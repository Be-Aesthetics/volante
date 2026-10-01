// Product identity: name, app ID, default port and the entry name written
// into each AI app's MCP config.

export interface Brand {
  id: 'volante'
  name: string
  appId: string
  /** Default router port. */
  port: number
  tokenPrefix: string
  /** Entry name written into each AI app's MCP config. */
  clientKey: string
  accent: string
  /** Theme a fresh install starts in. */
  defaultMode: 'light' | 'dark'
  swatches: string[]
  /** Title-bar colours before the renderer loads. */
  chrome: { dark: [string, string]; light: [string, string] }
}

export const BRAND: Brand = {
  id: 'volante',
  name: 'Volante',
  appId: 'com.beaesthetics.volante',
  port: 47900,
  tokenPrefix: 'vol_',
  clientKey: 'volante',
  accent: '#fc3a1e',
  defaultMode: 'light',
  swatches: ['#fc3a1e', '#ff7a1a', '#0d0d0d', '#3a6cff', '#2fae66'],
  chrome: { dark: ['#0d0d0d', '#eeeeee'], light: ['#0d0d0d', '#eeeeee'] }
}
