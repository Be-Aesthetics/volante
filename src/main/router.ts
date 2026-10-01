import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
  type CallToolResult
} from '@modelcontextprotocol/sdk/types.js'
import type { ActivityEntry, RouterStatus } from '../shared/types'
import { errMsg, type UpstreamManager } from './upstream'
import type { Store } from './store'
import { BRAND } from '../shared/brand'

const CALL_TIMEOUT_MS = 10 * 60_000
const ACTIVITY_MAX = 1000
const PREVIEW = 4000

// ---------------------------------------------------------------------------

export class Activity extends EventEmitter {
  entries: ActivityEntry[] = []
  private seq = 0

  add(e: Omit<ActivityEntry, 'id' | 'ts'> & { ts?: number }): ActivityEntry {
    const entry: ActivityEntry = { id: ++this.seq, ts: e.ts ?? Date.now(), ...e }
    this.entries.push(entry)
    if (this.entries.length > ACTIVITY_MAX) this.entries.splice(0, this.entries.length - ACTIVITY_MAX)
    this.emit('entry', entry)
    return entry
  }

  clear(): void {
    this.entries = []
    this.emit('cleared')
  }
}

function preview(v: unknown): string | undefined {
  if (v === undefined) return undefined
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > PREVIEW ? s.slice(0, PREVIEW) + '\n…' : s
}

function resultText(r: CallToolResult): string {
  const parts = (r.content ?? []).map((c) => {
    if (c.type === 'text') return c.text
    if (c.type === 'image') return `[image ${c.mimeType}]`
    if (c.type === 'audio') return `[audio ${c.mimeType}]`
    if (c.type === 'resource') return `[resource ${c.resource.uri}]`
    if (c.type === 'resource_link') return `[link ${c.uri}]`
    return `[${(c as { type: string }).type}]`
  })
  return parts.join('\n')
}

// ---------------------------------------------------------------------------

interface Session {
  transport: StreamableHTTPServerTransport
  server: Server
  client: string
  since: number
  lastSeen: number
  /** Open GET event streams; a session holding one is alive even when quiet. */
  streams: number
}

const SESSION_IDLE_MS = 15 * 60_000

export class Router extends EventEmitter {
  private http?: HttpServer
  private sweeper?: NodeJS.Timeout
  private sessions = new Map<string, Session>()
  running = false
  error?: string
  onOAuthCallback?: (serverId: string, code: string | null, error: string | null) => Promise<void>

  constructor(
    private store: Store,
    private ups: UpstreamManager,
    private activity: Activity
  ) {
    super()
    ups.on('changed', () => this.broadcastListChanged())
  }

  get port(): number {
    return this.store.settings.port
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  status(): RouterStatus {
    return {
      running: this.running,
      url: this.url,
      error: this.error,
      sessions: [...this.sessions.entries()].map(([id, s]) => ({ id, client: s.client, since: s.since }))
    }
  }

  async start(): Promise<void> {
    await this.stop()
    const http = createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        if (!res.headersSent) sendJson(res, 500, rpcError(-32603, errMsg(e)))
      })
    })
    this.http = http
    await new Promise<void>((resolve) => {
      http.once('error', (e: NodeJS.ErrnoException) => {
        this.running = false
        this.error = e.code === 'EADDRINUSE' ? `Port ${this.port} is already in use` : e.message
        this.emit('changed')
        resolve()
      })
      http.listen(this.port, '127.0.0.1', () => {
        this.running = true
        this.error = undefined
        this.emit('changed')
        resolve()
      })
    })
    this.sweeper = setInterval(() => this.sweep(), 60_000)
  }

  /** Drops sessions whose client went away without saying goodbye. */
  private sweep(): void {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      if (s.streams > 0 || now - s.lastSeen < SESSION_IDLE_MS) continue
      this.sessions.delete(id)
      void s.transport.close().catch(() => {})
      this.emit('changed')
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.sweeper)
    for (const [, s] of this.sessions) await s.transport.close().catch(() => {})
    this.sessions.clear()
    const h = this.http
    this.http = undefined
    this.running = false
    if (h) {
      h.closeAllConnections()
      await new Promise<void>((r) => h.close(() => r()))
    }
  }

  private authorized(req: IncomingMessage): boolean {
    if (!this.store.settings.requireToken) return true
    const h = req.headers.authorization ?? ''
    const m = /^Bearer\s+(.+)$/i.exec(h)
    if (!m) return false
    const a = Buffer.from(m[1].trim())
    const b = Buffer.from(this.store.settings.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)

    // DNS-rebinding guard: only accept requests addressed to loopback.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return sendJson(res, 403, { error: 'forbidden host' })
    const origin = req.headers.origin
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin) && origin !== 'null')
      return sendJson(res, 403, { error: 'forbidden origin' })

    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, name: BRAND.clientKey })
    if (url.pathname === '/oauth/callback') return this.oauthCallback(url, res)
    if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' })

    if (!this.authorized(req)) {
      res.setHeader('WWW-Authenticate', `Bearer realm="${BRAND.clientKey}"`)
      return sendJson(res, 401, rpcError(-32001, `Missing or invalid ${BRAND.name} token`))
    }

    const sid = req.headers['mcp-session-id']
    const existing = typeof sid === 'string' ? this.sessions.get(sid) : undefined
    if (existing) {
      existing.lastSeen = Date.now()
      if (req.method === 'GET') {
        existing.streams++
        res.on('close', () => {
          existing.streams--
          existing.lastSeen = Date.now()
        })
      }
      return existing.transport.handleRequest(req, res)
    }

    if (sid) return sendJson(res, 404, rpcError(-32001, 'Session not found'))
    if (req.method !== 'POST') return sendJson(res, 405, rpcError(-32000, 'Method not allowed'))

    const body = await readJson(req)
    const init = Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body)
    if (!init) return sendJson(res, 400, rpcError(-32000, 'Bad request: no session'))

    const server = this.makeServer()
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, server, client: 'unknown', since: Date.now(), lastSeen: Date.now(), streams: 0 })
        this.emit('changed')
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id && this.sessions.delete(id)) this.emit('changed')
    }
    server.oninitialized = () => {
      const id = transport.sessionId
      const info = server.getClientVersion()
      const s = id ? this.sessions.get(id) : undefined
      if (s && info) s.client = info.name
      this.activity.add({ kind: 'session', name: 'connected', client: info?.name, ok: true })
      this.emit('changed')
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  private async oauthCallback(url: URL, res: ServerResponse): Promise<void> {
    const state = url.searchParams.get('state') ?? ''
    const serverId = state.split('.')[0]
    const code = url.searchParams.get('code')
    const err = url.searchParams.get('error_description') ?? url.searchParams.get('error')
    let ok = !!code && !err
    let msg = ok ? `Signed in. You can close this tab and return to ${BRAND.name}.` : `Sign-in failed: ${err ?? 'no code returned'}`
    try {
      await this.onOAuthCallback?.(serverId, code, err)
    } catch (e) {
      ok = false
      msg = `Sign-in failed: ${errMsg(e)}`
    }
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
    res.end(callbackPage(ok, msg))
  }

  private instructions(): string {
    const ups = this.ups.all().filter((u) => u.status === 'ready')
    if (!ups.length) return `${BRAND.name} routes to your local MCP servers. None are connected right now.`
    const lines = ups.map((u) => {
      const head = `- ${u.cfg.name}: tools are prefixed "${u.cfg.prefix}__".`
      return u.instructions ? `${head}\n  ${u.instructions.replace(/\n/g, '\n  ')}` : head
    })
    return `${BRAND.name} routes to several MCP servers through one connection.\n${lines.join('\n')}`
  }

  private makeServer(): Server {
    const server = new Server(
      { name: BRAND.clientKey, version: '1.0.0' },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true }
        },
        instructions: this.instructions()
      }
    )
    const clientName = (): string | undefined => server.getClientVersion()?.name

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...this.ups.toolIndex().entries()].map(([name, { up, tool }]) => ({
        ...tool,
        name,
        description: `[${up.cfg.name}] ${tool.description ?? ''}`.trim()
      }))
    }))

    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const name = req.params.name
      const hit = this.ups.toolIndex().get(name)
      const started = Date.now()
      const base = { kind: 'tool' as const, name, client: clientName(), args: preview(req.params.arguments) }
      if (!hit || !hit.up.client) {
        this.activity.add({ ...base, ok: false, error: 'Unknown or disabled tool', ms: 0 })
        return { isError: true, content: [{ type: 'text', text: `${BRAND.name}: tool "${name}" is not available. It may be disabled or its server is offline.` }] }
      }
      const { up, tool } = hit
      const token = req.params._meta?.progressToken
      // Progress is relayed as it arrives; the result waits for every relay so it never overtakes the last update.
      const relays: Promise<void>[] = []
      try {
        const r = (await up.client!.callTool({ name: tool.name, arguments: req.params.arguments }, undefined, {
          signal: extra.signal,
          timeout: CALL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          onprogress:
            token !== undefined
              ? (p) => relays.push(extra.sendNotification({ method: 'notifications/progress', params: { ...p, progressToken: token } }).catch(() => {}))
              : undefined
        })) as CallToolResult
        await Promise.all(relays)
        this.activity.add({
          ...base,
          name: tool.name,
          serverId: up.cfg.id,
          server: up.cfg.name,
          ms: Date.now() - started,
          ok: !r.isError,
          error: r.isError ? resultText(r).slice(0, 300) : undefined,
          result: preview(resultText(r))
        })
        return r
      } catch (e) {
        this.activity.add({ ...base, name: tool.name, serverId: up.cfg.id, server: up.cfg.name, ms: Date.now() - started, ok: false, error: errMsg(e) })
        return { isError: true, content: [{ type: 'text', text: `${up.cfg.name}: ${errMsg(e)}` }] }
      }
    })

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [...this.ups.promptIndex().entries()].map(([name, { up, prompt }]) => ({
        ...prompt,
        name,
        description: `[${up.cfg.name}] ${prompt.description ?? ''}`.trim()
      }))
    }))

    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const hit = this.ups.promptIndex().get(req.params.name)
      if (!hit?.up.client) throw new Error(`Unknown prompt: ${req.params.name}`)
      const r = await hit.up.client.getPrompt({ name: hit.prompt.name, arguments: req.params.arguments })
      this.activity.add({ kind: 'prompt', name: hit.prompt.name, serverId: hit.up.cfg.id, server: hit.up.cfg.name, client: clientName(), ok: true })
      return r
    })

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.ups
        .all()
        .filter((u) => u.status === 'ready')
        .flatMap((u) => u.resources.map((r) => ({ ...r, description: `[${u.cfg.name}] ${r.description ?? ''}`.trim() })))
    }))

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: this.ups
        .all()
        .filter((u) => u.status === 'ready')
        .flatMap((u) => u.templates.map((t) => ({ ...t, description: `[${u.cfg.name}] ${t.description ?? ''}`.trim() })))
    }))

    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const uri = req.params.uri
      const ready = this.ups.all().filter((u) => u.status === 'ready' && u.client)
      const owner = ready.find((u) => u.resources.some((r) => r.uri === uri))
      const candidates = owner ? [owner] : ready.filter((u) => u.templates.length || u.resources.length)
      let last: unknown
      for (const up of candidates) {
        try {
          const r = await up.client!.readResource({ uri })
          this.activity.add({ kind: 'resource', name: uri, serverId: up.cfg.id, server: up.cfg.name, client: clientName(), ok: true })
          return r
        } catch (e) {
          last = e
        }
      }
      throw new Error(last ? errMsg(last) : `Unknown resource: ${uri}`)
    })

    return server
  }

  private broadcastListChanged(): void {
    for (const [, s] of this.sessions) {
      void s.server.sendToolListChanged().catch(() => {})
      void s.server.sendPromptListChanged().catch(() => {})
      void s.server.sendResourceListChanged().catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 8 * 1024 * 1024) throw new Error('Request body too large')
    chunks.push(c as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

function callbackPage(ok: boolean, msg: string): string {
  const esc = msg.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>${BRAND.name}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#e4eaf1;font:15px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
.c{text-align:center;max-width:420px;padding:24px}h1{font:400 26px Georgia,serif;margin:14px 0 8px}p{color:#97a5b4;margin:0}
.d{width:10px;height:10px;border-radius:50%;margin:0 auto;background:${ok ? '#2fb36e' : '#e0574f'};box-shadow:0 0 14px ${ok ? '#2fb36e' : '#e0574f'}}</style>
<div class="c"><div class="d"></div><h1>${ok ? 'Connected' : 'Something went wrong'}</h1><p>${esc}</p></div>`
}
