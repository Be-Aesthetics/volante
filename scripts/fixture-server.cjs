// Tiny stdio MCP server for exercising the router: one read, one write and one
// destructive tool, plus a prompt. Usage: node scripts/fixture-server.cjs
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const notes = new Map([['welcome', 'Hello from the fixture server']])
const server = new McpServer({ name: 'fixture', version: '0.1.0' }, { instructions: 'A test notebook.' })

server.registerTool(
  'list_notes',
  { description: 'List note titles', annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: 'text', text: [...notes.keys()].join('\n') || '(none)' }] })
)
server.registerTool(
  'create_note',
  { description: 'Create or replace a note', inputSchema: { title: z.string(), body: z.string() } },
  async ({ title, body }) => {
    notes.set(title, body)
    return { content: [{ type: 'text', text: `saved ${title}` }] }
  }
)
server.registerTool(
  'delete_note',
  { description: 'Delete a note', inputSchema: { title: z.string() } },
  async ({ title }) => ({ content: [{ type: 'text', text: notes.delete(title) ? `deleted ${title}` : `no note ${title}` }] })
)
server.registerTool(
  'slow_count',
  { description: 'Counts to n with progress', inputSchema: { n: z.number() } },
  async ({ n }, extra) => {
    for (let i = 1; i <= n; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const token = extra._meta?.progressToken
      if (token !== undefined) await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: i, total: n } })
    }
    return { content: [{ type: 'text', text: `counted to ${n}` }] }
  }
)
server.registerPrompt('summarize', { description: 'Summarize notes' }, () => ({
  messages: [{ role: 'user', content: { type: 'text', text: 'Summarize my notes.' } }]
}))

process.stderr.write('fixture server ready\n')
server.connect(new StdioServerTransport())
