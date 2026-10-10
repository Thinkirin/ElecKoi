import type { Session } from '@deepseek-ai/dsh-session'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { RoleplayRequestContextItem } from '../projections.js'
export interface RequestPreviewSummary {
  id: string
  round: number | null
  request: number
  turn: number
  step: number
  provider: string
  model: string
}
/** Host 运行期请求预览；只共用内存消息，不持久化或恢复历史请求。 */
export class RequestPreviewStore {
  /**
   * 捕获即将交给 LLM Runtime 的真实请求。
   * @param session - 发送请求的正式 Session。
   * @param options - 完成产品装配的实际模型请求。
   * @param plan - 此次装配使用的设定位置和可读来源。
   * @param execution - 已有输入投影的轮次和实时步骤事件中的执行身份。
   * @returns 仅含身份与编号的请求目录项。
   */
  capture(session: Session, options: GenerateOptions, plan: readonly object[], execution: { round: number | null; turn: number; step: number }): RequestPreviewSummary
  /**
   * 列出当前运行捕获的请求，目录不包含正文。
   * @param sessionId - 正式 Session ID。
   * @returns 发送顺序中的请求目录项。
   */
  list(sessionId: string): RequestPreviewSummary[]
  /**
   * 按运行期请求身份临时生成可读上下文；不存在时失败。
   * @param sessionId - 正式 Session ID。
   * @param requestId - 本次运行捕获时分配的请求 ID。
   * @returns 请求身份和按实际顺序排列的上下文条目。
   */
  read(sessionId: string, requestId: string): { id: string; items: RoleplayRequestContextItem[] }
  /**
   * 订阅请求目录，慢读取者合并通知，取消后释放订阅。
   * @param sessionId - 正式 Session ID。
   * @param signal - 订阅取消生命周期。
   * @returns 初始目录及之后的最新目录。
   */
  stream(sessionId: string, signal: AbortSignal): AsyncIterable<RequestPreviewSummary[]>
  /**
   * 删除聊天时释放该 Session 的全部运行期请求。
   * @param sessionId - 已删除的正式 Session ID。
   */
  forget(sessionId: string): void
  /** 释放全部请求并结束订阅；用于 Host 插件卸载。 */
  close(): void
}
