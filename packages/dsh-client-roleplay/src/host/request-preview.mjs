import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { requestContextItems } from './conversation-context.mjs'

/** Actual dispatches retained only by the running Host, with shared immutable message versions. */
export class RequestPreviewStore {
  #run = randomUUID()
  #sequence = 0
  #sessions = new Map()
  #subscribers = new Set()

  capture(session, options, plan, execution) {
    let state = this.#sessions.get(session.id)
    if (!state) {
      state = { records: new Map(), messages: new Map(), plan: [], inputRequests: new Map() }
      this.#sessions.set(session.id, state)
    }
    if (!execution) throw new Error('实际模型请求缺少 Session 步骤。')
    const input = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const { round, turn, step } = execution
    const group = input?.id ?? turn
    const request = (state.inputRequests.get(group) ?? 0) + 1
    state.inputRequests.set(group, request)
    const summary = Object.freeze({ id: `${this.#run}:${++this.#sequence}`, round, request,
      turn, step, provider: options.provider, model: options.model })
    const messages = options.messages.map(message => {
      const previous = state.messages.get(message.id)
      if (previous && isDeepStrictEqual(previous, message)) return previous
      state.messages.set(message.id, message)
      return message
    })
    if (!isDeepStrictEqual(state.plan, plan)) state.plan = Object.freeze(plan.map(entry => Object.freeze({ ...entry })))
    state.records.set(summary.id, { summary, messages, plan: state.plan })
    this.#publish(session.id)
    return summary
  }

  list(sessionId) {
    return [...(this.#sessions.get(sessionId)?.records.values() ?? [])].map(record => record.summary)
  }

  read(sessionId, requestId) {
    const record = this.#sessions.get(sessionId)?.records.get(requestId)
    if (!record) throw new Error('此请求不在当前运行期间的上下文预览中。')
    return { id: requestId, items: requestContextItems(record.messages, record.plan) }
  }

  stream(sessionId, signal) {
    const subscriber = { sessionId, pending: this.list(sessionId), closed: signal.aborted, wake: undefined }
    if (!subscriber.closed) this.#subscribers.add(subscriber)
    const close = () => {
      subscriber.closed = true
      subscriber.pending = undefined
      this.#subscribers.delete(subscriber)
      subscriber.wake?.()
    }
    signal.addEventListener('abort', close, { once: true })
    const store = this
    return (async function* () {
      try {
        while (!subscriber.closed) {
          if (subscriber.pending !== undefined) {
            const next = subscriber.pending
            subscriber.pending = undefined
            yield next
          } else await new Promise(resolve => { subscriber.wake = resolve })
        }
      } finally {
        signal.removeEventListener('abort', close)
        store.#subscribers.delete(subscriber)
        subscriber.pending = undefined
      }
    })()
  }

  #publish(sessionId) {
    for (const subscriber of this.#subscribers) {
      if (subscriber.sessionId !== sessionId || subscriber.closed) continue
      // Slow readers receive the newest small catalog; request bodies never enter this feed.
      subscriber.pending = this.list(sessionId)
      subscriber.wake?.()
      subscriber.wake = undefined
    }
  }

  forget(sessionId) {
    this.#sessions.delete(sessionId)
    this.#publish(sessionId)
  }

  close() {
    this.#sessions.clear()
    for (const subscriber of this.#subscribers) {
      subscriber.closed = true
      subscriber.pending = undefined
      subscriber.wake?.()
    }
    this.#subscribers.clear()
  }
}
