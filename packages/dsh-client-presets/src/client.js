window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-presets',
  factory(require) {
    const React = require('react')
    const PresetsPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-presets.js')
      .then(module => ({ default: module.PresetsPage })))
    class PresetCatalog {
      constructor(remote, remoteRoot) {
        this.remote = remote
        this.remoteRoot = remoteRoot
        this.snapshot = { status: 'loading', catalog: null, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.details = new Map()
        this.detailListeners = new Map()
        this.detailGenerations = new Map()
        this.disposed = false
        this.changeAbort = null
        this.changeStream = null
      }

      async call(method, ...args) {
        const result = await this.remote[method](...args)
        if (!result?.ok) throw new Error(result?.error?.message || 'Agent 预设操作失败。')
        return result.value
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

      getDetailSnapshot = id => this.details.get(id) || { status: 'idle', preset: null, error: '' }

      subscribeDetail = (id, listener) => {
        let listeners = this.detailListeners.get(id)
        if (!listeners) {
          listeners = new Set()
          this.detailListeners.set(id, listeners)
        }
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) this.detailListeners.delete(id)
        }
      }

      publishDetail(id, next) {
        this.details.set(id, next)
        for (const listener of this.detailListeners.get(id) || []) listener()
      }

      assertPreset(value, id) {
        if (!value || (id && value.id !== id) || !Array.isArray(value.regexRules)) {
          throw new Error('预设详情返回的数据格式不正确。')
        }
        return value
      }

      adoptDetail(preset) {
        if (this.disposed) return
        const id = preset?.id
        if (typeof id !== 'string' || !id) throw new Error('预设 ID 无效。')
        this.detailGenerations.set(id, (this.detailGenerations.get(id) || 0) + 1)
        this.publishDetail(id, { status: 'ready', preset: this.assertPreset(preset, id), error: '' })
      }

      async read(id) {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const generation = (this.detailGenerations.get(id) || 0) + 1
        this.detailGenerations.set(id, generation)
        try {
          const preset = this.assertPreset(await this.call('read', id), id)
          if (!this.disposed && generation === this.detailGenerations.get(id)) {
            this.publishDetail(id, { status: 'ready', preset, error: '' })
          }
          return this.getDetailSnapshot(id).preset || preset
        } catch (error) {
          if (!this.disposed && generation === this.detailGenerations.get(id)) {
            this.publishDetail(id, { status: 'error', preset: this.getDetailSnapshot(id).preset,
              error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }

      async save(preset, expectedRegexRules) {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const saved = this.assertPreset(await this.call('save', preset, expectedRegexRules), preset.id)
        this.adoptDetail(saved)
        return saved
      }

      async create(name, libraryGroupId = '') {
        const created = this.assertPreset(await this.call('create', name, libraryGroupId), null)
        this.adoptDetail(created)
        await this.refresh()
        return created
      }

      async import(source, document) {
        const result = await this.call('import', source, document)
        this.adoptDetail(this.assertPreset(result?.preset, result?.preset?.id))
        await this.refresh()
        return result
      }

      export(presetId, format) {
        return this.call('export', presetId, format)
      }

      async setActive(presetId) {
        const catalog = this.assertCatalog(await this.call('setActive', presetId))
        this.adopt(catalog)
        return catalog
      }

      async createGroup(name) {
        return this.adoptCatalog(await this.call('createGroup', name))
      }

      async renameGroup(groupId, name) {
        return this.adoptCatalog(await this.call('renameGroup', groupId, name))
      }

      async assignGroup(presetId, groupId) {
        return this.adoptCatalog(await this.call('assignGroup', presetId, groupId))
      }

      async deleteGroup(groupId) {
        return this.adoptCatalog(await this.call('deleteGroup', groupId))
      }

      async delete(presetId) {
        this.details.delete(presetId)
        return this.adoptCatalog(await this.call('delete', presetId))
      }

      start() {
        const controller = new AbortController()
        this.changeAbort = controller
        const stream = typeof this.remoteRoot?.$stream === 'function'
          ? this.remoteRoot.$stream({
            name: 'ElecKoi Agent preset changes',
            open: signal => this.remoteRoot.eleckoiCharacterConfiguration.changes(signal),
            ended: () => new Error('ElecKoi Agent 预设变更流意外结束。')
          })
          : this.remoteRoot.eleckoiCharacterConfiguration.changes(controller.signal)
        this.changeStream = stream
        void this.consumeChanges(stream)
      }

      async consumeChanges(stream) {
        try {
          for await (const item of stream) {
            if (this.disposed) return
            const change = item?.value ?? item
            item?.accept?.()
            if (change?.kind === 'snapshot'
              || (change?.kind === 'configuration' && change.domain === 'agentPresets')) {
              void this.refresh().catch(() => {})
              for (const id of this.details.keys()) void this.read(id).catch(() => {})
            }
          }
        } catch (error) {
          if (!this.disposed && !this.changeAbort?.signal.aborted) {
            console.error('ElecKoi Agent 预设变更流失败：', error)
          }
        }
      }

      assertCatalog(value) {
        if (!value || typeof value.activePresetId !== 'string'
          || !Array.isArray(value.groups)
          || value.groups.some(group => !group || typeof group.id !== 'string')
          || !Array.isArray(value.presets)
          || value.presets.some(preset => !preset || typeof preset.id !== 'string')) {
          throw new Error('预设目录返回的数据格式不正确。')
        }
        return value
      }

      adopt(catalog) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', catalog: this.assertCatalog(catalog), error: '' })
      }

      adoptCatalog(catalog) {
        this.adopt(this.assertCatalog(catalog))
        return catalog
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const generation = ++this.generation
        try {
          const catalog = this.assertCatalog(await this.call('catalog'))
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', catalog, error: '' })
          }
          return catalog
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              catalog: this.snapshot.catalog,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.changeAbort?.abort()
        if (typeof this.changeStream?.dispose === 'function') void this.changeStream.dispose()
        this.changeAbort = null
        this.changeStream = null
        this.generation += 1
        this.listeners.clear()
        this.details.clear()
        this.detailListeners.clear()
        this.detailGenerations.clear()
      }
    }

    function apply(ctx) {
      const catalog = new PresetCatalog(ctx.remote.eleckoiAgentPresets, ctx.remote)
      ctx.provide('eleckoiPresets', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'presets', registrant: '@eleckoi/dsh-client-presets' },
        () => React.createElement(PresetsPage)))
      const NavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-presets.js')
        .then(module => ({ default: module.NavigationIcon })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'presets', order: -20, label: '预设', registrant: '@eleckoi/dsh-client-presets'
      }, () => React.createElement(NavigationIcon)))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => {
          void catalog.refresh().catch(() => {})
          for (const id of catalog.details.keys()) void catalog.read(id).catch(() => {})
        })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: preset catalog')
    }

    return {
      inject: ['slots', 'remote', 'remote.eleckoiAgentPresets', 'remote.eleckoiCharacterConfiguration'],
      apply
    }
  }
})
