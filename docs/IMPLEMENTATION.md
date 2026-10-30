# alpha.1 实现记录

本文按时间保留实现记录，最新 4.4 见末尾；早期“不调用模型”“仅已关联来源”等描述只适用于当时功能。

日期：2026-10-28（Asia/Shanghai）。目标：先交付个人试用插件，用实际问题推动迭代。

## 实现

- JavaScript ESM + React createElement。构建使用 Node 内置模块，生成 DSH lazy-CJS factory，不打包第二份 React。
- 入口使用 `sidebar.panellist` 的 `id`，主面板使用 `main` 的 `key`。
- Host 使用 `ctx.connection.fetch.register` 注册精确 `/api/task-shelf/*` 路由，复用认证、owner-only 准入和桌面通道，不另开匿名路由。
- 客户端优先宿主 `__DSH_TRANSPORT__.fetch`，Web 使用同源 Fetch；导航使用 `ctx.uiWorkspace.openSession`。
- `workspaceRegistry` 校验归属；会话标题读取官方 projection hints，元数据读取不扫描聊天正文。
- 官方 `withFileLock` 包住读—版本校验—变更—提交，`writeFileAtomic` 替换单文件。业务记录和幂等回执在同一次提交中保存。
- 普通输入 64 KiB，导入单独限额 2 MiB + 64 KiB；列表 20 条分页，详情最多 50 个会话引用。
- 业务数据 2 MiB，完整状态文件 4 MiB。回执最多 4096 条、24 小时有效，不提前驱逐有效回执；导入历史最多 100 条。
- 一代 `state.json.previous` 备份。坏文件停止写入，不自动回退或清空。

历史 v0.2 的 500 资料夹、20 MiB、分块导入、三代备份、文件引用和消息收藏不属于当前完整实现。

## 验证边界

本机安装包 DSH 0.2.1-rc.3 只读提取至 `.dev/runtime`，用独立 `DSH_HOME`、浏览器上下文、工作区和合成会话测试，没有调用模型或操作日常会话。

具体通过项见 `TEST-RESULTS.md`。以下仍未验证：日常 Windows 桌面安装和 Electron IPC 端到端操作、其他第三方插件组合、长时间运行、强杀进程与断电恢复、未来 DSH 版本。

原子工具没有 fsync，不作断电保证。并发测试使用独立存储实例，未声称完成跨进程强杀测试。草稿仅在窗口内存；导入只提供同环境校验后的新增复制，未提供跨环境映射和覆盖损坏文件。

## 开发复现

设置 `DSH_ASAR` 指向自己的 `resources/app.asar`，运行 `node scripts/runtime-file.mjs --extract`，只读提取至项目 `.dev/runtime`。该目录不提交、不打包、不改原安装。

测试所需 `dsh-atomic-write`、`dsh-home-paths` 从精确运行时复制至开发 `node_modules/@deepseek-ai`；运行时作为宿主 peer，不随本插件分发。

`scripts/start-test-host.mjs` 只用 `.dev` 下的隔离数据。`tests/fixture-plugin.mjs` 生成合成会话，不进入安装包。浏览器测试使用 Playwright 和 Edge，可通过 `PLAYWRIGHT_PATH` 指定开发包路径。

打包只复制明确白名单，生成 tarball 后解包逐文件比对 SHA-256，排除测试运行时、凭据、认证 URL、聊天和 node_modules。

## alpha.2 启动自检实现

`apply` 立即启动独立的 `checkHealth` Promise，不阻塞业务路由注册。GET `health` 通过宿主原有认证读取该次结果；页面刷新不重新运行探针。检查使用已有状态校验器和官方原子写工具，只写随机命名的临时文件和固定的最近报告，不改任务文件与备份。报告包含固定提示而不序列化异常、内容或路径；每次覆盖一个文件，写报告失败仍保留内存结果。异常摘要写入宿主标准错误日志。没有新增常驻进程、系统启动项、网络上报或周期定时器。

启动检查不验证所有关联资源，不检测加载前失败，且可能与其他实例同时读写，因此结果只能说明检查时的局部状态。实际保存仍走原有锁与逐次数据校验。

## alpha.3 跨会话交接

新增 `handoff.js` 与 `handoff-client.js`。POST handoff 独立于任务数据写接口；校验资料夹 revision、已关联来源与工作区归属后，只读打开持久化句柄，并在 finally 关闭。使用官方 `dsh-session` 的 foldSurface/deriveEventMessage 还原当前有效表层，避免把被替换的原始历史再次带入。未提供额外消息投影时拒绝相关会话；只摘取 user/assistant 的 text block，省略工具、系统、思考与附件。

读取有事件数、逻辑字节数、摘录数量与输出字符数限制；后端可能在 open 内解压日志，因此这些限制不是后端峰值内存上限。数据源是已持久化前缀，不强制 flush 活跃会话。生成包不写入任务状态；不增 schema、不增加历史全文索引。每个窗口保留编辑稿，选择或资料夹版本变化阻止直接继续；原会话变化不自动同步。

复用 uiWorkspace.openWorkspace、sessions.binding 和 prepareDraft，将材料或摘要整理提示词追加到原生草稿，不发送。await 宿主返回，失败保留本地交接稿。模型总结留在原生会话内执行，不能将本地摘录称为 AI 总结。经真实 Web 运行时验证，未验证 Electron 端到端和模型回答质量。

开发环境使用指向 `.dev/runtime` 官方 session 包的 junction；不随安装包分发。运行时通过精确 peer 复用宿主库。

## 来源与许可

使用 DSH 公开接口与官方 peer 工具包。参考已安装插件的 manifest 和加载机制，没有复制其业务实现。自 2026-10-30 起采用 MIT 许可证，见仓库 LICENSE。`private: true` 仅阻止误发 npm。

## alpha.4 双版本

服务端一次读取来源，同时生成技术记录和易读文本。后者改用会话名称、顺序段落号和说话者称谓，并保留所有被选中摘录、截断和省略提示；不新增模型调用。前端分别保留两份编辑状态与输出选择，视图切换不重建内容。复制、下载和草稿入口统一读取显式选择的版本，默认易读版。两份不会自动同步编辑，重新生成会确认替换两份。

## alpha.4 跨工作区修订（不升包版本）

会话引用增加可选 workspaceId/workspaceTitle，仅跨区时保存。旧引用继续使用资料夹所属工作区。读取兼容 schema 1/2；首次写入跨区引用后使用 schema 2，导出保持实际 schema，导入接受两者并逐个校验各来源。旧包会拒绝 schema 2，避免误读；回退要求保留升级前完整状态。

选择器复用原 catalog 分页接口，以所选来源工作区请求。请求序号及资料夹选择序号隔离迟到响应。添加、设主会话、打开、导入和生成包都按引用实际工作区验证。生成前检查全部来源，读取后再次检查，任一失效不返回部分结果。摘录内容不持久化到资料夹；原会话不迁移。

目标工作区是窗口内的交接设置，不改变资料夹归属或已生成文本。带入前通过 owner 认证的 GET destination 验证目标仍存在，复用宿主 openWorkspace/prepareDraft 进入该工作区空白会话并追加。目标不存在时不回退其他工作区。现有讨论通过复制粘贴接收，不增加直接向已有会话发送的接口。

无新增服务或依赖。健康报告增加 build=alpha.4-cross-workspace，包版本仍为 0.0.1-alpha.4。沿用已安装 DSH 0.2.1-rc.3 的本地接口实现与许可边界。

## 4.4：工作区树与可选压缩

包版本 0.0.1-alpha.4.4，界面显示 4.4。`handoff-sources-client.js` 按工作区惰性加载、分页展示会话，已选来源在父组件独立保存，折叠/筛选不丢选择。选择不写资料夹关联，仍通过当前 owner 的 workspaceRegistry 验证归属。旧 POST handoff 保留兼容，4.4 UI 使用新的 plan/compress/status/release 入口。

`readContext(..., true)` 复用官方表层还原但不先做 12 条/1000 字截断。`handoff-plan.js` 验证全部来源后读取原文，按 Unicode 字符生成两个版本并统计较大者。单段 12,000、整包 30,000；客户端自动处理单段超限列表，合计超限只提供每段按钮，不自行挑选。原文始终留在临时计划中，再次压缩从原文开始，避免摘要叠加造成额外漂移。临时计划数量、字节容量、生命周期与尝试次数均有限，schema 保持 1/2。

本地精简按头尾比例截取并插入明确省略标记。AI 通过官方 `dsh-llm` 的 prepareCall、createUserMessage 与 BlockAssembler，校验界面看到的默认模型与服务端一致，仅发送文字和摘要系统提示，不启动 agent、不提供工具、不写源会话。增加精确 peer `@deepseek-ai/dsh-llm@0.2.1-rc.3`；开发环境 junction 指向隔离提取包，发布不附带该依赖副本。没有可用模型时本地功能仍能使用。

AI 输入上限 120,000 字符，按 10,000 分段并最终合并，单段分配摘要预算；输入按模型 contextWindow 做保守字符检查，而非声称精确 token 估算。超时、非正常 finish、超长/空摘要均拒绝替换。压缩操作以 operationId 合并重复进行中的请求并缓存完成/失败结果，不重复发起模型调用；同 ID 改内容被拒绝。压缩前后均重新验证资料夹 revision 和所有来源归属。HTTP 与流异常统一脱敏，前端保留旧编辑稿与失败提示。

真实模型质量、费用归属展示及不同 provider 的实际行为留待用户试用，当前验证采用官方流装配器与模拟模型服务，未使用真实凭据。

