import { useCallback, useEffect, useState } from 'react'
import type { AppState, ClientId, ClientView } from '../../../shared/types'
import type { Nav } from '../App'
import { CopyButton, useToast } from '../components/ui'
import { Check, CodeIcon, Eye, EyeClosed, Refresh } from '../icons'
import { ago, api } from '../theme'
import { BRAND } from '../../../shared/brand'

const MARK: Record<ClientId, string> = {
  'claude-desktop': 'C',
  'claude-code': '>_',
  cursor: 'Cu',
  vscode: 'VS',
  windsurf: 'W',
  gemini: 'G',
  codex: 'Cx'
}

export default function ConnectPage({ state, nav }: { state: AppState; nav: Nav }) {
  const toast = useToast()
  const [clients, setClients] = useState<ClientView[]>([])
  const [open, setOpen] = useState<ClientId | null>(null)
  const [snip, setSnip] = useState('')
  const [reveal, setReveal] = useState(false)

  const load = useCallback(() => void api.listClients().then(setClients), [])
  useEffect(load, [load, state.settings.port, state.settings.token])

  useEffect(() => {
    if (open) void api.clientSnippet(open).then(setSnip)
  }, [open, state.settings.token, state.settings.port, state.settings.requireToken])

  const act = async (c: ClientView, connect: boolean): Promise<void> => {
    try {
      if (connect) await api.connectClient(c.id)
      else await api.disconnectClient(c.id)
      toast(connect ? `Connected to ${c.name}. ${c.note ?? 'Restart it to pick up the change.'}` : `Removed from ${c.name}`)
      load()
    } catch (e) {
      toast(`${c.name}: ${(e as Error).message}`, true)
    }
  }

  const token = state.settings.token
  const masked = token.slice(0, 6) + '•'.repeat(18)

  const connected = clients.filter((c) => c.connected).length
  // Apps you have first; ones not on this computer last.
  const rank = (c: ClientView): number => (c.connected ? 0 : c.installed ? 1 : 2)
  const sorted = [...clients].sort((a, b) => rank(a) - rank(b))

  return (
    <>
      <div className="head">
        <h1>Connect apps</h1>
        <span className="spacer" />
        <button className="icon-btn" title="Check again" onClick={load}>
          <Refresh size={17} />
        </button>
      </div>
      <div className="scroll">
        <div className="page">
          <h2 className="page-title">Connect your AI apps.</h2>
          <p className="page-sub">
            Click Connect on each app you use, then restart that app. From then on it can use every server you add to {BRAND.name}. You only do this once.
          </p>

          {!state.router.running && (
            <div className="banner error">
              <span className="msg">{state.router.error ?? `${BRAND.name} isn't running.`}</span>
              <button className="btn sm" onClick={nav.settings}>
                Fix in settings
              </button>
            </div>
          )}

          <div className="section-head">
            <h2>Your apps{connected ? ` · ${connected} connected` : ''}</h2>
          </div>
          <div className="client-grid">
            {sorted.map((c) => (
              <div key={c.id} className={`card client${c.connected ? ' connected' : ''}${!c.installed && !c.connected ? ' missing' : ''}`}>
                <div className="top">
                  <span className="client-mark">{MARK[c.id]}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="name">{c.name}</div>
                    <div className="state">
                      {c.connected ? (
                        <>
                          <Check size={13} style={{ color: 'var(--up)' }} /> Connected
                        </>
                      ) : c.installed ? (
                        'Not connected yet'
                      ) : (
                        "Not installed on this computer"
                      )}
                    </div>
                  </div>
                </div>
                <div className="actions">
                  {c.connected ? (
                    <button className="btn sm" onClick={() => void act(c, false)}>
                      Disconnect
                    </button>
                  ) : (
                    <button className="btn sm primary" onClick={() => void act(c, true)}>
                      Connect
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <CodeIcon size={14} /> {open === c.id ? 'Hide details' : 'Details'}
                  </button>
                </div>
                {open === c.id && (
                  <>
                    <button className="path" title="Show this file in Explorer" onClick={() => void api.showInFolder(c.configPath)}>
                      Saved to {c.configPath.replace(/^C:\\Users\\[^\\]+/i, '~')}
                    </button>
                    <pre className="snippet">
                      <CopyButton text={snip} label="Copied" />
                      {snip}
                    </pre>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="section-head">
            <h2>Apps using {BRAND.name} right now</h2>
          </div>
          <div className="card sessions">
            {state.router.sessions.length ? (
              state.router.sessions.map((s) => (
                <div className="session" key={s.id}>
                  <span className="dot ready" />
                  <span>{s.client}</span>
                  <span className="spacer" />
                  <span className="faint" style={{ fontSize: 12 }}>
                    since {ago(s.since)}
                  </span>
                </div>
              ))
            ) : (
              <div className="session faint">None yet. An app shows up here once you've connected it and restarted it.</div>
            )}
          </div>

          <details className="manual">
            <summary>Connect another app manually</summary>
            <p className="page-sub" style={{ marginBottom: 16 }}>
              For apps that aren't listed above. Add a remote MCP server in that app with this address and send the key as a Bearer token.
            </p>
            <div className="endpoint">
              <span className="label">Address</span>
              <span className="value">{state.router.url}</span>
              <CopyButton text={state.router.url} label="Address copied" />
            </div>
            {state.settings.requireToken && (
              <div className="endpoint">
                <span className="label">Key</span>
                <span className="value">{reveal ? token : masked}</span>
                <button className="icon-btn sm" title={reveal ? 'Hide' : 'Show'} onClick={() => setReveal((r) => !r)}>
                  {reveal ? <EyeClosed size={15} /> : <Eye size={15} />}
                </button>
                <CopyButton text={token} label="Key copied" />
              </div>
            )}
            <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>
              Only this computer can reach this address.
            </p>
          </details>
        </div>
      </div>
    </>
  )
}
