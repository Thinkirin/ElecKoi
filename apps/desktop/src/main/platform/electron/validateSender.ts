import type { WebContents } from 'electron'
import { DesktopError, DESKTOP_ERROR_CODES } from '@shared/foundation/DesktopError'

export function isAppRendererUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    if (developmentUrl !== undefined) {
      return candidate.origin === new URL(developmentUrl).origin
    }
    if (candidate.protocol !== 'file:') return false
    const path = decodeURIComponent(candidate.pathname).replaceAll('\\', '/')
    return path.endsWith('/out/renderer/index.html')
  } catch {
    return false
  }
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    return candidate.protocol === 'https:'
  } catch {
    return false
  }
}

export function isDshAppUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    return candidate.protocol === 'dsh-app:' && candidate.hostname === 'app'
      && candidate.username === '' && candidate.password === '' && candidate.port === ''
  } catch {
    return false
  }
}

export function isDshChildUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    if (!isDshAppUrl(url) || candidate.pathname !== '/' || candidate.hash) return false
    const view = candidate.searchParams.get('view')
    if (view === 'character-editor' || view === 'chat') {
      const key = view === 'chat' ? 'chat' : 'character'
      return candidate.searchParams.size === 2 && Boolean(candidate.searchParams.get(key))
    }
    return (view === 'creator-studio' || view === 'character-manager' || view === 'preset-manager')
      && candidate.searchParams.size === 1
  } catch {
    return false
  }
}

export function assertTrustedRenderer(sender: WebContents, frameUrl: string, isMainFrame: boolean): void {
  if (!isMainFrame || frameUrl !== sender.getURL()
    || (!isAppRendererUrl(frameUrl) && !isDshAppUrl(frameUrl))) {
    throw new DesktopError(DESKTOP_ERROR_CODES.FORBIDDEN, '拒绝来自非 ElecKoi 页面进程的调用。')
  }
}

export function assertTrustedDshClientFrame(
  sender: WebContents,
  frameUrl: string,
  isMainFrame: boolean,
  trustedWindowSenders: readonly WebContents[]
): void {
  if (!trustedWindowSenders.includes(sender) || !isMainFrame || frameUrl !== sender.getURL()
    || !isDshAppUrl(frameUrl)
    || (new URL(frameUrl).pathname !== '/')
    || (new URL(frameUrl).search !== '' && !isDshChildUrl(frameUrl))) {
    throw new DesktopError(DESKTOP_ERROR_CODES.FORBIDDEN, '拒绝来自非 ElecKoi DSH 页面进程的桌面调用。')
  }
}
