# 参与贡献

欢迎提交使用反馈、复现步骤和 Pull Request。当前为 DSH Task Shelf 1 · 1.0.1 大肥鱼主题（包版本 1.0.1），目标宿主仅 DSH 0.2.1-rc.3。

## 本地开发

使用 Node.js 22 或以上版本。运行 `node scripts/build.mjs` 构建；测试使用 `node --test tests/*.test.mjs`，打包使用 `node scripts/pack.mjs`。测试需要安装 package.json 声明的官方 peer 依赖；可在开发目录运行 `npm install`。`private: true` 用来阻止误发 npm，不影响 GitHub 开源。

浏览器集成测试另外需要 Playwright 和同版本 DSH 运行时。Windows 开发环境可设置 `DSH_ASAR` 为已安装 DSH 的 app.asar，运行 `node scripts/runtime-file.mjs --extract` 提取到忽略目录 `.dev/runtime`，再运行 `node scripts/start-test-host.mjs`。另一个终端运行相应的 `scripts/browser-*.mjs`；脚本使用 Edge。Playwright 可安装到开发环境，或以 `PLAYWRIGHT_PATH` 指向已安装模块。只使用隔离的合成测试数据。

## 提交变更

- 说明用户遇到的问题、修改后的行为和实际执行的验证。
- UI 修改附合成内容截图；数据格式或模型调用变化说明兼容性、费用与回退影响。
- 不提交 `.dev`、用户配置、真实聊天、导出备份、认证 URL 或密钥。
- 使用官方扩展接口，不通过篡改宿主或绕过版本检查实现兼容。
- 提交的贡献按本仓库 MIT 许可证提供；第三方素材保留其来源与许可。

普通反馈使用仓库 Issues；无需公开完整聊天或任务备份。若发现安全问题，优先查看仓库 Security 页是否提供私密报告入口；不要在公开 Issue 中粘贴可用凭据或个人数据。
