import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { slugPrefix, type AppState, type ClientId, type ImportCandidate, type ServerConfig, type Settings } from '../shared/types'
import { Store, newToken } from './store'
import { BRAND } from '../shared/brand'
import { UpstreamManager } from './upstream'
import { Activity, Router } from './router'
import { connectClient, disconnectClient, importCandidates, listClients, refreshConnected, removeFromClient, snippet, type Endpoint } from './clients'

// Each brand keeps its own config; ROUTER_DATA_DIR lets a dev or test run use a scratch one.
app.setName(BRAND.name)
app.setPath('userData', process.env.ROUTER_DATA_DIR || join(app.getPath('appData'), BRAND.name))

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

if (process.platform === 'win32') app.setAppUserModelId(BRAND.appId)
const isMac = process.platform === 'darwin'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// Created once the app is ready: safeStorage's key isn't loaded before that,
// and decrypting early would silently drop every stored secret.
let store: Store
let ups: UpstreamManager
let router: Router
const activity = new Activity()

const endpoint = (): Endpoint => ({ url: router.url, token: store.settings.token, requireToken: store.settings.requireToken })
/** App assets live in resources/ as volante-icon.png and volante-tray.png. */
const resource = (f: string): string =>
  join(app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..'), 'resources', `${BRAND.id}-${f}`)

function state(): AppState {
  return { settings: store.settings, servers: ups.all().map((u) => u.view()), router: router.status() }
}

let pushTimer: NodeJS.Timeout | undefined
function pushState(): void {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    win?.webContents.send('state', state())
    updateTray()
  }, 30)
}

// ---------------------------------------------------------------------------
// Window and tray

function createWindow(show: boolean): void {
  const dark = store.settings.theme.mode === 'dark' || (store.settings.theme.mode === 'system' && nativeTheme.shouldUseDarkColors)
  const [bg, fg] = dark ? BRAND.chrome.dark : BRAND.chrome.light
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 820,
    minHeight: 540,
    show: false,
    title: BRAND.name,
    icon: resource('icon.png'),
    backgroundColor: bg,
    // macOS keeps its traffic lights, inset into the frame; Windows gets themed overlay controls.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: bg, symbolColor: fg, height: 36 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => {
    if (show) win?.show()
  })
  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win) createWindow(true)
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function updateTray(): void {
  if (!tray) return
  const all = ups.all()
  const ready = all.filter((u) => u.status === 'ready').length
  const tools = ups.toolIndex().size
  const head = router.running ? `Routing ${tools} tools from ${ready}/${all.length} servers` : (router.error ?? 'Router stopped')
  tray.setToolTip(`${BRAND.name} — ${head}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: head, enabled: false },
      { type: 'separator' },
      { label: `Open ${BRAND.name}`, click: showWindow },
      { label: 'Restart all servers', click: () => void Promise.all(ups.all().map((u) => u.restart())) },
      { type: 'separator' },
      {
        label: `Quit ${BRAND.name}`,
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const img = nativeImage.createFromPath(resource('tray.png'))
  // The menu bar recolours template images for light and dark menus.
  if (isMac) img.setTemplateImage(true)
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.on('click', showWindow)
  updateTray()
}

// ---------------------------------------------------------------------------
// Settings side effects

async function applySettings(patch: Partial<Settings>): Promise<Settings> {
  const prev = { ...store.settings }
  const next = store.setSettings(patch)
  if (patch.launchAtLogin !== undefined) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] })
  }
  const endpointChanged = prev.port !== next.port || prev.token !== next.token || prev.requireToken !== next.requireToken
  if (prev.port !== next.port) await router.start()
  if (endpointChanged) refreshConnected(endpoint())
  pushState()
  return next
}

// ---------------------------------------------------------------------------
// IPC

function newServer(p: Partial<ServerConfig>): ServerConfig {
  const name = p.name?.trim() || 'Server'
  let prefix = p.prefix?.trim() || slugPrefix(name)
  const taken = new Set(store.servers.map((s) => s.prefix))
  for (let i = 2; taken.has(prefix); i++) prefix = `${slugPrefix(name)}_${i}`
  return {
    id: randomUUID(),
    name,
    prefix,
    enabled: true,
    transport: p.transport ?? 'stdio',
    command: p.command,
    args: p.args ?? [],
    cwd: p.cwd,
    env: p.env ?? {},
    url: p.url,
    headers: p.headers ?? {},
    policy: p.policy ?? 'all',
    overrides: p.overrides ?? {},
    source: p.source
  }
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => state())

  ipcMain.handle('server:add', async (_e, p: Partial<ServerConfig>, opts?: { signIn?: boolean }) => {
    const cfg = newServer(p)
    // With signIn, open the provider's sign-in page as soon as the server asks for it.
    void ups.add(cfg).then(async () => {
      const u = ups.get(cfg.id)
      if (opts?.signIn && u?.auth?.pendingUrl) await shell.openExternal(u.auth.pendingUrl.href)
    })
    return cfg.id
  })
  ipcMain.handle('server:update', async (_e, cfg: ServerConfig) => {
    await ups.update(cfg)
  })
  ipcMain.handle('server:remove', (_e, id: string) => ups.remove(id))
  ipcMain.handle('server:restart', (_e, id: string) => ups.get(id)?.restart())
  ipcMain.handle('server:reorder', (_e, ids: string[]) => {
    store.reorder(ids)
    pushState()
  })
  ipcMain.handle('server:logs', (_e, id: string) => ups.get(id)?.stderr ?? [])
  ipcMain.handle('server:signin', async (_e, id: string) => {
    const u = ups.get(id)
    if (!u) return
    if (!u.auth?.pendingUrl) await u.restart()
    if (u.auth?.pendingUrl) await shell.openExternal(u.auth.pendingUrl.href)
  })
  ipcMain.handle('server:signout', async (_e, id: string) => {
    const u = ups.get(id)
    if (!u) return
    u.signOut()
    await u.restart()
  })

  ipcMain.handle('clients:list', () => listClients())
  ipcMain.handle('clients:connect', (_e, id: ClientId) => connectClient(id, endpoint()))
  ipcMain.handle('clients:disconnect', (_e, id: ClientId) => disconnectClient(id))
  ipcMain.handle('clients:snippet', (_e, id: ClientId) => snippet(id, endpoint()))

  ipcMain.handle('import:list', () => importCandidates(store.servers))
  ipcMain.handle('import:apply', async (_e, items: ImportCandidate[], remove: boolean) => {
    for (const it of items) {
      await ups.add(newServer({ ...it.config, source: it.clientName })).catch(() => {})
      if (remove) removeFromClient(it.client, it.key)
    }
  })

  ipcMain.handle('activity:list', () => activity.entries)
  ipcMain.handle('activity:clear', () => activity.clear())

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => applySettings(patch))
  ipcMain.handle('settings:regen-token', () => applySettings({ token: newToken() }))

  ipcMain.handle('titlebar:set', (_e, { color, symbolColor }: { color: string; symbolColor: string }) => {
    try {
      if (!isMac) win?.setTitleBarOverlay({ color, symbolColor, height: 36 })
      win?.setBackgroundColor(color)
    } catch {
      /* not supported on this platform */
    }
  })
  ipcMain.handle('open:external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('open:path', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('open:config-dir', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('app:quit', () => {
    quitting = true
    app.quit()
  })
}

// ---------------------------------------------------------------------------

function init(): void {
  store = new Store()
  ups = new UpstreamManager(store, () => `http://127.0.0.1:${store.settings.port}/oauth/callback`)
  router = new Router(store, ups, activity)

  router.onOAuthCallback = async (serverId, state, code, err) => {
    if (err || !code) throw new Error(err ?? 'No authorization code')
    const u = ups.get(serverId)
    if (!u) throw new Error('Unknown server')
    await u.finishAuth(code, state)
    showWindow()
  }

  ups.on('changed', pushState)
  ups.on('logs', (id: string) => win?.webContents.send('logs', id))
  router.on('changed', pushState)
}

activity.on('entry', (e) => win?.webContents.send('activity', e))
activity.on('cleared', () => win?.webContents.send('activity-cleared'))

// Clicking the dock icon brings the window back on macOS.
app.on('activate', () => showWindow())

app.on('second-instance', (_e, argv) => {
  if (!argv.includes('--hidden')) showWindow()
})

app.on('before-quit', () => {
  quitting = true
})

let stopped = false
app.on('will-quit', (e) => {
  if (stopped || !store) return
  e.preventDefault()
  stopped = true
  void Promise.race([Promise.all([ups.stopAll(), router.stop()]), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  /* keep running in the tray; the router must stay up */
})

void app.whenReady().then(async () => {
  init()
  registerIpc()
  const hidden = process.argv.includes('--hidden') || store.settings.startHidden
  createWindow(!hidden)
  createTray()
  await router.start()
  await ups.startAll()
})
