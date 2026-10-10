# ElecKoi 的 DSH 官方客户端架构基准

状态：当前架构目标。本文记录 ElecKoi 如何对照官方源码；**DSH 官方客户端及其同版本源码是唯一架构基准**，本文不另立一套与其平行的客户端标准。决策见 [ADR 0012](adr/0012-dsh-official-client-baseline.md)。

## 权威来源

当前仓库锁定 `deepseek-ai/deepseek-harness` `0.2.0-rc.2`，提交 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5`。核对架构和行为时使用这个**精确提交**的官方源码，而不是浮动的 `master`、旧版文档或 ElecKoi 的临时实现：

- [DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/architecture.zh.md)：Cordis、profile、bundle 与插件树。
- [Web Client 架构](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/subsystems/web-client.zh.md)：Host、Remote、Client model、Slots 与 React。
- [官方 Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/apps/desktop/README.zh.md)：Electron 壳、受管 profile、Web Host、客户端资源及插件管理。

升级时先锁定同一上游发布批次的提交、包和构建产物，再把上述引用与本仓库的依赖一起更新。不同版本的官方文件不能混作一次架构依据。

## 工作区目录

应用入口位于 `apps/desktop`、`apps/desktop-host`、`apps/web`；公共合同位于 `packages/product-shared`，Windows 原生源码位于 `native/windows-frame`。后续 Android 工程进入 `apps/android`，使用独立的平台构建和本地数据。目录决策见 [ADR 0028](adr/0028-multi-application-workspace.md)。

## 要达到的结构

1. Electron 负责官方桌面客户端所需的窗口、可信来源、受限 preload、本机资源、启动、恢复和更新；不另外发明一套与 DSH Web 应用竞争的客户端框架。
2. DSH 运行时通过官方 profile、bundle 和 patch 层装配。Agent、Session、模型、工具和官方插件由同版本 DSH Host 的正式能力负责。ElecKoi 的扩展优先作为独立的 DSH Host/Agent 插件进入该插件树。
3. 主界面使用官方 Web Client 的模块加载、Cordis 生命周期、Remote、Client model、Slots 和 Renderer。ElecKoi 的页面与角色聊天通过公开的客户端插件合同贡献；第三方插件在其声明的正式扩展位上生效。
4. 新增产品能力默认进入同版本 DSH 的 Host/Client 插件体系。每项能力都必须说明所有者、持久数据来源、公开扩展点、卸载行为和升级验证。需要 Electron 原生能力或产品独有持久数据时，先对照官方 Desktop/Host 的归属方式；无法纳入官方合同的例外必须有具体理由、明确边界和 ADR，不得把现有目录当作永久理由。
5. 不把“使用 Cordis”或“安装后出现在插件列表”当作架构对齐的证明。必须验证实际会话、界面、启停卸载、重启恢复及第三方插件效果。

## 当前代码与目标的差距

以下是**现状记录，不是新的永久架构规定**：

| 现状 | 与官方基准的关系 | 后续核对 |
| --- | --- | --- |
| `apps/desktop-host` 启动同一个 DSH Web Host，并经官方 SessionController 驱动角色会话 | 已采用官方运行路径 | 按精确版本验证会话和插件生命周期 |
| `@eleckoi/dsh-product-data` 在 DSH Host 打开产品数据库、执行迁移并持有全部领域 Repository | 产品 Client 调用全部使用生成的 Typert Remote；数据库唯一写入权、迁移链与媒体写入均已移交 Host | 保持 Host 单一所有权，禁止把 Repository、迁移或第二套跨端业务协议放回 Main |
| `@eleckoi/dsh-client-*` 在官方 Web Client 运行代内贡献界面和受控产品接入点 | 已使用官方 Client model、Slots、Renderer 与 Session 作用域 | 按公开类型和安装探针持续验证第三方插件行为 |
| `patches/` 对锁定官方包进行最小适配；预设桥接通过官方 `agent/created` 生命周期装配顶层 Session 作用域，并以 `agent/request` waterfall 覆盖当前全局模型；子 Agent 模型只由 DSH 官方子智能体设置决定；Session 信息性记录补丁见 ADR 0019 | 与上游实现紧耦合，补丁清单以 `pnpm-workspace.yaml` 为准 | 对照同版本公开扩展点；可替代则迁移，不能替代则记录例外和升级测试 |
| Runtime Manifest 已将桌面对话主路径标为 Web Host，并区分旧 SDK 兼容组合 | 事实源已校正；仍不能仅凭静态检查认定全体产品插件迁移完成 | 用实际桌面 Host 探针和插件安装探针继续验收 |

聊天正文以 DSH Session 日志为持久来源；SQLite 只保存仍属于 ElecKoi 的关系型产品数据。已经废弃的模型、搜索配置和运行流水表只在版本化迁移中删除，不再有运行时读写路径。

旧 Session 缺少空系统开头时，仅在锁定版本的官方 v3 到 v4 相邻迁移中补齐；通过正式校验后发布后继，保留旧文件，删除条件见 [ADR 0026](adr/0026-legacy-session-system-head-migration.md)。单个会话失败不阻断整个桌面 Host 启动。

## 数据放在哪里

数据位置由它的权威所有者决定，不以“统一放数据库”为目标：

- DSH 已有正式领域使用 DSH 自己的持久化合同：模型配置使用 settings/profile，密钥使用 `ctx.credentials`，聊天正文使用 Session 日志，bundle 选择使用 profile。
- DSH 的 [`dsh-storage-sqlite`](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/packages/storage/storage-sqlite/README.zh.md) 是 Host 侧的文档型 KV 后端：每个键保存一行 JSON，配合 `ctx.storageDomain` 提供 schema 校验、持久写入和进程内变更事件。简单、独立且按键读写的新增 Host 状态应优先评估这套正式合同。
- ElecKoi 的角色关系、聊天索引等关系型产品数据，在领域迁入 DSH Host 后由 Host Repository 独占 SQLite 写入；Client 和 Electron Main 不直接写。
- 创作项目、导出文件和其他以目录为产品形态的数据保存在用户选择的文件目录；Host 只维护对应文件索引，不复制进 SQLite。
- 页面加载状态、当前选择和生成中的临时状态留在 Client 内存，除非存在明确的重启恢复需求。

同一份配置不同时写入 DSH 与 SQLite。旧 SQLite 字段只在领域迁移时转换到新的权威存储，验证成功后删除旧读写路径和废弃结构。

`dsh-storage-sqlite` 不提供跨表事务、二级索引、多段键或自动迁移。现有 ElecKoi 产品库依赖关系表、外键、排序、搜索和连续版本化迁移，因此不能机械改造成 JSON KV。保留关系型产品库是数据模型选择；它仍由 DSH Host 插件独占，并通过 Typert Remote 对 Client 提供能力。DSH Session 查询索引则继续使用官方 `dsh-session-query-sqlite`，三者各自拥有独立用途和数据库身份。

## 实施顺序

1. 建立逐功能对照：官方 owner、ElecKoi 现有 owner、数据来源、正式扩展点、升级风险和验证用例。当前清单见 [插件归属与接入清单](DSH_PLUGIN_MIGRATION.md)。
2. 校正过期的 Runtime Manifest、检查器和实施文档，让它们验证实际的 Web Host 与客户端插件组合。该项事实源已校正，后续仍需继续扩充动态验收。
3. 持续复核官方包补丁与 Agent 创建/恢复适配等高耦合点；可以使用公开扩展点时移除补丁，仍需补丁时保留精确版本校验和运行探针。
4. Main 只保留窗口、资源协议、更新与 Host 进程管理；新业务进入 DSH Host/Client，现有数据库由 `@eleckoi/dsh-product-data` 独占。
5. 以真实官方/第三方插件验收安装、启用、界面效果、停用、卸载、会话恢复和上游批次升级。当前临时插件探针已覆盖安装、中文元数据、真实角色卡编辑入口、重启、停用、启用和卸载。

当前 `pnpm check:architecture` 检查目录、进程边界，并阻止已删除的 Desktop Gateway 业务桥回流；它仍不能代替真实 Host、Session 与插件生命周期验收。旧的 [桌面架构说明](history/ARCHITECTURE.md) 和私有知识库中的《ElecKoi Desktop 架构最终总纲》仅作历史索引。
