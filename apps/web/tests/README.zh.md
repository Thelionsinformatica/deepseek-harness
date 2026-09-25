# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实 Chromium 通过真实 HTTP 驱动它。该 lane
的运行机制——模式、fixture、golden，以及与 `dsh web` 之间刻意保留的组合差异——记录在
[`scaffold.ts`](scaffold.ts) 和
[浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)中。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取
Host 服务：`ctx.apiProxy`、Host 侧 `SessionStore`、`ctx.sessionProjectionCache`。运行时驱动
浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 cordis
`Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处
Host 服务访问都无法编译。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程
拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的
Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译，
于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的
import 点明源模块。这样漂移会表现为选择器未命中或镜像值过期——是响亮的失败，绝不会是静默
通过。`scaffold.ts` 按此规则镜像欢迎声明的 namespace、确认字段、版本和被断言的中文文案。

有两类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从
`@deepseek-ai/dsh-client-web` import `AppWebEntry`、从
`@deepseek-ai/dsh-client-modules/client` import boot manifest 类型：启动真实 shell 正是该
harness 的用途，且这两个包本来就在 Host 图中。另外，chat 场景从
`@deepseek-ai/dsh-client-runtime/client` import `conversationContextKey`，因为
`client/runtime` 经未拆分的 `directory-picker` 包可达，且不会再牵入别的东西。这种可达性是
偶然而非保证——一旦它离开该图，就像其余情形那样镜像该 helper。

没有任何机制强制这条规则；靠 review 守住它。

## 隔离的仪表板候选产物

`memory-capabilities.e2e.ts` 默认使用已安装的浏览器产物。如需在本地检查时保留活动服务器的 `lib/client.js`，设置 `DSH_WEB_DASHBOARD_CANDIDATE=1`。独立 Node 进程通过仓库的 `tsx/esm` 启动器，以 `write: false` 运行仪表板的真实浏览器打包配置；测试只在隔离 scaffold 的精确仪表板 URL 提供这些字节。此选项验证编译候选产物与真实 Host 组合，而非完整发布构建。默认 CI 路径仍要求最新的构建产物。两种模式均强制目录检查不调用推理，也不修改记忆。
