window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-models',
  factory(require) {
    const React = require('react')
    const SETTINGS_NAMESPACE = 'eleckoi-client-models'
    const protocols = { responses: 'openai-responses', chat_completions: 'openai-completions',
      anthropic_messages: 'anthropic-messages', google_gemini: 'google-generative-ai' }
    const formats = Object.fromEntries(Object.entries(protocols).map(([format, api]) => [api, format]))
    const valueOf = (result, fallback) => {
      if (!result?.ok) throw new Error(result?.error?.message || fallback)
      return result.value
    }
    const keyRef = id => `${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`
    const imageProvider = provider => ['openai_image', 'novelai_image'].includes(provider)
    const ModelPage = React.lazy(() => import((globalThis.__ELECKOI_CLIENT_ASSETS__?.baseUrl ?? 'dsh-app://app/eleckoi/assets/') + 'eleckoi-page-model.js')
      .then(module => ({ default: module.ModelPage })))
    class ModelCatalog {
      constructor(remote) {
        this.remote = remote
        this.snapshot = { status: 'loading', configs: [], error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.stopEvents = () => {}
        this.namespaces = new Map()
        this.writeQueue = Promise.resolve()
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

      configsFromCatalog(catalog) {
        if (!catalog || !Array.isArray(catalog.groups)) throw new Error('DSH 模型目录返回的数据格式不正确。')
        return catalog.groups.map(group => {
          if (!group || typeof group.id !== 'string' || typeof group.name !== 'string' || !Array.isArray(group.models)) {
            throw new Error('DSH 模型目录返回的数据格式不正确。')
          }
          const modelOptions = group.models.map(model => {
            if (!model || typeof model.id !== 'string' || typeof model.name !== 'string') {
              throw new Error('DSH 模型目录返回的数据格式不正确。')
            }
            const reasoningEfforts = model.reasoning?.efforts?.length
              ? Object.fromEntries(model.reasoning.efforts.map(effort => [effort.id, effort.id === 'off' ? null : effort.id]))
              : false
            return {
              id: model.id,
              name: model.name,
              ...(model.description ? { description: model.description } : {}),
              ...(Array.isArray(model.inputModalities)
                ? { inputModalities: [...model.inputModalities], supportsImageInput: model.inputModalities.includes('image') }
                : {}),
              ...(Number.isFinite(model.contextWindow) ? { contextWindowTokens: model.contextWindow } : {}),
              ...(Number.isFinite(model.defaultMaxTokens) ? { maxOutputTokens: model.defaultMaxTokens } : {}),
              reasoningEfforts,
              ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {})
            }
          })
          const defaultModel = catalog.default?.provider === group.id
            ? catalog.default.model
            : modelOptions[0]?.id || ''
          return {
            id: group.id,
            name: group.name,
            provider: group.id,
            model: defaultModel,
            model_options: modelOptions,
            enabled: true
          }
        })
      }

      adopt(configs) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', configs, error: '' })
      }

      enqueue(run) {
        const task = this.writeQueue.then(run)
        this.writeQueue = task.catch(() => {})
        return task
      }

      async settings() {
        const document = valueOf(await this.remote.settings.describe(), '读取模型设置失败。')
        this.namespaces = new Map(document.namespaces.map(row => [row.ns, row]))
        return this.namespaces
      }

      async mutate(ns, ops) {
        const row = this.namespaces.get(ns)
        if (!row) throw new Error(`DSH 设置命名空间 ${ns} 未加载。`)
        const next = valueOf(await this.remote.settings.mutate(ns, ops, row.revision), '保存模型设置失败。')
        this.namespaces.set(ns, next)
      }

      async configuredCatalog(catalog) {
        const namespaces = await this.settings()
        const entries = namespaces.get(SETTINGS_NAMESPACE)?.value?.entries || {}
        const routes = valueOf(await this.remote.llm.listConfigurableProviders(), '读取模型提供商失败。')
          .filter(route => route.settingsNs === 'llm-pi-ai' || route.provider === 'deepseek-official')
        const directory = new Map(routes.map(route => [route.provider, route]))
        // The model picker includes account-authenticated routes that are not
        // editable provider profiles. Only the configurable directory owns
        // model configuration pages.
        const base = this.configsFromCatalog(catalog).filter(config => directory.has(config.id))
        const byId = new Map(base.map(config => [config.id, config]))
        for (const route of routes) {
          const section = namespaces.get(route.settingsNs)?.value
          const profile = route.settingsPath.reduce((value, part) => value?.[part], section)
          // The configurable directory also contains unconfigured catalog providers.
          if (!byId.has(route.provider) && (profile || entries[route.provider])) {
            byId.set(route.provider, { id: route.provider, name: route.displayName, model_options: [] })
          }
        }
        const piAiProfiles = namespaces.get('llm-pi-ai')?.value?.providers || {}
        // pi-ai is the source of truth for generic provider profiles. Older
        // ElecKoi releases could persist a complete profile there while the
        // product metadata still labelled it as a dedicated provider (or was
        // missing altogether). Expose every persisted profile as a custom
        // configuration version even when the configurable-provider directory
        // has not listed the route yet.
        for (const [id, profile] of Object.entries(piAiProfiles)) {
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              name: profile.displayName || id,
              provider: 'custom',
              model: profile.models?.[0]?.id || '',
              model_options: [],
            })
          }
        }
        for (const [id, entry] of Object.entries(entries)) {
          if (imageProvider(entry.provider) || piAiProfiles[id]) {
            if (!byId.has(id)) byId.set(id, { id, model_options: [], ...entry })
          }
        }
        const configs = [...byId.values()].map(config => {
          const route = directory.get(config.id)
          const ns = route?.settingsNs || 'llm-pi-ai'
          const path = route?.settingsPath || ['providers', config.id]
          const profile = path.reduce((value, part) => value?.[part], namespaces.get(ns)?.value) || {}
          const extra = entries[config.id] || {}
          const models = new Map((profile.models || []).map(model => [model.id, model]))
          const options = new Map((config.model_options || []).map(model => [model.id, model]))
          for (const model of models.values()) if (!options.has(model.id)) options.set(model.id, { id: model.id, name: model.name || model.id })
          const provider = ns === 'llm-deepseek'
            ? 'deepseek'
            : extra.provider === 'deepseek' ? 'custom' : extra.provider || 'custom'
          const credentialRef = extra.credentialRef || profile.apiKeyEnv || (ns === 'llm-deepseek' ? 'DEEPSEEK_API_KEY' : keyRef(config.id))
          return { ...config, ...extra, provider, credentialRef, api_key: '',
            ...(imageProvider(provider) ? { image_settings: { ...extra.image_settings, ...extra.imageSettings } } : {}),
            name: extra.name || profile.displayName || config.name || '',
            model: extra.model || config.model || options.keys().next().value || '',
            base_url: imageProvider(provider) ? profile.baseURL ?? extra.baseUrl ?? extra.base_url ?? '' : profile.baseURL || (ns === 'llm-deepseek' ? 'https://api.deepseek.com/anthropic' : ''),
            api_format: ns === 'llm-deepseek' ? 'deepseek_messages' : formats[profile.api] || extra.api_format || 'responses',
            custom_headers: profile.headers || extra.custom_headers || {},
            settingsNs: ns, settingsPath: path,
            model_options: [...options.values()].map(model => {
              const declared = models.get(model.id) || {}
              const parameters = extra.parameters?.[model.id] || {}
              return { ...model, ...parameters,
                ...(declared.contextWindow ? { contextWindowTokens: declared.contextWindow } : {}),
                ...(declared.maxTokens ? { maxOutputTokens: declared.maxTokens } : {}),
                ...(declared.reasoningEfforts !== undefined ? { reasoningEfforts: declared.reasoningEfforts } : {}),
                ...(declared.input || declared.inputModalities ? { supportsImageInput: (declared.input || declared.inputModalities).includes('image') } : {}) }
            }), enabled: !imageProvider(provider) }
        })
        const credentials = valueOf(await this.remote.credentials.describe(configs.map(config => config.credentialRef)), '读取密钥状态失败。')
        return configs.map(config => ({ ...config, credentialConfigured: credentials[config.credentialRef]?.configured === true }))
      }

      async revealApiKey(configId) {
        return valueOf(await this.remote.eleckoiModels.revealApiKey(configId), '读取密钥失败。')
      }

      save(config) {
        return this.enqueue(async () => {
          if (!config.id || !/^[a-z][a-z0-9-]*$/.test(config.id)) throw new Error('模型配置编号不正确。')
          if (config.proxy_url?.trim()) throw new Error('当前 DSH 适配器不支持每个模型单独设置代理，请使用系统代理。')
          if (config.provider === 'deepseek'
            && (config.id !== 'deepseek-official' || config.api_format !== 'deepseek_messages')) {
            throw new Error('DeepSeek 官方 API 固定使用 DSH 的 Messages 专用适配器；其他协议请使用自定义模型提供商。')
          }
          await this.settings()
          const previous = this.snapshot.configs.find(item => item.id === config.id)
          const ref = previous?.credentialRef || (config.id === 'deepseek-official' ? this.namespaces.get('llm-deepseek')?.value?.apiKeyEnv || 'DEEPSEEK_API_KEY' : keyRef(config.id))
          if (config.clearConfiguration) {
            if (config.id === 'deepseek-official') {
              await this.mutate('llm-deepseek', [
                { op: 'unset', path: ['baseURL'] }, { op: 'unset', path: ['models'] },
              ])
            } else if (!imageProvider(config.provider)) {
              await this.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', config.id] }])
            }
            await this.mutate(SETTINGS_NAMESPACE, [{ op: 'unset', path: ['entries', config.id] }])
            if (!this.snapshot.configs.some(item => item.id !== config.id && item.credentialRef === ref)) {
              valueOf(await this.remote.credentials.unset(ref), '清除密钥失败。')
            }
            await this.refresh()
            return this.snapshot.configs.find(item => item.id === config.id)
              || { ...config, api_key: '', credentialConfigured: false, clearConfiguration: undefined }
          }
          const ns = config.api_format === 'deepseek_messages' ? 'llm-deepseek' : 'llm-pi-ai'
          if (ns === 'llm-deepseek' && config.id !== 'deepseek-official') throw new Error('DeepSeek Messages 使用内置 DeepSeek 专用配置；其他配置请选择对应的通用协议。')
          if (ns === 'llm-deepseek' && Object.keys(config.custom_headers || {}).length) throw new Error('DeepSeek Messages 专用适配器不支持自定义请求头。')
          const parameters = Object.fromEntries((config.model_options || []).map(model => [model.id, {
            ...(model.temperature == null ? {} : { temperature: model.temperature }),
            ...(model.topP == null ? {} : { topP: model.topP }),
            ...(model.autoCompactTokenLimit == null ? {} : { autoCompactTokenLimit: model.autoCompactTokenLimit }),
            ...(model.reasoningEffort == null ? {} : { reasoningEffort: model.reasoningEffort }),
            ...(model.isUserAdded ? { isUserAdded: true } : {})
          }]))
          const extra = { ...this.namespaces.get(SETTINGS_NAMESPACE)?.value?.entries?.[config.id],
            name: config.name || '', provider: config.provider, model: config.model || '', credentialRef: ref, parameters }
          if (imageProvider(config.provider)) {
            Object.assign(extra, { base_url: config.base_url, baseUrl: config.base_url,
              api_format: config.api_format, apiFormat: config.api_format,
              image_settings: config.image_settings || {}, imageSettings: config.image_settings || {},
              model_options: config.model_options || [], custom_headers: config.custom_headers || {}, customHeaders: config.custom_headers || {} })
            if (this.namespaces.get('llm-pi-ai')?.value?.providers?.[config.id]) {
              await this.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', config.id, 'baseURL'], value: config.base_url }])
            }
          } else {
            const models = (config.model_options || []).map(model => ({ id: model.id, name: model.name || model.id,
              ...(model.contextWindowTokens == null ? {} : { contextWindow: model.contextWindowTokens }),
              ...(model.maxOutputTokens == null ? {} : { maxTokens: model.maxOutputTokens }),
              [ns === 'llm-deepseek' ? 'inputModalities' : 'input']: model.supportsImageInput ? ['text', 'image'] : ['text'],
              ...(ns === 'llm-pi-ai' && model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}) }))
            const path = ns === 'llm-deepseek' ? [] : ['providers', config.id]
            if (ns === 'llm-deepseek') {
              const ops = [{ op: 'set', path: ['baseURL'], value: config.base_url }, { op: 'set', path: ['models'], value: models }]
              await this.mutate(ns, ops)
            } else {
              if (!protocols[config.api_format]) throw new Error('不支持的模型接口格式。')
              const previousProfile = this.namespaces.get(ns)?.value?.providers?.[config.id] || {}
              const profile = { ...previousProfile, apiKeyEnv: ref, displayName: config.name || config.id,
                api: protocols[config.api_format], baseURL: config.base_url, models, headers: config.custom_headers || {} }
              await this.mutate(ns, [{ op: 'set', path, value: profile }])
            }
          }
          await this.mutate(SETTINGS_NAMESPACE, [{ op: 'set', path: ['entries', config.id], value: extra }])
          if (config.api_key?.trim()) valueOf(await this.remote.credentials.set(ref, config.api_key.trim()), '保存密钥失败。')
          else if (config.clearCredential) valueOf(await this.remote.credentials.unset(ref), '清除密钥失败。')
          await this.refresh()
          return this.snapshot.configs.find(item => item.id === config.id)
        })
      }

      deleteConfig(id) {
        return this.enqueue(async () => {
          await this.settings()
          const config = this.snapshot.configs.find(item => item.id === id)
          if (!config) throw new Error('模型配置不存在。')
          if (!imageProvider(config.provider)) {
            if (config.settingsNs === 'llm-deepseek') {
              await this.mutate('llm-deepseek', [
                { op: 'unset', path: ['baseURL'] }, { op: 'unset', path: ['models'] },
              ])
            } else {
              await this.mutate(config.settingsNs, [{ op: 'unset', path: config.settingsPath }])
            }
          }
          await this.mutate(SETTINGS_NAMESPACE, [{ op: 'unset', path: ['entries', id] }])
          if (!this.snapshot.configs.some(item => item.id !== id && item.credentialRef === config.credentialRef)) {
            valueOf(await this.remote.credentials.unset(config.credentialRef), '删除密钥失败。')
          }
          await this.refresh()
          return this.snapshot.configs[0]
        })
      }

      async deleteProvider(provider, preferredId) {
        const ids = this.snapshot.configs.filter(config => config.provider === provider).map(config => config.id)
        for (const id of ids) await this.deleteConfig(id)
        return this.snapshot.configs.find(config => config.id === preferredId) || this.snapshot.configs[0]
      }

      async discover(config) {
        const saved = this.snapshot.configs.find(item => item.id === config.id)
        const unchangedEndpoint = saved && saved.base_url === config.base_url && saved.api_format === config.api_format
        if (config.api_format !== 'deepseek_messages' && !protocols[config.api_format]) throw new Error('该协议没有可读取的模型目录。')
        const models = valueOf(await this.remote.eleckoiModels.discoverModels({
          configId: config.id, baseURL: config.base_url,
          api: config.api_format === 'deepseek_messages' ? 'deepseek_messages' : protocols[config.api_format],
          ...(config.api_key?.trim() ? { apiKey: config.api_key.trim() } : {}),
          headers: config.custom_headers || {}
        }), '读取模型列表失败。')
        return models.map(model => ({ ...(unchangedEndpoint ? saved.model_options?.find(item => item.id === model.id) : {}),
          id: model.id, name: model.name || model.id,
          ...(model.contextWindow ? { contextWindowTokens: model.contextWindow } : {}),
          ...(model.maxTokens ? { maxOutputTokens: model.maxTokens } : {}),
          ...(model.inputModalities ? { supportsImageInput: model.inputModalities.includes('image') } : {}),
          ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts }),
          ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
          ...(config.model_options?.find(item => item.id === model.id) || {}) }))
      }

      async testConnection(config) {
        return valueOf(await this.remote.eleckoiModels.testConnection({
          configId: config.id, model: config.model, baseURL: config.base_url,
          api: config.api_format === 'deepseek_messages' ? 'deepseek_messages' : protocols[config.api_format],
          apiKey: config.api_key || undefined,
          headers: config.custom_headers || {},
        }), '工具调用测试失败。')
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 模型目录已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.remote.session.modelCatalog()
          if (!result?.ok) throw new Error(result?.error?.message || '读取 DSH 模型目录失败。')
          const configs = this.remote.settings ? await this.configuredCatalog(result.value) : this.configsFromCatalog(result.value)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', configs, error: '' })
          }
          return configs
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'error', configs: this.snapshot.configs,
              error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }

      start() {
        void this.refresh().catch(() => {})
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.stopEvents()
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const catalog = new ModelCatalog(ctx.remote)
      ctx.provide('eleckoiModels', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'model', registrant: '@eleckoi/dsh-client-models' },
        () => React.createElement(ModelPage)))
      const NavigationIcon = React.lazy(() => import((globalThis.__ELECKOI_CLIENT_ASSETS__?.baseUrl ?? 'dsh-app://app/eleckoi/assets/') + 'eleckoi-page-model.js')
        .then(module => ({ default: module.NavigationIcon })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'model', order: 30, label: '模型配置', registrant: '@eleckoi/dsh-client-models'
      }, () => React.createElement(NavigationIcon)))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => { void catalog.refresh().catch(() => {}) })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: model catalog')
    }

    return { inject: ['slots', 'remote', 'remote.session', 'remote.settings', 'remote.llm', 'remote.credentials', 'remote.eleckoiModels'], apply }
  }
})
