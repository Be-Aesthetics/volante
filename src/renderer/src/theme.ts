import type { ThemeMode, ThemeSettings } from '../../shared/types'

export const api = window.router

export function effectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return mode
}

/** Pushes the theme into the root element and recolors the native title bar to match. */
export function applyTheme(t: ThemeSettings): void {
  const root = document.documentElement
  const mode = effectiveMode(t.mode)
  root.dataset.mode = mode
  root.style.setProperty('color-scheme', mode)
  root.style.setProperty('--accent', t.accent)
  const cs = getComputedStyle(root)
  // A brand can set --chrome-bg/--chrome-fg when its window frame differs from the page (Volante's dark frame).
  const bg = cs.getPropertyValue('--chrome-bg').trim() || cs.getPropertyValue('--sidebar').trim()
  const fg = cs.getPropertyValue('--chrome-fg').trim() || cs.getPropertyValue('--text').trim()
  void api.setTitleBarColors(bg, fg)
}

export async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Splits a command line like a shell would: spaces separate, quotes group. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  let has = false
  for (const c of s) {
    if (q) {
      if (c === q) q = null
      else cur += c
    } else if (c === '"' || c === "'") {
      q = c
      has = true
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur)
      cur = ''
      has = false
    } else cur += c
  }
  if (cur || has) out.push(cur)
  return out
}

export function joinArgs(a: string[]): string {
  return a.map((x) => (x === '' || /[\s"']/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)).join(' ')
}
