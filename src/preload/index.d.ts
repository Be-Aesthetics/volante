import type { RouterApi } from './index'

declare global {
  interface Window {
    router: RouterApi
  }
}

export {}
