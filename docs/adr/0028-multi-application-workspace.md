# ADR 0028：以多应用工作区组织桌面与后续 Android 工程

## 状态

已采纳，2026-10-07。取代桌面独立仓库和根目录直接承载桌面源码的目录边界；不改变 ADR 0012 的 DSH 精确版本基准及 ADR 0017、0018 的通信与数据所有权。

## 背景

产品采用一个仓库维护多个平台。锁定的 DSH 提交 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 已将 Electron 壳、桌面 Host 和 Web Client 入口分别组织在 `apps/desktop`、`apps/desktop-host`、`apps/web`。继续由根目录承载桌面源码与应用配置，会使后续 Android 工程和桌面构建职责混在一起。

## 决定

1. 根目录负责 pnpm 工作区、锁文件、共享构建工具、测试、文档和应用命令调度；桌面应用进入 `apps/desktop`，保留原应用名称、版本及用户数据身份。
2. `apps/desktop/src/main` 与 `apps/desktop/src/preload` 承担 Electron 壳职责，桌面资源、Electron Vite 与安装配置由该应用拥有。
3. `apps/desktop-host` 拥有桌面 Host 子进程入口、profile/bundle 装配、父子进程生命周期协议与启动适配。它继续通过锁定版本的官方 `runProfile` 启动 Web Host；产品 Remote、Repository、数据库迁移和唯一写入权仍属于 `packages/dsh-product-api`、`packages/dsh-product-data`。
4. `apps/web` 拥有浏览器产品入口、界面源码和 Vite 构建；前端产物作为工作区包由桌面应用消费。DSH Client 插件继续位于 `packages/dsh-client-*`，不建立第二套业务通信路径。
5. 原 `src/shared` 移入 `packages/product-shared/src`，保持 `contracts`、`foundation` 两个边界，只保存合同和纯逻辑。Android 的领域语义需要按正式合同对齐，不能仅因同仓库就假定可以运行 TypeScript 实现。
6. 原 Windows 窗口适配源码进入 `native/windows-frame`；生成的 DLL 仍由桌面应用资源目录接收并保持 Git ignored。
7. 后续 Android 工程进入 `apps/android`，持有自己的运行环境、数据库及构建链。当前目录迁移不导入 Android 源码，也不启动 Android 构建。`vendor` 与 `snapshots` 按真实源码维护和会话回放测试用途建立，不创建没有用途的目录。

## 迁移与验证

迁移必须同时更新源码引用、工作区声明、应用 manifest、构建与启动入口、资源定位、架构检查器、测试和发布校验脚本。删除旧的源码及入口，不保留目录兼容副本。数据库、Session、profile 和媒体数据的用户路径不随源码搬迁。

开发工作区先完成源码检查、测试、构建和实际 Electron Host/Client 探针，再由用户启动确认。公开工作树在用户确认前不应用此次目录迁移。

DSH 目录依据：[锁定工作区](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/pnpm-workspace.yaml)、[官方 Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/apps/desktop/README.zh.md)、[官方 Desktop Host](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/apps/desktop-host/src/index.ts)。
