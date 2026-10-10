import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedVersion = '1.7.0'
const packageNames = ['@headless-tree/core', '@headless-tree/react']
const noticePath = resolve(root, 'apps', 'desktop', 'resources', 'licenses', 'headless-tree-MIT.txt')

const expectedNotice = `MIT License

Copyright (c) 2023 Lukas Bach

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

for (const packageName of packageNames) {
  const metadataPath = resolve(root, 'node_modules', ...packageName.split('/'), 'package.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  if (metadata.version !== expectedVersion) {
    throw new Error(`${packageName} 版本应为 ${expectedVersion}，实际为 ${metadata.version}`)
  }
  if (metadata.license !== 'MIT') {
    throw new Error(`${packageName} 许可证应为 MIT，实际为 ${metadata.license || '未声明'}`)
  }
}

const notice = await readFile(noticePath, 'utf8')
if (notice.replaceAll('\r\n', '\n') !== expectedNotice) {
  throw new Error('Headless Tree MIT 许可证文本缺失或已变更')
}

console.log('Desktop third-party license notice is current.')
