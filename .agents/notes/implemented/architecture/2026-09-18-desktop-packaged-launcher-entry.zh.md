# Agent Note: 打包桌面产物启动已验证的部署

Status: implemented

[English](2026-09-18-desktop-packaged-launcher-entry.md) | 中文

## 问题

[Electron 桌面外壳](2026-09-16-electron-desktop-shell.zh.md) 将 `src/main.ts` 作为打包入口：一个在 Electron 主进程内导入 `@deepseek-ai/dsh/desktop` 并启动 Cordis `web` 配置的进程内宿主。打包产物无法执行该入口。三个相互独立的约束共同构成该失败：

- Electron 的 ESM 加载器不解析 `app.asar` 内部的导入。asar 补丁仅覆盖 `require`（CJS）；对归档内相对文件和裸说明符的 `import` 会落到真实文件系统并失败。同一目录树解压后可正常运行；同样的字节放入 `app.asar` 则在用户代码执行前退出。
- electron-builder 的默认 fuse `OnlyLoadAppFromAsar` 阻止回退到普通的 `resources/app` 目录。
- 在 pnpm 下，electron-builder 不会打包 Cordis 插件图的 peer 依赖闭包；即使入口被 bundler 内联，也无法触达动态解析的 workspace 包。

## 决策

打包的 Windows 产物以 `src/local-main.ts` 作为 `main` 入口：一个轻量启动器，调用现有部署的 `Iniciar-Leon.ps1`（`$env:LEON_ROOT`，默认 `D:\Leon`）并带 `-NoOpen`，然后在同样加固的 `BrowserWindow`（`contextIsolation`、无 Node 集成、沙箱渲染进程）中加载 `http://127.0.0.1:3080`。`src/main.ts` 保留为进程内宿主的开发入口；打包外壳不再尝试它。

`tsdown` 对每个入口单独构建，使 rolldown 内联共享 chunk；启动器仅导入 `electron` 与 Node 内建模块——这是该 Electron 版本中唯一能在 `app.asar` 内存活的导入形态。`packages/bundle/base/cordis.patch.yml` 在 `process.argv[1]` 为 `undefined` 时禁用 `cordis-plugin-hmr`，使无脚本路径的打包上下文不会因缺少监视目标而崩溃。

启动失败会向 Electron `userData/desktop.log` 写入经净化的生命周期记录，并在弹出对话框前将嵌套的 `AggregateError`/`cause` 链展平；日志不包含对话内容或凭据。

## 已考虑的替代方案

**拒绝将整个 Cordis 运行时 bundler 进 asar。** 插件图在加载时动态解析 workspace 包；pnpm 不会为 electron-builder 物化该闭包，且无论暂存哪些包，归档内的 ESM 解析都会失败。

**拒绝通过禁用 `OnlyLoadAppFromAsar` 运行目录模式。** 这会削弱完整性 fuse，仅为绕过插件加载器并不支持的打包模型。

## 后果

打包产物是启动器而非自包含安装：它要求已存在的 `D:\Leon` 部署，并共享该部署的设置、会话与凭据。这逆转了 [Electron 桌面外壳](2026-09-16-electron-desktop-shell.zh.md) 中早先拒绝子进程决策的打包入口部分；进程内设计在开发中仍然成立。在 Authenticode 密钥就绪之前，发布产物均为未签名，且必须如此标注。

## 验证

`apps/desktop` 中的 `pnpm run package` 生成 NSIS 与 portable x64 产物。冒烟验证启动打包后的 `Leon.exe`，确认窗口标题为 `Leon — The Lions Informática`，从 `127.0.0.1:3080` 收到 HTTP `200`，并通过 `leon-windows` UIA 连接器截取窗口。对每个发布二进制执行 `Get-AuthenticodeSignature` 均报告 `NotSigned`；`SHA256SUMS.txt` 与产物一并生成。

`.github/workflows/desktop-release.yml` 在 Windows runner 上为每个触及 `apps/desktop` 的 pull request 构建并冒烟测试产物；向 GitHub Releases 的发布是经 `desktop-release` environment 的手动 `workflow_dispatch`。publish job 在创建 release 前重新验证每个二进制的 Authenticode 状态与清单一致。
