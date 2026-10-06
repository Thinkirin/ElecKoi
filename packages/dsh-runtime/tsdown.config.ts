import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'desktop-plugin-host': 'src/desktopPluginHostChild.ts',
    'node-host': 'src/nodePluginHost.ts',
    'android-transcript-import': 'src/androidTranscriptImport.ts',
    'session-edit-plugin': 'src/sessionEditPlugin.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json'
})
