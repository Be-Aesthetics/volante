import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ActivityEntry, AppState, ClientId, ClientView, ImportCandidate, ServerConfig, Settings } from '../shared/types'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  onState: (cb: (s: AppState) => void) => on('state', cb),

  addServer: (p: Partial<ServerConfig>, opts?: { signIn?: boolean }): Promise<string> => ipcRenderer.invoke('server:add', p, opts),
  updateServer: (cfg: ServerConfig): Promise<void> => ipcRenderer.invoke('server:update', cfg),
  removeServer: (id: string): Promise<void> => ipcRenderer.invoke('server:remove', id),
  restartServer: (id: string): Promise<void> => ipcRenderer.invoke('server:restart', id),
  reorderServers: (ids: string[]): Promise<void> => ipcRenderer.invoke('server:reorder', ids),
  serverLogs: (id: string): Promise<string[]> => ipcRenderer.invoke('server:logs', id),
  onLogs: (cb: (id: string) => void) => on('logs', cb),
  signIn: (id: string): Promise<void> => ipcRenderer.invoke('server:signin', id),
  signOut: (id: string): Promise<void> => ipcRenderer.invoke('server:signout', id),

  listClients: (): Promise<ClientView[]> => ipcRenderer.invoke('clients:list'),
  connectClient: (id: ClientId): Promise<void> => ipcRenderer.invoke('clients:connect', id),
  disconnectClient: (id: ClientId): Promise<void> => ipcRenderer.invoke('clients:disconnect', id),
  clientSnippet: (id: ClientId): Promise<string> => ipcRenderer.invoke('clients:snippet', id),

  importList: (): Promise<ImportCandidate[]> => ipcRenderer.invoke('import:list'),
  importApply: (items: ImportCandidate[], remove: boolean): Promise<void> => ipcRenderer.invoke('import:apply', items, remove),

  activity: (): Promise<ActivityEntry[]> => ipcRenderer.invoke('activity:list'),
  clearActivity: (): Promise<void> => ipcRenderer.invoke('activity:clear'),
  onActivity: (cb: (e: ActivityEntry) => void) => on('activity', cb),
  onActivityCleared: (cb: () => void) => on('activity-cleared', cb),

  updateSettings: (p: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', p),
  regenToken: (): Promise<Settings> => ipcRenderer.invoke('settings:regen-token'),

  setTitleBarColors: (color: string, symbolColor: string): Promise<void> => ipcRenderer.invoke('titlebar:set', { color, symbolColor }),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open:external', url),
  showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('open:path', p),
  openConfigDir: (): Promise<void> => ipcRenderer.invoke('open:config-dir'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit')
}

export type RouterApi = typeof api
contextBridge.exposeInMainWorld('router', api)
