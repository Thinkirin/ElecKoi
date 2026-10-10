import type { Context } from '@deepseek-ai/cordis'
import type { ConversationSummary, ConversationCreateInput, ConversationDetailsMetadata, ConversationMessageMetadata, ConversationModelSelection, AuthorConversationState, VariableJsonValue, VariableViewerTimeline } from '@eleckoi/dsh-product-api/types'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { FileUploadProgress } from '@deepseek-ai/dsh-client-file-upload/client'
import type { TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ConversationRequestPreview, ConversationRequestPreviewSummary } from '@eleckoi/dsh-product-api/types'

export interface ConversationProcessItem { id: string; kind: 'tool' | 'command' | 'file_change' | 'compaction' | 'subagent' | 'action' | 'narrative' | 'reasoning'; status: 'running' | 'complete' | 'error' | 'cancelled'; toolName: string; arguments: string; summary: string; detail: string; startedAtMillis: number; completedAtMillis?: number; parentId?: string; delegatedModel?: string }
/** 尚未进入正式 Session 的图片预览。 */
export interface ConversationPendingImage { attachmentId: string; name: string; dataUrl: string; width?: number; height?: number }
/** 尚未进入正式 Session 的文件信息。 */
export interface ConversationPendingFile { attachmentId: string; name: string; bytes: number }
/** 官方 Session 消息和产品显示资料；正文尚未投影时 content 可以不存在。 */
export interface ConversationClientMessage extends Omit<ConversationMessageMetadata, 'dshTurn'> {
  content?: string
  displayContent?: string
  status: 'complete' | 'streaming' | 'error' | 'cancelled'
  sequence?: number
  productSequence?: number
  sessionEventSeq?: number
  /** null 表示输入还没有进入正式轮次。 */
  dshTurn?: number | null
  requestId?: string
  process?: ConversationProcessItem[]
  dshMessageId?: string
  runtimeSessionId?: string
  renderKey?: string
  dshNodeKey?: string
  turnUsage?: TurnTailChatData['tokenUsage']
  inputImageAttachments?: (ImageAttachmentRef | ConversationPendingImage)[]
  inputFileAttachments?: (FileAttachmentRef | ConversationPendingFile)[]
}
export interface ConversationClientDetails extends Omit<ConversationDetailsMetadata, 'messages'> { messages: ConversationClientMessage[]; replace?: boolean }
export interface ConversationCatalogSnapshot { status: 'loading' | 'ready' | 'error'; items: ConversationSummary[]; error: string }
export interface ConversationDetailsSnapshot { id: string; status: 'idle' | 'loading' | 'ready' | 'error'; details: ConversationClientDetails | null; runtimeSessionId?: string; error: string }
export interface ConversationStreamSnapshot { id: string; status: 'idle' | 'running' | 'complete' | 'error'; runId: string; requestId: string; messageId: string; nodeKey: string; sequence: number; content: string; process: ConversationProcessItem[]; error: string }
export interface ConversationChatSnapshot { details: ConversationDetailsSnapshot; stream: ConversationStreamSnapshot }
export interface ConversationTimelineSnapshot { id: string; status: 'idle' | 'loading' | 'ready' | 'error'; timeline: VariableViewerTimeline | null; error: string }
export interface ConversationSelection { active_conversation_id: string; preferred_sessions: Record<string, string> }
export interface ConversationUploadedFile { id: string; receiptId: string; attachmentId: string; name: string; bytes: number }
export interface ConversationSendInput { conversationId: string; requestId: string; text?: string; mode?: 'steer' | 'queue'; signal?: AbortSignal; images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string }[]; files?: string[] }
export interface ConversationRegenerateInput { conversationId: string; requestId: string; eventSeq: number; replacementMessage?: string; signal?: AbortSignal }
export interface ConversationRunResult { details: ConversationClientDetails | null; cancelled: boolean }

/** 管理聊天目录、官方 Session 的消息显示、提交、停止、回退和角色资料。 */
export interface ElecKoiConversations {
  /**
   * 订阅当前运行期间实际发起的请求目录；取消时释放订阅。
   * @param id - 聊天编号。
   * @param onChange - 接收不含正文的请求目录。
   * @param signal - 关闭弹窗或切换聊天时取消订阅。
   * @returns 订阅结束后完成；失败会拒绝 Promise。
   */
  observeRequestPreviews(id: string, onChange: (requests: ConversationRequestPreviewSummary[]) => void, signal: AbortSignal): Promise<void>
  /**
   * 读取当前运行期间某次实际请求的正文；不提供关闭后的恢复。
   * @param id - 聊天编号。
   * @param requestId - 请求目录中的标识。
   * @param signal - 切换请求时取消读取。
   * @returns 实际发送顺序与可读正文。
   */
  readRequestPreview(id: string, requestId: string, signal: AbortSignal): Promise<ConversationRequestPreview>
  /**
   * 读取聊天目录的页面状态。
   * @returns 当前页面保存的状态对象。
   */
  getSnapshot(): ConversationCatalogSnapshot
  /**
   * 订阅聊天目录变化。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 读取当前打开聊天的消息和加载状态。
   * @returns 当前页面保存的状态对象。
   */
  getDetailsSnapshot(): ConversationDetailsSnapshot
  /**
   * 订阅当前聊天的消息变化。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribeDetails(listener: () => void): () => void
  /**
   * 同时读取当前聊天的消息和生成状态。
   * @returns 当前页面保存的状态对象。
   */
  getChatSnapshot(): ConversationChatSnapshot
  /**
   * 订阅聊天消息或生成状态变化。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribeChat(listener: () => void): () => void
  /**
   * 读取当前变量时间线的状态。
   * @returns 当前页面保存的状态对象。
   */
  getTimelineSnapshot(): ConversationTimelineSnapshot
  /**
   * 订阅变量时间线变化。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribeTimeline(listener: () => void): () => void
  /**
   * 读取当前回复的流式正文和处理过程。
   * @returns 当前页面保存的状态对象。
   */
  getStreamSnapshot(): ConversationStreamSnapshot
  /**
   * 订阅当前回复的流式输出。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribeStream(listener: () => void): () => void
  /**
   * 重新读取聊天目录。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  refresh(): Promise<ConversationSummary[]>
  /**
   * 创建聊天并返回关联的官方 Session 编号和产品消息元数据。
   * @param input - 本次创建、提交或重新生成所需数据。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  create(input: ConversationCreateInput): Promise<ConversationClientDetails>
  /**
   * 打开聊天；切换到其他聊天后，过期请求返回 null。
   * @param id - 要打开或读取的聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  open(id: string): Promise<ConversationClientDetails | null>
  /**
   * 读取更早消息；当前聊天或分页位置已改变时返回 null。
   * @param expectedId - 发起分页时的聊天编号。
   * @param expectedBeforeSequence - 发起分页时的上一页边界。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  pageOlder(expectedId: string, expectedBeforeSequence: number): Promise<ConversationClientDetails | null>
  /**
   * 打开指定聊天的变量时间线。
   * @param id - 要打开或读取的聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  openTimeline(id: string): Promise<VariableViewerTimeline | null>
  /**
   * 关闭指定聊天的变量时间线订阅。
   * @param id - 要打开或读取的聊天编号。
   * @returns 操作完成。
   */
  closeTimeline(id: string): void
  /**
   * 通过官方文件上传服务上传附件，返回可提交的附件编号。
   * @param conversationId - ElecKoi 聊天编号。
   * @param file - 浏览器 File 对象。
   * @param options - 上传取消信号和进度回调。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  uploadFile(conversationId: string, file: File, options?: { signal?: AbortSignal; onProgress?: (progress: FileUploadProgress) => void }): Promise<ConversationUploadedFile>
  /**
   * 准备官方输入框即将提交的文本，校验当前聊天与 Session 一致。
   * @param input - 本次创建、提交或重新生成所需数据。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  prepareNativeInput(input: { sessionId: string; text?: string; signal?: AbortSignal }): Promise<{ kind: 'success' } | { kind: 'error'; text: string }>
  /**
   * 通过官方 Session 提交用户输入，并等待本次请求结束。
   * @param input - 本次创建、提交或重新生成所需数据。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  send(input: ConversationSendInput): Promise<ConversationRunResult>
  /**
   * 在同一聊天和 Session 中回退并重新生成指定用户输入。
   * @param input - 本次创建、提交或重新生成所需数据。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  regenerate(input: ConversationRegenerateInput): Promise<ConversationRunResult>
  /**
   * 停止指定请求；未匹配当前运行请求时返回 false。
   * @param conversationId - ElecKoi 聊天编号。
   * @param requestId - 本次提交的唯一请求编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  cancelRequest(conversationId: string, requestId: string): Promise<boolean>
  /**
   * 读取当前聊天及各角色首选聊天。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readSelection(): Promise<ConversationSelection>
  /**
   * 保存当前聊天及各角色首选聊天。
   * @param value - 完整待保存的聊天选择。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  saveSelection(value: ConversationSelection): Promise<ConversationSelection>
  /**
   * 读取该聊天下一轮使用的全局模型。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readModelSelection(conversationId: string): Promise<ConversationModelSelection>
  /**
   * 读取官方轨迹投影，必要时先打开目标聊天。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readTrajectory(conversationId: string): Promise<TrajectorySnapshot>
  /**
   * 导出聊天资料和官方 Session 轨迹的归档 JSON。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  exportArchive(conversationId: string): Promise<string>
  /**
   * 导入归档到指定角色，返回新聊天编号。
   * @param characterId - 角色编号。
   * @param json - 聊天归档 JSON 文本。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  importArchive(characterId: string, json: string): Promise<string>
  /**
   * 在文件管理器中显示聊天附件。
   * @param conversationId - ElecKoi 聊天编号。
   * @param attachmentId - 官方附件编号。
   * @param name - 附件文件名。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  revealFile(conversationId: string, attachmentId: string, name: string): Promise<void>
  /**
   * 保存下一轮的全局模型选择。
   * @param conversationId - ElecKoi 聊天编号。
   * @param selection - 模型提供商、模型编号和可选推理档位。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  selectModel(conversationId: string, selection: ConversationModelSelection): Promise<ConversationModelSelection>
  /**
   * 切换聊天开场白并刷新消息。
   * @param conversationId - ElecKoi 聊天编号。
   * @param openingId - 开场白编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  selectOpening(conversationId: string, openingId: string): Promise<ConversationClientDetails | null>
  /**
   * 修改聊天开场白并刷新消息。
   * @param conversationId - ElecKoi 聊天编号。
   * @param content - 要保存的消息文本。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  updateOpening(conversationId: string, content: string): Promise<ConversationClientDetails | null>
  /**
   * 在当前页面记住一个角色的首选聊天。
   * @param characterId - 角色编号。
   * @param sessionId - 目标聊天编号。
   * @returns 操作完成。
   */
  rememberSession(characterId: string, sessionId: string): void
  /**
   * 读取当前页面记住的角色首选聊天。
   * @param characterId - 角色编号。
   * @returns 当前页面记住的聊天编号；未选择时为空字符串。
   */
  preferredSession(characterId: string): string
  /**
   * 清除页面中匹配的首选聊天。
   * @param characterId - 角色编号。
   * @param sessionId - 目标聊天编号。
   * @returns 操作完成。
   */
  forgetSession(characterId: string, sessionId: string): void
  /**
   * 读取当前聊天的有效设定库、变量配置和变量状态，保留完整设定字段。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  readAuthorState(conversationId: string): Promise<AuthorConversationState>
  /**
   * 替换当前聊天变量；正在生成时由 Host 拒绝修改。
   * @param conversationId - ElecKoi 聊天编号。
   * @param state - 完整的新变量对象。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  replaceAuthorVariableState(conversationId: string, state: Record<string, VariableJsonValue>): Promise<Record<string, VariableJsonValue>>
  /**
   * 修改官方 Session 中的一条消息并刷新聊天显示。
   * @param conversationId - ElecKoi 聊天编号。
   * @param eventSeq - 官方 Session 中消息的事件序号。
   * @param role - 要修改或回退的消息角色。
   * @param content - 要保存的消息文本。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  editMessage(conversationId: string, eventSeq: number, role: 'user' | 'assistant', content: string): Promise<ConversationClientDetails | null>
  /**
   * 从指定消息起回退聊天并刷新显示。
   * @param conversationId - ElecKoi 聊天编号。
   * @param eventSeq - 官方 Session 中消息的事件序号。
   * @param role - 要修改或回退的消息角色。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  deleteMessagesFrom(conversationId: string, eventSeq: number, role: 'user' | 'assistant'): Promise<ConversationClientDetails | null>
  /**
   * 删除聊天及对应 Session，刷新目录。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 操作结果，字段见返回类型；异步失败会拒绝 Promise。
   */
  delete(conversationId: string): Promise<void>
  /**
   * 读取页面中的模型选择。
   * @returns 当前页面保存的状态对象。
   */
  getModelSelectionSnapshot(): ConversationModelSelection
  /**
   * 订阅模型选择变化。
   * @param listener - 状态变化回调。
   * @returns 取消本次订阅的函数。
   */
  subscribeModelSelection(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' { interface Context { eleckoiConversations: ElecKoiConversations } }
export declare function apply(ctx: Context): void
export declare const inject: string[]
