import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, WEBFLOW_LEGACY_URL, WEBFLOW_URL, type ServerConfig, type Settings } from '../shared/types'
import { BRAND } from '../shared/brand'

// Env values, headers and OAuth tokens are encrypted with DPAPI (safeStorage)
// value by value, so the rest of config.json stays readable by hand.

const ENC = 'enc:'

function seal(v: string): string {
  // Still-sealed values (ones we couldn't decrypt) are written back untouched.
  if (v.startsWith(ENC) || !safeStorage.isEncryptionAvailable()) return v
  return ENC + safeStorage.encryptString(v).toString('base64')
}

/** On failure the sealed text is kept as-is, so a bad read never destroys a secret. */
function unseal(v: string): string {
  if (!v.startsWith(ENC)) return v
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(ENC.length), 'base64'))
  } catch {
    return v
  }
}

function mapValues(o: Record<string, string> | undefined, f: (v: string) => string): Record<string, string> | undefined {
  if (!o) return o
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]))
}

interface FileShape {
  settings: Settings
  servers: ServerConfig[]
  /** OAuth state per server id, sealed as one JSON blob. */
  auth: Record<string, string>
}

export class Store {
  private file: string
  private data: FileShape

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'config.json')
    this.data = this.load()
    if (!this.data.settings.token) {
      this.data.settings.token = newToken()
      this.save()
    }
  }

  private load(): FileShape {
    const base: FileShape = { settings: defaultSettings(), servers: [], auth: {} }
    if (!existsSync(this.file)) return base
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^﻿/, '')) as Partial<FileShape>
      const settings = { ...base.settings, ...raw.settings, theme: { ...base.settings.theme, ...raw.settings?.theme } }
      settings.token = unseal(settings.token)
      const servers = (raw.servers ?? []).map((s) => ({
        ...s,
        // Move Webflow servers saved with the old SSE address to Streamable HTTP; the sign-in carries over.
        ...(s.url === WEBFLOW_LEGACY_URL ? { url: WEBFLOW_URL, transport: 'http' as const } : {}),
        env: mapValues(s.env, unseal),
        headers: mapValues(s.headers, unseal)
      }))
      return { settings, servers, auth: raw.auth ?? {} }
    } catch {
      return base
    }
  }

  save(): void {
    const out: FileShape = {
      settings: { ...this.data.settings, token: seal(this.data.settings.token) },
      servers: this.data.servers.map((s) => ({ ...s, env: mapValues(s.env, seal), headers: mapValues(s.headers, seal) })),
      auth: this.data.auth
    }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(out, null, 2))
    renameSync(tmp, this.file)
  }

  get settings(): Settings {
    return this.data.settings
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch, theme: { ...this.data.settings.theme, ...patch.theme } }
    this.save()
    return this.data.settings
  }

  get servers(): ServerConfig[] {
    return this.data.servers
  }

  upsertServer(cfg: ServerConfig): void {
    const i = this.data.servers.findIndex((s) => s.id === cfg.id)
    if (i >= 0) this.data.servers[i] = cfg
    else this.data.servers.push(cfg)
    this.save()
  }

  removeServer(id: string): void {
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    delete this.data.auth[id]
    this.save()
  }

  reorder(ids: string[]): void {
    const byId = new Map(this.data.servers.map((s) => [s.id, s]))
    this.data.servers = ids.map((id) => byId.get(id)).filter((s): s is ServerConfig => !!s)
    this.save()
  }

  getAuth<T>(id: string): T | undefined {
    const v = this.data.auth[id]
    if (!v) return undefined
    try {
      return JSON.parse(unseal(v)) as T
    } catch {
      return undefined
    }
  }

  setAuth(id: string, value: unknown): void {
    if (value === undefined) delete this.data.auth[id]
    else this.data.auth[id] = seal(JSON.stringify(value))
    this.save()
  }
}

export function newToken(): string {
  return BRAND.tokenPrefix + randomBytes(24).toString('base64url')
}
