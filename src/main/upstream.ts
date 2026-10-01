import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import type { ServerConfig, ServerStatus, ServerView, ToolView } from '../shared/types'
import type { Store } from './store'
import { BRAND } from '../shared/brand'

const CONNECT_TIMEOUT_MS = 120_000
const STDERR_LINES = 400
const RESTART_BACKOFF = [2_000, 5_000, 15_000, 30_000, 60_000]

// ---------------------------------------------------------------------------
// Tool classification: annotations first, then words in the tool name.

const READ_WORDS = new Set(
  'get list search read fetch find query describe view show lookup check count inspect browse preview status info explain resolve stat stats diff summary summarize analyze analyse ls cat head tail grep peek validate compare export download screenshot snapshot'.split(
    ' '
  )
)
const WRITE_WORDS = new Set(
  'create update set add edit write put post patch upload insert move rename copy publish send run execute exec start stop restart install deploy apply commit push merge click type fill navigate press drag select'.split(
    ' '
  )
)
const DESTRUCTIVE_WORDS = new Set(
  'delete remove destroy drop purge erase wipe truncate reset revoke kill terminate unpublish archive rm rmdir overwrite force'.split(' ')
)

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function classify(tool: Tool): { kind: ToolView['kind']; inferred: boolean } {
  const a = tool.annotations
  if (a?.readOnlyHint === true) return { kind: 'read', inferred: false }
  if (a?.destructiveHint === true) return { kind: 'destructive', inferred: false }
  if (a?.destructiveHint === false) return { kind: 'write', inferred: false }
  const w = words(tool.name)
  if (w.some((x) => DESTRUCTIVE_WORDS.has(x))) return { kind: 'destructive', inferred: true }
  if (w.some((x) => WRITE_WORDS.has(x))) return { kind: 'write', inferred: true }
  if (w.some((x) => READ_WORDS.has(x))) return { kind: 'read', inferred: true }
  return { kind: 'write', inferred: true }
}

/** Namespaced, client-safe tool name (Anthropic and OpenAI both cap at 64 chars). */
export function exposedName(prefix: string, name: string): string {
  const full = `${prefix}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (full.length <= 64) return full
  const hash = createHash('sha1').update(full).digest('hex').slice(0, 6)
  return full.slice(0, 57) + '_' + hash
}

function isExposed(cfg: ServerConfig, tool: Tool, kind: ToolView['kind']): { exposed: boolean; overridden: boolean } {
  const o = cfg.overrides[tool.name]
  if (o !== undefined) return { exposed: o, overridden: true }
  const byPolicy =
    cfg.policy === 'all' ? true : cfg.policy === 'readonly' ? kind === 'read' : cfg.policy === 'safe' ? kind !== 'destructive' : false
  return { exposed: byPolicy, overridden: false }
}

// ---------------------------------------------------------------------------
// OAuth for remote servers. The browser redirects to the router's own
// /oauth/callback; `state` carries the server id so the router can route it.

interface AuthState {
  client?: Awaited<ReturnType<OAuthClientProvider['clientInformation']>>
  tokens?: Awaited<ReturnType<OAuthClientProvider['tokens']>>
  verifier?: string
}

class RouterAuthProvider implements OAuthClientProvider {
  pendingUrl?: URL
  constructor(
    private serverId: string,
    private store: Store,
    private redirect: string
  ) {}

  private get st(): AuthState {
    return this.store.getAuth<AuthState>(this.serverId) ?? {}
  }
  private patch(p: Partial<AuthState>): void {
    this.store.setAuth(this.serverId, { ...this.st, ...p })
  }

  get redirectUrl(): string {
    return this.redirect
  }
  get clientMetadata() {
    return {
      client_name: BRAND.name,
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }
  state(): string {
    return `${this.serverId}.${randomBytes(8).toString('hex')}`
  }
  clientInformation() {
    return this.st.client
  }
  saveClientInformation(info: AuthState['client']): void {
    this.patch({ client: info })
  }
  tokens() {
    return this.st.tokens
  }
  saveTokens(tokens: AuthState['tokens']): void {
    this.patch({ tokens })
  }
  redirectToAuthorization(url: URL): void {
    this.pendingUrl = url
  }
  saveCodeVerifier(v: string): void {
    this.patch({ verifier: v })
  }
  codeVerifier(): string {
    return this.st.verifier ?? ''
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') this.store.setAuth(this.serverId, undefined)
    else if (scope === 'client') this.patch({ client: undefined })
    else if (scope === 'tokens') this.patch({ tokens: undefined })
    else if (scope === 'verifier') this.patch({ verifier: undefined })
  }
}

// ---------------------------------------------------------------------------

export class Upstream {
  client?: Client
  transport?: Transport & { finishAuth?: (code: string) => Promise<void> }
  status: ServerStatus = 'stopped'
  error?: string
  tools: Tool[] = []
  prompts: Prompt[] = []
  resources: Resource[] = []
  templates: ResourceTemplate[] = []
  stderr: string[] = []
  startedAt?: number
  pid?: number
  instructions?: string
  auth?: RouterAuthProvider
  private attempts = 0
  private restartTimer?: NodeJS.Timeout
  private stopping = false
  private generation = 0

  constructor(
    public cfg: ServerConfig,
    private mgr: UpstreamManager
  ) {}

  view(): ServerView {
    const tools: ToolView[] = this.tools.map((t) => {
      const { kind, inferred } = classify(t)
      return {
        name: t.name,
        exposedAs: exposedName(this.cfg.prefix, t.name),
        description: t.description ?? '',
        annotations: t.annotations,
        kind,
        inferred,
        ...isExposed(this.cfg, t, kind)
      }
    })
    const v = this.client?.getServerVersion()
    return {
      config: this.cfg,
      status: this.status,
      error: this.error,
      serverInfo: v ? { name: v.name, version: v.version } : undefined,
      tools,
      promptCount: this.prompts.length,
      resourceCount: this.resources.length + this.templates.length,
      exposedCount: tools.filter((t) => t.exposed).length,
      startedAt: this.startedAt,
      pid: this.pid
    }
  }

  exposedTools(): { tool: Tool; name: string }[] {
    if (this.status !== 'ready') return []
    return this.tools
      .filter((t) => isExposed(this.cfg, t, classify(t).kind).exposed)
      .map((t) => ({ tool: t, name: exposedName(this.cfg.prefix, t.name) }))
  }

  private log(line: string): void {
    for (const l of line.split(/\r?\n/)) {
      if (!l) continue
      this.stderr.push(l)
    }
    if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES)
    this.mgr.emit('logs', this.cfg.id)
  }

  private set(status: ServerStatus, error?: string): void {
    this.status = status
    this.error = error
    this.mgr.changed()
  }

  private makeTransport(kind: 'stdio' | 'http' | 'sse'): Transport {
    const c = this.cfg
    if (kind === 'stdio') {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !k.startsWith('ELECTRON_')) env[k] = v
      }
      Object.assign(env, c.env)
      const t = new StdioClientTransport({
        command: c.command ?? '',
        args: c.args ?? [],
        cwd: c.cwd || undefined,
        env,
        stderr: 'pipe'
      })
      t.stderr?.on('data', (d: Buffer) => this.log(d.toString()))
      return t
    }
    const url = new URL(c.url ?? '')
    this.auth ??= new RouterAuthProvider(c.id, this.mgr.store, this.mgr.callbackUrl())
    const opts = { requestInit: { headers: { ...c.headers } }, authProvider: this.auth }
    return kind === 'http' ? new StreamableHTTPClientTransport(url, opts) : new SSEClientTransport(url, opts)
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return
    clearTimeout(this.restartTimer)
    this.stopping = false
    const gen = ++this.generation
    if (this.auth) this.auth.pendingUrl = undefined
    this.set('starting')
    this.log(`— starting ${this.cfg.transport === 'stdio' ? [this.cfg.command, ...(this.cfg.args ?? [])].join(' ') : this.cfg.url}`)

    const kinds: ('stdio' | 'http' | 'sse')[] = this.cfg.transport === 'http' ? ['http', 'sse'] : [this.cfg.transport]
    let lastErr: unknown
    for (const kind of kinds) {
      const client = new Client({ name: BRAND.name, version: '1.0.0' }, { capabilities: {} })
      const transport = this.makeTransport(kind) as Upstream['transport'] & Transport
      this.transport = transport
      try {
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'Timed out connecting')
        if (gen !== this.generation) {
          await client.close().catch(() => {})
          return
        }
        this.client = client
        deferResponses(transport)
        this.pid = transport instanceof StdioClientTransport ? (transport.pid ?? undefined) : undefined
        this.instructions = client.getInstructions()
        client.onclose = () => this.onClosed(gen)
        client.onerror = (e) => this.log(`! ${e.message}`)
        this.wireNotifications(client)
        await this.refresh()
        this.startedAt = Date.now()
        this.set('ready')
        this.log(`— connected via ${kind}: ${this.tools.length} tools`)
        setTimeout(() => {
          if (gen === this.generation && this.status === 'ready') this.attempts = 0
        }, 60_000)
        return
      } catch (e) {
        lastErr = e
        await client.close().catch(() => {})
        if (e instanceof UnauthorizedError || this.auth?.pendingUrl) {
          this.set('needs-auth', 'Sign-in required')
          this.log('— waiting for sign-in')
          return
        }
        this.log(`! ${kind}: ${errMsg(e)}`)
      }
    }
    if (gen !== this.generation) return
    this.set('error', errMsg(lastErr))
    this.scheduleRestart()
  }

  private wireNotifications(client: Client): void {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      await this.refresh().catch(() => {})
      this.mgr.changed()
    })
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      await this.refresh().catch(() => {})
      this.mgr.changed()
    })
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      await this.refresh().catch(() => {})
      this.mgr.changed()
    })
  }

  async refresh(): Promise<void> {
    const c = this.client
    if (!c) return
    const caps = c.getServerCapabilities() ?? {}
    this.tools = caps.tools ? await paged((cursor) => c.listTools({ cursor }).then((r) => [r.tools, r.nextCursor])) : []
    this.prompts = caps.prompts ? await paged((cursor) => c.listPrompts({ cursor }).then((r) => [r.prompts, r.nextCursor])).catch(() => []) : []
    if (caps.resources) {
      this.resources = await paged((cursor) => c.listResources({ cursor }).then((r) => [r.resources, r.nextCursor])).catch(() => [])
      this.templates = await paged((cursor) =>
        c.listResourceTemplates({ cursor }).then((r) => [r.resourceTemplates, r.nextCursor])
      ).catch(() => [])
    } else {
      this.resources = []
      this.templates = []
    }
  }

  private onClosed(gen: number): void {
    if (gen !== this.generation || this.stopping) return
    this.client = undefined
    this.tools = []
    this.prompts = []
    this.resources = []
    this.templates = []
    this.log('! connection closed')
    this.set('error', 'Connection closed')
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (!this.cfg.enabled || this.stopping) return
    const delay = RESTART_BACKOFF[this.attempts]
    if (delay === undefined) {
      this.log('— giving up after repeated failures; restart it manually')
      return
    }
    this.attempts++
    this.log(`— retrying in ${Math.round(delay / 1000)}s`)
    this.restartTimer = setTimeout(() => void this.start(), delay)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.generation++
    clearTimeout(this.restartTimer)
    const c = this.client
    this.client = undefined
    this.tools = []
    this.prompts = []
    this.resources = []
    this.templates = []
    this.pid = undefined
    this.startedAt = undefined
    await c?.close().catch(() => {})
    await this.transport?.close().catch(() => {})
    this.transport = undefined
    this.set('stopped')
  }

  async restart(): Promise<void> {
    this.attempts = 0
    await this.stop()
    await this.start()
  }

  async finishAuth(code: string): Promise<void> {
    const t = this.transport
    if (!t?.finishAuth) throw new Error('No sign-in in progress')
    await t.finishAuth(code)
    this.auth!.pendingUrl = undefined
    await this.restart()
  }

  signOut(): void {
    this.mgr.store.setAuth(this.cfg.id, undefined)
    if (this.auth) this.auth.pendingUrl = undefined
  }
}

// ---------------------------------------------------------------------------

export class UpstreamManager extends EventEmitter {
  private list = new Map<string, Upstream>()
  private changeTimer?: NodeJS.Timeout

  constructor(
    public store: Store,
    public callbackUrl: () => string
  ) {
    super()
  }

  all(): Upstream[] {
    return this.store.servers.map((s) => this.list.get(s.id)).filter((u): u is Upstream => !!u)
  }

  get(id: string): Upstream | undefined {
    return this.list.get(id)
  }

  /** Debounced: many servers finishing startup at once become one update. */
  changed(): void {
    clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => this.emit('changed'), 40)
  }

  async startAll(): Promise<void> {
    for (const cfg of this.store.servers) {
      const u = new Upstream(cfg, this)
      this.list.set(cfg.id, u)
    }
    this.changed()
    await Promise.all(this.all().map((u) => u.start()))
  }

  async add(cfg: ServerConfig): Promise<void> {
    this.store.upsertServer(cfg)
    const u = new Upstream(cfg, this)
    this.list.set(cfg.id, u)
    this.changed()
    await u.start()
  }

  /** Applies a config change, restarting only when connection settings changed. */
  async update(cfg: ServerConfig): Promise<void> {
    const u = this.list.get(cfg.id)
    this.store.upsertServer(cfg)
    if (!u) return this.add(cfg)
    const prev = u.cfg
    u.cfg = cfg
    const conn = (c: ServerConfig) => JSON.stringify([c.transport, c.command, c.args, c.cwd, c.env, c.url, c.headers])
    if (!cfg.enabled) await u.stop()
    else if (!prev.enabled || conn(prev) !== conn(cfg)) await u.restart()
    this.changed()
  }

  async remove(id: string): Promise<void> {
    const u = this.list.get(id)
    this.list.delete(id)
    this.store.removeServer(id)
    await u?.stop()
    this.changed()
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.all().map((u) => u.stop()))
  }

  /** Every exposed tool across servers, keyed by exposed name (first server wins a clash). */
  toolIndex(): Map<string, { up: Upstream; tool: Tool }> {
    const m = new Map<string, { up: Upstream; tool: Tool }>()
    for (const up of this.all()) {
      for (const { tool, name } of up.exposedTools()) if (!m.has(name)) m.set(name, { up, tool })
    }
    return m
  }

  promptIndex(): Map<string, { up: Upstream; prompt: Prompt }> {
    const m = new Map<string, { up: Upstream; prompt: Prompt }>()
    for (const up of this.all()) {
      if (up.status !== 'ready') continue
      for (const p of up.prompts) {
        const name = exposedName(up.cfg.prefix, p.name)
        if (!m.has(name)) m.set(name, { up, prompt: p })
      }
    }
    return m
  }
}

// ---------------------------------------------------------------------------

/**
 * The SDK handles progress notifications a microtask late but responses at once, so
 * when a server's last progress update and its result arrive in the same chunk the
 * result wins and the update is dropped. Holding each response back one macrotask
 * lets every notification ahead of it be handled first.
 */
function deferResponses(transport: Transport): void {
  const deliver = transport.onmessage
  if (!deliver) return
  transport.onmessage = (message, extra) => {
    if ('result' in message || 'error' in message) setImmediate(() => deliver(message, extra))
    else deliver(message, extra)
  }
}

async function paged<T>(page: (cursor?: string) => Promise<[T[], string | undefined]>): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let i = 0; i < 50; i++) {
    const [items, next] = await page(cursor)
    out.push(...items)
    if (!next) break
    cursor = next
  }
  return out
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: NodeJS.Timeout
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() => clearTimeout(t))
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
