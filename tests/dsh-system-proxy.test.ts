import { describe, expect, it, vi } from 'vitest'
import { resolveDshSystemProxyEnvironment } from '../apps/desktop/src/main/platform/electron/systemProxy'

describe('DSH system proxy bridge', () => {
  it('converts Electron HTTP and HTTPS proxy routes into the DSH launch environment', async () => {
    const resolveProxy = vi.fn(async (url: string) => url.startsWith('https:')
      ? 'HTTPS proxy.example:8443; DIRECT'
      : 'PROXY 127.0.0.1:7890; DIRECT')

    await expect(resolveDshSystemProxyEnvironment(resolveProxy, {})).resolves.toEqual({
      http_proxy: 'http://127.0.0.1:7890/',
      HTTP_PROXY: 'http://127.0.0.1:7890/',
      https_proxy: 'https://proxy.example:8443/',
      HTTPS_PROXY: 'https://proxy.example:8443/'
    })
    expect(resolveProxy).toHaveBeenCalledTimes(2)
  })

  it('keeps explicit launch proxy variables authoritative', async () => {
    const resolveProxy = vi.fn(async () => 'PROXY 127.0.0.1:7890')

    await expect(resolveDshSystemProxyEnvironment(resolveProxy, {
      HTTPS_PROXY: 'http://explicit.example:8080'
    })).resolves.toEqual({})
    expect(resolveProxy).not.toHaveBeenCalled()
  })

  it('does not turn DIRECT or unsupported SOCKS routes into an HTTP proxy', async () => {
    const report = vi.fn()
    const resolveProxy = vi.fn(async (url: string) => url.startsWith('https:')
      ? 'SOCKS5 127.0.0.1:7891'
      : 'DIRECT')

    await expect(resolveDshSystemProxyEnvironment(resolveProxy, {}, report)).resolves.toEqual({})
    expect(report).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith('Electron HTTPS 系统代理不包含 DSH 支持的 HTTP(S) 路由。')
  })
})
