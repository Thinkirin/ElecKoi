import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { authorVendorPlugin } from '../../scripts/vite-author-vendor-plugin.ts'
import { dshClientPages } from '../../scripts/dsh-client-pages.mjs'

const webRoot = import.meta.dirname
const workspaceRoot = resolve(webRoot, '../..')

const platformExports = {
  react: [
    'Children', 'Component', 'Fragment', 'PureComponent', 'Suspense', 'cloneElement',
    'createContext', 'createElement', 'createRef', 'forwardRef', 'isValidElement',
    'lazy', 'memo', 'startTransition', 'useCallback', 'useContext', 'useDebugValue',
    'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle', 'useInsertionEffect',
    'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState',
    'useSyncExternalStore', 'useTransition'
  ],
  'react/jsx-runtime': ['Fragment', 'jsx', 'jsxs'],
  'react/jsx-dev-runtime': ['Fragment', 'jsxDEV'],
  'react-dom': ['createPortal', 'flushSync'],
  'react-dom/client': ['createRoot', 'hydrateRoot']
}

function dshPlatformReact() {
  const prefix = '\0eleckoi-dsh-platform:'
  return {
    name: 'eleckoi-dsh-platform-react',
    enforce: 'pre',
    resolveId(source) {
      return Object.hasOwn(platformExports, source) ? prefix + source : null
    },
    load(id) {
      if (!id.startsWith(prefix)) return null
      const source = id.slice(prefix.length)
      const member = source === 'react' ? 'react'
        : source === 'react-dom' ? 'reactDom'
          : source === 'react-dom/client' ? 'reactDomClient'
            : source === 'react/jsx-runtime' ? 'jsxRuntime' : 'jsxDevRuntime'
      return [
        `const platform = globalThis.__ELECKOI_DSH_PLATFORM__?.${member};`,
        `if (!platform) throw new Error('DSH React platform module is unavailable: ${source}');`,
        'export default platform;',
        ...platformExports[source].map(name => `export const ${name} = platform.${name};`)
      ].join('\n')
    }
  }
}

export default defineConfig({
  root: webRoot,
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve(webRoot, 'src'),
      '@shared': resolve(workspaceRoot, 'packages/product-shared/src')
    }
  },
  plugins: [dshPlatformReact(), authorVendorPlugin(workspaceRoot), react(), tailwindcss()],
  build: {
    outDir: resolve(webRoot, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        app: resolve(webRoot, 'dsh.html'),
        ...Object.fromEntries(dshClientPages.map(page => [
          `eleckoi-page-${page.key}`,
          resolve(workspaceRoot, `packages/${page.package}/src/${page.entry}`)
        ]))
      },
      output: { entryFileNames: 'assets/[name].js' }
    }
  }
})
