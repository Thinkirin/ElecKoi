import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { authorVendorPlugin } from './scripts/vite-author-vendor-plugin'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('apps/desktop/src/main'),
      '@product-data': resolve('packages/dsh-product-data/src'),
      '@shared': resolve('packages/product-shared/src'),
      '@eleckoi/dsh-product-data/media': resolve('packages/dsh-product-data/src/storage/media/index.ts'),
      '@eleckoi/dsh-product-data': resolve('packages/dsh-product-data/src/index.ts'),
      '@eleckoi/desktop-host': resolve('apps/desktop-host/src/index.ts'),
      '@eleckoi/dsh-runtime': resolve('packages/dsh-runtime/src/index.ts')
    }
  },
  plugins: [authorVendorPlugin(resolve('.'))],
  test: {
    environment: 'node',
    server: {
      deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] }
    }
  }
})
