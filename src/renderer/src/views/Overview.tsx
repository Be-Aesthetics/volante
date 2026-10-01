import { useEffect, useState } from 'react'
import type { ActivityEntry, AppState, ClientView } from '../../../shared/types'
import type { Nav } from '../App'
import { Plus } from '../icons'
import { BRAND } from '../../../shared/brand'
import { copy } from '../copy'
import { ago, api, clock } from '../theme'

function greeting(state: AppState): { title: string; sub: string } {
  const on = state.servers.filter((s) => s.config.enabled)
  const ready = on.filter((s) => s.status === 'ready')
  const down = on.filter((s) => s.status === 'error' || s.status === 'needs-auth')
  const tools = ready.reduce((n, s) => n + s.exposedCount, 0)
  const apps = new Set(state.router.sessions.map((s) => s.client)).size
  if (!state.router.running) return { title: copy.routerDown, sub: state.router.error ?? 'The router is not running.' }
  if (!state.servers.length) return { title: copy.empty, sub: `${BRAND.name} links your AI apps to the tools you choose. Follow the three steps to get going.` }
  const title = down.length ? copy.attention(down.length) : on.length === ready.length ? copy.allOpen : copy.starting
  const sub = `Your AI apps can use ${tools} tool${tools === 1 ? '' : 's'} from ${ready.length} server${ready.length === 1 ? '' : 's'}${apps ? `, and ${apps} app${apps === 1 ? ' is' : 's are'} connected right now` : ''}.`
  return { title, sub }
}

function figures(state: AppState, activity: ActivityEntry[]) {
  const ready = state.servers.filter((s) => s.status === 'ready')
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const calls = activity.filter((a) => a.kind === 'tool' && a.ts >= since.getTime())
  return {
    ready: ready.length,
    enabled: state.servers.filter((s) => s.config.enabled).length,
    tools: ready.reduce((n, s) => n + s.exposedCount, 0),
    calls: calls.length,
    failed: calls.filter((c) => !c.ok).length,
    apps: new Set(state.router.sessions.map((s) => s.client)).size
  }
}

interface Step {
  title: string
  text: string
  done: boolean
  action: string
  /** Button label once the step is done. */
  again: string
  go: () => void
}

/** The whole app in three steps. Each ticks itself off as it happens. */
function Steps({ state, activity, nav }: { state: AppState; activity: ActivityEntry[]; nav: Nav }) {
  const [clients, setClients] = useState<ClientView[]>([])
  useEffect(() => void api.listClients().then(setClients), [state.router.sessions.length])

  const steps: Step[] = [
    {
      title: 'Add a server',
      text: 'A server gives your AI new abilities, like working in Webflow, GitHub or a web browser.',
      done: state.servers.some((s) => s.status === 'ready'),
      action: 'Add a server',
      again: 'Add another',
      go: () => nav.addServer('presets')
    },
    {
      title: 'Connect your AI apps',
      text: `Link Claude, Cursor or VS Code once. After that they can use every server you add to ${BRAND.name}.`,
      done: clients.some((c) => c.connected) || state.router.sessions.length > 0,
      action: 'Connect apps',
      again: 'Manage',
      go: () => nav.go({ kind: 'connect' })
    },
    {
      title: 'Ask your AI',
      text: 'Ask your AI app to use one of the tools. Each request shows up in Activity so you can see what happened.',
      done: activity.some((x) => x.kind === 'tool'),
      action: 'See activity',
      again: 'See activity',
      go: () => nav.go({ kind: 'activity' })
    }
  ]
  const next = steps.findIndex((s) => !s.done)

  return (
    <div className="steps">
      <p className="steps-label">{next === -1 ? 'All set up' : 'Getting started'}</p>
      {steps.map((s, i) => (
        <div key={s.title} className={`step${s.done ? ' done' : ''}${i === next ? ' next' : ''}`}>
          <span className="step-n">{s.done ? '✓' : `0${i + 1}`}</span>
          <div className="step-body">
            <div className="step-title">{s.title}</div>
            <div className="step-text">{s.text}</div>
          </div>
          <button className={`btn sm${i === next ? ' primary' : ''}`} onClick={s.go}>
            {s.done ? s.again : s.action}
          </button>
        </div>
      ))}
    </div>
  )
}

function Servers({ state, nav }: { state: AppState; nav: Nav }) {
  if (!state.servers.length) return null
  return (
    <>
      <div className="section-head">
        <h2>Servers</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => nav.addServer('presets')}>
          <Plus size={14} /> Add
        </button>
      </div>
      <div className="server-grid">
        {state.servers.map((s) => (
          <button key={s.config.id} className="card server-card" onClick={() => nav.go({ kind: 'server', id: s.config.id })}>
            <div className="top">
              <span className={`dot ${s.config.enabled ? s.status : 'stopped'}`} />
              {s.config.name}
            </div>
            <div className="sub">{s.config.transport === 'stdio' ? [s.config.command, ...(s.config.args ?? [])].join(' ') : s.config.url}</div>
            <div className="meta">
              {!s.config.enabled ? (
                <span>Disabled</span>
              ) : s.status === 'ready' ? (
                <>
                  <span>
                    {s.exposedCount}/{s.tools.length} tools
                  </span>
                  {s.startedAt && <span>up {ago(s.startedAt).replace(' ago', '')}</span>}
                </>
              ) : s.status === 'needs-auth' ? (
                <span style={{ color: 'var(--warn)' }}>Sign-in required</span>
              ) : s.status === 'error' ? (
                <span style={{ color: 'var(--down)' }}>{s.error ?? 'Error'}</span>
              ) : (
                <span>Starting…</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

function Recent({ activity, nav }: { activity: ActivityEntry[]; nav: Nav }) {
  const recent = activity.filter((a) => a.kind !== 'session').slice(-6).reverse()
  if (!recent.length) return null
  return (
    <>
      <div className="section-head">
        <h2>Recent requests</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => nav.go({ kind: 'activity' })}>
          View all
        </button>
      </div>
      <div className="act-list">
        {recent.map((a) => (
          <div key={a.id} className={`act${a.ok ? '' : ' fail'}`}>
            <div className="act-row" style={{ cursor: 'default' }}>
              <span className="time">{clock(a.ts)}</span>
              {a.server && <span className="chip">{a.server}</span>}
              <span className="tool-name">{a.name}</span>
              <span className="spacer" />
              {a.client && <span className="who">{a.client}</span>}
              {a.ms !== undefined && <span className="ms">{a.ms} ms</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Volante: a grid page. Headline left, facts right, figures on a blue band. */
function VolanteOverview({ state, activity, nav }: { state: AppState; activity: ActivityEntry[]; nav: Nav }) {
  const g = greeting(state)
  const f = figures(state, activity)
  return (
    <>
      <div className="head">
        <h1>Home</h1>
      </div>
      <div className="scroll">
        <section className="vo-hero">
          <div className="vo-lead">
            <h1 className="vo-title">{g.title}</h1>
            <p className="vo-sub">{g.sub}</p>
          </div>
          <aside className="vo-aside">
            <Steps state={state} activity={activity} nav={nav} />
          </aside>
        </section>
        <section className="vo-band">
          <div className="vo-figure">
            <div className="k">Servers running</div>
            <div className="n">
              {f.ready}
              <small>/{f.enabled}</small>
            </div>
          </div>
          <div className="vo-figure">
            <div className="k">Tools your AI can use</div>
            <div className="n">{f.tools}</div>
          </div>
          <div className="vo-figure">
            <div className="k">Requests today{f.failed ? ` · ${f.failed} failed` : ''}</div>
            <div className="n">{f.calls}</div>
          </div>
          <div className="vo-figure">
            <div className="k">Apps using it now</div>
            <div className="n">{f.apps}</div>
          </div>
        </section>
        <div className="vo-body">
          <Servers state={state} nav={nav} />
          <Recent activity={activity} nav={nav} />
        </div>
      </div>
    </>
  )
}

export default function Overview({ state, activity, nav }: { state: AppState; activity: ActivityEntry[]; nav: Nav }) {
  return <VolanteOverview state={state} activity={activity} nav={nav} />
}
