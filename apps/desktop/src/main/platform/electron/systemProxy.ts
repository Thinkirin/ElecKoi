export type ElectronProxyResolver = (url: string) => Promise<string>

export type DshProxyEnvironment = Readonly<Record<string, string>>

const explicitProxyNames = [
  'http_proxy', 'HTTP_PROXY',
  'https_proxy', 'HTTPS_PROXY',
  'all_proxy', 'ALL_PROXY'
] as const

function hasExplicitProxy(environment: NodeJS.ProcessEnv): boolean {
  return explicitProxyNames.some(name => environment[name]?.trim())
}

function proxyUrlOf(result: string): string | undefined {
  for (const directive of result.split(';')) {
    const match = /^\s*(PROXY|HTTP|HTTPS)\s+(.+?)\s*$/i.exec(directive)
    if (match === null) continue
    const [, kind, target] = match
    if (kind === undefined || target === undefined) continue
    const protocol = kind.toUpperCase() === 'HTTPS' ? 'https:' : 'http:'
    try {
      const url = new URL(`${protocol}//${target}`)
      if (url.hostname === '') continue
      return url.href
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Convert Chromium's effective system-proxy route into the environment contract
 * installed by DSH before any profile plugin mounts. An explicitly exported
 * proxy remains authoritative and is never mixed with the operating-system route.
 */
export async function resolveDshSystemProxyEnvironment(
  resolveProxy: ElectronProxyResolver,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  report: (message: string) => void = () => undefined
): Promise<DshProxyEnvironment> {
  if (hasExplicitProxy(inheritedEnvironment)) return {}

  const environment: Record<string, string> = {}
  for (const protocol of ['http', 'https'] as const) {
    let result: string
    try {
      result = await resolveProxy(`${protocol}://example.com/`)
    } catch (error) {
      report(`无法读取 Electron ${protocol.toUpperCase()} 系统代理：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const proxy = proxyUrlOf(result)
    if (proxy === undefined) {
      if (!result.split(';').some(directive => /^\s*DIRECT\s*$/i.test(directive))) {
        report(`Electron ${protocol.toUpperCase()} 系统代理不包含 DSH 支持的 HTTP(S) 路由。`)
      }
      continue
    }
    environment[`${protocol}_proxy`] = proxy
    environment[`${protocol.toUpperCase()}_PROXY`] = proxy
  }
  return environment
}
