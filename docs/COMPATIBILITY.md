> 公开副本：仅将本机绝对路径和安装操作标识替换为占位符；原始评测保留在维护者本地项目。以下是历史评测，不代表当前安装状态。

# 兼容性核对：现有插件组合与 DSH 宿主

日期：2026-10-29（Asia/Shanghai）
对象：`dsh-task-shelf` 0.0.1-alpha.2（源码）／已安装 0.0.1-alpha.1
宿主：DSH Desktop 0.2.1-rc.3（Windows）
结论性质：**静态核对，未实机共存测试。**

## 1. 结论

1. 与本机现有插件组合**没有可预见的硬冲突**：侧栏项 id、主面板 key、Host 路由前缀、存储目录、全局 CSS、快捷键、模型／会话写入六个面都不重叠。
2. 与 DSH 宿主本身不冲突：只使用官方公开扩展点（`sidebar.panellist` 列表 + `main` keyed slot），不替换原生布局、不接管对话渲染。
3. 真正需要注意的不是“撞车”，而是三件事：**已安装的是 alpha.1（不是本工作区）**、**升级时不能双挂载**、**共存从未实测**（见第 5 节）。

## 2. 核对范围与方法

| 项目 | 内容 |
|---|---|
| 被核对对象 | 本仓库 `src/` 与打包产物 `lib/`；已安装副本 alpha.1 |
| 对照插件 | dsh-better-sidebar 0.28.0、dsh-plugin-wallpaper-engine 1.3.3、dsh-context 0.75.1、dshmarket 1.70.1、@dougen/dsh-deepseek-usage 0.15.0 |
| 对照宿主 | DSH 0.2.1-rc.3 桌面运行时；`.dev/runtime` 内同版本官方包 |
| 方法 | 读源码、读已安装插件源码与清单、读 profile 配置与安装日志；**未启动宿主实跑** |
| 未覆盖 | 真实共存交互、60 分钟持续运行、强杀／断电、macOS／Linux、其他 DSH 版本 |

## 3. 隔离点核对表

| 面 | 任务资料夹占用 | 其他占用 | 结论 |
|---|---|---|---|
| 侧栏项 id / 顺序 | `dsh-task-shelf`，`order: 80` | plugins `0`、dshmarket `1`、schedule `10` | 不撞；只表现为排在最下面 |
| 主面板 key | `main` key `dsh-task-shelf` | conversation key `conversation` | 不撞；不覆盖对话面板 |
| Host 路由 | `/api/task-shelf/` 下 8 条精确路由 | better-sidebar `/sidebar/api`，其余无此前缀 | 不撞 |
| 存储 | `$DSH_HOME/task-shelf/state.json` | 各插件各自目录 | 不撞 |
| 全局 CSS | 全部 `.ts-*`，仅三条 `body[data-ds-dark-theme] .ts-*` | wallpaper 用 `body[data-we-*]` 与 `::before` 玻璃层 | 不撞；任务资料夹不读取被改写的令牌 |
| 快捷键 | 未注册任何快捷键 | 宿主 `dsh-client-shortcuts` | 不抢绑定 |
| 会话／模型 | 只读会话标题与工作区归属；不写会话、不注册工具、不发模型请求 | agent loop | 不冲突 |

补充：`main` keyed slot 与 `sidebar.panellist`（`id` + `order` + `label`）是 DSH 官方文档声明给插件用的入口，官方 `dsh-client-ui-plugin-manager` 与 `dsh-client-ui-schedule` 用的是同一套写法。

## 4. 与各插件的具体互动

### 4.1 dsh-better-sidebar 0.28.0

- 它在右侧加一列（文件树／编辑器／改动／任务／侧聊天），有自己的 Host 路由 `/sidebar/api`，并向其他插件暴露“注册右栏页签”的服务——与任务资料夹的左侧栏入口不在同一位置，无 id 或路由重叠。
- 它自带 `beforeunload` 守卫（编辑器未保存内容）。任务资料夹在有未保存草稿或“结果待确认”时也会挂 `beforeunload`。两者不会互相取消，浏览器只弹一个通用确认框；副作用是**提示原因会变得含糊**：关窗时看到确认框，无法判断是编辑器有改动还是资料夹有草稿。
- 任务资料夹切换到自身面板时，对话视图被替换，better-sidebar 的右栏随之卸载；这是“切换面板”的正常行为，不是错误。

### 4.2 dsh-plugin-wallpaper-engine 1.3.3

- 它通过 `body[data-we-*]` 属性与 `::before` 载体给宿主已有的面（对话、输入卡、侧栏、设置窗）加液态玻璃，不改任务资料夹的选择器。
- 任务资料夹读取的是 `--dsw-bg`、`--dsw-bg-elevated`、`--dsw-text-primary`、`--dsw-text-secondary`、`--dsw-border`；DSH 的设计令牌实际叫 `--dsw-alias-*` / `--dsw-static-*`，上述变量在 0.2.1-rc.3 中不存在，因此**始终走 `var()` 的兜底值**（自有浅色／深色两套）。结论：不会被壁纸引擎的令牌改写弄坏，也不会跟着变玻璃。
- 它提供“给第三方面板补雾化选择器”的开关，但载体是 `::before` 且要求目标自身已定位（fixed/absolute）；`.ts-root` 不满足，直接填入不会产生玻璃效果。
- 视觉结果：开启壁纸／玻璃时，其他面板是磨砂，任务资料夹是一块不透明平板。属于观感不一致，不是故障。

### 4.3 dsh-context 0.75.1 / dshmarket 1.70.1 / @dougen/dsh-deepseek-usage 0.15.0

- dsh-context：注册到对话头部与右侧栏页签，读会话投影；无 `main` 面板占位，无冲突。
- dshmarket：注册自己的 `main` key（`dsh-market`）与 `sidebar.panellist` 项（`order: 1`），另有设置页；key 不同，只影响侧栏顺序。
- deepseek-usage：设置页与用量展示，未占用 `main` / `sidebar.panellist`。

## 5. 风险清单

### R1（高，已在发生）已安装的是 alpha.1，且指向旧目录

desktop profile 里 `dsh-task-shelf` 是 `link:<release-directory>/dsh-task-shelf-0.0.1-alpha.1`，而当前工作区是 `<project-directory>` 的 **alpha.2**（多出 `lib/health.js` 启动自检）。后果：

- 本工作区的任何修改都不会生效，除非重新打包并替换 link 目标。
- link 方式不解析 peer、不跟随更新（插件管理器安装日志已警告），等于一份“冻结副本”。
- 若长期两份并存，容易误判“明明改了却没变化”。

处理：确认 alpha.2 可用后，先用插件管理器移除旧条目，再指向 `dist/dsh-task-shelf-0.0.1-alpha.2/`（或直接 link 本工作区打包目录），不要两步之间留两份。

### R2（高）双挂载会让宿主启动失败

`dsh-client-connection` 对重复的精确路由直接抛错：

```text
connection: exact Fetch route "<path>" is already registered
```

dsh-better-sidebar 的 patch 注释记录过同类事故：两个 mount 注册同一前缀会让整棵插件树启动失败（“duplicate prefix route”）。任务资料夹的 8 条路由同样会被注册两次。触发条件：profile 里同时存在两条 `dsh-task-shelf`（旧 link + 新包，或 bundle 层与手写 patch 各一条）。

处理：`dsh.profile.bundles` 里只保留一条 `dsh-task-shelf`；`profiles/<name>/cordis.patch.yml` 里不要手写同名 mount。

### R3（中）版本锁得过死，DSH 升级时最先僵

本包 `engines.dsh` 与 5 个 peerDependencies 全部精确锁 `0.2.1-rc.3`。对照：better-sidebar 用 `^0.2.1-rc.1`，wallpaper 用 `>=0.1.5-rc.1`，context 用 `>=0.2.1-rc.2`，dshmarket 接受多个区间。

当前版本完全对得上，不构成冲突；但 DSH 一旦升到 0.2.2，其他插件大概率继续可用，本插件会先报不兼容或依赖缺失。升级 DSH 前应同步改宽版本区间并重跑验收。

### R4（中）共存从未实测

[docs/TEST-RESULTS.md](TEST-RESULTS.md#L26) 明确把“用户现有其他插件组合”列在“未完成”。13 项验收是在隔离宿主中完成的，不覆盖“壁纸 + 玻璃 + better-sidebar 右栏 + 市场 + 用量 + 本插件”同时加载。

## 6. 待验证清单（建议按序执行）

| # | 动作 | 通过标准 |
|---|---|---|
| 1 | 移除旧 link，改装 alpha.2，重启宿主 | 插件树无报错；侧栏出现“任务资料夹”；启动自检横幅为“通过”或无异常 |
| 2 | 新建资料夹 → 写下一步 → 保存 → 重载页面 | 内容保留；无“结果待确认”残留 |
| 3 | 关联会话、设为主会话、点“继续任务” | 跳到正确会话；better-sidebar 右栏随之正常卸载／恢复 |
| 4 | 开启壁纸与液态玻璃，进入资料夹面板 | 面板可读、不透明（预期）；无布局错位；如需要玻璃效果，记录为已知观感差异 |
| 5 | 右栏编辑器留未保存改动 + 资料夹留未保存草稿，关闭窗口 | 只弹一次通用确认；取消后两边草稿都还在；文案可接受 |
| 6 | 窄屏（< 650px）与深色主题各走一遍 | 布局单列、深色不走浅色底 |
| 7 | 连续运行 60 分钟并切换多个工作区 | 无内存／样式泄漏迹象；无重复侧栏项 |

## 7. 证据索引

本仓库（相对路径）：

- 侧栏项与主面板注册：[src/client.js](src/client.js#L200-L203)
- Host 路由注册：[src/index.js](src/index.js#L99-L101)
- 存储路径：[src/index.js](src/index.js#L94)
- 版本与 peer 锁：[package.json](package.json#L11-L13)
- CSS 作用域：[src/client.css](src/client.css#L1-L5)
- 共存未验证的原始声明：[docs/TEST-RESULTS.md](TEST-RESULTS.md#L26)

外部证据（只读参考，不在本仓库）：

```text
$DSH_HOME\profiles\desktop\package.json            # bundles 与 link: ...alpha.1
$DSH_HOME\profiles\desktop\cordis.yml              # 空根，树由补丁层组合
$DSH_HOME\profiles\desktop\cordis.patch.yml        # 无手写 dsh-task-shelf mount
$DSH_HOME\profiles\desktop\.plugin-manager\logs\operation-<redacted>\pnpm.log
                                                           # link 安装警告：peer 不从目标解析、不跟随更新
$DSH_HOME\profiles\desktop\node_modules\dsh-better-sidebar\cordis.patch.yml
                                                           # 双挂载 → duplicate prefix route 注释
$DSH_HOME\profiles\desktop\node_modules\dsh-better-sidebar\lib\client.js:29032
                                                           # 自带 beforeunload 守卫
$DSH_HOME\profiles\desktop\node_modules\dshmarket\client\client.js:16689-16705
                                                           # main key dsh-market / sidebar order 1
<DSH-install-directory>\resources\app.asar\dsh\package.json:4  # 宿主版本 0.2.1-rc.3
```

以下在 `.dev/runtime`（已安装的 0.2.1-rc.3 官方包）中核对：

- 重复精确路由抛错：`@deepseek-ai/dsh-client-connection/lib/index.js:848`
- 侧栏契约（id 寻址 main keyed slot）：`@deepseek-ai/dsh-client-ui-sidebar/README.zh.md:38-40`
- 官方同款写法：`dsh-client-ui-plugin-manager`（main key `plugins`、order `0`）、`dsh-client-ui-schedule`（order `10`）
- 对话面板 key：`dsh-client-ui-conversation/lib/client.js:20219-20227`
- 设计令牌命名：`dsh-client-ui-theme/lib/client.js`（`--dsw-alias-*` / `--dsw-static-*`，无 `--dsw-bg`）

## 8. 结论边界

本文件是**静态核对**，不是兼容性证明。它回答的是“代码层面有没有可预见的冲突”，答案是“没有”；它不回答“这套组合一起跑会不会出问题”，那需要第 6 节的实测。在实测通过前，不应对外宣称“已兼容现有插件组合”。
