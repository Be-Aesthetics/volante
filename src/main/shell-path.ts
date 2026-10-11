// Apps opened from Finder, the Dock or at login get launchd's bare PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so stdio servers launched with npx, node,
// uvx or docker would not be found. Borrow the PATH the user's login shell sets up.

import { execFileSync } from 'node:child_process'

const MARK = '__VOLANTE_PATH__'
// Where Homebrew and friends usually live, in case the shell can't be asked.
const FALLBACK = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']

export function fixShellPath(): void {
  if (process.platform === 'win32') return
  const dirs: string[] = []
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }
    })
    const m = out.match(new RegExp(`${MARK}(.*)${MARK}`))
    if (m) dirs.push(...m[1].split(':'))
  } catch {
    /* a slow or broken shell config shouldn't stop the app */
  }
  dirs.push(...(process.env.PATH ?? '').split(':'), ...FALLBACK)
  process.env.PATH = [...new Set(dirs.filter(Boolean))].join(':')
}
