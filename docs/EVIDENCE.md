# 事实依据与待验证项

初稿标注核对日期：2026-10-28。以下来源与 Git blob SHA 沿用 v0.1 的证据记录；本次 v0.2 修订未独立复核这些上游事实。审查时 raw.githubusercontent.com 与 github.com 均返回访问／安全验证错误，未取得上游页面内容，也未执行安装或运行测试。master 会变化，P0 必须重新核对目标发行版对应的固定 commit；文档事实不替代运行测试。

## 官方依据

| 事实 | 来源 | 对方案的影响 |
|---|---|---|
| Host 插件在进程内、工作区沙箱外运行 | [Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md) | 不宣称权限隔离；尽量减少 Host 代码与依赖 |
| 版本安装检查、更新恢复有具体条件和失败路径 | 同上，Version compatibility / updateBundle | 固定版本、实测升级与回退，不依赖“自动恢复一定成功” |
| engines.dsh 优先于 DSH peer 范围；准入在导入前进行 | [App boot](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md) | 正确声明兼容范围，避免字段矛盾 |
| 可选插件失败与必需插件失败处理不同；未捕获异常可导致退出 | 同上，Startup and reload failures | 无法承诺绝不影响宿主；故障注入必须测真实启动 |
| 桌面端具备禁用第三方插件并重启等恢复入口 | [Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md) | 编写并验证脱离插件 UI 的恢复流程 |
| 公开 API 尚未稳定 | [官方 AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md) | 适配层、有限支持矩阵与明确停止支持策略 |
| 通过上下文注册和 effect 管理资源清理 | [First plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) | 显式管理订阅、任务与退出生命周期 |
| 官方右侧栏已持久化会话布局与标签，公开资源导航能力 | [Right Sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-right/README.md) | 复用预览和布局，不做重复替代 |
| 启动时错误客户端声明／缺失 bundle 可能使客户端模块服务失败 | [Client Modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md) | 正式包内容与真实安装检查必须成为发布门槛 |
| manifest 提供元数据类型，不自动证明行为兼容 | [Package manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/package-manifest/README.md) | 类型检查、声明准入与行为测试分别记录 |

初稿记录的 package-manifest README Git blob SHA（本次未重新读取）：
85e39259b2115066b2c8009d1d1831eb78d50154
这是单个文件的内容标识，不是整仓 commit，也不代表已验证的运行版本。

## 可借鉴项目

- [penguin-oo/dsh-bookmarks](https://github.com/penguin-oo/dsh-bookmarks)：消息收藏、Host 校验和版本化写入的参考。README 标明 MIT；复制前仍需检查固定 commit 的 LICENSE。
- [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)：现有侧栏能力与扩展生态参考，不作为首版强依赖。
- [yiliang114/dsh-session-deck](https://github.com/yiliang114/dsh-session-deck)：会话状态、导航与兼容记录的参考。
- [KhalilHsu/dsh-plugins](https://github.com/KhalilHsu/dsh-plugins)：核心功能被宿主覆盖后停更的实例，提示我们控制长期维护范围。

截至本轮，没有复制这些项目的实现代码，也没有执行其安装脚本。

## 必须在 P0/P1 回答的未知项

1. 用户实际 DSH 精确版本及其客户端运行时。
2. 目标发行版中可用的 UI slots、Remote、资源和会话导航契约；消息／文件就近动作入口或面板内公开替代路径。
3. 已完成消息是否有稳定身份，精确定位某条消息是否有可靠公开能力；仅缺定位可以降级，不能把缺少稳定身份隐去。
4. 存储的事务、并发和异常退出语义，及多个 Host 共用数据目录的限制；是否支持原子写入业务记录与幂等回执、导入整体提交。
5. 卸载流程是否保留插件存储。
6. 桌面测试环境是否能与日常数据完全隔离。
7. 正式打包后生命周期、失败恢复和包准入是否与源码开发环境一致。
8. GitHub/npm 名称、维护者身份、许可证及安全报告渠道。
9. 当前工作区／会话如何通过公开接口获取，切换工作区及多窗口时的事件与身份边界。
10. 普通 Remote 的实际大小／传输限制、32 MiB 导入受限解析路径和分块传输的可行性；最大合法数据能否完成导出再导入。
11. 幂等回执的具体保留期、数量／容量上限，导入暂存保留期与重启清理机制；须在 P1 定值并测试，不能发布时仍为占位要求。

## v0.2 修订记录（2026-10-28）

本节为方案决策，不是上游已提供这些能力的证据：
- 统一 JSON 导入／导出文件上限为 32 MiB，保留 20 MiB 活跃记录逻辑限额；明确普通请求、分页响应、传输块及临时空间的不同边界。
- 用来源线索与本地绑定表达跨环境引用，区分待关联、可访问、确认失效和暂不可验证；主会话改为指向本地会话引用。
- 明确 revision、持久化幂等回执、结果待确认状态以及暂存后整体提交的导入协议，规定重复导入默认阻止、显式副本不自动合并。
- 明确每窗口／每工作区的当前任务选择、主会话生命周期、冲突草稿保留和无会话资料夹的继续方式。
- P1 增加消息、文件、工作区上下文及存储原语最小探针；验收矩阵补充对应反例，Windows 首发与 Web 后续验证不再互相矛盾。
- 未重新取得上游文档内容；既有官方依据与第三方项目链接仍需固定版本复核，没有新增兼容性结论。

## 本轮完成情况

- 完成：在既有产品、架构、安全、验收与证据文档中修订上述设计缺口；保留原首版功能范围。
- 未完成：插件代码、运行测试、接口探针、兼容验证、性能测量、渗透测试、第三方独立审计。
- 未执行：安装插件、修改用户 DSH、创建远端仓库、发布 npm／GitHub Release、创建监控自动化。
