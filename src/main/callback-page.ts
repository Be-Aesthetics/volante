// The page the browser lands on after an OAuth sign-in. It is served by the
// router itself, so it carries the app's own look: the dark frame and its glow,
// a light sheet, and the brand fonts inlined (the page has no other assets).
import display from '../renderer/src/fonts/InterTight-Latin.woff2?inline'
import mono from '../renderer/src/fonts/JetBrainsMono-Latin.woff2?inline'
import { BRAND } from '../shared/brand'

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Volante's dot-V on its 1932-unit grid, the same artwork as the app icon.
const VX: Record<number, number> = { [-4]: 408, [-3]: 524, [-2]: 641, [-1]: 758, 0: 966, 1: 1174, 2: 1291, 3: 1408, 4: 1524 }
const VY = [487, 607, 727, 846, 966, 1086, 1206, 1326]
const VROWS = [[-4, -3, 0, 3, 4], [-4, -3, 0, 3, 4], [-3, -2, 0, 2, 3], [-3, -2, 0, 2, 3], [-2, -1, 0, 1, 2], [-2, -1, 0, 1, 2], [-1, 0, 1], [-1, 0, 1]]

function mark(): string {
  if (BRAND.id !== 'volante') return `<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="6" fill="${BRAND.accent}"/></svg>`
  const dots = VROWS.flatMap((cols, row) => cols.map((c) => `<circle cx="${VX[c]}" cy="${VY[row]}" r="50"/>`)).join('')
  return `<svg viewBox="300 380 1332 1172" width="34" height="30" fill="currentColor">${dots}<circle cx="966" cy="1446" r="50" fill="${BRAND.accent}"/></svg>`
}

/** `server` is the display name of the server that signed in, when known. */
export function callbackPage(ok: boolean, msg: string, server?: string): string {
  const a = BRAND.accent
  const title = ok ? 'Connected.' : 'Sign-in failed.'
  const label = ok ? 'Signed in' : 'Sign-in'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Connected' : 'Sign-in failed'} · ${BRAND.name}</title>
<style>
@font-face{font-family:'Inter Tight';src:url(${display}) format('woff2');font-weight:300 700;font-display:block}
@font-face{font-family:'JetBrains Mono';src:url(${mono}) format('woff2');font-weight:300 600;font-display:block}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:#0d0d0d;color:#0d0d0d;display:grid;place-items:center;padding:24px;
  font:400 12px/1.6 'JetBrains Mono','Cascadia Mono',Consolas,monospace;letter-spacing:.02em;
  background-image:radial-gradient(55% 60% at 100% 100%,${a}8c,transparent 70%),radial-gradient(35% 40% at 88% 0%,${a}38,transparent 70%)}
.sheet{width:min(460px,100%);background:#fafafa;border-radius:6px;box-shadow:0 30px 80px rgba(0,0,0,.45);padding:28px 32px 26px}
.top{display:flex;align-items:center;justify-content:space-between;color:#0d0d0d}
.tag{text-transform:uppercase;color:#767676}
.tag b{font-weight:500;color:${ok ? '#0d0d0d' : a}}
h1{font:400 44px/1.02 'Inter Tight','Segoe UI Variable Display',system-ui,sans-serif;letter-spacing:-.035em;margin:44px 0 14px}
.server{font-weight:500;color:#0d0d0d;margin-bottom:6px}
.msg{color:#3d3d3d;max-width:36ch}
.foot{display:flex;justify-content:space-between;margin-top:34px;padding-top:12px;border-top:1px solid #e2e2e2;text-transform:uppercase;color:#767676}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:${ok ? a : '#0d0d0d'};margin-right:8px;vertical-align:1px}
</style></head><body>
<main class="sheet">
  <div class="top">${mark()}<span class="tag">[ <b>${label}</b> ]</span></div>
  <h1>${title}</h1>
  ${server ? `<p class="server">${esc(server)}</p>` : ''}
  <p class="msg">${esc(msg)}</p>
  <div class="foot"><span><span class="dot"></span>/ ${esc(BRAND.name)}</span><span>${ok ? 'You can close this tab' : 'Try again from the app'}</span></div>
</main>
</body></html>`
}
