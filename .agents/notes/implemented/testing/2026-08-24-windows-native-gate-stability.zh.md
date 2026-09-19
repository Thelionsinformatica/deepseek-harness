# Agent Note：Windows 原生 gate 稳定性

Status: implemented

[English](2026-08-24-windows-native-gate-stability.md) | 中文

## 问题

完整单元测试与快照 gate 在原生 Windows checkout 上无法稳定复现，尽管受影响的测试单独运行时都能通过。目录符号链接创建需要普通 Windows 安装默认不授予的权限；仅支持 Bash 的场景会在没有 Bash 时尝试启动；嵌套 JSON 文本会保留成对的 Windows 路径分隔符；不受限的 fork 或 ACP 并发会让子进程超过期限，或在同时关闭子进程时触发 libuv 的 `UV_HANDLE_CLOSING` 断言。这些宿主故障掩盖了产品回归，也使 Leon fork 无法证明干净的本地基线。

## 决定

目录链接测试在 Windows 上使用 junction，在其他宿主上继续使用符号链接。契约明确要求文件符号链接的测试只在 Windows 上跳过，并继续在非 Windows CI 中运行。快照套件与 headless 示例会探测 Bash 可用性，只跳过其已提交命令方言确实需要 Bash 的场景；原生 PowerShell 覆盖继续启用。

快照与 JSON-RPC 归一化现在同时识别 Windows cwd 的字面拼写及其 JSON 转义表示，随后只在 cwd 根路径或明确承载路径的文本中规范重复分隔符。回归测试固定了会话事件内嵌 JSON 文本中的 Windows 路径。DeepSeek Files offload 快照也只规范其 `<path>` 值。

原生 Windows 单元 gate 最多使用四个 fork worker，并采用平台专属的测试与清理期限，为 Codex、ConPTY、Git 和 SQLite fixture 保留进程余量。Windows 快照回放最多使用两个文件 worker，且每个文件内部一次只运行一个场景；其他宿主保留原有的五 worker 与文件内并发默认值。配置的快照上限现在同时控制 `maxWorkers` 与 `maxConcurrency`，与其文档声明一致。完整应用 loader 探测使用平台感知的子进程期限，可选 OpenCode 行则保持禁用，直到启动器验证运行时并显式启用。

快照 ACP 服务器也不再在 Cordis 树完成销毁后立即强制调用 `process.exit(0)`。它们会设置成功退出码，并让 Node 自然排空原生回调与异步句柄。这消除了剩余的 Windows 竞争条件：第二个串行的构建模式图片请求或持久 PowerShell 场景，不会再在某个原生句柄已经关闭时重复进入 libuv。

持久 PowerShell 包装器会在完成标记前检查控制台光标，并且只结束尚未终止的输出行。若命令使用不带换行的 `Console.Out.Write`，PowerShell 返回管道输出时 ConPTY 可能重绘该行，而面向行的捕获会把同一段可见文本保留两次。已自行结束输出行的命令仍保留原有换行契约。普通 Node 外部消费者冒烟测试在 Windows 上也改用目录 junction，因此无需 Developer Mode 或提升权限即可验证已发布包的解析契约。

完整的本地 `check:all` 图会先让原生 Windows 单元测试清单收敛，再启动同级 gate。该排序使用软 `after` 边，而不是要求成功的依赖，因此单元测试失败不会掩盖构建、快照、hygiene 或文档检查的诊断。其他平台继续并行执行 aggregate，因为其进程基础设施不会出现 Windows 的句柄冲突与子进程资源饥饿问题。

## 考虑过的替代方案

**在 Windows 上跳过所有依赖进程或快照的测试。** 已否决，因为 PowerShell、Windows 路径、junction 清理和随附 Leon 组合都是必须获得原生覆盖的产品表面。

**只提高所有超时而不限制并发。** 已否决，因为 libuv 关闭断言属于并发碰撞，而不仅是操作缓慢；无限 fork 仍可能让原本健康的子进程得不到资源。

**要求 Developer Mode 或管理员符号链接权限。** 已否决，因为目标安装器和贡献者体验必须能在普通 Windows 账户上运行；junction 无需扩大宿主权限即可覆盖目录链接行为。

**全局规范所有反斜杠。** 已否决，因为模型编写的命令、正则表达式与无关文本必须继续保持回归可见。规范化仅限已识别的生成路径。

## 后果

原生 Windows checkout 可以运行完整单元测试清单与组装后的 Leon 快照，而不会把缺失的 POSIX 能力误判为产品故障。平台专属跳过保持狭窄且显式，Linux 与 macOS 继续保留更强的符号链接和 Bash 契约。Windows gate 会更久，因为依赖大量子进程的 ACP 场景在文件内串行收敛，但结果可重复，且任何可选执行器都不会阻止基础助手启动。
