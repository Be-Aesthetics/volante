import { useMemo, useState } from 'react'
import type { ActivityEntry, ServerView } from '../../../shared/types'
import { Confirm, Segmented } from '../components/ui'
import { BrandLogo, Search, Trash } from '../icons'
import { BRAND } from '../../../shared/brand'
import { copy } from '../copy'
import { api, clock } from '../theme'

type Show = 'all' | 'failed'

export default function ActivityPage({ activity, servers }: { activity: ActivityEntry[]; servers: ServerView[] }) {
  const [server, setServer] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return activity
      .filter((a) => a.kind !== 'session')
      .filter((a) => !server || a.serverId === server)
      .filter((a) => show === 'all' || !a.ok)
      .filter((a) => !s || a.name.toLowerCase().includes(s) || (a.client ?? '').toLowerCase().includes(s))
      .slice()
      .reverse()
  }, [activity, server, show, q])

  const used = servers.filter((s) => activity.some((a) => a.serverId === s.config.id))

  return (
    <>
      <div className="head">
        <h1>Activity</h1>
        <span className="spacer" />
        <button className="icon-btn" title="Clear" disabled={!activity.length} onClick={() => setConfirm(true)}>
          <Trash size={17} />
        </button>
      </div>
      <div className="scroll">
        <div className="page">
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <div className="search">
              <Search size={15} />
              <input placeholder="Filter by tool or app" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented<Show>
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All' },
                { value: 'failed', label: 'Failed' }
              ]}
            />
          </div>
          {used.length > 1 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button className={`chip${!server ? ' on' : ''}`} onClick={() => setServer(null)}>
                All servers
              </button>
              {used.map((s) => (
                <button key={s.config.id} className={`chip${server === s.config.id ? ' on' : ''}`} onClick={() => setServer(s.config.id)}>
                  {s.config.name}
                </button>
              ))}
            </div>
          )}

          {!list.length ? (
            <div className="empty">
              <div className="brand-mark" style={{ display: 'flex' }}>
                <BrandLogo size={36} />
              </div>
              <h3>{activity.length ? 'Nothing matches' : copy.quiet}</h3>
              <p>{activity.length ? 'Try a different filter.' : `Every tool call routed through ${BRAND.name} shows up here as it happens.`}</p>
            </div>
          ) : (
            <div className="act-list">
              {list.map((a) => (
                <div key={a.id} className={`act${a.ok ? '' : ' fail'}`}>
                  <button className="act-row" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <span className="time">{clock(a.ts)}</span>
                    {a.server && <span className="chip">{a.server}</span>}
                    <span className="tool-name">{a.name}</span>
                    {a.kind !== 'tool' && <span className="badge">{a.kind}</span>}
                    <span className="spacer" />
                    {a.client && <span className="who">{a.client}</span>}
                    {a.ms !== undefined && <span className="ms">{a.ms} ms</span>}
                  </button>
                  {!a.ok && a.error && open !== a.id && <div className="act-err">{a.error}</div>}
                  {open === a.id && (
                    <div className="act-detail">
                      <div>
                        <h4>Arguments</h4>
                        <pre className="snippet">{a.args ?? '—'}</pre>
                      </div>
                      <div>
                        <h4>{a.ok ? 'Result' : 'Error'}</h4>
                        <pre className="snippet" style={a.ok ? undefined : { color: 'var(--down)' }}>
                          {(a.ok ? a.result : (a.error ?? a.result)) || '—'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {confirm && (
        <Confirm
          title="Clear activity?"
          body="This clears the call history shown here. It doesn't affect your servers."
          action="Clear"
          danger
          onConfirm={() => void api.clearActivity()}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  )
}
