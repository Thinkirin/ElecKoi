window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-characters',
  factory(require) {
    const React = require('react')
    const CharacterPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-character.js')
      .then(module => ({ default: module.CharacterPage })))
    class CharacterCatalog {
      constructor(remote) {
        this.remote = remote
        this.snapshot = {
          status: 'loading',
          collection: { active_character_id: '', groups: [], items: [] },
          error: ''
        }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
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

      start() {
        void this.refresh().catch(() => {})
        this.changeAbort = new AbortController()
        void this.consumeChanges(this.changeAbort.signal)
      }

      async consumeChanges(signal) {
        try {
          const stream = this.remote.eleckoiCharacters.changes.$stream
            ? await this.remote.eleckoiCharacters.changes.$stream(signal)
            : this.remote.eleckoiCharacters.changes(signal)
          for await (const change of stream) {
            if (signal.aborted || this.disposed) break
            if (change?.kind === 'snapshot' || change?.domain === 'characters') {
              await this.refresh().catch(() => {})
            }
          }
        } catch (error) {
          if (!signal.aborted && !this.disposed) console.error('角色变更流已中断。', error)
        }
      }

      assertCollection(value) {
        if (!value || typeof value.active_character_id !== 'string'
          || !Array.isArray(value.groups) || !value.groups.every(group => typeof group === 'string')
          || !Array.isArray(value.items) || value.items.some(item => !item || typeof item.id !== 'string')) {
          throw new Error('角色列表返回的数据格式不正确。')
        }
        const active = value.items.find(item => item.id === value.active_character_id) || value.items[0]
        return active?.id === value.active_character_id
          ? value
          : { ...value, active_character_id: active?.id || '' }
      }

      adopt(collection) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', collection: this.assertCollection(collection), error: '' })
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 角色列表已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.remote.eleckoiCharacters.list()
          if (!result?.ok) throw new Error(result?.error?.message || '读取角色列表失败。')
          const collection = this.assertCollection(result.value)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', collection, error: '' })
          }
          return collection
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              collection: this.snapshot.collection,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async mutate(method, args, failure) {
        if (this.disposed) throw new Error('ElecKoi 角色列表已关闭。')
        const result = await this.remote.eleckoiCharacters[method](...args)
        if (!result?.ok) throw new Error(result?.error?.message || failure)
        const collection = this.assertCollection(result.value)
        this.adopt(collection)
        return collection
      }

      create(character) {
        return this.mutate('create', [character], '新建角色失败。')
      }

      update(character) {
        return this.mutate('update', [character], '保存角色失败。')
      }

      select(characterId) {
        return this.mutate('select', [characterId], '切换角色失败。')
      }

      saveGroups(groups, assignments = []) {
        return this.mutate('saveGroups', [groups, assignments], '保存角色分组失败。')
      }

      delete(characterIds) {
        return this.mutate('delete', [characterIds || []], '删除角色失败。')
      }

      async prepareImport(source, files) {
        const result = await this.remote.eleckoiCharacters.prepareImport(files, source)
        if (!result?.ok) throw new Error(result?.error?.message || '角色卡无法读取。')
        return result.value
      }

      async commitImport(token) {
        const result = await this.remote.eleckoiCharacters.commitImport(token)
        if (!result?.ok) throw new Error(result?.error?.message || '导入角色卡失败。')
        const value = result.value
        this.adopt(value.collection)
        return value
      }

      async discardImport(token) {
        const result = await this.remote.eleckoiCharacters.discardImport(token)
        if (!result?.ok) throw new Error(result?.error?.message || '无法清理角色卡导入。')
      }

      async exportCharacters(characterIds, format) {
        const written = []
        const failures = []
        for (const characterId of [...new Set(characterIds || [])]) {
          try {
            const result = await this.remote.eleckoiCharacters.export(characterId, format)
            if (!result?.ok) throw new Error(result?.error?.message || '导出失败。')
            downloadExport(result.value)
            written.push({ characterId, fileName: result.value.fileName })
          } catch (error) {
            failures.push({ characterId, message: error instanceof Error ? error.message : '导出失败。' })
          }
        }
        return { canceled: false, directory: '下载目录', written, failures }
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.changeAbort?.abort()
        this.changeAbort = null
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const catalog = new CharacterCatalog(ctx.remote)
      ctx.provide('eleckoiCharacters', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'character', registrant: '@eleckoi/dsh-client-characters' },
        () => React.createElement(CharacterPage)))
      const NavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-character.js')
        .then(module => ({ default: module.NavigationIcon })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'character', order: -30, label: '角色列表', registrant: '@eleckoi/dsh-client-characters'
      }, () => React.createElement(NavigationIcon)))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => { void catalog.refresh().catch(() => {}) })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: character catalog')
    }

    return { inject: ['slots', 'remote', 'remote.eleckoiCharacters'], apply }
  }
})

function downloadExport(file) {
  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
