import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { authorVendorPlugin } from '../../scripts/vite-author-vendor-plugin'

const desktopRoot = import.meta.dirname
const workspaceRoot = resolve(desktopRoot, '../..')
const webRoot = resolve(workspaceRoot, 'apps/web')
const sharedRoot = resolve(workspaceRoot, 'packages/product-shared/src')

export default defineConfig({
  main: {
    build: { lib: { entry: resolve(desktopRoot, 'src/main/main.ts') } },
    resolve: { alias: { '@main': resolve(desktopRoot, 'src/main'), '@shared': sharedRoot } },
    plugins: [externalizeDepsPlugin({
      exclude: ['@eleckoi/author-sdk', '@eleckoi/compatibility-mvu', '@eleckoi/compatibility-tavern-helper', 'electron-updater']
    })]
  },
  preload: {
    build: {
      lib: { entry: resolve(desktopRoot, 'src/preload/preload.ts') },
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    },
    resolve: { alias: { '@shared': sharedRoot } },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: webRoot,
    build: {
      outDir: resolve(desktopRoot, 'out/renderer'),
      rollupOptions: { input: resolve(webRoot, 'index.html') }
    },
    server: { cors: { origin: 'dsh-app://app' }, fs: { allow: [workspaceRoot] } },
    resolve: { alias: { '@renderer': resolve(webRoot, 'src'), '@shared': sharedRoot } },
    plugins: [authorVendorPlugin(workspaceRoot), react(), tailwindcss()]
  }
})
