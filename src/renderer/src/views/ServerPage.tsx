import { useEffect, useMemo, useRef, useState } from 'react'
import { isWebflow, webflowWorkspace, type ServerConfig, type ServerView, type ToolPolicy, type ToolView } from '../../../shared/types'
import type { Nav } from '../App'
import ServerForm, { validate, type Draft } from '../components/ServerForm'
import { Confirm, CopyButton, Menu, Segmented, Switch, useToast } from '../components/ui'
import { Ellipsis, Globe, LogIn, LogOut, Plus, Refresh, Search, TerminalIcon, Trash, Undo, Warning } from '../icons'
import { ago, api } from '../theme'

type Tab = 'tools' | 'logs' | 'settings'

const POLICY_HINT: Record<ToolPolicy, string> = {
  all: 'Your AI apps can use every tool this server offers.',
  readonly: 'Your AI apps can look things up, but cannot create, change or delete anything.',
  safe: 'Your AI apps can do everything except delete things.',
  custom: 'Your AI apps can only use the tools you switch on below.'
}

const KIND_LABEL: Record<ToolView['kind'], string> = { read: 'reads', write: 'changes', destructive: 'deletes' }

const STATUS_LABEL: Record<ServerView['status'], string> = {
  ready: 'Running',
  starting: 'Starting',
  error: 'Not working',
  'needs-auth': 'Sign-in required',
  stopped: 'Turned off'
}

export default function ServerPage({ server, all, nav }: { server: ServerView; all: ServerView[]; nav: Nav }) {
  const toast = useToast()
  const cfg = server.config
  const [tab, setTab] = useState<Tab>('tools')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async (next: ServerConfig): Promise<void> => {
    try {
      await api.updateServer(next)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const status = cfg.enabled ? server.status : 'stopped'
  const webflow = isWebflow(cfg)
  const workspace = webflowWorkspace(cfg)

  /** Sign out, then straight back in so Webflow asks which workspace to use. */
  const switchWorkspace = async (): Promise<void> => {
    await api.signOut(cfg.id)
    await api.signIn(cfg.id)
    toast('Your browser is opening Webflow. Pick the workspace there.')
  }

  return (
    <>
      <div className="head">
        <span className={`dot ${status}`} />
        <h1>{cfg.name}</h1>
        <span className="spacer" />
        <Switch
          checked={cfg.enabled}
          onChange={(v) => void save({ ...cfg, enabled: v })}
          title={cfg.enabled ? 'Turn off' : 'Turn on'}
        />
        <button className="icon-btn" title="Restart" disabled={!cfg.enabled} onClick={() => void api.restartServer(cfg.id)}>
          <Refresh size={17} />
        </button>
        <Menu trigger={(open) => <button className="icon-btn" onClick={open} title="More"><Ellipsis size={18} /></button>}>
          {(close) => (
            <>
              {webflow && (
                <>
                  <button
                    onClick={() => {
                      close()
                      void switchWorkspace()
                    }}
                  >
                    <Refresh size={16} /> Switch workspace
                  </button>
                  <button
                    onClick={() => {
                      close()
                      nav.addServer('webflow')
                    }}
                  >
                    <Plus size={16} /> Add another Webflow workspace
                  </button>
                  <hr />
                </>
              )}
              {cfg.transport !== 'stdio' && (
                <button
                  onClick={() => {
                    close()
                    void api.signOut(cfg.id)
                  }}
                >
                  <LogOut size={16} /> Sign out
                </button>
              )}
              <button
                className="danger"
                onClick={() => {
                  close()
                  setConfirmDelete(true)
                }}
              >
                <Trash size={16} /> Remove server
              </button>
            </>
          )}
        </Menu>
      </div>

      <div className="scroll">
        <div className="page">
          {cfg.enabled && server.status === 'error' && (
            <div className="banner error">
              <Warning size={17} />
              <span className="msg">{server.error}</span>
              <button className="btn sm" onClick={() => setTab('logs')}>
                See log
              </button>
              <button className="btn sm" onClick={() => void api.restartServer(cfg.id)}>
                Retry
              </button>
            </div>
          )}
          {cfg.enabled && server.status === 'needs-auth' && (
            <div className="banner warn">
              <LogIn size={17} />
              <span className="msg">
                {webflow
                  ? `Sign in to Webflow and choose the ${workspace} workspace. Your browser will open; come back here when you're done.`
                  : `${cfg.name} needs you to sign in before your AI can use it. Your browser will open; come back here when you're done.`}
              </span>
              <button className="btn sm primary" onClick={() => void api.signIn(cfg.id)}>
                Sign in
              </button>
            </div>
          )}

          <div className="server-meta">
            <span>
              <span className={`dot ${status}`} /> {cfg.enabled ? STATUS_LABEL[server.status] : 'Turned off'}
            </span>
            {!webflow && (<span>
              {cfg.transport === 'stdio' ? <TerminalIcon size={14} /> : <Globe size={14} />}
              <span className="mono" title={cfg.transport === 'stdio' ? [cfg.command, ...(cfg.args ?? [])].join(' ') : cfg.url}>
                {cfg.transport === 'stdio' ? [cfg.command, ...(cfg.args ?? [])].join(' ') : cfg.url}
              </span>
            </span>)}
            {server.startedAt && <span>started {ago(server.startedAt)}</span>}
            {cfg.source && <span>imported from {cfg.source}</span>}
          </div>

          {webflow && (
            <div className="wf-strip">
              <span className="wf-strip-label">Webflow workspace</span>
              <span className="wf-strip-name">{workspace}</span>
              <span className="spacer" />
              <button className="btn sm" onClick={() => void switchWorkspace()}>
                Switch workspace
              </button>
              <button className="btn sm primary" onClick={() => nav.addServer('webflow')}>
                <Plus size={14} /> Add another workspace
              </button>
            </div>
          )}

          <div className="tabs">
            <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>
              Tools <span className="n">{server.tools.length ? `${server.exposedCount}/${server.tools.length}` : ''}</span>
            </button>
            <button className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>
              Log
            </button>
            <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
              Settings
            </button>
          </div>

          {tab === 'tools' && <ToolsTab server={server} save={save} />}
          {tab === 'logs' && <LogsTab id={cfg.id} />}
          {tab === 'settings' && <SettingsTab key={JSON.stringify(cfg)} cfg={cfg} all={all} save={save} onRemove={() => setConfirmDelete(true)} />}
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          title={`Remove ${cfg.name}?`}
          body="Your AI apps will lose its tools. You can add it again later."
          action="Remove"
          danger
          onConfirm={() => {
            void api.removeServer(cfg.id)
            nav.go({ kind: 'overview' })
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

function ToolsTab({ server, save }: { server: ServerView; save: (c: ServerConfig) => Promise<void> }) {
  const cfg = server.config
  const [q, setQ] = useState('')
  const tools = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? server.tools.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s)) : server.tools
  }, [server.tools, q])
  const overrides = Object.keys(cfg.overrides).length

  const toggle = (t: ToolView, on: boolean): void => {
    const next = { ...cfg.overrides }
    const policyDefault = cfg.policy === 'all' ? true : cfg.policy === 'readonly' ? t.kind === 'read' : cfg.policy === 'safe' ? t.kind !== 'destructive' : false
    if (on === policyDefault) delete next[t.name]
    else next[t.name] = on
    void save({ ...cfg, overrides: next })
  }

  return (
    <>
      <p className="policy-q">What can your AI apps do with {cfg.name}?</p>
      <div className="policy">
        <Segmented<ToolPolicy>
          value={cfg.policy}
          onChange={(p) => void save({ ...cfg, policy: p })}
          options={[
            { value: 'all', label: 'Allow everything' },
            { value: 'readonly', label: 'Look only' },
            { value: 'safe', label: 'No deleting' },
            { value: 'custom', label: 'Choose tools' }
          ]}
        />
      </div>
      <p className="policy-hint">{POLICY_HINT[cfg.policy]}</p>

      {server.status !== 'ready' && !server.tools.length ? (
        <div className="empty">
          <h3>{server.status === 'starting' ? 'Connecting…' : 'No tools yet'}</h3>
          <p>{server.status === 'starting' ? 'Tools will appear as soon as the server answers.' : 'Tools appear once the server is connected.'}</p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="search">
              <Search size={15} />
              <input placeholder={`Search ${server.tools.length} tools`} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="spacer" />
            {overrides > 0 && (
              <button className="btn sm ghost" onClick={() => void save({ ...cfg, overrides: {} })} title="Go back to what the setting above allows">
                <Undo size={14} /> Undo {overrides} manual change{overrides === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <div className="tool-list">
            {tools.map((t) => (
              <div className={`tool${t.exposed ? '' : ' off'}`} key={t.name}>
                <Switch small checked={t.exposed} onChange={(v) => toggle(t, v)} />
                <div className="body">
                  <div className="name">
                    <span>{t.name}</span>
                    <span
                      className={`badge ${t.kind}${t.inferred ? ' inferred' : ''}`}
                      title={t.inferred ? 'Guessed from the tool name' : 'Stated by the server'}
                    >
                      {KIND_LABEL[t.kind]}
                    </span>
                    {t.overridden && <span className="override">custom</span>}
                    <span className="spacer" />
                    <CopyButton text={t.exposedAs} label={`Copied ${t.exposedAs}`} size={13} />
                  </div>
                  {t.description && <div className="desc" title={t.description}>{t.description}</div>}
                </div>
              </div>
            ))}
            {!tools.length && <div className="empty" style={{ padding: 30 }}>No tools match “{q}”.</div>}
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

function LogsTab({ id }: { id: string }) {
  const [lines, setLines] = useState<string[]>([])
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const load = (): void => void api.serverLogs(id).then(setLines)
    load()
    return api.onLogs((x) => x === id && load())
  }, [id])

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <pre
      className="logs"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {lines.length ? (
        lines.map((l, i) => (
          <div key={i} className={l.startsWith('—') ? 'sys' : l.startsWith('!') ? 'err' : ''}>
            {l}
          </div>
        ))
      ) : (
        <span className="sys">No output yet.</span>
      )}
    </pre>
  )
}

// ---------------------------------------------------------------------------

function SettingsTab({ cfg, all, save, onRemove }: { cfg: ServerConfig; all: ServerView[]; save: (c: ServerConfig) => Promise<void>; onRemove: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(cfg)
  const error = validate(draft, all.map((s) => s.config))
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg)

  return (
    <>
      <ServerForm draft={draft} onChange={setDraft} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {dirty && error && <span style={{ color: 'var(--down)', fontSize: 12.5, marginRight: 'auto' }}>{error}</span>}
        <button className="btn" disabled={!dirty} onClick={() => setDraft(cfg)}>
          Discard
        </button>
        <button
          className="btn primary"
          disabled={!dirty || !!error}
          onClick={async () => {
            await save({ ...cfg, ...draft, prefix: draft.prefix?.trim() || cfg.prefix } as ServerConfig)
            toast('Saved. The server restarts if its connection changed.')
          }}
        >
          Save changes
        </button>
      </div>
      <div className="danger-zone">
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5 }}>Remove this server</div>
          <div className="faint" style={{ fontSize: 12 }}>
            Stops it and removes its tools from every connected app.
          </div>
        </div>
        <button className="btn danger" onClick={onRemove}>
          <Trash size={15} /> Remove
        </button>
      </div>
    </>
  )
}
