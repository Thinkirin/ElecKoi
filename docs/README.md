# ElecKoi Desktop 文档

本目录区分当前开发规范、插件教程、架构决策和历史资料。实现以仓库锁定版本的 DSH 官方源码为基准，ADR 说明决策原因，不替代当前接口合同。

## 当前架构

- [运行期请求预览与写入放大](adr/0029-ephemeral-request-context-preview.md)：实际请求、内存共享、预览入口与增长回归约束。

- [DSH 官方客户端架构基准](DSH_DESKTOP_ARCHITECTURE.md)：Host、Client、桌面壳及上游版本边界。
- [产品数据库](DATABASE.md)：数据所有权、结构与迁移。
- [插件归属与接入清单](DSH_PLUGIN_MIGRATION.md)：内置能力的归属与公开接入点。

## 插件开发

从 [插件开发文档](plugins/README.md) 开始；第一次写插件先看 [快速入门](plugins/quick-start.md)。查询能力时使用 [接口总表](plugins/api-reference.md)，跨 Host/Client 调用见 [Remote](plugins/remote.md)。

接口总表是 bundle manifest 的导航目录；[Client](plugins/api-client.md)、[Host](plugins/api-host.md)、[Remote](plugins/api-remote.md) 的完整调用参考和数据类型使用锁定 DSH 官方生成器从公开源码生成。数量、成员和参数不能另行手工维护。

- [插件参与聊天流程](plugins/conversation-lifecycle.md)：生成前准备、保存后收尾、消息回退及当前操作等待。

## 决策与历史

- [多应用工作区目录](adr/0028-multi-application-workspace.md)：桌面壳、Host、Web Client、共享包与后续 Android 工程的归属。

- [架构决策索引](adr/README.md)：按编号查看决定、状态与替代关系。
- [官方 ChatView 与角色消息座位](adr/0024-official-chat-view-roleplay-seats.md)：消息呈现、官方滚动与输入区布局边界。
- [同一 Session 复用已有用户事件重新生成](adr/0025-same-session-existing-input-regeneration.md)：重新生成、编辑、轨迹与轮次统计的身份规则。
- [历史资料](history/README.md)：旧架构说明，不作为当前实现指南。

## 文档维护

- [v0.2.8 发布说明](releases/v0.2.8.md)
- [v0.2.7 发布说明](releases/v0.2.7.md)

新增、改名、归档和同步规则见 [文档维护约定](MAINTENANCE.md)。运行 `pnpm check:docs` 检查本地链接、ADR 编号、标题和索引；接口总表由 `pnpm check:plugin-docs` 单独校验。

## 公开课题与产品截图

- [AI 角色扮演开发难题](open-problems/README.md)
- [Open development questions](open-problems/README.en.md)
- 正式截图放在 `screenshots/`，供仓库产品介绍引用。
