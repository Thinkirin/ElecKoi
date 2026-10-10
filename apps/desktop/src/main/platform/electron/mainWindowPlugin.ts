import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { app, BrowserWindow, ipcMain, nativeTheme, protocol, screen, session, shell, type BrowserWindowConstructorOptions } from 'electron'
import { windowsAppUserModelId } from './windowsAppIdentity'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { assertTrustedDshClientFrame, isAllowedExternalUrl, isAppRendererUrl, isDshAppUrl, isDshChildUrl } from './validateSender'
import { ElectronWindowHost } from './ElectronWindowHost'
import { installWindowsNativeFrame } from './windowsNativeFrame'
import { DesktopBrowserGuests } from './desktopBrowserGuests'
import { authenticateDshClientHost, DSH_CLIENT_ORIGIN, forwardDshClientRequest, isDshClientAsset, resolveElecKoiClientAssets, serveDshClientAsset, serveElecKoiClientAsset } from './dshClientDocument'
import { DESKTOP_SHELL_IPC } from '@shared/contracts/desktopShell'

export const mainWindowPlugin = {
  name: 'eleckoi-main-window',
  inject: ['appPaths', 'appLog', 'pluginHost'],
  provide: 'electronWindows',
  async apply(ctx: Context) {
    const appPaths = ctx.appPaths
    const appLog = ctx.appLog
    const pluginHost = ctx.pluginHost
    nativeTheme.themeSource = 'system'

    const windows = new ElectronWindowHost()
    ctx.provide('electronWindows', windows)
    let mainWindow: BrowserWindow | undefined
    let pluginHostReady: { url: string; injections: readonly unknown[]; cookie: string } | undefined
    const browserGuests = new DesktopBrowserGuests(() => pluginHostReady?.url)

    windows.define('main', {
      singleton: true,
      closesHostOnClose: true,
      options: () => windowOptions(appPaths, false),
      load: (window) => window.loadURL(`${DSH_CLIENT_ORIGIN}/`),
      afterCreate: (window) => {
        mainWindow = window
        window.once('closed', () => { if (mainWindow === window) mainWindow = undefined })
        browserGuests.bind(window)
        configureMainWindow(appPaths, appLog, windows, window)
      }
    })
    windows.define('child', {
      singleton: false,
      instanceKey: (payload) => {
        const frameName = (payload as { frameName?: unknown })?.frameName
        return typeof frameName === 'string' ? frameName : ''
      },
      options: (payload) => windowOptions(appPaths, true, payload),
      load: async (window, payload) => {
        const url = (payload as { url?: unknown })?.url
        if (typeof url !== 'string' || (!isAppRendererUrl(url) && !isDshChildUrl(url))) {
          throw new Error('拒绝打开非 ElecKoi 子窗口。')
        }
        await window.loadURL(url)
      },
      afterCreate: (window) => {
        configureWindowsAppDetails(appPaths, window)
        installWindowsNativeFrame(window)
        window.webContents.on('did-finish-load', () => installWindowsNativeFrame(window))
        window.webContents.on('console-message', ({ level, message }) => {
          if (level === 'error') appLog.error({ message }, 'ElecKoi child window console error')
        })
        window.webContents.on('did-fail-load', (_event, code, description, url) => {
          appLog.error({ code, description, url }, 'ElecKoi child window failed to load')
        })
        window.once('ready-to-show', () => window.show())
        configureWindowNavigation(appLog, windows, window, true)
      }
    })
    const rendererDirectory = join(dirname(createRequire(import.meta.url).resolve('@eleckoi/web-client/package.json')), 'dist')
    const clientAssets = await resolveElecKoiClientAssets(rendererDirectory)
    protocol.handle('dsh-app', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return new Response(null, { status: 404 })
      if (url.pathname.startsWith('/eleckoi/assets/')) return serveElecKoiClientAsset(request, rendererDirectory)
      if (isDshClientAsset(url.pathname)) return serveDshClientAsset(request, pluginHost.frontendDirectory())
      const ready = pluginHostReady
      if (ready === undefined) return new Response(null, { status: 503 })
      try {
        const response = await forwardDshClientRequest(request, ready.url, ready.cookie)
        if (!response.ok && url.pathname.startsWith('/plugins/')) {
          appLog.error({ status: response.status, pathname: url.pathname }, 'DSH client plugin asset failed')
        }
        return response
      } catch (error) {
        appLog.error({ error, pathname: url.pathname }, 'DSH client request failed')
        return new Response(null, { status: 502 })
      }
    })
    ipcMain.handle('eleckoi:dsh-client-boot', (event) => {
      assertTrustedDshClientFrame(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      const ready = pluginHostReady
      if (ready === undefined) throw new Error('DSH 插件宿主尚未启动。')
      return {
        injections: [
          ...ready.injections,
          { kind: 'global', name: '__ELECKOI_CLIENT_ASSETS__', value: clientAssets }
        ],
        streamBaseUrl: new URL(ready.url).origin
      }
    })
    ipcMain.handle('eleckoi:dsh-client-boot-failed', (event, message: unknown) => {
      assertTrustedDshClientFrame(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      if (typeof message !== 'string') throw new Error('DSH 插件页面错误格式不正确。')
      appLog.error({ message }, 'DSH plugin client boot failed')
    })
    const syncNativeTheme = (event: Electron.IpcMainEvent, source: unknown) => {
      const mainContents = mainWindow?.webContents
      if (mainContents === undefined || event.sender !== mainContents
        || event.senderFrame !== mainContents.mainFrame
        || event.senderFrame?.url !== `${DSH_CLIENT_ORIGIN}/`) return
      if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
    }
    ipcMain.on('eleckoi:dsh-native-theme', syncNativeTheme)
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
      const ready = pluginHostReady
      const trustedSender = windows.all().some(window => window.webContents.id === details.webContentsId)
      if (ready === undefined || !trustedSender) { callback({}); return }
      const target = new URL(ready.url)
      if (new URL(details.url).host !== target.host) { callback({}); return }
      const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
      if (headers.origin !== DSH_CLIENT_ORIGIN) { callback({ cancel: true }); return }
      callback({ requestHeaders: { ...headers, origin: target.origin, cookie: ready.cookie, 'sec-fetch-site': 'same-origin' } })
    })
    const focusMainWindow = () => { void windows.open('main') }
    app.on('activate', focusMainWindow)
    app.on('second-instance', focusMainWindow)
    const detachPluginFailure = pluginHost.onFailure(() => {
      for (const window of windows.all()) {
        if (!window.isDestroyed()) {
          window.webContents.send(DESKTOP_SHELL_IPC.hostFailure, '插件服务意外退出，请重新打开插件中心。')
        }
      }
    })

    ipcMain.handle(DESKTOP_SHELL_IPC.windowControl, (event, action: unknown) => {
      assertTrustedDshClientFrame(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      if (action !== 'minimize' && action !== 'maximize' && action !== 'close') {
        throw new TypeError('桌面窗口操作不受支持。')
      }
      const target = BrowserWindow.fromWebContents(event.sender)
      if (target === null || target.isDestroyed()) return
      if (action === 'minimize') target.minimize()
      if (action === 'maximize') {
        if (target.isMaximized()) target.unmaximize()
        else target.maximize()
      }
      if (action === 'close') target.close()
    })
    ipcMain.handle(DESKTOP_SHELL_IPC.browserAcquire, (event, workspace: unknown) => {
      assertTrustedDshClientFrame(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      return browserGuests.acquire(event.sender, workspace)
    })
    ipcMain.handle(DESKTOP_SHELL_IPC.browserRelease, async (event, lease: unknown) => {
      assertTrustedDshClientFrame(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      await browserGuests.release(event.sender, lease)
    })
    const ready = await pluginHost.start()
    pluginHostReady = { ...ready, cookie: await authenticateDshClientHost(ready.url) }
    await windows.open('main')
    return () => {
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.windowControl)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.browserAcquire)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.browserRelease)
      detachPluginFailure()
      ipcMain.removeHandler('eleckoi:dsh-client-boot')
      ipcMain.removeHandler('eleckoi:dsh-client-boot-failed')
      ipcMain.removeListener('eleckoi:dsh-native-theme', syncNativeTheme)
      session.defaultSession.webRequest.onBeforeSendHeaders(null)
      protocol.unhandle('dsh-app')
      app.removeListener('activate', focusMainWindow)
      app.removeListener('second-instance', focusMainWindow)
      windows.close()
    }
  }
} satisfies Plugin.Object

function windowOptions(appPaths: Context['appPaths'], child: boolean, payload?: unknown): BrowserWindowConstructorOptions {
  const size = child ? initialChildWindowSize(payload) : initialWindowSize()
  return {
    title: child ? 'ElecKoi' : 'ElecKoi',
    ...size,
    minWidth: 900,
    minHeight: 600,
    center: true,
    show: false,
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const }
      : { frame: false }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#13131a' : '#ffffff',
    icon: appPaths.resolveResource('icons', 'eleckoi-app-icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: !child
    }
  }
}

function configureMainWindow(appPaths: Context['appPaths'], appLog: Context['appLog'], windows: ElectronWindowHost, window: BrowserWindow): void {
  configureWindowsAppDetails(appPaths, window)
  installWindowsNativeFrame(window)
  window.webContents.on('did-finish-load', () => installWindowsNativeFrame(window))
  window.webContents.on('console-message', (details) => {
    if (details.level !== 'error') return
    // Rich character cards run in srcDoc iframes. Their compatibility API
    // errors are author-card diagnostics, not failures of the DSH application
    // renderer. Electron forwards both frames through this one WebContents
    // event, so only the main frame belongs in the DSH renderer error stream.
    // Older Electron builds can report the child frame as the main frame on
    // this event. `about:srcdoc` is the explicit origin used by author cards,
    // so use it as a second guard to keep card-local errors out of the DSH
    // renderer error stream.
    if (details.sourceId === 'about:srcdoc'
      || (details.frame && details.frame !== window.webContents.mainFrame)) return
    appLog.error({
      message: details.message,
      lineNumber: details.lineNumber,
      sourceId: details.sourceId,
      url: window.webContents.getURL()
    }, 'DSH client renderer error')
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // Rich author cards use srcDoc iframes. Replacing their document while a
    // message changes reports ERR_ABORTED (-3) for about:srcdoc; it is an
    // expected subframe lifecycle event, not a failed DSH application load.
    if (!isMainFrame && code === -3) return
    appLog.error({ code, description, url, isMainFrame }, 'DSH client renderer failed to load')
  })
  window.once('ready-to-show', () => window.show())
  configureWindowNavigation(appLog, windows, window, true)
}

function configureWindowNavigation(appLog: Context['appLog'], windows: ElectronWindowHost, window: BrowserWindow, allowDshClient = false): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppRendererUrl(url) && !(allowDshClient && isDshAppUrl(url))) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (isAppRendererUrl(url) || isDshChildUrl(url)) void windows.open('child', { url, frameName })
    else if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error: unknown) => {
        appLog.warn({ error, url }, 'Failed to open external URL')
      })
    }
    else appLog.warn({ url }, 'Blocked external window request')
    return { action: 'deny' }
  })
}

function configureWindowsAppDetails(appPaths: Context['appPaths'], window: BrowserWindow): void {
  if (process.platform !== 'win32') return

  const executable = `"${process.execPath}"`
  const windowIconPath = appPaths.resolveResource('icons', 'eleckoi-app-icon.png')
  const relaunchCommand = process.defaultApp
    ? `${executable} "${app.getAppPath()}"`
    : executable

  window.setIcon(windowIconPath)
  window.setAppDetails({
    appId: windowsAppUserModelId,
    appIconPath: process.defaultApp
      ? appPaths.resolveResource('icons', 'eleckoi-app-icon.ico')
      : process.execPath,
    appIconIndex: 0,
    relaunchCommand,
    relaunchDisplayName: 'ElecKoi'
  })
}

function initialWindowSize(): { width: number; height: number } {
  return fitWindowSize(1536, 1070)
}

function initialChildWindowSize(payload?: unknown): { width: number; height: number } {
  const frameName = (payload as { frameName?: unknown } | undefined)?.frameName
  if (typeof frameName === 'string' && frameName.startsWith('character-editor-')) {
    return fitWindowSize(1520, 1120)
  }
  if (frameName === 'creator-studio') {
    return fitWindowSize(1536, 1070)
  }
  if (frameName === 'character-manager' || frameName === 'preset-manager') {
    return fitWindowSize(1500, 1040)
  }
  return fitWindowSize(960, 720)
}

function fitWindowSize(preferredWidth: number, preferredHeight: number): { width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const workAreaMargin = 64
  const scale = Math.min(
    1,
    (workArea.width - workAreaMargin) / preferredWidth,
    (workArea.height - workAreaMargin) / preferredHeight
  )

  return {
    width: Math.max(900, Math.floor(preferredWidth * scale)),
    height: Math.max(600, Math.floor(preferredHeight * scale))
  }
}
