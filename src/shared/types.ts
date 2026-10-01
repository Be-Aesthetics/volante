export type ThemeMode = 'system' | 'light' | 'dark'
import { BRAND } from './brand'

export const DEFAULT_ACCENT = BRAND.accent
export const DEFAULT_PORT = BRAND.port

export type TransportKind = 'stdio' | 'http' | 'sse'

/**
 * Which tools a server exposes through the router.
 * all       every tool
 * readonly  only tools marked (or named like) read-only
 * safe      everything except tools marked (or named like) destructive
 * custom    nothing unless switched on individually
 * Per-tool overrides always win over the policy.
 */
export type ToolPolicy = 'all' | 'readonly' | 'safe' | 'custom'

export interface ServerConfig {
  id: string
  name: string
  /** Namespace prepended to tool and prompt names: `<prefix>__<tool>`. */
  prefix: string
  enabled: boolean
  transport: TransportKind
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  policy: ToolPolicy
  overrides: Record<string, boolean>
  /** Where it came from, shown as a hint in the UI. */
  source?: string
}

export type ServerStatus = 'stopped' | 'starting' | 'ready' | 'error' | 'needs-auth'

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolView {
  name: string
  exposedAs: string
  description: string
  annotations?: ToolAnnotations
  /** read-only / destructive, as declared or inferred from the name. */
  kind: 'read' | 'write' | 'destructive'
  inferred: boolean
  exposed: boolean
  overridden: boolean
}

export interface ServerView {
  config: ServerConfig
  status: ServerStatus
  error?: string
  serverInfo?: { name: string; version: string }
  tools: ToolView[]
  promptCount: number
  resourceCount: number
  exposedCount: number
  startedAt?: number
  pid?: number
}

export interface ThemeSettings {
  mode: ThemeMode
  accent: string
}

export interface Settings {
  port: number
  token: string
  requireToken: boolean
  theme: ThemeSettings
  launchAtLogin: boolean
  startHidden: boolean
  closeToTray: boolean
}

export interface RouterStatus {
  running: boolean
  url: string
  error?: string
  sessions: { id: string; client: string; since: number }[]
}

export type ClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode' | 'windsurf' | 'gemini' | 'codex'

export interface ClientView {
  id: ClientId
  name: string
  installed: boolean
  connected: boolean
  configPath: string
  /** stdio bridge or direct HTTP */
  mode: 'bridge' | 'http'
  note?: string
}

export interface ImportCandidate {
  client: ClientId
  clientName: string
  key: string
  config: Omit<ServerConfig, 'id' | 'policy' | 'overrides' | 'enabled' | 'prefix'>
  alreadyAdded: boolean
}

export interface ActivityEntry {
  id: number
  ts: number
  kind: 'tool' | 'prompt' | 'resource' | 'session'
  serverId?: string
  server?: string
  name: string
  client?: string
  ms?: number
  ok: boolean
  error?: string
  args?: string
  result?: string
}

export interface AppState {
  settings: Settings
  servers: ServerView[]
  router: RouterStatus
}

export function defaultSettings(): Settings {
  return {
    port: DEFAULT_PORT,
    token: '',
    requireToken: true,
    theme: { mode: BRAND.defaultMode, accent: DEFAULT_ACCENT },
    launchAtLogin: false,
    startHidden: false,
    closeToTray: true
  }
}

/** Turns a display name into a tool-name-safe prefix. */
export function slugPrefix(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  return s || 'server'
}

// Webflow: one server per workspace, each with its own sign-in.
// Streamable HTTP. Webflow's older /sse address answers 400 once signed in.
export const WEBFLOW_URL = 'https://mcp.webflow.com/mcp'
export const WEBFLOW_LEGACY_URL = 'https://mcp.webflow.com/sse'
export const WEBFLOW_PREFIX = 'Webflow – '

export function isWebflow(c: Pick<ServerConfig, 'url'>): boolean {
  return !!c.url && /(^|\/\/)mcp\.webflow\.com\//.test(c.url)
}

/** "Webflow – Acme Studio" → "Acme Studio". */
export function webflowWorkspace(c: Pick<ServerConfig, 'name'>): string {
  return c.name.startsWith(WEBFLOW_PREFIX) ? c.name.slice(WEBFLOW_PREFIX.length) : c.name
}
