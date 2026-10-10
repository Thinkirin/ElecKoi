# ADR 0019：请求上下文记录的 Session 信封与修复

## 状态

已采纳，2026-10-02。

2026-10-07 更新：新请求已按 [ADR 0029](0029-ephemeral-request-context-preview.md) 停止全文事件写入和请求投影；本 ADR 的信封合同与修复继续用于已有 Session 的恢复和导入。

## 依据与问题

锁定提交 `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 的 `SessionEvent.ignorable`、`known-event-types.ts` 和《为外部插件保留可忽略会话事件》规定：第一方词汇之外的信息性事件必须显式保存 `ignorable: true`，未知必需事件继续拒绝读取。请求上下文只记录实际输入供轨迹查看，不改变 Session surface 或模型历史，符合该规则。

该版本的 `Session.append()` 未提供写入此信封标记的参数。ElecKoi 曾直接追加 `eleckoi/request-context`，内存投影可以读取，正式持久化读取器却拒绝重新打开。

## 决定

1. 对精确版本 `dsh-session@0.2.0-rc.2` 增加最小补丁：append 的 options 接受显式 `ignorable: true`，现有 surface 参数与校验不变。记录方必须显式选择，不把所有未知事件自动标为可忽略，不修改已知事件目录。
2. `eleckoi/request-context` 的写入携带该标记，继续使用正式 Session 事件、投影和 Connection。记录不进入模型消息，插件卸载后也不阻止聊天恢复。
3. 对同版本 JSONL 包仅公开现有 `SessionWriteLease`，使 Host 启动修复能够使用与官方写入者相同的跨进程锁；不另建锁、读取器或持久化后端。
4. 修复只在 Host 插件装配前运行。通过官方 backend 枚举 Session，通过官方格式目录严格解码、编码与验证；仅为载荷通过当前产品 schema、引用同日志中当前 `step/start` 的该事件补标记。未知其他事件、损坏记录、历史格式和正在使用的日志均不修改。
5. 修复保留 Header、Session ID、事件数量、序号、时间、正文、工具、推理和请求上下文。原始文件备份后原子替换，校验失败恢复原文件。修复幂等，不保留运行时双轨解码逻辑。

## 验证

- 真实 Session append、JSONL 保存、关闭、重开及请求上下文投影完整重放。
- 旧记录修复前被官方读取器拒绝；修复后正文、轨迹及请求上下文保持相同。
- 重复修复不改文件；未知事件和无效载荷原样保留并报错；官方写入锁被占用时拒绝修改。
- 上游升级时重新核对 append options 与锁的公开面，具备正式入口后删除相应补丁。
