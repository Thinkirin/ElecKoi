import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_SHELL_IPC } from '../../../shared/contracts/desktopShell'
import type { PlatformSpeechRequest } from '../../../shared/contracts/platformSpeech'
import { DesktopSystemSpeech } from './desktopSystemSpeech'

/** Each renderer owns its synthesis tasks; navigation/disposal releases the OS processes and audio files. */
export function installDesktopSpeechIpc(
  authorize: (event: IpcMainInvokeEvent) => void,
  report: (error: unknown) => void
): () => Promise<void> {
  const sessions = new Map<number, DesktopSystemSpeech>()
  const closing = new Set<Promise<void>>()
  const forEvent = (event: IpcMainInvokeEvent): DesktopSystemSpeech => {
    authorize(event)
    const id = event.sender.id
    let speech = sessions.get(id)
    if (!speech) {
      speech = new DesktopSystemSpeech()
      sessions.set(id, speech)
      event.sender.once('destroyed', () => {
        const instance = sessions.get(id)
        if (!instance) return
        sessions.delete(id)
        const close = instance.close()
        closing.add(close)
        void close.then(() => closing.delete(close), error => { closing.delete(close); report(error) })
      })
    }
    return speech
  }
  ipcMain.handle(DESKTOP_SHELL_IPC.ttsVoices, event => forEvent(event).voices())
  ipcMain.handle(DESKTOP_SHELL_IPC.ttsSynthesize, (event, request: PlatformSpeechRequest) => forEvent(event).synthesize(request))
  ipcMain.handle(DESKTOP_SHELL_IPC.ttsCancel, (event, id: string) => forEvent(event).cancel(id))
  ipcMain.handle(DESKTOP_SHELL_IPC.ttsReadAudio, (event, token: string, offset: number, count?: number) => forEvent(event).readAudio(token, offset, count))
  ipcMain.handle(DESKTOP_SHELL_IPC.ttsReleaseAudio, (event, token: string) => forEvent(event).releaseAudio(token))
  return async () => {
    for (const channel of [DESKTOP_SHELL_IPC.ttsVoices, DESKTOP_SHELL_IPC.ttsSynthesize, DESKTOP_SHELL_IPC.ttsCancel,
      DESKTOP_SHELL_IPC.ttsReadAudio, DESKTOP_SHELL_IPC.ttsReleaseAudio]) ipcMain.removeHandler(channel)
    const tasks = [...closing, ...[...sessions.values()].map(speech => speech.close())]
    sessions.clear()
    await Promise.all(tasks)
  }
}
