import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', media: 'src/storage/media/index.ts', 'android-import': 'src/migration/androidDomainImport.ts',
    'android-conversations': 'src/migration/androidConversationImport.ts', 'android-files': 'src/migration/androidFileImport.ts' },
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
