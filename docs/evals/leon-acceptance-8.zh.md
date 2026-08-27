# LEON-ACCEPTANCE-8

[English](leon-acceptance-8.md) | 中文

## 目的

LEON-ACCEPTANCE-8 是一个只在本地运行的端到端基准，用于验证一次有边界的自主工程流程。它与 LEON-ACCEPTANCE-7 中的单答案用例不同：基准会驱动真实的 headless Leon AgentLoop、ToolRuntime、文件系统工具、todo 工具和 shell 工具，完成规划、多文件实现、测试执行、确定性故障注入、诊断、修复和宿主验证的完成流程。

基准不信任 Leon 的最终文字声明。判定来自持久化的 `tool/call` 与 `tool/result` 事件、受保护文件的哈希、三次由宿主持有的隐藏预言机运行、精确的本地路由证据，以及与通过预言机绑定的最终源码摘要。

## 前置条件

- 构建仓库，确保 `apps/cli/lib/bin.js` 与 workspace 包库已经存在。
- 在字面回环端点 `http://127.0.0.1:11434` 上运行 Ollama。
- 在 Ollama 中安装精确模型 id `qwen3.5:9b` 和 `ornith-1.5:9b`。
- 使用 Node.js 22.19 或更高版本。fixture 只使用 Node 内置测试运行器，不安装任何依赖。

运行前确认模型 id：

```sh
ollama list
```

## 运行基准

```sh
pnpm exec tsx scripts/run-leon-acceptance-8.ts
```

默认脱敏产物为 `.artifacts/leon-acceptance-8/latest.json`。可用 `--output <path>` 选择其他位置。`--implementation-model` 和 `--recovery-model` 可选择其他已安装的本地模型 id；`--ollama-url` 只接受位于字面 `127.0.0.1` 或 `[::1]` 且不含凭据的 HTTP 端点。

## 执行阶段

1. 宿主在临时目录中创建一个无需依赖的项目 fixture。`TASK.md`、`package.json` 和可见测试是不可变证据输入。
2. 第一个全新 headless Leon runtime 使用实现模型。其第一个工具必须是至少含五个步骤的 `todo_write`；它必须修改至少两个必需源码文件，并成功运行精确命令 `node --test`。
3. 位于 Leon workspace 之外的隐藏测试验证舍入、折扣边界、精确报表格式及输入不变性。宿主将结果绑定到精确源码哈希。
4. 宿主只把 `src/currency.mjs` 替换为已知舍入回归。隐藏测试此时必须失败，以证明预言机确实能发现被注入的缺陷。
5. 第二个全新 headless Leon runtime 在当前 workspace 上使用恢复模型。它必须先运行 `node --test` 并观察失败，然后检查、诊断、修复，再成功运行同一精确命令。
6. 宿主再次运行隐藏预言机。只有结果通过并绑定到最终源码哈希、受保护文件未改变且没有意外特殊文件系统条目时，基准才批准。

## 仅本地与隔离保护

- 子进程接收环境变量白名单，而不是父进程的完整环境。支持的 Anthropic、DeepSeek、Gemini、Google、NVIDIA、OmniRoute 和 OpenAI 凭据变量在结构上不存在，代理变量也不存在。
- 启动目录和两个 DSH home 都是临时目录，其中没有继承的 `.env` 或 settings 文件。
- 每个阶段的模型目录只包含一个 Ollama 路由。settings、credentials、web、jobs、skills、code runtime、goals、workflows、Ralph、OpenCode 和进程内 subagent 均被禁用。
- 会话使用 `workspace-write`，并禁用批准提示。fixture 之外的修改会被文件系统 sandbox 拒绝；任何解析到 workspace 之外的文件工具参数也会使证据门失败。
- 唯一接受的 shell 命令是精确的 `node --test`。其他 shell 命令或任何未批准工具名都会使本次运行失败。
- 隐藏预言机写在 workspace 之外，模型既不会收到其路径，也不会收到其内容。

## 判定与预算

只有全部阶段都得到证明时，运行才通过。每个阶段限制为一个 turn、30 个模型 step、80 次工具调用、250,000 个输入 token、50,000 个输出 token和 15 分钟。墙钟限制会终止子进程；其余预算从持久化会话日志中评估，超出时结果失败。

基准还会拒绝非本地或非预期模型路由、缺失或伪造的预言机与源码绑定、哈希不同于规范回归的宿主注入、受保护文件变化、特殊文件系统条目、外部路径引用，以及恢复模型没有先观察失败测试再执行后续通过测试或缺少最终宿主预言机的完成声明。

## 产物与保密性

runner 会在删除临时 fixture、两个 DSH home 和原始会话日志之后，原子写入脱敏 JSON 产物。它保留模型 id 与 Ollama 摘要、数字化的时间和 token 证据、相对源码名称及 SHA-256 哈希、工具和测试序号、阶段布尔值、稳定失败代码，以及 stdout、stderr 和完成文本的哈希。

它不会保留提示词、源码内容、模型响应、工具参数或结果、临时绝对路径、凭据、隐藏预言机文本或堆栈。该产物证明基准判定；它不是对话记录，也不是提供方发票。

## 解释限制

故障由宿主在两个全新 headless 会话之间刻意注入。这证明故障检测、模型切换后的 workspace 状态连续性、真实工具执行和已验证修复，但不证明一个不中断的 Leon 会话发现了自然产生的缺陷，也不证明同一会话的 runtime 恢复。

一个小型订单汇总 fixture 是有边界的工程基准，不是任意多小时或多月自主性的证明。单次通过也不能建立统计稳定性。当模型输出方差重要时，应重复命令并比较产物；模型权重、量化、Ollama 版本、硬件和温度状态都会改变延迟与行为。

隐藏预言机是确定性的，但刻意只覆盖 fixture 的产品契约。通过它不代表任意生成代码都安全。基准只在文件工具参数保持在 fixture 内时允许本地文件读取，但它不是操作系统虚拟机或恶意软件 sandbox。

实现决策和被拒绝的替代方案记录在 [LEON-ACCEPTANCE-8 Agent Note](../../.agents/notes/implemented/testing/2026-08-26-leon-acceptance-8.zh.md) 中。
