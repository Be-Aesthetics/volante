// End-to-end check against a running Volante. Expects the three fixture servers
// seeded by the test config (prefixes fx, ro, safe).
// Usage: ROUTER_URL=... ROUTER_TOKEN=... [OUT_DIR=out-volante] node scripts/smoke-test.cjs
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { join } = require('node:path')

const url = process.env.ROUTER_URL
const token = process.env.ROUTER_TOKEN
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}
const text = (r) => r.content.map((c) => c.text).join('\n')

async function main() {
  // 1. auth
  const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' })
  check('rejects a wrong token', bad.status === 401, `status ${bad.status}`)
  // fetch won't send a custom Host, so use a raw request (what a DNS-rebinding page would produce).
  const u = new URL(url)
  const evil = await new Promise((res) => {
    const r = require('node:http').request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { host: `evil.example:${u.port}`, authorization: `Bearer ${token}` } },
      (resp) => res(resp.statusCode)
    )
    r.on('error', () => res(0))
    r.end('{}')
  })
  check('rejects a foreign Host header', evil === 403, `status ${evil}`)

  // 2. HTTP client
  const c = new Client({ name: 'smoke-http', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  // The fixture servers start in parallel with the app; wait until all three have reported in.
  let names = []
  for (let i = 0; i < 30; i++) {
    names = (await c.listTools()).tools.map((t) => t.name).sort()
    if (['fx__', 'ro__', 'safe__'].every((p) => names.some((n) => n.startsWith(p)))) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('      tools:', names.join(', '))
  check('all-policy server exposes every tool', ['fx__create_note', 'fx__delete_note', 'fx__list_notes', 'fx__slow_count'].every((n) => names.includes(n)))
  check('read-only policy hides writes', names.includes('ro__list_notes') && !names.includes('ro__create_note') && !names.includes('ro__delete_note'))
  check('no-destructive policy hides delete only', names.includes('safe__create_note') && !names.includes('safe__delete_note'))
  check('per-tool override hides fx__slow_count on safe', !names.includes('safe__slow_count'))

  const desc = (await c.listTools()).tools.find((t) => t.name === 'fx__create_note')?.description
  check('descriptions are labelled with the server', /^\[[^\]]+\] /.test(desc ?? ''), desc)

  await c.callTool({ name: 'fx__create_note', arguments: { title: 'hello', body: 'routed' } })
  const list = await c.callTool({ name: 'fx__list_notes', arguments: {} })
  check('calls route to the right server', text(list).includes('hello'), text(list).replace(/\n/g, ', '))

  const progress = []
  const counted = await c.callTool({ name: 'fx__slow_count', arguments: { n: 5 } }, undefined, { onprogress: (p) => progress.push(p.progress) })
  check('progress notifications are forwarded', progress.length === 5 && text(counted) === 'counted to 5', `progress ${progress.join(',')}`)

  const hidden = await c.callTool({ name: 'ro__delete_note', arguments: { title: 'x' } })
  check('hidden tools cannot be called', hidden.isError === true)

  const prompts = (await c.listPrompts()).prompts.map((p) => p.name)
  check('prompts are namespaced', prompts.includes('fx__summarize'), prompts.join(', '))
  const pr = await c.getPrompt({ name: 'fx__summarize' })
  check('prompts route', pr.messages.length === 1)
  await c.transport.terminateSession()
  await c.close()

  // 3. stdio bridge, the way Claude Desktop and Codex launch it
  const b = new Client({ name: 'smoke-bridge', version: '1' })
  await b.connect(
    new StdioClientTransport({
      command: join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [join(__dirname, '..', process.env.OUT_DIR || 'out', 'main', 'bridge.js')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ROUTER_URL: url, ROUTER_TOKEN: token },
      stderr: 'inherit'
    })
  )
  const viaBridge = (await b.listTools()).tools.length
  check('stdio bridge lists the same tools', viaBridge === names.length, `${viaBridge} tools`)
  const r = await b.callTool({ name: 'fx__list_notes', arguments: {} })
  check('stdio bridge calls tools', text(r).includes('hello'))
  await b.close()

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
