const { app, BrowserWindow, nativeTheme } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const root = mkdtempSync(join(tmpdir(), 'eleckoi-dsh-client-'))
let host
let window
const diagnostics = []

async function main() {
  const { DshDesktopPluginHost } = await import('@eleckoi/desktop-host')
  const packageManager = {
    entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
    nodeBinPath: join(__dirname, '..', 'apps', 'desktop', 'resources', 'dsh', 'node-bin')
  }
  await app.whenReady()
  if (process.env.ELECKOI_PLUGIN_CLIENT_THEME === 'dark') nativeTheme.themeSource = 'dark'
  host = new DshDesktopPluginHost({
    runtimeDataRoot: root,
    workspaceRoot: join(root, 'workspace'),
    productDatabasePath: join(root, 'product.sqlite'),
    productMediaRoot: join(root, 'media'),
    presetTemplatePath: resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'),
    agentPatchPath: resolve('apps/desktop/resources/dsh/desktop-agent.patch.yml'),
    executablePath: process.execPath,
    packageManager,
    onDiagnostic: message => diagnostics.push(`host:${message}`)
  })
  const ready = await host.start()
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.webContents.on('console-message', details => {
    diagnostics.push(`console:${details.level}:${details.message}`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    diagnostics.push(`load:${code}:${description}:${url}`)
  })
  await window.loadURL(ready.url)
  const deadline = Date.now() + 30_000
  let body = ''
  while (Date.now() < deadline) {
    body = await window.webContents.executeJavaScript('document.body.innerText')
    if (body.includes('插件') || body.includes('Plugins')) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  if (!body.includes('插件') && !body.includes('Plugins')) {
    throw new Error(`DSH client did not show plugin navigation: ${body.slice(0, 1000)}\n${diagnostics.slice(-100).join('\n')}`)
  }
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '插件' || button.getAttribute('aria-label') === 'Plugins')?.click()`)
  let pluginPage = ''
  while (Date.now() < deadline) {
    pluginPage = await window.webContents.executeJavaScript('document.body.innerText')
    if (pluginPage.includes('添加插件') || pluginPage.includes('Add Plugin')) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  if (!pluginPage.includes('添加插件') && !pluginPage.includes('Add Plugin')) {
    throw new Error(`DSH plugin center did not render: ${pluginPage.slice(0, 500)}`)
  }
  if (process.env.ELECKOI_PLUGIN_CLIENT_THEME === 'dark') {
    const dark = await window.webContents.executeJavaScript(`document.body.hasAttribute('data-ds-dark-theme')`)
    if (!dark) throw new Error('DSH plugin center did not follow the desktop dark mode.')
  }
  let addEnabled = false
  while (Date.now() < deadline) {
    addEnabled = await window.webContents.executeJavaScript(`Boolean(Array.from(document.querySelectorAll('button')).find(button => (button.innerText.trim() === '添加插件' || button.innerText.trim() === 'Add Plugin') && !button.disabled))`)
    if (addEnabled) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  if (!addEnabled) throw new Error('DSH add-plugin button remained disabled.')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '添加插件' || button.innerText.trim() === 'Add Plugin').click()`)
  let installDialog = ''
  while (Date.now() < deadline) {
    installDialog = await window.webContents.executeJavaScript('document.body.innerText')
    if ((installDialog.includes('插件安装引导') || installDialog.includes('Plugin installation guide'))
      && (installDialog.includes('安装源') || installDialog.includes('Registry'))) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  if ((!installDialog.includes('插件安装引导') && !installDialog.includes('Plugin installation guide'))
    || (!installDialog.includes('安装源') && !installDialog.includes('Registry'))) {
    throw new Error(`DSH add-plugin dialog did not include guide and package source: ${installDialog.slice(0, 500)}`)
  }
  const installSpec = process.env.ELECKOI_PLUGIN_CLIENT_INSTALL_SPEC
  if (installSpec) {
    const bundle = installSpec.replace(/@[^@/]+$/, '')
    const entered = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[aria-label="包名或地址"], input[aria-label="Package name or address"]')
      if (!input) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(installSpec)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!entered) throw new Error('DSH add-plugin input is unavailable.')
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '安装' || button.innerText.trim() === 'Install')?.click()`)
    const installDeadline = Date.now() + 90_000
    let phase = ''
    while (Date.now() < installDeadline) {
      phase = await window.webContents.executeJavaScript(`document.querySelector('[data-install-phase]')?.getAttribute('data-install-phase') ?? ''`)
      if (phase === 'done' || phase === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (phase !== 'done') throw new Error(`DSH UI plugin install ended in phase ${phase}: ${(await window.webContents.executeJavaScript('document.body.innerText')).slice(-1000)}`)
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '立即启用' || button.innerText.trim() === 'Enable now')?.click()`)
    while (Date.now() < installDeadline) {
      const found = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-plugin-package="${bundle}"]'))`)
      if (found) break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    const opened = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('[data-plugin-package="${bundle}"]')
      const button = card?.querySelector('button')
      button?.click()
      return Boolean(button)
    })()`)
    if (!opened) throw new Error(`Installed plugin card ${bundle} is unavailable.`)
    const detail = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-plugin-detail="${bundle}"]'))`)
    if (!detail) throw new Error(`Installed plugin detail ${bundle} is unavailable.`)
    await window.webContents.executeJavaScript(`document.querySelector('[data-plugin-detail="${bundle}"] button[aria-label^="卸载"], [data-plugin-detail="${bundle}"] button[aria-label^="Uninstall"]')?.click()`)
    const confirmed = await window.webContents.executeJavaScript(`(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).at(-1)
      const button = Array.from(dialog?.querySelectorAll('button') ?? []).find(row => row.innerText.trim() === '卸载' || row.innerText.trim() === 'Uninstall')
      button?.click()
      return Boolean(button)
    })()`)
    if (!confirmed) throw new Error('DSH uninstall confirmation is unavailable.')
    while (Date.now() < installDeadline) {
      const found = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-plugin-package="${bundle}"]'))`)
      if (!found) break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    const remained = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-plugin-package="${bundle}"]'))`)
    if (remained) throw new Error(`DSH UI did not remove ${bundle}.`)
    process.stdout.write(`DSH official client installed, enabled and uninstalled ${bundle} through its UI.\n`)
  }
  const configOpened = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-plugin-item]')
    const button = card?.querySelector('button')
    button?.click()
    return Boolean(button)
  })()`)
  if (!configOpened) throw new Error('DSH official plugin configuration entry is unavailable.')
  const configured = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-plugin-item-detail] [data-plugin-config]'))`)
  if (!configured) throw new Error('DSH official plugin configuration page did not render.')
  const screenshotPath = process.env.ELECKOI_PLUGIN_CLIENT_SCREENSHOT
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG())
  process.stdout.write('DSH official client rendered plugin navigation, add dialog, guide, package source and configuration in Electron.\n')
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n${diagnostics.slice(-100).join('\\n')}\\n`)
  process.exitCode = 1
}).finally(async () => {
  window?.destroy()
  await host?.close()
  rmSync(root, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
