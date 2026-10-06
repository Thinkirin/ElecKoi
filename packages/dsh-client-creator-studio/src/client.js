window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-creator-studio',
  factory(require) {
    const React = require('react')
    function clientTimeZone() {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (['+00:00', '-00:00', 'GMT', 'UTC'].includes(zone)) return 'UTC'
      // Session's optional wire field accepts named zones, not Intl offset identifiers.
      return typeof zone === 'string' && /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone) ? zone : undefined
    }
    class CreatorStudioProjects {
      constructor(remote, sessions, uiConversation, fileUpload) {
        this.remote = remote
        this.sessions = sessions
        this.uiConversation = uiConversation
        this.fileUpload = fileUpload
        this.assistantSnapshot = { projectId: '', sessionId: '', history: [], messages: [], status: 'idle', running: false, error: '' }
        this.assistantListeners = new Set()
        this.assistantGeneration = 0
        this.assistantReference = null
        this.assistantStops = []
        this.snapshot = { status: 'loading', collection: { items: [] }, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.directoryRequests = new Set()
        this.directorySnapshot = { open: false }
        this.directoryListeners = new Set()
        this.directoryPending = null
        this.changeAbort = null
      }

      getSnapshot = () => this.snapshot
      getDirectorySnapshot = () => this.directorySnapshot
      subscribeDirectory = listener => { this.directoryListeners.add(listener); return () => this.directoryListeners.delete(listener) }
      publishDirectory(open) { this.directorySnapshot = { open }; for (const listener of this.directoryListeners) listener() }
      finishDirectory = (value, error) => {
        const pending = this.directoryPending
        if (!pending) return
        this.directoryPending = null
        pending.signal.removeEventListener('abort', pending.abort)
        this.publishDirectory(false)
        if (error) pending.reject(error)
        else pending.resolve(value)
      }

      browseDirectory(signal) {
        return new Promise((resolve, reject) => {
          const abort = () => this.finishDirectory(null, signal.reason || new Error('文件夹选择已取消。'))
          this.directoryPending = { resolve, reject, signal, abort }
          signal.addEventListener('abort', abort, { once: true })
          this.publishDirectory(true)
        })
      }
      getAssistantSnapshot = () => this.assistantSnapshot
      subscribeAssistant = listener => { this.assistantListeners.add(listener); return () => this.assistantListeners.delete(listener) }
      publishAssistant(next) { if (this.disposed) return; this.assistantSnapshot = next; for (const listener of this.assistantListeners) listener() }
      unwrap(result, message) { if (!result?.ok) throw new Error(result?.error?.message || message); return result.value }

      releaseAssistant() {
        this.assistantGeneration += 1
        for (const stop of this.assistantStops) stop()
        this.assistantStops = []
        this.assistantReference?.release()
        this.assistantReference = null
      }

      async enterProject(projectId) {
        this.releaseAssistant()
        const generation = this.assistantGeneration
        this.publishAssistant({ projectId, sessionId: '', history: [], messages: [], status: 'loading', running: false, error: '' })
        try {
          const history = this.unwrap(await this.remote.eleckoiCreatorAssistant.history(projectId), '读取创作对话失败。')
          if (generation !== this.assistantGeneration || this.disposed) return
          this.publishAssistant({ ...this.assistantSnapshot, history: history.items, status: 'ready' })
          if (history.activeSessionId) await this.openAssistantConversation(projectId, history.activeSessionId)
        } catch (error) { if (generation === this.assistantGeneration) this.publishAssistant({ ...this.assistantSnapshot, status: 'error', error: error.message || String(error) }); throw error }
      }

      async createAssistantConversation(projectId) {
        const history = this.unwrap(await this.remote.eleckoiCreatorAssistant.create(projectId), '创建创作对话失败。')
        if (this.assistantSnapshot.projectId === projectId) await this.openAssistantConversation(projectId, history.activeSessionId)
        return history
      }

      async openAssistantConversation(projectId, sessionId) {
        this.releaseAssistant()
        const generation = this.assistantGeneration
        this.publishAssistant({ ...this.assistantSnapshot, projectId, sessionId, messages: [], status: 'loading', running: false, error: '' })
        try {
          const history = this.unwrap(await this.remote.eleckoiCreatorAssistant.open(projectId, sessionId), '打开创作对话失败。')
          await this.sessions.refresh()
          if (this.disposed || generation !== this.assistantGeneration) return
          const reference = this.sessions.retain(sessionId, { source: 'mainView' })
          this.assistantReference = reference
          const binding = await reference.ready
          if (this.disposed || generation !== this.assistantGeneration) { reference.release(); return }
          const target = this.uiConversation.binding(binding).target('chat')
          const publish = () => {
            if (generation !== this.assistantGeneration || this.disposed) return
            const chat = target.getSnapshot(), state = binding.session.getSnapshot(), messages = []
            const body = blocks => (blocks || []).filter(block => block.kind === 'text').map(block => block.text || '').join('')
            for (const key of chat?.order || []) {
              const node = chat.nodes?.get(key), data = node?.data
              if (!node) continue
              if (node.kind === 'user' || node.kind === 'steering') messages.push({ id: key, role: 'user', content: (data.content || []).filter(item => item.type === 'text').map(item => item.text || '').join(''), attachments: (data.content || []).filter(item => ['image', 'file'].includes(item.type)) })
              if (node.kind === 'assistant-step') {
                const reasoning = (data.blocks || []).filter(block => block.kind === 'reasoning').map(block => block.text || '').join('')
                const tools = (data.blocks || []).filter(block => ['tool-call', 'tool-result'].includes(block.kind)).map(block => ({ id: block.callId, name: block.name || block.call?.name || block.callId, kind: block.kind, detail: block.argsRaw || (block.content || []).map(item => item.text || '').join('') }))
                messages.push({ id: key, role: 'assistant', content: body(data.blocks), reasoning, tools })
              }
              if (node.kind === 'tool-call') {
                const toolRows = root => !root ? [] : [{ id: root.callId, name: root.name || root.call?.name || root.callId, kind: root.kind, detail: root.kind === 'tool-result' ? (root.content || []).map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') || root.error?.reason || '' : root.argsRaw || '' }, ...(root.subCalls || []).flatMap(toolRows)]
                messages.push({ id: key, role: 'assistant', content: '', tools: toolRows(data.root) })
              }
            }
            const error = state.openError?.message || state.promptError?.error?.message || state.lastAgentError || (state.removed ? '创作会话已关闭。' : '')
            this.publishAssistant({ projectId, sessionId, history: history.items, messages, status: error ? 'error' : 'ready', running: state.running === true, error })
          }
          this.assistantStops = [target.subscribe(publish), binding.session.subscribe(publish)]
          publish()
        } catch (error) { if (generation === this.assistantGeneration) { this.releaseAssistant(); this.publishAssistant({ ...this.assistantSnapshot, status: 'error', error: error.message || String(error) }) } throw error }
      }

      async sendAssistant(projectId, text, files = []) {
        let sessionId = this.assistantSnapshot.projectId === projectId ? this.assistantSnapshot.sessionId : ''
        if (!sessionId) { const history = await this.createAssistantConversation(projectId); sessionId = history.activeSessionId }
        const content = text.trim() ? [{ type: 'text', text }] : []
        for (const file of files) {
          if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error || new Error('读取图片失败。')); reader.readAsDataURL(file) })
            content.push({ type: 'image', mediaType: file.type, data, name: file.name })
          } else {
            const uploaded = this.unwrap(await this.fileUpload.upload(sessionId, file, file.name), '上传创作文件失败。')
            content.push({ type: 'file', receiptId: uploaded.receiptId })
          }
        }
        const timeZone = clientTimeZone()
        const result = this.unwrap(await this.remote.eleckoiCreatorAssistant.prompt({ projectId, sessionId, content, requestId: crypto.randomUUID(), ...(timeZone === undefined ? {} : { clientTimeZone: timeZone }) }), '发送创作消息失败。')
        return result
      }

      async cancelAssistant(projectId) {
        const sessionId = this.assistantSnapshot.projectId === projectId ? this.assistantSnapshot.sessionId : ''
        if (!sessionId) throw new Error('请先打开创作对话。')
        return this.unwrap(await this.remote.eleckoiCreatorAssistant.cancel(projectId, sessionId), '停止创作失败。')
      }

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      publish(next) {
        this.snapshot = next
        for (const listener of this.listeners) listener()
      }

      assertCollection(value) {
        if (!value || !Array.isArray(value.items) || value.items.some(item => !item
          || typeof item.id !== 'string' || typeof item.name !== 'string'
          || typeof item.rootPath !== 'string' || typeof item.mode !== 'string')) {
          throw new Error('创作项目返回的数据格式不正确。')
        }
        return value
      }

      adopt(collection) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', collection: this.assertCollection(collection), error: '' })
      }

      start() {
        void this.refresh().catch(() => {})
        this.changeAbort = new AbortController()
        void this.consumeChanges(this.changeAbort.signal)
      }

      async consumeChanges(signal) {
        try {
          const stream = this.remote.eleckoiCreatorStudio.changes.$stream
            ? await this.remote.eleckoiCreatorStudio.changes.$stream(signal)
            : this.remote.eleckoiCreatorStudio.changes(signal)
          for await (const change of stream) {
            if (signal.aborted || this.disposed) break
            if (change?.kind === 'snapshot' || change?.domain === 'creatorProjects') {
              await this.refresh().catch(() => {})
            }
          }
        } catch (error) {
          if (!signal.aborted && !this.disposed) console.error('创作项目变更流已中断。', error)
        }
      }

      async refresh() {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.remote.eleckoiCreatorStudio.list()
          if (!result?.ok) throw new Error(result?.error?.message || '读取创作项目失败。')
          const collection = this.assertCollection(result.value)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', collection, error: '' })
          }
          return collection
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error', collection: this.snapshot.collection,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async create(input) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const result = await this.remote.eleckoiCreatorStudio.create(input)
        if (!result?.ok) throw new Error(result?.error?.message || '项目创建失败。')
        const collection = this.assertCollection(result.value)
        this.adopt(collection)
        return collection
      }

      async delete(projectId) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const result = await this.remote.eleckoiCreatorStudio.delete(projectId)
        if (!result?.ok) throw new Error(result?.error?.message || '无法删除项目。')
        const collection = this.assertCollection(result.value)
        this.adopt(collection)
        return collection
      }

      async selectDirectory(signal) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const request = new AbortController()
        this.directoryRequests.add(request)
        try {
          const lifetime = signal ? AbortSignal.any([signal, request.signal]) : request.signal
          lifetime.throwIfAborted()
          // A host-native chooser opens on the host's display, which a phone
          // cannot reach. Mobile uses the official in-app browse flow and the
          // same generated list/createDirectory Remote services instead.
          if (window.ElecKoiPlatform) return await this.browseDirectory(lifetime)
          const result = await this.remote.directoryPicker.pick(lifetime)
          lifetime.throwIfAborted()
          if (!result?.ok) throw new Error(result?.error?.message || '无法选择保存位置。')
          return result.value
        } finally {
          this.directoryRequests.delete(request)
        }
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.releaseAssistant()
        this.assistantListeners.clear()
        this.generation += 1
        this.changeAbort?.abort()
        this.changeAbort = null
        for (const request of this.directoryRequests) request.abort()
        this.directoryRequests.clear()
        this.directoryListeners.clear()
        this.listeners.clear()
      }
    }

    function CreatorDirectoryFlow({ projects, slots }) {
      const state = React.useSyncExternalStore(projects.subscribeDirectory, projects.getDirectorySnapshot)
      const flowVersion = React.useSyncExternalStore(
        listener => slots.subscribe('sidebar.workspaces.directoryFlow', listener),
        () => slots.getVersion('sidebar.workspaces.directoryFlow')
      )
      // Cordis registrants can be minified apply() names. Select the official
      // browse surface by its public injected capability, not that label; the
      // host-native surface only supplies pick(), so it cannot match here.
      const flow = React.useMemo(() => {
        for (const entry of slots.entriesOfSlot('sidebar.workspaces.directoryFlow')) {
          const face = entry.inject?.()
          if (typeof face?.listDirectory === 'function' && typeof face?.createDirectory === 'function') {
            return { entry, face }
          }
        }
        return null
      }, [slots, flowVersion])
      React.useEffect(() => {
        if (state.open && !flow) projects.finishDirectory(null,
          new Error('宿主的应用内文件夹浏览服务尚未就绪，请确认已启用 directory-picker-browse。'))
      }, [state.open, flow, projects])
      if (!state.open || !flow) return null
      return React.createElement('div', { className: 'creator-directory-flow', style: { pointerEvents: 'auto' } },
        React.createElement(flow.entry.component, { ...flow.face, open: true, busy: false,
          onPicked: path => projects.finishDirectory(path),
          onCancel: () => projects.finishDirectory(null),
          onError: message => projects.finishDirectory(null, new Error(message)) }))
    }

    function apply(ctx) {
      const projects = new CreatorStudioProjects(ctx.remote, ctx.sessions, ctx.uiConversation, ctx.fileUpload)
      ctx.provide('eleckoiCreatorStudio', projects)
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'eleckoi-creator-directory-flow', order: 100,
        inject: () => ({ projects, slots: ctx.slots })
      }, CreatorDirectoryFlow))
      ctx.effect(() => {
        projects.start()
        const stopReset = ctx.on('connection/reset', () => {
          void projects.refresh().catch(() => {})
          const projectId = projects.getAssistantSnapshot().projectId
          if (projectId) void projects.enterProject(projectId).catch(error => console.error('恢复创作会话失败。', error))
        })
        return () => {
          stopReset()
          projects.dispose()
        }
      }, 'eleckoi: creator studio projects')
    }

    return { inject: ['slots', 'sessions', 'uiConversation', 'fileUpload', 'remote', 'remote.eleckoiCreatorStudio', 'remote.eleckoiCreatorAssistant', 'remote.directoryPicker'], apply }
  }
})
