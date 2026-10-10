import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { DshDesktopPluginHost } from '@eleckoi/desktop-host'

const root = await mkdtemp(join(tmpdir(), 'eleckoi-electron-dsh-'))
const host = new DshDesktopPluginHost({
  runtimeDataRoot: join(root, 'runtime'),
  workspaceRoot: join(root, 'workspace'),
  productDatabasePath: join(root, 'product.sqlite'),
  productMediaRoot: join(root, 'media'),
  presetTemplatePath: resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'),
  agentPatchPath: resolve('apps/desktop/resources/dsh/desktop-agent.patch.yml'),
  executablePath: process.execPath
})

try {
  const ready = await host.start()
  if (!ready.url || !Array.isArray(ready.injections)) {
    throw new Error('DSH Desktop Host did not return its authenticated client bootstrap.')
  }
  if (await host.updateTasks('inspect') !== false) {
    throw new Error('DSH Desktop Host reported unexpected active tasks.')
  }
  console.log('Electron DSH Desktop Host handshake passed.')
} finally {
  await host.close()
  const absolute = resolve(root)
  if (!absolute.startsWith(resolve(tmpdir()) + sep)
    || !basename(absolute).startsWith('eleckoi-electron-dsh-')) {
    throw new Error('Refusing to remove an unexpected probe directory.')
  }
  await rm(absolute, { recursive: true, force: true })
}
