import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController, PromptContentPart, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CompatibilityStoreContract, CompatibilityValue, CreatorProject, ElecKoiProductDataStore,
  CreatorAssistantConversation, CreatorAssistantHistory, CreatorAssistantPromptReceipt, CreatorAssistantCancelReceipt } from './types.js'
export type { CreatorAssistantConversation, CreatorAssistantHistory, CreatorAssistantPromptReceipt, CreatorAssistantCancelReceipt } from './types.js'
type Product = Pick<ElecKoiProductDataStore, 'readCreatorProjects' | 'compatibilityStore'>
type Controller = Pick<SessionController, 'create' | 'inspect' | 'prompt' | 'cancel'>
const json = (value: unknown): CompatibilityValue => JSON.parse(JSON.stringify(value)) as CompatibilityValue
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}

/** Project ownership is product metadata; every turn and tool still belongs to the original Agent. */
export class CreatorAssistantOperations {
  private readonly store: CompatibilityStoreContract
  private readonly creating = new Map<string, Promise<CreatorAssistantHistory>>()
  constructor(private readonly product: Product, private readonly sessions: Controller) { this.store = product.compatibilityStore() }
  private project(id: string): CreatorProject {
    const project = this.product.readCreatorProjects().items.find(item => item.id === id)
    if (!project) throw new Error(`Creator project does not exist: ${id}`)
    return project
  }
  history(projectId: string): CreatorAssistantHistory {
    this.project(projectId)
    const stored = this.store.get('creator:assistant', projectId)
    if (stored) return structuredClone(stored) as unknown as CreatorAssistantHistory
    const migrated = record(this.store.get('migration:android:creator', projectId))
    const items: CreatorAssistantConversation[] = (Array.isArray(migrated.conversations) ? migrated.conversations : [])
      .filter((item: Record<string, any>) => typeof item.sessionId === 'string' && item.sessionId)
      .map((item: Record<string, any>) => ({ sessionId: item.sessionId, title: String(item.title || '导入的创作对话'), createdAt: String(item.createdAt || ''), legacyConversationId: String(item.id) }))
    const active = items.find(item => item.legacyConversationId === migrated.restoredWorkspace?.activeConversationId)
    const history = { projectId, activeSessionId: active?.sessionId ?? items.at(-1)?.sessionId ?? '', items }
    this.store.put('creator:assistant', projectId, json(history))
    return history
  }
  async create(projectId: string): Promise<CreatorAssistantHistory> {
    const pending = this.creating.get(projectId)
    if (pending) return pending
    const operation = (async () => {
      const project = this.project(projectId), created = await this.sessions.create({ cwd: project.rootPath, agentPreset: 'eleckoi-creator' })
      const history = this.history(projectId)
      const item = { sessionId: created.sessionId as string, title: '新创作对话', createdAt: new Date().toISOString() }
      const next = { ...history, activeSessionId: item.sessionId, items: [...history.items, item] }
      this.store.put('creator:assistant', projectId, json(next)); return next
    })()
    this.creating.set(projectId, operation)
    try { return await operation } finally { this.creating.delete(projectId) }
  }
  private async owned(projectId: string, sessionId: string): Promise<void> {
    const project = this.project(projectId), history = this.history(projectId)
    if (!history.items.some(item => item.sessionId === sessionId)) throw new Error(`Creator conversation does not belong to project ${projectId}: ${sessionId}`)
    const inspection = await this.sessions.inspect(SessionId(sessionId))
    if (!inspection.meta.cwd || resolve(inspection.meta.cwd) !== resolve(project.rootPath)) throw new Error(`Creator Session working directory differs from project: ${sessionId}`)
  }
  async open(projectId: string, sessionId: string): Promise<CreatorAssistantHistory> {
    await this.owned(projectId, sessionId)
    const next = { ...this.history(projectId), activeSessionId: sessionId }
    this.store.put('creator:assistant', projectId, json(next)); return next
  }
  async prompt(input: { projectId: string; sessionId: string; content: readonly PromptContentPart[]; requestId?: string; clientTimeZone?: string }, signal: AbortSignal = new AbortController().signal): Promise<CreatorAssistantPromptReceipt> {
    await this.owned(input.projectId, input.sessionId)
    const requestId = input.requestId || randomUUID()
    const receipt = await this.sessions.prompt({ sessionId: SessionId(input.sessionId), requestId: requestId as SessionRequestId, mode: 'queue', content: input.content,
      ...(input.clientTimeZone ? { clientTimeZone: input.clientTimeZone } : {}) }, signal)
    const title = input.content.filter(item => item.type === 'text').map(item => item.text).join(' ').trim().slice(0, 80)
    if (title) {
      const history = this.history(input.projectId), item = history.items.find(item => item.sessionId === input.sessionId)
      if (item?.title === '新创作对话') { item.title = title; this.store.put('creator:assistant', input.projectId, json(history)) }
    }
    return { ...receipt, requestId }
  }
  async cancel(projectId: string, sessionId: string): Promise<CreatorAssistantCancelReceipt> { await this.owned(projectId, sessionId); return this.sessions.cancel({ sessionId: SessionId(sessionId) }) }
}

declare module '@deepseek-ai/cordis' { interface Context { eleckoiCreatorAssistantApi: ElecKoiCreatorAssistantApi } }
/** 管理创作项目所属的官方 Session，并通过原有 Agent 队列发送输入或取消生成。 */
export class ElecKoiCreatorAssistantApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'sessionController']
  private readonly operations: CreatorAssistantOperations
  constructor(ctx: Context) {
    super(ctx, 'eleckoiCreatorAssistantApi', { namespace: 'eleckoiCreatorAssistant' })
    this.operations = new CreatorAssistantOperations(ctx.eleckoiProductData, {
      create: request => ctx.sessionController.create(request), inspect: (id, signal) => ctx.sessionController.inspect(id, signal),
      prompt: (input, signal) => ctx.sessionController.prompt(input, signal), cancel: input => ctx.sessionController.cancel(input)
    })
  }
  /**
   * 读取创作项目的会话目录，首次读取时接续已迁移的 Android 创作会话。
   * @param projectId - 已存在的创作项目编号。
   * @returns 项目编号、当前会话编号和包含标题及创建时间的会话列表。
   */
  @Remote history(projectId: string): CreatorAssistantHistory { return this.operations.history(projectId) }
  /**
   * 在项目工作目录中创建原生创作 Agent 会话，并将其设为当前会话。
   * @param projectId - 已存在的创作项目编号。
   * @returns 包含新会话的项目会话目录；同一项目的并发创建共享同一次创建结果。
   */
  @Remote create(projectId: string): Promise<CreatorAssistantHistory> { return this.operations.create(projectId) }
  /**
   * 将项目已有的会话设为当前会话，并检查其所属项目和实际工作目录。
   * @param projectId - 创作项目编号。
   * @param sessionId - 属于该项目的官方 Session 编号。
   * @returns 更新当前会话后的项目会话目录；归属或工作目录不一致时抛出错误。
   */
  @Remote open(projectId: string, sessionId: string): Promise<CreatorAssistantHistory> { return this.operations.open(projectId, sessionId) }
  /**
   * 将输入排入项目创作 Agent 的生成队列，首次文本输入同时更新默认会话标题。
   * @param input - 项目与会话编号、输入内容，以及可选请求编号和客户端时区。
   * @param signal - 取消本次输入提交的信号。
   * @returns 输入被队列接受的回执和实际 requestId；回复内容通过官方 Session 协议读取。
   */
  @Remote prompt(input: { projectId: string; sessionId: string; content: readonly PromptContentPart[]; requestId?: string; clientTimeZone?: string }, signal: AbortSignal): Promise<CreatorAssistantPromptReceipt> { return this.operations.prompt(input, signal) }
  /**
   * 请求取消指定项目会话中正在进行的 Agent 生成。
   * @param projectId - 创作项目编号。
   * @param sessionId - 属于该项目的官方 Session 编号。
   * @returns 取消请求被接受的回执；归属检查或取消提交失败时抛出错误。
   */
  @Remote cancel(projectId: string, sessionId: string): Promise<CreatorAssistantCancelReceipt> { return this.operations.cancel(projectId, sessionId) }
}
