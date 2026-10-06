import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@eleckoi/dsh-product-api'

const baseUrl = '/eleckoi/assets/'
const mime: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp'
}

/** The official HTTP Host serves the same product renderer used by Electron. */
export async function installWebClientAssets(ctx: Context, directory: string): Promise<void> {
  const html = await readFile(resolve(directory, 'src/renderer/dsh.html'), 'utf8')
  const script = html.match(/<script\b[^>]*\bsrc="(?:\.\.\/)+assets\/([^"]+\.js)"/i)?.[1]
  const style = html.match(/<link\b[^>]*\bhref="(?:\.\.\/)+assets\/([^"]+\.css)"/i)?.[1]
  if (!script || !style) throw new Error('ElecKoi WebClient build is incomplete')
  const assets = { baseUrl, script: baseUrl + script, style: baseUrl + style }
  const root = resolve(directory, 'assets')
  await Promise.all([readFile(resolve(root, script)), readFile(resolve(root, style))])
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__ELECKOI_CLIENT_ASSETS__', value: assets })
  })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: baseUrl.slice(0, -1), handler: async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return
    }
    let pathname: string
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) }
    catch { response.writeHead(400); response.end(); return }
    const target = resolve(root, pathname.slice(baseUrl.length))
    if (!target.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
    let content: Buffer
    try { content = await readFile(target) }
    catch (error) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        response.writeHead(404); response.end(); return
      }
      throw error
    }
    response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' })
    response.end(request.method === 'HEAD' ? undefined : content)
  } }), 'eleckoi: shared WebClient assets')
}

/** Author project files use the same Host route for HTTP clients and Electron's protocol proxy. */
export function installProductFrontendAssets(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/eleckoi/frontends', handler: (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return
    }
    const frontends = ctx.get('eleckoiCompatibilityFrontends', false)
    if (!frontends) { response.writeHead(503); response.end('Frontend service is not ready'); return }
    let parts: string[]
    try { parts = new URL(request.url ?? '/', 'http://localhost').pathname.slice('/eleckoi/frontends/'.length).split('/').map(decodeURIComponent) }
    catch { response.writeHead(400); response.end(); return }
    const id = parts.shift() ?? '', path = parts.join('/')
    try {
      const asset = frontends.readAsset(id, path)
      response.writeHead(200, { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' })
      response.end(request.method === 'HEAD' ? undefined : asset.body)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || /does not exist/.test(String(error))) {
        response.writeHead(404); response.end(); return
      }
      throw error
    }
  } }), 'eleckoi: shared HTML frontend resources')
}
