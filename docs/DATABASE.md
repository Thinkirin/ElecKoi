# Desktop 产品数据库

本文记录当前 ElecKoi SQLite 基线及其所有权。DSH 已有正式存储合同的领域不在该数据库维护第二份数据：模型与联网搜索配置使用 settings/profile/credentials，聊天正文与运行轨迹使用 Session 日志，bundle 选择使用 profile。

## 所有者与位置

- 唯一所有者：DSH Host 插件 `@eleckoi/dsh-product-data`。
- 数据库文件：Electron `userData/eleckoi-common.sqlite3`，路径由桌面壳作为 Host 启动参数传入。
- SQLite 打开、迁移、恢复和所有 Repository 写入均位于 `packages/dsh-product-data/src`。Electron Main、Client 和 Renderer 不打开数据库。
- 公共 SQL：`apps/desktop/resources/database/eleckoi-common-schema-v1.sql`。
- 当前 `PRAGMA user_version`：`9`。
- 当前结构：43 张业务表、2 个视图；数据库物理结构版本只使用 SQLite `PRAGMA user_version`。

`pnpm db:generate` 从固定 SQL 生成内嵌迁移 SQL与 Drizzle 查询映射；`pnpm check:database-schema` 校验生成内容。SQL 是公共结构权威，Drizzle 映射不反向生成迁移。

## 数据边界

| 数据 | 权威存储 |
| --- | --- |
| 角色、角色卡文本、用户资料 | SQLite；媒体字段保存 `eleckoi-media://` 引用，文件位于产品媒体目录 |
| 设定库、变量配置与状态、正则、Agent 预设 | SQLite |
| 聊天目录、角色快照、关系索引、说话者、轮次与最终回复关系 | SQLite |
| 聊天正文、推理、工具调用、工具结果与 Provider replay state | DSH Session 日志 |
| 模型提供商、模型 profile、API Key | DSH settings/profile/credentials |
| Tavily 设置与 API Key | DSH settings/credentials |
| 创作项目 | 用户工作区目录；SQLite 只保存当前需要的产品索引 |
| 显示偏好与聊天选择 | DSH settings；旧 `desktop_preferences` 在 v6 直接删除，不迁移 |

## 与 DSH Storage 的关系

当前产品数据库没有挂载 `@deepseek-ai/dsh-storage-sqlite`。该官方包是 Host 侧文档型 KV 后端，每个键对应一行 JSON；`@deepseek-ai/dsh-storage-domain` 在其上提供 schema 校验、写入串行化和 `domain/changed` 事件。它适合简单、独立、按键读写的领域状态。

ElecKoi 当前 43 张产品表需要关系、外键、排序、搜索、跨表事务和从 v1 连续迁移到当前版本。锁定版本的 DSH Storage 不提供二级索引、跨表事务或自动迁移，因此不替代这套关系型产品库。两者遵守同一所有权边界：只在 DSH Host 打开，Client 通过正式 Remote 调用；新增简单 KV 领域时先评估 `ctx.storageDomain`，新增关系型领域则进入本产品库并维护迁移链。聊天正文与轨迹仍由 DSH Session 持久化，查询索引由官方 `dsh-session-query-sqlite` 负责。

角色扮演的下一轮模型请求从 Session 投影：旧轮次只携带用户输入和角色最终正文，旧推理、工具过程与 Provider replay state 不再发送；当前轮次流程完整保留。该投影不会删除历史轨迹。编辑、删除、回退和重新生成保持同一聊天与 Session ID。

## 迁移链

迁移由 `packages/dsh-product-data/src/storage/sqlite/installSchema.ts` 在 Host 启动时原子执行：

1. v1：公共 SQL 基线。
2. v2：运行期结构整理。
3. v3：设定条目与版本引用整理。
4. v4：DSH Session/turn 绑定。
5. v5：删除废弃消息高度字段。
6. v6：删除已由 DSH 正式存储接管的模型与搜索配置表，并删除不再使用的 `generation_attempts`、`cleanup_operations`、`desktop_preferences` 与旧结构登记表 `desktop_schema`；旧设置不迁移，当前版本只以 `PRAGMA user_version` 标识。
7. v7：原子移除当前预设及其历史版本中的子 Agent 模型选择字段，并更新预设工具配置版本；子 Agent 模型授权只由 DSH Host 设置负责。
8. v8：原子删除 `chat_sessions.historyUserMessageCount` 冗余列，保留其他列、聊天标识、快照及全部有效产品关系；运行时不再写入该计数。开场白切换和编辑权限以 DSH Session 的真实用户输入、待处理输入与运行状态为准，不另存第二份用户历史判断。
9. v9：聊天保存所选开场白的变量版本编号，变量工具按该版本加载完整配置；从 v8 直接升级，旧聊天固定升级时的当前版本，保留初始值、当前值及消息。

本批变更尚未发布，生成结果表已移除，不占用正式迁移步骤。已运行过原开发 v9/v10 的数据库，启动时先核对全部结构，再原子删除该表并整理为当前 v9；原开发 v9 补齐变量版本绑定，原开发 v10 保留已有绑定，不重新选择版本。未知结构拒绝修改，失败回滚，不清库。聊天插件收尾只等待当前进程的工作，不保存或查询重启前的执行结果。

较早开发构建创建的 v6 数据库在升级至 v7 前，先原子整理已废弃的执行、偏好与结构登记表，再执行 v6 → v7 迁移。仍有效的角色、预设、设定、变量与聊天索引数据保留，不要求清库。后续结构变化必须提升版本并追加连续迁移。

## 升级代码的清理条件

代码入口旁以 `TODO(迁移清理)` 标记等待退役的转换，下面按实际数据分别核对。客户端发布了新版本、某台机器已升级或本机扫描没有命中，都不能证明其他受支持的旧安装、未打开的聊天及备份已完成转换。当前没有宣布新的最低升级版本，以下入口均保留。

| 入口 | 何时可以清理 | 必须一起处理的范围 |
| --- | --- | --- |
| [SQLite v1 → v8 迁移链](../packages/dsh-product-data/src/storage/sqlite/installSchema.ts) | 正式停止支持某步骤起点及更早 schema 直接升级；剩余受支持版本仍有连续原子链 | 对应 `0002` 至 `0008` 步骤、旧表定义、import、登记与旧库 fixture；保留当前 SQL、版本常量及完整性校验 |
| [开发 v2、v6 同版本整理](../packages/dsh-product-data/src/storage/sqlite/installSchema.ts) | 分别停止支持对应开发基线直接升级 | 对应整理函数、专用入口和 fixture；v2 共享整理函数仍被 `0002` 使用时继续保留 |
| [模型设置 schema v0/v1 → v2](../packages/dsh-client-models/src/index.js) | 支持的升级和 profile 恢复入口均已保存至少 schema v2 的设置 | 旧 schema 转换、专用常量与用例；函数和启动调用须等两段整理均退役，保留当前设置合同和插件装配 |
| [旧子 Agent 占位路由](../packages/dsh-client-models/src/index.js) | 停止支持 v0.2.3 之前版本直升，且支持的 profile 恢复入口不再携带该路由 | 占位路由过滤、专用常量与用例；与模型设置 schema 转换分别核对 |
| [旧默认模型路由](../packages/dsh-client-roleplay/src/host/model-selection-migration.mjs) | 停止支持 v0.2.1 及更早版本直升，且支持的 profile 恢复入口不再携带旧路由 | 迁移函数、辅助函数、启动调用和旧路由用例；当前请求快照改为直接解析正式选择，保留每轮冻结与恢复后的模型刷新 |
| [旧实体化预设 ID](../packages/dsh-client-roleplay/src/host/agent-preset-bridge.mjs) | 支持恢复的 Session、快照和导入记录均已持久选择 `eleckoi-active`，且对应旧版本直升已退役 | 旧声明注册、别名、目录扫描、分支与用例；保留当前预设注册、重组和恢复服务 |
| [profile 内置 bundle 登记](../apps/desktop-host/src/desktopPluginBundles.ts)、[Tavily 首次选择](../apps/desktop-host/src/desktopPluginHost.ts) | 支持的升级和 profile 恢复入口分别已完成 `bundles-v5`、`tavily-bundle-v1` 登记 | 各自的一次性函数、调用及旧 profile 用例；保留新 profile 初始化和用户启停选择 |
| [请求上下文记录修复](../packages/dsh-runtime/src/sessionRequestContextRepair.ts) | 对应旧版本直升已退役，且支持的 Session 恢复和导入入口已有转换缺失可忽略标记的能力 | 修复模块、启动扫描、导出与专用用例；旧事件保留，新预览不落盘，见 [ADR 0029](adr/0029-ephemeral-request-context-preview.md) |
| [旧聊天独立输入补回](../packages/dsh-runtime/src/sessionHistoryRecovery.ts) | 对应旧聊天直升已退役，且支持的恢复和导入入口已把缺失输入写为正式 Session 消息 | 补回模块、归档读取、启动调用、导出与专用用例；保留逐会话错误隔离、投影重放、检查点和正常重新生成 |
| [已补回聊天的统计标记](../packages/dsh-client-roleplay/src/host/history-stats-projection.mjs) | 支持恢复的已迁移日志完成等价统计转换，重放结果保持正确 | 仅旧标记分支、专用状态与旧日志用例；保留当前已有输入续接的统计及投影登记 |
| [旧请求投影信封过滤](../packages/dsh-client-roleplay/src/host/conversation-context.mjs) | 支持恢复和导入的旧日志均已不含该插件消息 | 按正式插件来源标识排除旧信封；新请求仅在内存装配，不生产新信封 |
| [v3 → v4 系统开头补丁](adr/0026-legacy-session-system-head-migration.md) | 锁定上游的正式相邻迁移能通过同一组旧日志用例 | 版本补丁、`patchedDependencies` 登记和锁文件；保留官方格式目录与完整迁移链 |

删除恢复或迁移入口时只移除其专用用例；新建、重开、备份、完整性、当前模型请求、预设重组和重新生成等正常路径的验证继续保留。异常退出后的响应状态恢复是当前运行职责，仍由 [启动恢复](../packages/dsh-product-data/src/storage/sqlite/recoverInterruptedState.ts) 执行。

## 删除与文件

- 删除角色时级联删除其产品关系和聊天索引。
- 删除聊天或清空记录时，产品索引与对应 DSH Session 使用同一聊天标识处理，不创建分叉会话。
- 媒体文件由 Host 的 `LocalMediaStore` 写入；数据库只保存稳定媒体引用。Electron 的媒体协议只负责只读响应。
- 不再使用数据库清理任务表。DSH Session 文件生命周期交给正式 Session API，产品媒体删除由拥有该文件的 Host 操作在业务事务边界内执行。

## 验证

- `pnpm check:database-schema`：43 张公共表、2 个视图与生成文件一致。
- `pnpm test`：覆盖 v1 至 v9 迁移、未发布开发库整理、失败回滚、外键、重启持久化、角色与媒体、设定、变量、正则、预设、聊天索引和 Remote 写入。
- `pnpm rebuild:electron && pnpm check:electron-sqlite`：使用 Electron 的真实原生 SQLite ABI 创建公共结构，核对 43 张业务表、2 个视图、`user_version = 9`、冗余列缺失、外键和完整性。

架构决策见 [ADR 0018](adr/0018-dsh-host-owns-product-data.md)。
