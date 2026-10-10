const { app, BrowserWindow, protocol } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, sep } = require('node:path')
const Module = require('node:module')
const { buildSync } = Module.createRequire(require.resolve('vite'))('esbuild')

const sourcePath = resolve('apps/desktop/src/main/platform/electron/mediaProtocol.ts')
const loaded = new Module(sourcePath, module)
loaded.paths = module.paths
loaded._compile(buildSync({ entryPoints: [sourcePath], bundle: true, write: false,
  platform: 'node', format: 'cjs', external: ['electron', '@eleckoi/dsh-product-data/media'],
  alias: { '@shared': resolve('packages/product-shared/src') },
}).outputFiles[0].text, sourcePath)
const media = loaded.exports
protocol.registerSchemesAsPrivileged([media.localMediaScheme, { scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }])
const root = mkdtempSync(join(tmpdir(), 'eleckoi-media-crop-'))
app.setPath('userData', root)
let window
let dispose
let failed = false
async function main() {
  const { LocalMediaStore } = await import('@eleckoi/dsh-product-data/media')
  const store = new LocalMediaStore(root)
  const image = store.prepareImage('user/example', 'avatar',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=')
  image.commit()
  const editor = buildSync({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { AvatarManagerEditor } from './apps/web/src/ui/ui/AvatarSlotsEditor.jsx';
    globalThis.React = React;
    globalThis.savedAvatars = null;
    createRoot(document.getElementById('root')).render(React.createElement(AvatarManagerEditor, {
      value: { portrait: ${JSON.stringify(image.reference)}, square: ${JSON.stringify(image.reference)}, circle: ${JSON.stringify(image.reference)} },
      name: 'Example', onSave: async value => { globalThis.savedAvatars = value; },
    }));`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  }).outputFiles[0].text
  await app.whenReady()
  dispose = media.mediaProtocolPlugin.apply({ appPaths: { media: root } })
  protocol.handle('dsh-app', request => new Response(new URL(request.url).pathname === '/probe.js'
    ? editor : '<!doctype html><html><body><div id="root"></div><script src="/probe.js"></script></body></html>', {
    headers: { 'content-type': new URL(request.url).pathname === '/probe.js' ? 'text/javascript' : 'text/html' },
  }))
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') process.stderr.write(message + '\n')
  })
  await window.loadURL('dsh-app://app/')
  const result = await window.webContents.executeJavaScript(`(async () => {
    const source = ${JSON.stringify(image.reference)};
    const preview = new Image();
    preview.src = source;
    await preview.decode();
    const response = await fetch(source);
    if (!response.ok) throw new Error('Media response: ' + response.status);
    const file = new File([await response.blob()], 'avatar.png', { type: 'image/png' });
    const image = new Image();
    const url = URL.createObjectURL(file);
    try { image.src = url; await image.decode(); return { bytes: file.size, width: image.naturalWidth }; }
    finally { URL.revokeObjectURL(url); }
  })()`)
  if (result.bytes < 1 || result.width !== 1) throw new Error('Crop input did not decode')
  const waitFor = async expression => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Avatar editor check timed out: ' + expression)
  }
  await waitFor(`document.querySelector('.is-portrait header button') !== null`)
  for (const kind of ['portrait', 'shared']) {
    await window.webContents.executeJavaScript(`document.querySelector('.is-${kind} header button').click()`)
    await waitFor(`document.querySelector('.avatar-crop-save')?.disabled === false`)
    await window.webContents.executeJavaScript(`document.querySelector('.avatar-crop-save').click()`)
    await waitFor(`document.querySelector('.avatar-crop-overlay') === null && globalThis.savedAvatars !== null`)
    const saved = await window.webContents.executeJavaScript(`globalThis.savedAvatars`)
    if (!(kind === 'portrait' ? saved.portrait : saved.square).startsWith('data:image/png;base64,')) {
      throw new Error('Cropped avatar was not saved')
    }
    if (kind === 'shared' && saved.circle !== saved.square) throw new Error('Shared crop did not update both avatars')
  }
  process.stdout.write('Persisted avatar reading and both crop dialogs opened and saved successfully in Electron.\n')
}
main().catch(error => { failed = true; process.stderr.write(`${error.stack || error}\n`) }).finally(() => {
  window?.destroy()
  dispose?.()
  protocol.unhandle('dsh-app')
  if (resolve(root).startsWith(resolve(tmpdir()) + sep)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
    catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error }
  }
  app.exit(failed ? 1 : 0)
})
