import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_SHELL_IPC, type DesktopTextFileRequest, type DesktopTextFileResult } from '../../../shared/contracts/desktopShell'

/** The native picker owns the destination; success means the UTF-8 write has completed. */
export async function saveDesktopTextFile(
  request: DesktopTextFileRequest,
  choosePath: (name: string) => Promise<string | undefined>,
  persist: typeof writeFile = writeFile
): Promise<DesktopTextFileResult> {
  if (typeof request?.name !== 'string' || !request.name.trim()) throw new TypeError('Filename is required')
  if (typeof request.text !== 'string') throw new TypeError('text must be a string')
  const path = await choosePath(request.name)
  if (!path) return { saved: false, cancelled: true }
  const content = Buffer.from(request.text, 'utf8')
  await persist(path, content)
  return { saved: true, name: basename(path), uri: pathToFileURL(path).href, bytes: content.byteLength }
}

export function installDesktopFileIpc(authorize: (event: IpcMainInvokeEvent) => void): () => void {
  ipcMain.handle(DESKTOP_SHELL_IPC.filesSaveText, async (event, request: DesktopTextFileRequest) => {
    authorize(event)
    const parent = BrowserWindow.fromWebContents(event.sender)
    return saveDesktopTextFile(request, async name => {
      const options = { defaultPath: name }
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      return result.canceled ? undefined : result.filePath
    })
  })
  return () => ipcMain.removeHandler(DESKTOP_SHELL_IPC.filesSaveText)
}
