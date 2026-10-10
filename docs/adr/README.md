# 架构决策记录

ADR 是 Architecture Decision Record，即架构决策记录，用于说明一个重要方案为什么这样选择。使用当前能力先看 [文档首页](../README.md) 和正式教程，再按需要追溯决策。

编号沿用既有记录，不要求连续。本目录从 0012 开始不表示缺了教程；不同仓库保留的记录集合可以不同，已有编号不重新分配。当前模型配置记录为 0022，历史恢复为 0020，二者不再共用编号。

## 决策索引

| 编号 | 决策 | 状态 | 当前关系 |
| --- | --- | --- | --- |
| 0012 | [DSH 官方桌面客户端基准](0012-dsh-official-client-baseline.md) | 已采纳 | 当前架构基准；迁移结果由 0017、0018 补充。 |
| 0013 | [插件平台与产品数据边界](0013-dsh-plugin-platform-and-product-data.md) | 已被取代 | 0017、0018 取代旧 Gateway 与 Main 数据所有权决定。 |
| 0015 | [内置功能登记为 DSH bundle](0015-dsh-built-in-bundle-registration.md) | 已采纳，部分被取代 | bundle 登记保留；旧 Gateway 数据边界由 0017、0018 取代。 |
| 0016 | [插件开发接口自声明](0016-plugin-developer-interface-catalog.md) | 已采纳 | 接口总表从 bundle manifest 生成。 |
| 0017 | [DSH Remote 取代旧业务网关](0017-dsh-remote-replaces-desktop-gateway.md) | 已实施 | 跨端业务采用 Remote 与正式 Connection 协议。 |
| 0018 | [DSH Host 独占产品数据](0018-dsh-host-owns-product-data.md) | 已实施 | 产品数据库、迁移与领域仓库由 Host 持有。 |
| 0019 | [请求上下文的信息性记录](0019-informational-session-records.md) | 已采纳 | Session 信息性事件信封与记录修复。 |
| 0020 | [旧聊天历史与回退状态恢复](0020-roleplay-history-recovery.md) | 已采纳 | 恢复可信历史并保持原聊天与 Session 身份。 |
| 0021 | [同一 Session 的历史重载](0021-session-history-reload.md) | 已采纳 | 日志修改后共享 Client Session 的重载合同。 |
| 0022 | [模型配置的发现与采样参数](0022-model-configuration-request-contract.md) | 已采纳 | 模型配置、凭据、发现和正式请求参数。 |
| 0023 | [使用 DSH 官方生成器维护插件接口参考](0023-official-plugin-api-reference.md) | 已实施 | 公开类型、源码生成参考与官方 Inspect 查询，补充 0016。 |
| 0024 | [官方 ChatView 与角色消息座位](0024-official-chat-view-roleplay-seats.md) | 已采纳 | 官方列表、滚动与角色呈现边界。 |
| 0025 | [同一 Session 复用已有用户事件重新生成](0025-same-session-existing-input-regeneration.md) | 已采纳 | 保留用户事件并继续官方运行循环。 |
| 0026 | [旧 Session 系统开头的迁移修复](0026-legacy-session-system-head-migration.md) | 已采纳 | 在相邻迁移中补齐空开头，保留原日志并隔离单个会话失败。 |
| 0027 | [通过官方 DSH 合同开放聊天流程参与入口](0027-conversation-plugin-lifecycle.md) | 已采纳 | Cordis Host 服务、官方 Session 保存、Remote 当前操作等待及消息回退参与。 |
| 0028 | [以多应用工作区组织桌面与后续 Android 工程](0028-multi-application-workspace.md) | 已采纳 | 应用入口、公共合同、原生源码与各平台构建职责。 |
| 0029 | [运行期间查看实际请求，停止请求副本写入放大](0029-ephemeral-request-context-preview.md) | 已采纳 | 真实请求只在内存保留；独立弹窗按需预览，退出后不恢复。 |

本目录没有收录 0006—0011 和 0014；保留编号间隔，不复制内部历史材料来补齐。后续编号须同时核对两个工作树，避免复用未收录编号。
