import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', media: 'src/storage/media/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.json',
  external: [
    '@deepseek-ai/cordis',
    'better-sqlite3',
    /^drizzle-orm(?:\/.*)?$/,
    'zod'
  ]
})
