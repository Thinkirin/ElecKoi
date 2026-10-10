import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_SHELL_IPC, type DesktopBrowserBridge, type DesktopBrowserLeaseId, type DshDesktopProductApi } from '@shared/contracts/desktopShell'
import type { UpdateInstallResult, UpdateStatus } from '@shared/contracts/updates/schemas'

function createDesktopBrowserBridge(): DesktopBrowserBridge {
  const listeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()
  ipcRenderer.on(DESKTOP_SHELL_IPC.browserOpenRequested, (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('url' in request)
      || typeof request.lease !== 'string' || typeof request.url !== 'string') return
    const callbacks = listeners.get(request.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    for (const callback of [...callbacks]) {
      try {
        callback(request.url)
      } catch (error) {
        console.error('Desktop browser link handler failed', error)
      }
    }
  })
  return {
    acquire: (workspace) => ipcRenderer.invoke(DESKTOP_SHELL_IPC.browserAcquire, workspace) as ReturnType<DesktopBrowserBridge['acquire']>,
    release: (lease) => ipcRenderer.invoke(DESKTOP_SHELL_IPC.browserRelease, lease) as Promise<void>,
    onOpenRequested(lease, listener) {
      let callbacks = listeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        listeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks?.delete(listener)
        if (callbacks?.size === 0) listeners.delete(lease)
      }
    }
  }
}

function createDesktopProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    browser: createDesktopBrowserBridge(),
    updates: {
      status: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.updatesStatus) as Promise<UpdateStatus>,
      check: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.updatesCheck) as Promise<UpdateStatus>,
      download: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.updatesDownload) as Promise<UpdateStatus>,
      install: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.updatesInstall) as Promise<UpdateInstallResult>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]): void => listener(status)
        ipcRenderer.on(DESKTOP_SHELL_IPC.updatesChanged, handle)
        return () => ipcRenderer.off(DESKTOP_SHELL_IPC.updatesChanged, handle)
      }
    },
    windowControls: {
      minimize: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.windowControl, 'minimize') as Promise<void>,
      maximizeToggle: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.windowControl, 'maximize') as Promise<void>,
      close: () => ipcRenderer.invoke(DESKTOP_SHELL_IPC.windowControl, 'close') as Promise<void>
    },
    host: {
      subscribeFailure(listener) {
        const handle = (_event: Electron.IpcRendererEvent, message: string): void => listener(message)
        ipcRenderer.on(DESKTOP_SHELL_IPC.hostFailure, handle)
        return () => ipcRenderer.off(DESKTOP_SHELL_IPC.hostFailure, handle)
      }
    }
  }
}

const documentLocation = (globalThis as unknown as { location?: { protocol: string; hostname: string } }).location
if (documentLocation?.protocol === 'dsh-app:' && documentLocation.hostname === 'app' && process.isMainFrame) {
  type BootNode = {
    nextElementSibling: BootNode | null
    textContent: string | null
    style: { cssText: string }
    remove(): void
    after(node: BootNode): void
  }
  const browser = globalThis as unknown as {
    document: {
      querySelector(selector: string): BootNode | null
      createElement(tag: string): BootNode
      documentElement: { getAttribute(name: string): string | null }
      readyState: string
    }
    MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void }
    addEventListener(name: string, listener: () => void, options: { once: boolean }): void
  }
  const showBootFailure = (message: string): void => {
    const spinner = browser.document.querySelector('[data-dsh-boot-spinner]')
    if (spinner === null) return
    const hint = spinner.nextElementSibling
    spinner.remove()
    if (hint !== null) hint.textContent = '插件加载失败'
    const detail = browser.document.createElement('pre')
    detail.textContent = message
    detail.style.cssText = 'max-width:min(640px,80vw);white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;font:12px/1.5 monospace;color:inherit;'
    hint?.after(detail)
  }
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke('eleckoi:dsh-client-boot') as Promise<unknown>,
    failed: (message: string) => {
      showBootFailure(message)
      return ipcRenderer.invoke('eleckoi:dsh-client-boot-failed', message) as Promise<void>
    }
  })

  let sentThemeSource: string | undefined
  const sendThemeSource = (): void => {
    const source = browser.document.documentElement.getAttribute('data-ds-theme-source')
    if (source === null || source === sentThemeSource) return
    sentThemeSource = source
    ipcRenderer.send('eleckoi:dsh-native-theme', source)
  }
  const observeThemeSource = (): void => {
    new browser.MutationObserver(sendThemeSource).observe(browser.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ds-theme-source']
    })
    sendThemeSource()
  }
  if (browser.document.readyState === 'loading') {
    browser.addEventListener('DOMContentLoaded', observeThemeSource, { once: true })
  } else observeThemeSource()
}

contextBridge.exposeInMainWorld(
  'dshDesktop',
  documentLocation?.protocol === 'dsh-app:' && documentLocation.hostname === 'app' && process.isMainFrame
    ? createDesktopProductApi()
    : { protocolVersion: 1 }
)
