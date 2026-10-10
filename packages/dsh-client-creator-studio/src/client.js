window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-creator-studio',
  factory() {
    class CreatorStudioProjects {
      constructor(remote) {
        this.remote = remote
        this.snapshot = { status: 'loading', collection: { items: [] }, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.directoryRequests = new Set()
        this.changeAbort = null
      }

      getSnapshot = () => this.snapshot

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
        this.generation += 1
        this.changeAbort?.abort()
        this.changeAbort = null
        for (const request of this.directoryRequests) request.abort()
        this.directoryRequests.clear()
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const projects = new CreatorStudioProjects(ctx.remote)
      ctx.provide('eleckoiCreatorStudio', projects)
      ctx.effect(() => {
        projects.start()
        const stopReset = ctx.on('connection/reset', () => { void projects.refresh().catch(() => {}) })
        return () => {
          stopReset()
          projects.dispose()
        }
      }, 'eleckoi: creator studio projects')
    }

    return { inject: ['remote', 'remote.eleckoiCreatorStudio', 'remote.directoryPicker'], apply }
  }
})
