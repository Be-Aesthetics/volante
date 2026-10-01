import { useEffect, useMemo, useState } from 'react'
import { isWebflow, slugPrefix, webflowWorkspace, WEBFLOW_PREFIX, WEBFLOW_URL, type ImportCandidate, type ServerView } from '../../../shared/types'
import { ArrowLeft, Check, CodeIcon, Globe, ImportIcon, Paste, Sparks, TerminalIcon, X } from '../icons'
import { api } from '../theme'
import ServerForm, { validate, type Draft } from './ServerForm'
import { Overlay, useToast } from './ui'

export type AddTab = 'presets' | 'custom' | 'json' | 'import' | 'webflow'

interface Preset {
  name: string
  desc: string
  draft: Draft
  note?: string
}

const PRESETS: Preset[] = [
  {
    name: 'Webflow',
    desc: 'Sites, CMS, pages and the Designer. Signs in with your Webflow account.',
    draft: { name: 'Webflow', prefix: 'webflow', transport: 'http', url: WEBFLOW_URL }
  },
  {
    name: 'Shopify Dev',
    desc: 'Shopify docs, GraphQL schema and theme validation.',
    draft: { name: 'Shopify Dev', prefix: 'shopify_dev', transport: 'stdio', command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'] }
  },
  {
    name: 'Playwright',
    desc: 'Drive a real browser: navigate, click, fill and screenshot.',
    draft: { name: 'Playwright', prefix: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }
  },
  {
    name: 'GitHub',
    desc: 'Repos, issues and pull requests. Needs a personal access token.',
    draft: {
      name: 'GitHub',
      prefix: 'github',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ' }
    },
    note: 'Paste your GitHub personal access token after "Bearer ".'
  },
  {
    name: 'Filesystem',
    desc: 'Read and write files inside folders you choose.',
    draft: {
      name: 'Filesystem',
      prefix: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\path\\to\\your\\folder'],
      policy: 'safe'
    },
    note: 'Change the folder at the end of the arguments to the ones you want to share.'
  },
  {
    name: 'Context7',
    desc: 'Up-to-date library documentation for coding agents.',
    draft: { name: 'Context7', prefix: 'context7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
  },
  {
    name: 'Memory',
    desc: 'A local knowledge graph your agents can remember things in.',
    draft: { name: 'Memory', prefix: 'memory', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
  },
  {
    name: 'Sequential Thinking',
    desc: 'Structured step-by-step reasoning tool.',
    draft: {
      name: 'Sequential Thinking',
      prefix: 'thinking',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
    }
  }
]

/** Accepts `{mcpServers:{…}}`, `{servers:{…}}`, `{name:{command…}}` or a single `{command…}`. */
function parsePasted(text: string): Draft[] {
  const j = JSON.parse(text) as Record<string, unknown>
  const one = (name: string, v: Record<string, unknown>): Draft | null => {
    const url = (v.url ?? v.serverUrl ?? v.httpUrl) as string | undefined
    if (typeof v.command === 'string')
      return {
        name,
        transport: 'stdio',
        command: v.command,
        args: Array.isArray(v.args) ? v.args.map(String) : [],
        env: (v.env as Record<string, string>) ?? {},
        cwd: typeof v.cwd === 'string' ? v.cwd : undefined
      }
    if (typeof url === 'string')
      return { name, transport: v.type === 'sse' || /\/sse\/?$/.test(url) ? 'sse' : 'http', url, headers: (v.headers as Record<string, string>) ?? {} }
    return null
  }
  if (typeof j.command === 'string' || typeof j.url === 'string') {
    const d = one('Server', j)
    return d ? [d] : []
  }
  const map = (j.mcpServers ?? j.servers ?? j) as Record<string, Record<string, unknown>>
  return Object.entries(map)
    .map(([k, v]) => (v && typeof v === 'object' ? one(k, v) : null))
    .filter((d): d is Draft => !!d)
}

export default function AddServerDialog({
  initialTab,
  servers,
  onClose,
  onAdded
}: {
  initialTab: AddTab
  servers: ServerView[]
  onClose: () => void
  onAdded: (id?: string) => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<AddTab>(initialTab)
  const [draft, setDraft] = useState<Draft>({ transport: 'stdio', name: '', command: 'npx', args: [] })
  const [note, setNote] = useState<string>()
  const [formKey, setFormKey] = useState(0)
  const [json, setJson] = useState('')
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [removeOriginal, setRemoveOriginal] = useState(true)
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState('')

  const configs = servers.map((s) => s.config)
  const webflows = configs.filter(isWebflow)
  const wfName = workspace.trim()
  const wfTaken = webflows.some((c) => webflowWorkspace(c).toLowerCase() === wfName.toLowerCase())

  useEffect(() => {
    if (tab !== 'import' || candidates) return
    void api.importList().then((c) => {
      setCandidates(c)
      setPicked(new Set(c.map((x, i) => (x.alreadyAdded ? -1 : i)).filter((i) => i >= 0)))
    })
  }, [tab, candidates])

  const pasted = useMemo(() => {
    if (!json.trim()) return { drafts: [] as Draft[], error: null as string | null }
    try {
      const drafts = parsePasted(json)
      return { drafts, error: drafts.length ? null : 'No servers found in that code.' }
    } catch (e) {
      return { drafts: [], error: "That doesn't look like setup code. Check it was copied in full." }
    }
  }, [json])

  const error = tab === 'custom' ? validate(draft, configs) : null

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      if (tab === 'webflow') {
        // One server per workspace: its own sign-in, and tools that say which workspace they act on.
        const id = await api.addServer(
          { name: WEBFLOW_PREFIX + wfName, prefix: ('webflow_' + slugPrefix(wfName)).slice(0, 24), transport: 'http', url: WEBFLOW_URL },
          { signIn: true }
        )
        toast(`Your browser is opening Webflow. Pick the ${wfName} workspace there.`)
        onAdded(id)
      } else if (tab === 'custom') {
        const id = await api.addServer(draft)
        toast(`Added ${draft.name}`)
        onAdded(id)
      } else if (tab === 'json') {
        let last: string | undefined
        for (const d of pasted.drafts) last = await api.addServer(d)
        toast(`Added ${pasted.drafts.length} server${pasted.drafts.length === 1 ? '' : 's'}`)
        onAdded(pasted.drafts.length === 1 ? last : undefined)
      } else if (tab === 'import' && candidates) {
        const items = candidates.filter((_, i) => picked.has(i))
        await api.importApply(items, removeOriginal)
        toast(`Imported ${items.length} server${items.length === 1 ? '' : 's'}`)
        onAdded()
      }
    } catch (e) {
      toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const choosePreset = (p: Preset): void => {
    if (p.draft.url === WEBFLOW_URL) {
      setTab('webflow')
      return
    }
    setDraft({ ...p.draft })
    setNote(p.note)
    setFormKey((k) => k + 1)
    setTab('custom')
  }

  const canAdd =
    tab === 'webflow' ? !!wfName && !wfTaken : tab === 'custom' ? !error : tab === 'json' ? pasted.drafts.length > 0 : tab === 'import' ? picked.size > 0 : false

  return (
    <Overlay onClose={onClose}>
      <div className="dialog">
        <div className="dialog-nav">
          <h2>Add server</h2>
          <button className={`nav-item${tab === 'presets' || tab === 'webflow' ? ' active' : ''}`} onClick={() => setTab('presets')}>
            <Sparks size={16} /> Popular
          </button>
          <button className={`nav-item${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>
            <ImportIcon size={16} /> From my apps
          </button>
          <button className={`nav-item${tab === 'json' ? ' active' : ''}`} onClick={() => setTab('json')}>
            <Paste size={16} /> Paste setup code
          </button>
          <button className={`nav-item${tab === 'custom' ? ' active' : ''}`} onClick={() => setTab('custom')}>
            <TerminalIcon size={16} /> Set up by hand
          </button>
        </div>

        <div className="dialog-body">
          <div className="dialog-head">
            <h3>
              {tab === 'presets' && 'Pick a server to add'}
              {tab === 'webflow' && 'Add a Webflow workspace'}
              {tab === 'custom' && 'Set up a server by hand'}
              {tab === 'json' && 'Paste setup code'}
              {tab === 'import' && 'Servers your apps already use'}
            </h3>
            <span className="spacer" />
            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          </div>

          <div className="dialog-scroll">
            {tab === 'presets' && (
              <div className="presets">
                {PRESETS.map((p) => (
                  <button key={p.name} className="card preset" onClick={() => choosePreset(p)}>
                    <span className="client-mark">{p.draft.transport === 'stdio' ? <TerminalIcon size={16} /> : <Globe size={16} />}</span>
                    <span>
                      <span className="t">{p.name}</span>
                      <span className="d">
                        {p.draft.url === WEBFLOW_URL && webflows.length
                          ? `Add another workspace. ${webflows.length} added so far.`
                          : p.desc}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'webflow' && (
              <div className="wf">
                <button className="link wf-back" onClick={() => setTab('presets')}>
                  <ArrowLeft size={13} /> All servers
                </button>
                <p className="policy-hint">
                  Add each Webflow workspace on its own. That way your AI always knows which workspace it is working in, and you can give each one
                  different permissions.
                </p>
                <div className="field">
                  <label>Workspace name</label>
                  <input
                    className="input"
                    autoFocus
                    placeholder="e.g. Acme Studio"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && canAdd && !busy && void add()}
                  />
                  <span className="hint">
                    {wfTaken
                      ? `You've already added ${wfName}.`
                      : 'Use the name you know it by. It only labels it here.'}
                  </span>
                </div>
                <ol className="wf-steps">
                  <li>Click Add and sign in. Your browser opens Webflow.</li>
                  <li>
                    Choose the <b>{wfName || 'workspace'}</b> workspace and approve.
                  </li>
                  <li>Come back here. Its tools are ready for your AI apps.</li>
                </ol>
                {webflows.length > 0 && (
                  <div className="wf-added">
                    <p className="field-label">Already added</p>
                    {webflows.map((c) => (
                      <div key={c.id} className="wf-row">
                        <Check size={14} /> {webflowWorkspace(c)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'custom' && (
              <>
                {note && (
                  <div className="banner warn">
                    <span className="msg">{note}</span>
                  </div>
                )}
                <ServerForm key={formKey} draft={draft} onChange={setDraft} autoFocus={!draft.name} />
              </>
            )}

            {tab === 'json' && (
              <>
                <p className="policy-hint">
                  Many servers include a block of setup code in their instructions (it usually starts with <span className="mono">"mcpServers"</span>). Paste it here and every server in it gets added.
                </p>
                <textarea
                  className="textarea mono"
                  style={{ minHeight: 220 }}
                  autoFocus
                  spellCheck={false}
                  placeholder={'{\n  "mcpServers": {\n    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] }\n  }\n}'}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
                {pasted.error && <p style={{ color: 'var(--down)', fontSize: 12.5 }}>{pasted.error}</p>}
                {pasted.drafts.length > 0 && (
                  <div className="card" style={{ marginTop: 12 }}>
                    {pasted.drafts.map((d, i) => (
                      <div className="import-row" key={i} style={{ cursor: 'default' }}>
                        {d.transport === 'stdio' ? <TerminalIcon size={16} /> : <Globe size={16} />}
                        <div style={{ minWidth: 0 }}>
                          <div>{d.name}</div>
                          <div className="sub">{d.transport === 'stdio' ? [d.command, ...(d.args ?? [])].join(' ') : d.url}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'import' && (
              <>
                <p className="policy-hint">These servers are already set up in your other apps. Tick the ones to bring in; after that you manage them here.</p>
                {!candidates ? (
                  <p className="muted">Looking…</p>
                ) : !candidates.length ? (
                  <div className="empty" style={{ padding: 30 }}>
                    <h3>Nothing to import</h3>
                    <p>None of your apps have MCP servers configured yet.</p>
                  </div>
                ) : (
                  <>
                    <div className="card">
                      {candidates.map((c, i) => (
                        <label key={i} className={`import-row${c.alreadyAdded ? ' done' : ''}`}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            disabled={c.alreadyAdded}
                            checked={picked.has(i)}
                            onChange={(e) => setPicked((s) => new Set(e.target.checked ? [...s, i] : [...s].filter((x) => x !== i)))}
                          />
                          {c.config.transport === 'stdio' ? <CodeIcon size={16} /> : <Globe size={16} />}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div>
                              {c.key} {c.alreadyAdded && <span className="badge">added</span>}
                            </div>
                            <div className="sub">{c.config.transport === 'stdio' ? [c.config.command, ...(c.config.args ?? [])].join(' ') : c.config.url}</div>
                          </div>
                          <span className="chip">{c.clientName}</span>
                        </label>
                      ))}
                    </div>
                    <label className="row" style={{ marginTop: 14, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" className="checkbox" checked={removeOriginal} onChange={(e) => setRemoveOriginal(e.target.checked)} />
                      <span>
                        Remove them from the other app, so the same tools don't show up twice
                        <span className="faint"> (a backup of each config is kept)</span>
                      </span>
                    </label>
                  </>
                )}
              </>
            )}
          </div>

          {tab !== 'presets' && (
            <div className="dialog-foot">
              <span className="left">{tab === 'custom' && draft.name ? error : ''}</span>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={!canAdd || busy} onClick={() => void add()}>
                {tab === 'webflow' ? 'Add and sign in' : tab === 'import' ? `Import ${picked.size || ''}`.trim() : tab === 'json' && pasted.drafts.length > 1 ? `Add ${pasted.drafts.length} servers` : 'Add server'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
