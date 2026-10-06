import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dshClientPages } from './dsh-client-pages.mjs'

const root = resolve(import.meta.dirname, '..')
const assets = resolve(root, 'out/renderer-dsh/assets')
const files = await readdir(assets)
const html = await readFile(resolve(root, 'out/renderer-dsh/src/renderer/dsh.html'), 'utf8')
const styles = files.filter(file => file.endsWith('.css'))
if (styles.length !== 1 || !html.includes(`assets/${styles[0]}`)) {
  throw new Error('DSH 页面样式没有随客户端主入口加载。')
}

for (const page of dshClientPages) {
  const assetName = `eleckoi-page-${page.key}.js`
  const bundle = await readFile(resolve(assets, assetName), 'utf8')
  const plugin = await readFile(resolve(root, `packages/${page.package}/src/client.js`), 'utf8')
  if (!new RegExp(`\\bas\\s+${page.component}\\b`).test(bundle)) {
    throw new Error(`${assetName} 没有导出 ${page.component}。`)
  }
  if (!plugin.includes(assetName)
    || !plugin.includes('__ELECKOI_CLIENT_ASSETS__?.baseUrl')
    || !plugin.includes('dsh-app://app/eleckoi/assets/')) {
    throw new Error(`${page.package} 没有加载自己的页面资源。`)
  }
}
