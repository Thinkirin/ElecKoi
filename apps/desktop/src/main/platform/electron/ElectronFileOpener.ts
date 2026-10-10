import { existsSync } from 'node:fs'
import { shell } from 'electron'

export class ElectronFileOpener {
  reveal(path: string): void {
    if (!existsSync(path)) throw new Error('文件已不存在。')
    shell.showItemInFolder(path)
  }
}
