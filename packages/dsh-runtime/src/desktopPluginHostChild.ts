import { delimiter } from 'node:path'
import { startPluginHostApplication } from './pluginHostApplication'
import { isParentHostMessage, type ChildHostMessage } from './hostSessionProtocol'

function send(message: ChildHostMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) {
      resolve()
      return
    }
    process.send(message, error => error === null ? resolve() : reject(error))
  })
}

async function main(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (profileDirectory === undefined) throw new Error('Missing desktop plugin profile directory')
  const application = startPluginHostApplication({
    profileDirectory,
    patchFiles: [process.argv[3], process.argv[6]].filter((value): value is string => Boolean(value)),
    ...!process.argv[4] ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[4]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[5] ?? ''}${delimiter}${process.env.PATH ?? ''}`
        }
      }
    }
  })
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    const running = await application
    await running.close()
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect?.()
  })()
  process.on('message', (value: unknown) => {
    if (!isParentHostMessage(value)) {
      void send({ type: 'fatal', message: 'Invalid ElecKoi Host control message' })
      return
    }
    if (value.type === 'shutdown') {
      void stop().catch(reportFailure)
      return
    }
    void application.then(host => host.control(value))
      .then(active => send({ type: 'update-tasks-complete', id: value.id, active }))
      .catch(error => send({ type: 'update-tasks-complete', id: value.id, active: true,
        message: error instanceof Error ? error.message : String(error) }))
  })
  process.once('disconnect', () => { void stop().catch(reportFailure) })
  const host = await application
  if (stopping === undefined) await send({ type: 'ready', ...host.ready })
}

function reportFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  void send({ type: 'fatal', message }).catch(sendError => { console.error(sendError) })
  console.error(error)
  process.exitCode = 1
  if (process.connected) process.disconnect?.()
}

void main().catch(reportFailure)
