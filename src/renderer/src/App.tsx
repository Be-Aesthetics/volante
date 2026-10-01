import { useEffect, useState } from 'react'
import { isWebflow, webflowWorkspace, type ActivityEntry, type AppState, type ServerView } from '../../shared/types'
import { ActivityIcon, BrandLogo, Gear, Home, PlugIcon, Plus } from './icons'
import { BRAND } from '../../shared/brand'
import { api, applyTheme } from './theme'
import { ToastProvider } from './components/ui'
import Overview from './views/Overview'
import ServerPage from './views/ServerPage'
import ConnectPage from './views/ConnectPage'
import ActivityPage from './views/ActivityPage'
import AddServerDialog, { type AddTab } from './components/AddServerDialog'
import SettingsDialog from './components/SettingsDialog'

export type View = { kind: 'overview' } | { kind: 'server'; id: string } | { kind: 'connect' } | { kind: 'activity' }

export interface Nav {
  go: (v: View) => void
  addServer: (tab?: AddTab) => void
  settings: () => void
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [view, setView] = useState<View>({ kind: 'overview' })
  const [adding, setAdding] = useState<AddTab | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void api.getState().then(setState)
    void api.activity().then(setActivity)
    const offs = [
      api.onState(setState),
      api.onActivity((e) => setActivity((a) => [...a.slice(-999), e])),
      api.onActivityCleared(() => setActivity([]))
    ]
    return () => offs.forEach((f) => f())
  }, [])

  useEffect(() => {
    if (!state) return
    applyTheme(state.settings.theme)
    if (state.settings.theme.mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = (): void => applyTheme(state.settings.theme)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [state?.settings.theme.mode, state?.settings.theme.accent])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === ',') setSettingsOpen(true)
      if (e.ctrlKey && e.key.toLowerCase() === 'n') setAdding('presets')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // A removed server shouldn't leave the page pointing at nothing.
  useEffect(() => {
    if (view.kind === 'server' && state && !state.servers.some((s) => s.config.id === view.id)) setView({ kind: 'overview' })
  }, [state, view])

  if (!state) return <div className="app" />

  // Webflow workspaces are grouped under their own heading, listed by workspace name.
  const webflows = state.servers.filter((s) => isWebflow(s.config))
  const others = state.servers.filter((s) => !isWebflow(s.config))
  const serverItem = (s: ServerView, label: string) => (
    <button
      key={s.config.id}
      className={`nav-item server-item${!s.config.enabled ? ' off' : ''}${view.kind === 'server' && view.id === s.config.id ? ' active' : ''}`}
      onClick={() => setView({ kind: 'server', id: s.config.id })}
      title={s.error ?? s.config.name}
    >
      <span className={`dot ${s.config.enabled ? s.status : 'stopped'}`} />
      <span className="name">{label}</span>
      <span className="count">{s.status === 'ready' ? s.exposedCount : ''}</span>
    </button>
  )

  const nav: Nav = { go: setView, addServer: (t) => setAdding(t ?? 'presets'), settings: () => setSettingsOpen(true) }
  const exposed = state.servers.reduce((n, s) => n + (s.status === 'ready' ? s.exposedCount : 0), 0)
  const clients = new Set(state.router.sessions.map((s) => s.client)).size

  return (
    <ToastProvider>
      <div className="app">
        {/* Volante floats its content on a sheet; this keeps the frame above it draggable. */}
        {BRAND.id === 'volante' && <div className="frame-drag" />}
        <aside className="sidebar">
          <div className="sidebar-head">
            <span className="brand-mark">
              <BrandLogo size={24} />
            </span>
            <span className="brand-name">{BRAND.name}</span>
          </div>

          <nav className="nav">
            <button className={`nav-item${view.kind === 'overview' ? ' active' : ''}`} onClick={() => setView({ kind: 'overview' })}>
              <Home size={17} /> Home
              <span className="count">{exposed ? `${exposed} tools` : ''}</span>
            </button>
            <button className={`nav-item${view.kind === 'connect' ? ' active' : ''}`} onClick={() => setView({ kind: 'connect' })}>
              <PlugIcon size={17} /> Connect apps
              <span className="count">{clients || ''}</span>
            </button>
            <button className={`nav-item${view.kind === 'activity' ? ' active' : ''}`} onClick={() => setView({ kind: 'activity' })}>
              <ActivityIcon size={17} /> Activity
              <span className="count">{activity.filter((a) => a.kind !== 'session').length || ''}</span>
            </button>
          </nav>

          <div className="side-label">
            Servers
            <button className="icon-btn" title="Add server (Ctrl+N)" onClick={() => setAdding('presets')}>
              <Plus size={15} />
            </button>
          </div>
          <div className="side-scroll">
            {others.map((s) => serverItem(s, s.config.name))}
            {webflows.length > 0 && (
              <>
                <div className="side-group">
                  Webflow
                  <button className="icon-btn" title="Add a Webflow workspace" onClick={() => setAdding('webflow')}>
                    <Plus size={14} />
                  </button>
                </div>
                {webflows.map((s) => serverItem(s, webflowWorkspace(s.config)))}
              </>
            )}
            {!state.servers.length && (
              <div className="side-empty">
                No servers yet.
                <br />
                <button className="link" onClick={() => setAdding('presets')}>
                  Add one
                </button>{' '}
                or{' '}
                <button className="link" onClick={() => setAdding('import')}>
                  import
                </button>
              </div>
            )}
          </div>

          <div className="side-foot">
            <button className="router-pill" onClick={() => setView({ kind: 'connect' })} title={state.router.error ?? state.router.url}>
              <span className={`dot ${state.router.running ? 'ready' : 'error'}`} />
              <span>{state.router.running ? `${BRAND.name} is running` : `${BRAND.name} is offline`}</span>
            </button>
            <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
              <Gear size={17} />
            </button>
          </div>
        </aside>

        <main className="main">
          {view.kind === 'overview' && <Overview state={state} activity={activity} nav={nav} />}
          {view.kind === 'server' && (() => {
            const s = state.servers.find((x) => x.config.id === view.id)
            return s ? <ServerPage key={s.config.id} server={s} all={state.servers} nav={nav} /> : null
          })()}
          {view.kind === 'connect' && <ConnectPage state={state} nav={nav} />}
          {view.kind === 'activity' && <ActivityPage activity={activity} servers={state.servers} />}
        </main>
      </div>

      {adding && (
        <AddServerDialog
          initialTab={adding}
          servers={state.servers}
          onClose={() => setAdding(null)}
          onAdded={(id) => {
            setAdding(null)
            if (id) setView({ kind: 'server', id })
          }}
        />
      )}
      {settingsOpen && <SettingsDialog settings={state.settings} onClose={() => setSettingsOpen(false)} />}
    </ToastProvider>
  )
}
