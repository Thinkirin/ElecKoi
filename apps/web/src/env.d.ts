/// <reference types="vite/client" />

import type { DshDesktopProductApi } from '../../../packages/product-shared/src/contracts/desktopShell'

declare global {
  interface Window {
    dshDesktop: DshDesktopProductApi
  }
}

export {}
