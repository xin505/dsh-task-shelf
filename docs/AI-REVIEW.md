---
review_id: DSH-TS-REV-001
title: DSH Task Shelf 设计评审（AI 交接版）
reviewed_at: 2026-10-28
reconciled_at: 2026-10-28
reviewed_by: DSH coding agent
baseline_target: DSH Task Shelf design v0.1
current_docs_version: v0.2
target: DSH Task Shelf design (v0.1 baseline, reconciled to v0.2)
runtime_checked: DSH 0.2.1-rc.3 (desktop runtime)
check_type: static contract review
executed_plugin: false
verdict: feasible_with_changes
confidence: high for 0.2.1-rc.3; medium for other DSH versions
canonical_json: docs/ai-review.json
---

# DSH Task Shelf 设计评审（AI 交接版）

> 这是给下一个 AI / 维护者看的结构化评审，不是设计文档的替代。
> 机器可读版本：[ai-review.json](ai-review.json)。两者冲突时，以 JSON 为准。

## 0. 60 秒摘要

- **结论**：方向可行；v0.1 的 20 条 finding 中，v0.2 已吸收 3 条、部分吸收 9 条、仍开放 8 条；剩余 4 个 blocker，不先做 P0 spike，P1 会返工。
- **4 个 blocker**：
  - R-001 第三方客户端 bundle 的构建与 Host↔Client 通道未定义。
  - R-002 `fileRefs` 缺 session 锚点，原生预览无法单独打开。
  - R-003 存储域语义与“坏数据恢复 / 备份 / 迁移”承诺冲突（v0.2 部分缓解）。
  - R-004 限额、请求上限、存储上限不能同时成立（v0.2 部分缓解）。
- **最该先做的 3 件事**：R-001（hello-world bundle + ping Remote）、R-003（per-record domain + 坏数据/中断测试）、R-002（`openSession` + `fileAddressFor` 预览）。
- **不要做**：不要用右侧栏做资料夹；不要把 domain version 当迁移机制；不要承诺 3 份备份 / 20 MiB / 500 shelf；不要用 npm CLI 管 desktop profile。
- **进入 P1 的门槛**：第 7 节 P0 spike 的 8 项全部通过，并留下测试记录。

### 0.1 v0.2 复核结果

评审完成后，仓库文档已从 v0.1 修订到 v0.2（README 已标注 v0.2）。本文件保留 v0.1 的 finding 细节，并增加本节做差异核对；**状态以本节和 `docs/ai-review.json` 的 `reconciliation` 为准**。

| v0.2 状态 | Findings |
|---|---|
| 已吸收 | R-010、R-011、R-020 |
| 部分吸收 | R-003、R-004、R-006、R-008、R-009、R-012、R-014、R-016、R-018 |
| 仍开放 | R-001、R-002、R-005、R-007、R-013、R-015、R-017、R-019 |

**v0.2 做对了什么**：

- `V1-PLAN` §3.1/§3.2/§3.3 补齐了当前任务、主会话、编辑/冲突/结果待确认的交互契约。
- §5.1/§5.2 把“来源”和“本地绑定”分开，增加 `unresolved/resolved/missing/unavailable` 引用状态；跨环境不再按标题猜。
- §5.3 把普通请求限制为 64 KiB，改成单字段/单条引用增量写入；导入改为 32 MiB 上限 + 32 KiB 分块 + 独立传输路径。
- §6.2 增加 `operationId`、持久化幂等回执和结果查询；§6.3 增加暂存、预览、整体提交和重复导入识别。
- `VALIDATION-RELEASE` 增加了 D06–D08、R03/R04、I02–I07、U01–U05、P03、C03；这些正是 v0.1 缺少的用例。

**v0.2 仍未覆盖**：

- 没有写清第三方 client bundle 的构建、Typert generator、`dsh.client`/`lib/client.js` 与 Remote 通道（R-001）。
- `FileLocator` 仍然只有 `relativePath`；没有说明打开预览需要 session（R-002）。
- 20 MiB 活跃上限与 500 shelf × 100 消息 × 5 KiB 仍然矛盾；32 MiB 完整导出上限也装不下“最大合法数据集”（R-004）。
- 备份 3 份、坏数据只读恢复、跨进程写入仍然没有存储 API 落点（R-003、R-013）。
- 侧栏 seat、桌面恢复路径、workspace 身份漂移、日志绝对路径仍未处理（R-005、R-007、R-008、R-017）。
- 产品与 workspace/goal/todo/deliverables/session-reference 的分工仍未写（R-015）。
- 跨工作区任务仍是“后续评估”，数据模型仍是单 `workspaceId`（R-019）。

## 1. 核对范围与方法

- 设计文档：`README.md`、`docs/V1-PLAN.md`、`docs/SECURITY-DESIGN.md`、`docs/VALIDATION-RELEASE.md`、`docs/OPEN-SOURCE.md`、`docs/EVIDENCE.md`。
- 运行时：当前安装的 DSH `0.2.1-rc.3`；只读核对相关包的 README 与 `package.json`，**没有安装或运行插件**。
- 结论只对 `0.2.1-rc.3` 负责；换 DSH 版本后必须重跑 R-001、R-005、R-006、R-007、R-008。
- “依据”里的包名都是当前安装包的 README 章节；不是 GitHub master 的承诺。

## 2. Finding index

| ID | severity | v0.1 status | v0.2 status | area | title |
|---|---|---|---|---|---|
| R-001 | blocker | needs-spike | open | build/rpc | 第三方客户端 bundle 的构建与 Host↔Client 通道未定义 |
| R-002 | blocker | needs-spike | open | files | `fileRefs` 缺 session 锚点，原生预览无法单独打开 |
| R-003 | blocker | needs-spike | partial | storage | 存储域语义与可靠性承诺冲突 |
| R-004 | blocker | doc-fix | partial | limits | 限额、请求上限、存储上限不能同时成立 |
| R-005 | high | doc-fix | open | ui | UI 落点未指定；全局面板生命周期未验证 |
| R-006 | high | needs-spike | partial | messages | “关键消息”的身份与收藏入口不明确 |
| R-007 | high | doc-fix | open | desktop | 桌面端安装/恢复路径写错了一半 |
| R-008 | high | doc-fix | partial | workspace | Workspace 身份会漂移；归档会话不能直接打开 |
| R-009 | medium | needs-spike | partial | ui | 全局面板拿不到“当前 session / workspace” |
| R-010 | medium | doc-fix | addressed | sync | 多窗口实时同步不可用 |
| R-011 | medium | doc-fix | addressed | import/export | 导入/导出缺 workspace 映射与去重策略 |
| R-012 | medium | doc-fix | partial | model | 数据模型缺 `schemaVersion`、`originId`、primarySession 完整性 |
| R-013 | medium | doc-fix | open | storage | 备份与“清除本插件数据”没有 API 落点 |
| R-014 | medium | needs-spike | partial | performance | domain `open()` 全量校验会拖慢启动 |
| R-015 | medium | doc-fix | open | product | 与原生能力重叠，价值主张需明确 |
| R-016 | medium | doc-fix | partial | evidence | 证据未固定到安装版；DSH 文档对 `engines.dsh` 强制有矛盾 |
| R-017 | low | doc-fix | open | privacy | 日志/错误可能泄露绝对路径 |
| R-018 | medium | needs-spike | partial | lifecycle | 面板选中时禁用 / 客户端 bundle 失败未覆盖 |
| R-019 | medium | decision | open | scope | 跨工作区任务范围被数据模型锁死 |
| R-020 | medium | doc-fix | addressed | import | 导入 10 MiB 与 64 KiB 请求上限冲突 |

计数：blocker 4，high 4，medium 11，low 1。v0.2 后：addressed 3，partial 9，open 8。

> 说明：第 3–5 节保留 v0.1 的原始 finding 细节；v0.2 是否已吸收以上表为准。R-010、R-011、R-020 在 v0.2 已吸收，下面的 fix 仅作历史记录，不需要再按原文修改。

## 3. Blockers

### R-001 · 第三方客户端 bundle 的构建与 Host↔Client 通道未定义

- **severity**: blocker
- **status**: needs-spike
- **area**: build/rpc
- **claim**: 方案把“client 发 Remote 请求”当成现成能力，但当前 DSH 要求预构建 `lib/client.js` 与 Typert 生成的 descriptor；第三方不能像内置包那样扩展 `dsh-api-remotes` 的能力集。
- **evidence**:
  - `dsh-client-modules` README：`dsh.client` + `platform: 'web'`；Host 只服务已构建的 `lib/client.js`，`pnpm run build` 必须先产出 bundle。
  - `dsh-api-gateway` README：`ctx.remote` 使用 Typert 生成的 invocation descriptor 与 strict codec。
  - `dsh-api-remotes` README：能力集由构建期 value import 固定；加 capability 要显式 `/remote` import 并 mount。
  - 当前安装包带了 `dsh-typert-loader` / `registry` / `protocol`，**没带 generator**；generator 属于仓库构建链。
- **impact**: P1 第一步就卡住；如果 generator/preset 不对外，UI 架构要改成 Host exact HTTP route + 自建认证/校验。
- **fix**:
  1. 做 P0 hello-world：Host row + client panel + 一个 `ping` Remote，从本地路径安装。
  2. 决定通道：优先 Typert；确认 generator 与 client preset 的对外可用性；退路是 exact route。
  3. 新增 `docs/API-CONTRACT.md`，固定构建产物、依赖、版本。
- **acceptance**:
  - 本地路径安装成功，面板出现，`ping` 返回。
  - 启停/重载 20 次不重复注册。
  - 打包后的 `lib/client.js` 在真实安装中加载。
- **doc targets**: `docs/V1-PLAN.md` §4；`docs/VALIDATION-RELEASE.md` §3 C01/L04。

### R-002 · `fileRefs` 缺 session 锚点，原生预览无法单独打开

- **severity**: blocker
- **status**: needs-spike
- **area**: files
- **claim**: `{ relativePath }` 单独不足以打开 DSH 原生预览；预览地址必须带 session。
- **evidence**:
  - `dsh-client-ui-sidebar-documentpreview` README：`canOpen` 只接受 Session address；地址由 `fileAddressFor` 构造。
  - `dsh-api-workspace-files` README：`read/stat/readBytes/list` 全部要 `sessionId`；`absolute/<path>` 会 `workspace-file/unknown-workspace`。
  - 实际地址形如 `dsh-resource://file/session/<sessionId>/<path>`。
- **impact**: “关联文件 → 原生预览”只能在有可用 session 时工作；无 session、archived、跨 workspace 的行为未定义。
- **fix**:
  1. 打开时解析一个该 workspace 的可用 session（primary 或任意同 workspace session）。
  2. 或给 `fileRefs` 增加可选 `sessionId`；不要只存路径。
  3. 定义无 session / archived / 文件不存在时的降级文案。
- **acceptance**:
  - 有 primary session 时预览成功。
  - 无 session 时给明确提示，不抛未捕获错误。
  - archived primary 时能降级到其他 session 或提示 Unarchive。
- **doc targets**: `docs/V1-PLAN.md` §2/§5；`docs/SECURITY-DESIGN.md` §2。

### R-003 · 存储域语义与可靠性承诺冲突

- **severity**: blocker
- **status**: needs-spike
- **area**: storage
- **claim**: `ctx.storageDomain` 的能力边界不支持方案里的“坏数据只读恢复 / 备份 3 份 / 原子迁移 / 多进程安全”。
- **evidence**:
  - `dsh-storage-domain` README：`open()` 加载并校验全部记录；任一 `invalid-record` 直接 reject；没有 migration，version 不匹配 `version-mismatch`。
  - `dsh-storage-domain` README：`domain/changed` 只在本进程；没有跨表事务、二级索引。
  - `dsh-storage-json` README：没有跨进程写锁；`single` 布局每次写重写整个 unit。
- **impact**: 安全/验证文档里的可靠性声明无法按现在写法实现；D02–D05 会失败。
- **fix**:
  1. 选择 per-record 布局，降低写放大并隔离坏记录。
  2. 自己在 global/记录里放 `schemaVersion`，做应用层迁移；不要 bump domain version 当迁移。
  3. 明确只支持单 Host 进程；多进程写入写成限制。
  4. 备份改成“导出文件”，删除后台轮换 3 份的承诺。
  5. domain name 用 `dsh-task-shelf` 命名空间，避免 `already-open`。
- **acceptance**:
  - 坏一条记录时行为已定义（不可见或只读），不覆盖整库。
  - kill Host 中途写入后，旧数据或新数据至少一份完整。
  - 两个 Host 进程写入的行为有文档和测试。
- **doc targets**: `docs/V1-PLAN.md` §5/§6；`docs/SECURITY-DESIGN.md` §5；`docs/VALIDATION-RELEASE.md` D02–D05。

### R-004 · 限额、请求上限、存储上限不能同时成立

- **severity**: blocker
- **status**: doc-fix
- **area**: limits
- **claim**: 500 shelf × 100 消息 × 5 KiB 远超 20 MiB；单条满配 shelf 也超过 64 KiB 请求上限。
- **evidence**:
  - `docs/V1-PLAN.md` §5：500 shelf；每 shelf 50 session / 100 message / 100 file；note 4 KiB、excerpt 1 KiB；单请求 64 KiB；存储 20 MiB；导入 10 MiB。
  - 计算：单 shelf 上限约 630 KiB；500 shelf 约 307 MiB；20 MiB 只够约 32 个满配 shelf。
  - 计算：100 条消息 × (1 KiB excerpt + 4 KiB note) = 500 KiB > 64 KiB。
- **impact**: 满配数据无法保存；500 上限没有意义；P01 无法通过。
- **fix**:
  1. 重算并写死“每 shelf 上限 + 总 cap + 平均 cap”三者相容的数字。
  2. 改成 item-level 写入，或把单请求上限提到 ≥512 KiB。
  3. 导入走 file upload / 分块，不要用 64 KiB 普通请求。
- **acceptance**:
  - 一条满配 shelf 可以保存。
  - 达到总 cap 时明确拒绝，不静默删除。
  - P01 在目标机器有 p95 记录。
- **doc targets**: `docs/V1-PLAN.md` §5；`docs/VALIDATION-RELEASE.md` P01/I01。

## 4. High

### R-005 · UI 落点未指定；全局面板生命周期未验证

- **claim**: 方案只说“侧栏入口 + 独立面板”，没写 seat；正确落点是 `sidebar.panellist` + layout 的 root-scoped `main` keyed slot。
- **evidence**: `dsh-client-ui-sidebar` README 的 “Global panel entries”；`dsh-client-ui-sidebar-right` README 的 “No surface without a session”；`sidebar.panellist` 选中缺失 `main` entry 会 throw。
- **impact**: 用右侧栏会在 hero/无 session 时消失；禁用插件时可能留下失效选中。
- **fix**: 在文档里写死 seat；加“面板选中时禁用/重载”和“client bundle 失败”测试。
- **acceptance**: 无 session 也能打开面板；禁用/重载不抛错。
- **doc targets**: `docs/V1-PLAN.md` §3；`docs/VALIDATION-RELEASE.md` L03/C02。

### R-006 · “关键消息”的身份与收藏入口不明确

- **claim**: 至少 finalized assistant message 有 `messageId`；user message 不是 message-feedback 的合法 target；全局面板拿不到“当前选中消息”。
- **evidence**: `dsh-message-feedback` README 的 targets；`dsh-client-ui-message-feedback` README 的 `conversation.chat.assistant-actions`。
- **impact**: “收藏消息”可能做成不可用入口；用户消息引用可能不稳定。
- **fix**:
  1. v1 只收藏 finalized assistant message；或用 `(sessionId, seq)` 覆盖用户消息。
  2. 把收藏入口挂到 `conversation.chat.assistant-actions`。
  3. 精确跳转没有公开 API 时，保留“只打开会话”的降级，不承诺定位。
- **acceptance**: 消息动作能写入 ref；excerpt 正确；打开会话成功。
- **doc targets**: `docs/V1-PLAN.md` §2/§5；`docs/VALIDATION-RELEASE.md` R01。

### R-007 · 桌面端安装/恢复路径写错了一半

- **claim**: `desktop` profile 是 Electron-owned；npm CLI 拒绝 plugin-management；Desktop shell 才管包操作。
- **evidence**: `@deepseek-ai/dsh` README 的 “Profiles”；`dsh-plugin-manager` README 的 “Desktop package operations remain owned by the Desktop shell”；`dsh-app-boot` README 的 `sanitizeProfile` 原生 fatal recovery。
- **impact**: 发布/恢复测试会用错命令；桌面用户无法按文档恢复。
- **fix**:
  1. 桌面：Desktop 插件管理入口，或 `sanitizeProfile`（重命名 `cordis.patch.yml` 为 `.bak-<timestamp>`，恢复 bundle list）。
  2. Web：`dsh plugin --profile web`。
  3. L02/C01 加桌面真实安装/停用/卸载/恢复。
- **acceptance**: disposable profile 上完成桌面安装和恢复演练。
- **doc targets**: `docs/SECURITY-DESIGN.md` §6；`docs/VALIDATION-RELEASE.md` L02/C01。

### R-008 · Workspace 身份会漂移；归档会话不能直接打开

- **claim**: 移除后重新添加同一目录会生成新 project；只存 `workspaceId` 会失联；DSH 没有常规“删除会话”，真实降级是 archived/hidden。
- **evidence**: `dsh-workspace` README 的 “Re-adding a directory starts fresh”；`dsh-client-ui-workspace` README 的 archived 结果说明；`dsh-workspace` README 明确 session deletion 是 absent capability。
- **impact**: shelf 在 workspace 重建后指向旧 id；R01 的“会话删除”场景不存在。
- **fix**:
  1. 存 `workspaceId` + canonical path/display name；打开时按 path remap。
  2. 归档 session 显示 badge，给 Unarchive 引导；不要承诺直接打开。
  3. R01 改成“归档/隐藏/日志缺失”。
- **acceptance**: 移除/重建 workspace 后 shelf 能重新绑定；archived 有明确提示。
- **doc targets**: `docs/V1-PLAN.md` §5/§7；`docs/VALIDATION-RELEASE.md` R01。

## 5. Medium / low

| ID | severity | 问题 | 建议 |
|---|---|---|---|
| R-009 | medium | 全局面板拿不到“当前 session / workspace”，`useSessions`/`useWorkspaces` 对 `main` 是否可见未验证 | 先验证；拿不到就把入口放到消息/文件动作，或用 workspace picker |
| R-010 | medium | `domain/changed` 不过客户端，`$on` 白名单是构建期固定；不能承诺实时同步 | 聚焦/可见性刷新 + revision 冲突；不写实时同步 |
| R-011 | medium | 导出只有本地 `workspaceId`，跨机无法映射；没有去重策略 | 导出带 workspace path/name；加 `originId`；导入预览映射 |
| R-012 | medium | 存储侧没有 `schemaVersion`；`primarySessionId` 可能不在 `sessionRefs`；file ref 缺 session/line | 加字段和校验；写迁移测试 |
| R-013 | medium | 没有 domain 备份/删除 API；“3 份备份”“清除数据”没有落点 | 备份用导出；清除=删除全部记录 + 说明文件残留 |
| R-014 | medium | domain `open()` 加载并校验全部记录；500 shelf 会拖慢启动 | 懒加载 + per-record；P01 测启动增量 |
| R-015 | medium | 与 workspace/goal/todo/deliverables/session-reference 重叠，README 未说明分工 | 加“与原生能力的分工”一节 |
| R-016 | medium | EVIDENCE 用 master 文档；安装版是 0.2.1-rc.3；DSH 对 `engines.dsh` 强制有文档矛盾 | 固定到安装版/commit；实测安装拒绝；标注文档冲突 |
| R-017 | low | DSH 错误可能带绝对路径；日志脱敏承诺需验证 | 统一错误脱敏；S02 加绝对路径样本 |
| R-018 | medium | 面板选中时禁用、client bundle 失败未覆盖 | 加 L03/L04 用例；确认 layout 回退 |
| R-019 | medium | `workspaceId` 单值把跨工作区任务锁死 | 现在决定：单 workspace 还是预留 `workspaceIds` |
| R-020 | medium | 导入 10 MiB 与 64 KiB 请求上限冲突 | 走 file upload/分块；写清路径 |

## 6. 限额计算

假设：每 shelf 100 条消息、100 个文件、50 个会话；note 4 KiB、excerpt 1 KiB、file path 1 KiB、session title 0.5 KiB、元数据 5 KiB。

- 单 shelf 上限 ≈ 100×5 + 100×1 + 50×0.5 + 5 = **630 KiB**。
- 500 shelf ≈ **307 MiB**。
- 20 MiB 目标上限 ≈ **32 个满配 shelf**。
- 单条满配 shelf 写入 ≈ **500 KiB**，超过 **64 KiB** 请求上限。
- 10 MiB 导入也超过 64 KiB。

**结论**：当前数字互相矛盾。二选一：

1. 保持 20 MiB：把 shelf 上限降到约 50 个、每 shelf 20 条消息，或把 excerpt/note 降得更小。
2. 保持 500 shelf：把存储 cap 提到约 256–320 MiB，请求 cap 提到 ≥512 KiB，并改 item-level 写入。

## 7. P0 spike（进入 P1 前必须全过）

1. **Bundle hello-world**：Host row + `dsh.client` + `lib/client.js`；从本地路径安装。
   - pass：面板出现；启停/重载 20 次不重复注册。
2. **Typert ping**：Host `@Remote` + generator + client `$mount`。
   - pass：真实安装中调用成功；打包后仍成功。
3. **Panel seat**：`sidebar.panellist` + `main`；无 session 打开；禁用/重载。
   - pass：不 throw；选中状态可恢复。
4. **Domain**：per-record + `schemaVersion`；写/读/坏一条/中断。
   - pass：坏记录不拖垮整库；中断后旧/新至少一份完整。
5. **Session + file**：`ctx.uiWorkspace.openSession` + `fileAddressFor(sessionId, path)`。
   - pass：primary/无 session/archived/跨 workspace 四种情况都有定义。
6. **Message action**：`conversation.chat.assistant-actions` + `messageId`/excerpt。
   - pass：assistant 消息可收藏；user 消息行为明确。
7. **Desktop**：安装/停用/卸载/`sanitizeProfile` 恢复。
   - pass：disposable desktop profile 完成全流程。
8. **Scale + two hosts**：500 shelf 样本；两个 Host 共享 `DSH_HOME`。
   - pass：启动/面板 p95 有记录；多进程写入行为有结论。

### 7.1 v0.2 后的最短路径

v0.2 已经吸收导入、写入、当前任务的大部分问题，剩余工作不要重做已吸收项。按以下顺序：

1. **R-001**：先证明第三方 client bundle + Typert Remote 能装、能跑；这是唯一可能推翻架构的 blocker。
2. **R-002**：用 P1 探针确认文件预览的 session 锚点，改 `FileLocator`。
3. **R-004**：重算 20 MiB / 500 shelf / 32 MiB 三组数字，按 §6 的建议二选一。
4. **R-003 / R-013**：确认存储域能否支持整体提交；不能就阻断导入，不要降级成部分成功；同时删掉“3 份备份”或改成导出备份。
5. **R-005 / R-007**：补 UI seat 和桌面恢复两段文档，成本低。
6. **R-006 / R-008 / R-009 / R-012 / R-018**：跟随 P1 探针结果补契约。
7. **R-014 / R-015 / R-016 / R-017 / R-019**：进入 P2 前收尾。

## 8. 数据模型建议

```ts
interface FileRef {
  path: string
  sessionId?: string   // 打开预览时的授权 session；缺省用 primarySessionId
  line?: number
  label?: string
}

interface TaskShelf {
  id: string
  workspaceId: string
  workspacePath?: string // canonical path，用于 workspace 重建后 remap
  schemaVersion: number  // 存储格式版本，不要只放在导出信封
  originId?: string      // 跨机导入去重
  title: string
  nextStep: string
  primarySessionId?: string
  sessionRefs: Array<{ sessionId: string; titleSnapshot?: string }>
  messageRefs: Array<{
    sessionId: string
    messageId?: string   // 仅 finalized assistant
    seq?: number         // 覆盖 user/任意消息
    excerpt: string
    note: string
  }>
  fileRefs: FileRef[]
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

interface ExportEnvelope {
  format: 'dsh-task-shelf'
  schemaVersion: number
  exportedAt: string
  workspaceHints?: Array<{ workspaceId: string; path?: string; name?: string }>
  shelves: TaskShelf[]
}
```

不变量：

- `primarySessionId` 必须在 `sessionRefs` 内，或为 `undefined`。
- `messageRefs` 每条至少有 `messageId` 或 `seq`。
- `fileRefs` 打开时必须能解析到 session；否则显示不可预览。
- `workspaceId` 解析失败时用 `workspacePath` remap，不要按标题猜。

## 9. 术语表

| term | 含义 |
|---|---|
| `sidebar.panellist` | 左侧栏的全局面板列表 seat；配 `main` keyed slot 使用 |
| `main` | layout 的 root-scoped keyed slot；`conversation` 也在这里 |
| `dsh.client` | `package.json` 里的客户端 bundle 声明 |
| `lib/client.js` | Host 预构建并服务的客户端 bundle |
| Typert | DSH 的 typed RPC 生成/描述机制；`ctx.remote` 依赖它 |
| `dsh-api-remotes` | 应用级 Remote 能力集与转发事件白名单；构建期固定 |
| `dsh-resource://file/session/<id>/<path>` | 带 session 授权的文件地址 |
| `ctx.storageDomain` | schema 校验的 KV domain；单进程写链 |
| `domain/changed` | 进程内变更事件，不跨进程/窗口 |
| `sanitizeProfile` | 桌面原生 fatal recovery；重置 profile patch/bundle list |
| `engines.dsh` | 安装与启动的版本准入范围 |

## 10. Do not do

- 不要用右侧栏做资料夹面板。
- 不要用 `domain/changed` 做跨窗口实时同步。
- 不要 bump domain version 当迁移。
- 不要在没有重算前承诺 3 份备份 / 20 MiB / 500 shelf。
- 不要用 npm CLI 管理 desktop profile。
- 不要把 `messageId` 当成所有消息的通用身份。
- 不要在无公开 reveal API 时承诺“定位到消息”。
- 不要假设 `workspaceId` 永久稳定。
- 不要把“导出/导入”当成“事务性备份”。

## 11. 核对来源

- 安装版：`@deepseek-ai/dsh-desktop-runtime` `0.2.1-rc.3`。
- 主要 README：`dsh-client-ui-sidebar`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-documentpreview`、`dsh-client-ui-workspace`、`dsh-client-ui-conversation`、`dsh-client-ui-message-feedback`、`dsh-client-modules`、`dsh-api-gateway`、`dsh-api-remotes`、`dsh-api-workspace-files`、`dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`、`dsh-workspace`、`dsh-session`、`dsh-message-feedback`、`dsh-plugin-manager`、`dsh-package-manifest`、`dsh-app-boot`、`dsh`。
- 设计文档：本仓库 `README.md` 与 `docs/*.md`。初评审对象为 v0.1；2026-10-28 复核时仓库已修订到 v0.2（README、V1-PLAN、SECURITY-DESIGN、VALIDATION-RELEASE、EVIDENCE 均已更新）。
- v0.2 复核只读取本仓库文档，没有重新核对上游 DSH 文档；R-016 的“证据未固定版本”仍然开放。
- 未执行：安装插件、运行插件、真实会话操作、性能测量。

## 12. 下一个 AI 的启动 Prompt

```text
你在维护 DSH Task Shelf 的设计文档，不是实现插件。
先读 docs/AI-REVIEW.md 和 docs/ai-review.json，把 JSON 当 canonical。
当前文档是 v0.2；先看 reconciliation，不要重做已吸收的 R-010/R-011/R-020。
只做文档修复，不改产品范围；R-019 需要人类确认跨工作区范围。
按 finding 的 doc_targets 逐项修改，优先 open 的 R-001/R-002/R-005/R-007/R-013/R-015/R-017，再处理 partial 的 R-003/R-004/R-006/R-008/R-009/R-012/R-014/R-016/R-018：
1. 在 V1-PLAN 增加 "API 落点" 与 "第三方 client bundle 构建/Remote" 两节。
2. 修 R-004 的限额表，给出可同时成立的数字（20 MiB / 500 shelf / 32 MiB 三者）。
3. 修 R-002/R-006/R-008/R-012 的数据模型。
4. 修 SECURITY §6 的桌面恢复路径。
5. 修 VALIDATION 的 L02/L03/C01/R01 用例。
保留原文 "未验证/设计阶段" 的诚实措辞，不要写成已实现。
每改一项，在 docs/AI-REVIEW.md 的对应 finding 下加一行 "applied: <date> <summary>"。
```
