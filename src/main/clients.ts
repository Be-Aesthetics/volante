import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ClientId, ClientView, ImportCandidate, ServerConfig } from '../shared/types'
import { BRAND } from '../shared/brand'

// Each AI app keeps its MCP servers in a JSON (or TOML) file. The router adds a
// single entry named after the brand there: direct HTTP where the app supports it, or a
// stdio bridge (the app's own executable in Node mode) where it doesn't.

const KEY = BRAND.clientKey
const home = homedir()
const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')

export interface Endpoint {
  url: string
  token: string
  requireToken: boolean
}

interface JsonClient {
  id: ClientId
  name: string
  mode: 'bridge' | 'http'
  /** Config files to write; the first existing one is read for status. */
  paths: () => string[]
  installed: () => boolean
  serversKey: 'mcpServers' | 'servers'
  entry: (ep: Endpoint) => Record<string, unknown>
  note?: string
}

function authHeaders(ep: Endpoint): Record<string, string> | undefined {
  return ep.requireToken ? { Authorization: `Bearer ${ep.token}` } : undefined
}

export function bridgeEntry(ep: Endpoint): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', ROUTER_URL: ep.url }
  if (ep.requireToken) env.ROUTER_TOKEN = ep.token
  if (app.isPackaged) env.ROUTER_EXE = process.execPath
  return { command: process.execPath, args: [join(__dirname, 'bridge.js')], env }
}

function claudeDesktopPaths(): string[] {
  const out: string[] = []
  const pk = join(localAppData, 'Packages')
  if (existsSync(pk)) {
    for (const d of readdirSync(pk)) {
      if (/^(AnthropicPBC\.)?Claude_/i.test(d)) out.push(join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'))
    }
  }
  out.push(join(appData, 'Claude', 'claude_desktop_config.json'))
  const present = out.filter((p) => existsSync(dirname(p)))
  return present.length ? present : [out[out.length - 1]]
}

const CLIENTS: JsonClient[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    mode: 'bridge',
    paths: claudeDesktopPaths,
    installed: () => claudeDesktopPaths().some((p) => existsSync(dirname(p))),
    serversKey: 'mcpServers',
    entry: (ep) => bridgeEntry(ep),
    note: 'Restart Claude Desktop to pick up the change.'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    mode: 'http',
    paths: () => [join(home, '.claude.json')],
    installed: () => existsSync(join(home, '.claude.json')) || existsSync(join(home, '.claude')),
    serversKey: 'mcpServers',
    entry: (ep) => ({ type: 'http', url: ep.url, ...(authHeaders(ep) ? { headers: authHeaders(ep) } : {}) }),
    note: 'Added at user scope, so every project sees it.'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mode: 'http',
    paths: () => [join(home, '.cursor', 'mcp.json')],
    installed: () => existsSync(join(home, '.cursor')),
    serversKey: 'mcpServers',
    entry: (ep) => ({ url: ep.url, ...(authHeaders(ep) ? { headers: authHeaders(ep) } : {}) })
  },
  {
    id: 'vscode',
    name: 'VS Code',
    mode: 'http',
    paths: () => [join(appData, 'Code', 'User', 'mcp.json')],
    installed: () => existsSync(join(appData, 'Code', 'User')),
    serversKey: 'servers',
    entry: (ep) => ({ type: 'http', url: ep.url, ...(authHeaders(ep) ? { headers: authHeaders(ep) } : {}) })
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    mode: 'http',
    paths: () => [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    installed: () => existsSync(join(home, '.codeium', 'windsurf')),
    serversKey: 'mcpServers',
    entry: (ep) => ({ serverUrl: ep.url, ...(authHeaders(ep) ? { headers: authHeaders(ep) } : {}) })
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    mode: 'http',
    paths: () => [join(home, '.gemini', 'settings.json')],
    installed: () => existsSync(join(home, '.gemini')),
    serversKey: 'mcpServers',
    entry: (ep) => ({ httpUrl: ep.url, ...(authHeaders(ep) ? { headers: authHeaders(ep) } : {}) })
  }
]

const CODEX_PATH = join(home, '.codex', 'config.toml')

// ---------------------------------------------------------------------------
// JSON files: tolerate comments and trailing commas (VS Code writes JSONC).

function stripJsonc(s: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      out += c
      if (c === '\\') out += s[++i] ?? ''
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
      out += c
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '')
  if (!raw.trim()) return {}
  return JSON.parse(stripJsonc(raw)) as Record<string, unknown>
}

/** Keeps the very first original around, then writes the new content. */
function backupAndWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const bak = `${path}.${KEY}.bak`
  if (existsSync(path) && !existsSync(bak)) copyFileSync(path, bak)
  writeFileSync(path, content)
}

function servers(json: Record<string, unknown>, key: string): Record<string, Record<string, unknown>> {
  const v = json[key]
  return v && typeof v === 'object' ? (v as Record<string, Record<string, unknown>>) : {}
}

// ---------------------------------------------------------------------------
// Codex keeps TOML; only our own [mcp_servers.<key>] block is touched.

const tomlStr = (s: string): string => (s.includes("'") ? JSON.stringify(s) : `'${s}'`)

function codexBlock(ep: Endpoint): string {
  const b = bridgeEntry(ep)
  const env = Object.entries(b.env)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ')
  return `[mcp_servers.${KEY}]\ncommand = ${tomlStr(b.command)}\nargs = [${b.args.map(tomlStr).join(', ')}]\nenv = { ${env} }\n`
}

function stripCodexBlock(toml: string): string {
  const lines = toml.split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const l of lines) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(l)
    if (h) skipping = h[1] === `mcp_servers.${KEY}` || h[1].startsWith(`mcp_servers.${KEY}.`)
    if (!skipping) out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

// ---------------------------------------------------------------------------

export function listClients(): ClientView[] {
  const out: ClientView[] = CLIENTS.map((c) => {
    const path = c.paths()[0]
    let connected = false
    try {
      connected = c.paths().some((p) => KEY in servers(readJson(p), c.serversKey))
    } catch {
      /* unreadable config; treat as not connected */
    }
    return { id: c.id, name: c.name, installed: c.installed(), connected, configPath: path, mode: c.mode, note: c.note }
  })
  let codexConnected = false
  try {
    codexConnected = existsSync(CODEX_PATH) && readFileSync(CODEX_PATH, 'utf8').includes(`[mcp_servers.${KEY}]`)
  } catch {
    /* ignore */
  }
  out.push({
    id: 'codex',
    name: 'Codex',
    installed: existsSync(join(home, '.codex')),
    connected: codexConnected,
    configPath: CODEX_PATH,
    mode: 'bridge',
    note: 'Restart Codex to pick up the change.'
  })
  return out
}

export function connectClient(id: ClientId, ep: Endpoint): void {
  if (id === 'codex') {
    const cur = existsSync(CODEX_PATH) ? readFileSync(CODEX_PATH, 'utf8') : ''
    const next = stripCodexBlock(cur).trimEnd()
    backupAndWrite(CODEX_PATH, (next ? next + '\n\n' : '') + codexBlock(ep))
    return
  }
  const c = CLIENTS.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown client ${id}`)
  for (const p of c.paths()) {
    const json = readJson(p)
    json[c.serversKey] = { ...servers(json, c.serversKey), [KEY]: c.entry(ep) }
    backupAndWrite(p, JSON.stringify(json, null, 2))
  }
}

export function disconnectClient(id: ClientId): void {
  if (id === 'codex') {
    if (existsSync(CODEX_PATH)) backupAndWrite(CODEX_PATH, stripCodexBlock(readFileSync(CODEX_PATH, 'utf8')))
    return
  }
  const c = CLIENTS.find((x) => x.id === id)
  if (!c) return
  for (const p of c.paths()) {
    if (!existsSync(p)) continue
    const json = readJson(p)
    const s = servers(json, c.serversKey)
    if (!(KEY in s)) continue
    delete s[KEY]
    json[c.serversKey] = s
    backupAndWrite(p, JSON.stringify(json, null, 2))
  }
}

/** Refreshes existing connections, e.g. after the port or token changed. */
export function refreshConnected(ep: Endpoint): void {
  for (const c of listClients()) {
    if (c.connected) {
      try {
        connectClient(c.id, ep)
      } catch {
        /* leave it; the Connect page will show the state */
      }
    }
  }
}

export function snippet(id: ClientId, ep: Endpoint): string {
  if (id === 'codex') return codexBlock(ep)
  const c = CLIENTS.find((x) => x.id === id)!
  return JSON.stringify({ [c.serversKey]: { [KEY]: c.entry(ep) } }, null, 2)
}

// ---------------------------------------------------------------------------
// Import: pull servers other apps already know about.

function toConfig(raw: Record<string, unknown>): ImportCandidate['config'] | undefined {
  const url = (raw.url ?? raw.serverUrl ?? raw.httpUrl) as string | undefined
  const headers = raw.headers as Record<string, string> | undefined
  if (typeof raw.command === 'string') {
    return {
      name: '',
      transport: 'stdio',
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
      env: (raw.env as Record<string, string>) ?? {},
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined
    }
  }
  if (typeof url === 'string') {
    const t = String(raw.type ?? raw.transport ?? '')
    return { name: '', transport: t === 'sse' || /\/sse\/?$/.test(url) ? 'sse' : 'http', url, headers: headers ?? {} }
  }
  return undefined
}

function sameServer(a: Partial<ServerConfig>, b: Partial<ServerConfig>): boolean {
  if (a.url || b.url) return !!a.url && a.url === b.url
  return a.command === b.command && JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? [])
}

export function importCandidates(existing: ServerConfig[]): ImportCandidate[] {
  const out: ImportCandidate[] = []
  for (const c of CLIENTS) {
    for (const p of c.paths()) {
      let json: Record<string, unknown>
      try {
        json = readJson(p)
      } catch {
        continue
      }
      for (const [key, raw] of Object.entries(servers(json, c.serversKey))) {
        if (key === KEY || !raw || typeof raw !== 'object') continue
        const cfg = toConfig(raw)
        if (!cfg) continue
        cfg.name = key
        if (out.some((o) => sameServer(o.config, cfg))) continue
        out.push({
          client: c.id,
          clientName: c.name,
          key,
          config: cfg,
          alreadyAdded: existing.some((e) => sameServer(e, cfg))
        })
      }
    }
  }
  return out
}

/** Removes imported servers from the app they came from so tools aren't doubled. */
export function removeFromClient(id: ClientId, key: string): void {
  const c = CLIENTS.find((x) => x.id === id)
  if (!c || key === KEY) return
  for (const p of c.paths()) {
    if (!existsSync(p)) continue
    const json = readJson(p)
    const s = servers(json, c.serversKey)
    if (!(key in s)) continue
    delete s[key]
    json[c.serversKey] = s
    backupAndWrite(p, JSON.stringify(json, null, 2))
  }
}
