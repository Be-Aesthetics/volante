import { useState } from 'react'
import { slugPrefix, type ServerConfig, type TransportKind } from '../../../shared/types'
import { joinArgs, splitArgs } from '../theme'
import { KvEditor, Segmented } from './ui'
import { BRAND } from '../../../shared/brand'

export type Draft = Partial<ServerConfig> & { transport: TransportKind }

export function validate(d: Draft, others: ServerConfig[]): string | null {
  if (!d.name?.trim()) return 'Give the server a name.'
  const prefix = d.prefix?.trim() || slugPrefix(d.name)
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(prefix)) return 'Prefix can only use letters, numbers, - and _ (max 24).'
  if (others.some((o) => o.id !== d.id && o.prefix === prefix)) return `Another server already uses the prefix "${prefix}".`
  if (d.transport === 'stdio' && !d.command?.trim()) return 'Enter the command that starts the server.'
  if (d.transport !== 'stdio') {
    try {
      const u = new URL(d.url ?? '')
      if (!/^https?:$/.test(u.protocol)) return 'URL must start with http:// or https://'
    } catch {
      return 'Enter a valid URL.'
    }
  }
  return null
}

export default function ServerForm({ draft, onChange, autoFocus }: { draft: Draft; onChange: (d: Draft) => void; autoFocus?: boolean }) {
  const [argText, setArgText] = useState(() => joinArgs(draft.args ?? []))
  const [prefixTouched, setPrefixTouched] = useState(!!draft.prefix)
  const set = (p: Partial<Draft>): void => onChange({ ...draft, ...p })

  return (
    <div>
      <div className="row">
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            autoFocus={autoFocus}
            value={draft.name ?? ''}
            placeholder="e.g. Webflow"
            onChange={(e) => set({ name: e.target.value, ...(prefixTouched ? {} : { prefix: slugPrefix(e.target.value) }) })}
          />
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Short name for tools</label>
          <input
            className="input mono"
            value={draft.prefix ?? ''}
            placeholder="webflow"
            onChange={(e) => {
              setPrefixTouched(true)
              set({ prefix: e.target.value })
            }}
          />
        </div>
      </div>
      <div className="field">
        <span className="hint" style={{ marginTop: -8 }}>
          Tools show up in your apps as <span className="mono">{(draft.prefix || slugPrefix(draft.name ?? '')) + '__tool_name'}</span>, so two servers never clash.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Where does it run?</span>
        <div>
          <Segmented
            value={draft.transport}
            onChange={(t) => set({ transport: t })}
            options={[
              { value: 'stdio', label: 'Runs on this computer' },
              { value: 'http', label: 'Online service' },
              { value: 'sse', label: 'Online (older)' }
            ]}
          />
        </div>
      </div>

      {draft.transport === 'stdio' ? (
        <>
          <div className="row">
            <div className="field" style={{ maxWidth: 200 }}>
              <label>Command</label>
              <input className="input mono" value={draft.command ?? ''} placeholder="npx" onChange={(e) => set({ command: e.target.value })} />
            </div>
            <div className="field">
              <label>Arguments</label>
              <input
                className="input mono"
                value={argText}
                placeholder="-y @playwright/mcp@latest"
                onChange={(e) => {
                  setArgText(e.target.value)
                  set({ args: splitArgs(e.target.value) })
                }}
              />
            </div>
          </div>
          <div className="field">
            <label>Working directory</label>
            <input className="input mono" value={draft.cwd ?? ''} placeholder="Optional" onChange={(e) => set({ cwd: e.target.value })} />
          </div>
          <div className="field">
            <label>Keys and settings (environment variables)</label>
            <KvEditor value={draft.env ?? {}} onChange={(env) => set({ env })} keyPlaceholder="API_KEY" valuePlaceholder="value" secret />
            <span className="hint">Stored encrypted with your Windows account.</span>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Server URL</label>
            <input className="input mono" value={draft.url ?? ''} placeholder="https://example.com/mcp" onChange={(e) => set({ url: e.target.value })} />
            <span className="hint">
              {draft.transport === 'http'
                ? `Streamable HTTP. Falls back to SSE automatically. If the server uses OAuth, ${BRAND.name} will ask you to sign in.`
                : 'Legacy SSE transport.'}
            </span>
          </div>
          <div className="field">
            <label>Headers</label>
            <KvEditor value={draft.headers ?? {}} onChange={(headers) => set({ headers })} keyPlaceholder="Authorization" valuePlaceholder="Bearer …" secret />
            <span className="hint">Stored encrypted with your Windows account.</span>
          </div>
        </>
      )}
    </div>
  )
}
