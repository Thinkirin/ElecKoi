# ADR 0018：DSH Host 独占产品数据与官方 Agent 运行时

## 状态

已实施，2026-10-01。本文完成 [ADR 0017](0017-dsh-remote-replaces-desktop-gateway.md) 规定的数据所有权迁移，并取代仍把产品 Repository、SQLite 迁移或自建 Agent Runtime 留在 Electron Main 的现状描述。

## 背景

产品 Client 已经改用锁定版本 DSH 的 Typert Remote，但数据库启动、领域 Repository 和一套自建 `DshRuntime` 曾继续存在于 Electron Main。这样虽然移除了页面到 Main 的旧 Gateway，业务事实仍跨 Main 与 DSH Host 分布，官方 Session、Agent 生命周期和产品数据的所有者也不清晰。

锁定版本 `deepseek-ai/deepseek-harness@c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 的 Desktop 由 Electron 壳启动受管 Host；Agent、Session、Remote、插件组合和 Host 服务在该 Host 生命周期中运行。ElecKoi 的关系型产品数据可以作为 Host 插件服务存在，不需要另建 Main 业务运行时。

## 决定

1. `@eleckoi/dsh-product-data` 是产品 SQLite 的唯一所有者。它在 DSH Host 中打开数据库、执行版本化迁移、恢复中断状态并创建领域 Repository。
2. 角色、用户资料、设定库、变量、正则、Agent 预设、聊天索引、消息关系、存档和创作项目等产品能力只从该 Host 服务访问。Client 使用生成的 `@eleckoi/dsh-product-api` Typert Remote；Electron Main 不持有这些 Repository。
3. 聊天正文、推理、工具轨迹和 Provider 状态继续由 DSH Session 日志负责。SQLite 只保存 ElecKoi 的关系与索引，不复制 Session 正文。
4. Agent 创建、恢复、流式运行和 SessionController 使用锁定批次的官方 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-jobs` 与正式插件组合。删除自建 `DshRuntime`、Main Agent 协调器、运行通知和运行统计流水。
5. Electron Main 只承担窗口、可信资源协议、更新、路径与日志、受管 Host 进程启动和故障处理。壳层可按媒体引用读取文件以响应 `eleckoi-media://`，但不能修改业务数据。
6. 模型、联网搜索、显示偏好与聊天选择继续使用 DSH settings/profile/credentials。未正式发布的 v6 数据库基线删除相应旧表以及不再使用的运行流水表；按产品决定，旧设置不迁移。已有开发 v6 数据库在原版本内原子整理其他有效产品数据，不清库。
7. 锁定版本的 `dsh-storage-sqlite` 是文档型 KV 后端，不提供当前产品库需要的跨表事务、二级索引和自动迁移。现有关系型产品数据继续由本 Host 插件管理；新增简单 KV 状态必须先评估 `ctx.storageDomain`，不能为复用介质而把不匹配的数据模型强行转换成 JSON 文档。
8. 任何把业务 Repository、数据库迁移、自建 Agent Runtime、Desktop Gateway 或业务 preload API 放回 Main 的改动，都需要新的 ADR 并必须先证明锁定版本 DSH 没有正式承载方式。

## 验收

- `apps/desktop/src/main` 不包含产品 Repository、SQLite 实现或自建 Agent Runtime。
- `@eleckoi/dsh-product-data` 独立完成数据库创建、v1 至 v6 迁移、开发 v6 整理、外键和完整性检查。
- 产品 Client 的跨端方法都来自生成的 Typert Remote；实时 Agent 与轨迹来自 DSH Session/Connection。
- 编辑、删除、回退和重新生成保留同一聊天与 Session ID，不使用 Session 分叉。
- 角色模型请求仅携带旧轮次的用户输入与最终正文；当前轮次推理和工具流程完整保留，历史轨迹本身不被删除。
- 类型检查、架构检查、数据库合同、全量测试、生产构建和 Electron DSH/SQLite 探针通过。

## 结果

ElecKoi 只有一个业务 Host、一个产品数据库写入者和一套官方 Agent/Session 运行路径。Electron Main 成为桌面壳，第三方插件只需理解 DSH bundle、Cordis、Remote、Connection 和 Slots。
