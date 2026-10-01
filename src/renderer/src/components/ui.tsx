import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Plus, Warning, X } from '../icons'
import { copy } from '../theme'

export function Switch({ checked, onChange, small, title }: { checked: boolean; onChange: (v: boolean) => void; small?: boolean; title?: string }) {
  return (
    <label className={`switch-wrap${small ? ' sm' : ''}`} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Key/value rows for env vars and headers. Values can be masked. */
export function KvEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  secret
}: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
  keyPlaceholder: string
  valuePlaceholder: string
  secret?: boolean
}) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value))
  const [shown, setShown] = useState<Set<number>>(new Set())

  const push = (next: [string, string][]): void => {
    setRows(next)
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())))
  }

  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input className="input mono" placeholder={keyPlaceholder} value={k} onChange={(e) => push(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <input
            className="input mono"
            placeholder={valuePlaceholder}
            type={secret && !shown.has(i) ? 'password' : 'text'}
            value={v}
            onChange={(e) => push(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          {secret ? (
            <button
              className="btn sm ghost"
              type="button"
              onClick={() => setShown((s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]))}
            >
              {shown.has(i) ? 'Hide' : 'Show'}
            </button>
          ) : (
            <span />
          )}
          <button className="icon-btn sm" type="button" title="Remove" onClick={() => push(rows.filter((_, j) => j !== i))}>
            <X size={15} />
          </button>
        </div>
      ))}
      <div>
        <button className="btn sm" type="button" onClick={() => setRows([...rows, ['', '']])}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  )
}

export function Menu({ trigger, children }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', k)
    }
  }, [open])
  return (
    <div className="menu-anchor no-drag" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

export function Confirm({
  title,
  body,
  action,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  body: ReactNode
  action: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog small">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {action}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ------------------------------------------------------------------ toasts

interface Toast {
  id: number
  text: string
  error?: boolean
}

const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 5000 : 2400)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            {t.error ? <Warning size={15} /> : <Check size={15} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function CopyButton({ text, label = 'Copied', size = 15 }: { text: string; label?: string; size?: number }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  return (
    <button
      className="icon-btn sm"
      title="Copy"
      onClick={async () => {
        await copy(text)
        setDone(true)
        toast(label)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}
