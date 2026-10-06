type Document = Record<string, unknown>
export interface AndroidModelConfigImportServices {
  invokeCompatibility(command: { method: string; params: Document }): unknown | Promise<unknown>
  selectActive?(selection: { configId: string; provider: string; model: string }): unknown | Promise<unknown>
  preserveRaw?(section: Document): unknown | Promise<unknown>
}
export interface AndroidModelConfigImportReport {
  format: 'eleckoi.android-model-config-import'
  version: 1
  imported: Array<{ sourceId: string; targetId: string; model: string; hasKey: boolean; credentialsMissing: boolean }>
  activeSelection: { configId: string; provider: string; model: string } | null
  warnings: string[]
}
const document = (value: unknown, label: string): Document => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object`)
  return value as Document
}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const formats = new Set(['chat_completions', 'responses', 'anthropic_messages', 'google_gemini'])

/** Portable original Android metadata is written by the existing settings-backed model service.
 * The official backup deliberately omits credentials: an existing native secret survives and
 * genuinely missing credentials are reported to the migration UI for re-entry. */
export async function importAndroidModelConfigSection(value: unknown, services: AndroidModelConfigImportServices): Promise<AndroidModelConfigImportReport> {
  const section = document(value, 'Android model configuration backup')
  if (section.format !== 'eleckoi.model-configs' || section.version !== 1) throw new Error('Unsupported Android model configuration backup format/version')
  if (!Array.isArray(section.configs)) throw new TypeError('Android model configuration configs must be an array')
  const seen = new Set<string>()
  const configs = section.configs.map((value, index) => {
    const item = document(value, `Android model configuration ${index}`), id = string(item.id)
    if (!id || seen.has(id)) throw new Error(`Missing or duplicate Android model configuration ID: ${id}`)
    seen.add(id)
    const format = string(item.api_format)
    if (!formats.has(format)) throw new Error(`Android model configuration ${id} has unsupported API format: ${format}`)
    if (!Array.isArray(item.model_options)) throw new TypeError(`Android model configuration ${id} model_options must be an array`)
    const headers = document(item.custom_headers ?? {}, `Android model configuration ${id} headers`)
    const options = item.model_options.map((value, optionIndex) => {
      const option = document(value, `Android model option ${id}/${optionIndex}`)
      if (!string(option.id)) throw new Error(`Android model option has no ID: ${id}/${optionIndex}`)
      return { ...option, ...(option.supportsImageInput === true ? { input: ['text', 'image'] } : {}) }
    })
    const config = { ...item, id, name: string(item.name) || id, provider: string(item.provider) || 'custom',
      model: string(item.model), apiFormat: format, baseUrl: string(item.base_url), proxyUrl: string(item.proxy_url),
      customHeaders: headers, models: options, imageSettings: item.image_settings ?? {}, androidBackupHadApiKey: item.had_api_key === true }
    // This is the same credential-free restore contract as the original application.
    // Unknown extension fields remain intact; only credential payloads cannot be restored from portable metadata.
    delete (config as Document).apiKey; delete (config as Document).api_key
    return config
  })
  const activeId = string(section.active_config_id)
  if (activeId && !seen.has(activeId)) throw new Error(`Android active model configuration is missing: ${activeId}`)
  const existingValue = await services.invokeCompatibility({ method: 'models.list', params: {} })
  if (!Array.isArray(existingValue)) throw new TypeError('Native models.list returned an invalid catalog')
  const existing = new Map(existingValue.map(item => { const config = document(item, 'Native model configuration'); return [string(config.id), config] }))
  const report: AndroidModelConfigImportReport = { format: 'eleckoi.android-model-config-import', version: 1, imported: [], activeSelection: null, warnings: [] }
  await services.preserveRaw?.(structuredClone(section))
  for (const config of configs) {
    const hasKey = existing.get(config.id)?.hasKey === true, credentialsMissing = config.androidBackupHadApiKey && !hasKey
    const saved = document(await services.invokeCompatibility({ method: 'models.put', params: { config: { ...config,
      credentialsMissing, apiKeyNeedsReentry: credentialsMissing } } }), `Native saved model configuration ${config.id}`)
    const targetId = string(saved.id)
    if (!targetId) throw new Error(`Native model service did not return the saved configuration ID: ${config.id}`)
    report.imported.push({ sourceId: config.id, targetId, model: string(saved.model), hasKey, credentialsMissing })
    if (config.id === activeId) {
      if (string(saved.model)) report.activeSelection = { configId: targetId, provider: targetId, model: string(saved.model) }
      else report.warnings.push(`Active Android model configuration has no selected model: ${config.id}`)
    }
  }
  if (report.activeSelection) await services.selectActive?.(report.activeSelection)
  return report
}
