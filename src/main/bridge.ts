// stdio <-> Streamable HTTP relay for apps that can only launch local MCP
// processes (Claude Desktop, Codex). Runs under ELECTRON_RUN_AS_NODE, so it
// is plain Node: no windows, no Electron APIs. If the router app isn't running and we
// know where it lives, start it in the tray and wait for the endpoint.

import { spawn } from 'node:child_process'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

const url = new URL(process.env.ROUTER_URL ?? 'http://127.0.0.1:47800/mcp')
const token = process.env.ROUTER_TOKEN
const exe = process.env.ROUTER_EXE

const log = (m: string): void => void process.stderr.write(`[mcp-bridge] ${m}\n`)

async function alive(): Promise<boolean> {
  try {
    const r = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

async function ensureRunning(): Promise<boolean> {
  if (await alive()) return true
  if (!exe) return false
  log('router is not running; starting it')
  spawn(exe, ['--hidden'], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }).unref()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await alive()) return true
  }
  return false
}

async function main(): Promise<void> {
  const ok = await ensureRunning()
  if (!ok) log(`cannot reach ${url.href}; requests will fail until the router is running`)

  const up = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  })
  const down = new StdioServerTransport()
  const initIds = new Set<string | number>()

  down.onmessage = async (m: JSONRPCMessage) => {
    if ('method' in m && m.method === 'initialize' && 'id' in m) initIds.add(m.id)
    try {
      await up.send(m)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log(msg)
      if ('id' in m && 'method' in m) {
        await down.send({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: `Router is unreachable: ${msg}` } })
      }
    }
  }
  up.onmessage = async (m: JSONRPCMessage) => {
    if ('result' in m && initIds.has(m.id)) {
      initIds.delete(m.id)
      const v = (m.result as { protocolVersion?: string }).protocolVersion
      if (v) up.setProtocolVersion(v)
    }
    await down.send(m)
  }
  up.onerror = (e) => log(e.message)
  down.onclose = () => {
    void up
      .terminateSession()
      .catch(() => {})
      .then(() => up.close())
      .finally(() => process.exit(0))
  }
  up.onclose = () => process.exit(0)

  await up.start()
  await down.start()
}

main().catch((e) => {
  log(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
