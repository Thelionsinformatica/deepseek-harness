# headless-agent

[English](README.md) | 中文

本目录负责 headless coding agent（智能体）的回放和真实模型测试组装：DeepSeek V4 + 本地 bash 与文件系统工具 + subagent 委托 + 工作流与全新 agent Ralph 迭代 + `todo_write` + JSONL 持久化。本目录显式挂载共享 agent 主干、一个根 agent、持久化和检查点策略；它不是第二个产品入口。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

产品命令是 [`dsh --profile headless`](../../apps/cli/README.zh.md)：它接受一项非空任务，创建并持久化新会话，打印最终 assistant 文本，然后退出。

快照套件通过 [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts) 运行本目录的配置。这个未导出且仅供测试使用的进程会在结果记录之前，以 JSONL 发出规范会话事件。该事件流属于测试基础设施，不是受支持的 CLI（命令行界面）输出格式。子会话只通过父会话的工具事件和结果对外显示。

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) 使用一个共享 E2B 沙箱替换本地文件系统与子进程提供方，同时保留 `dsh-bash-local` 和相同的面向模型工具。请在 git 忽略的根目录 `.env` 中，将 `E2B_API_KEY` 与 `DEEPSEEK_API_KEY` 放在一起，然后运行凭据门控的实机组合测试；它在同一个沙箱中驱动 FS、Bash、PTY 和 LSP，并证明沙箱最终被删除：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

该 overlay 会在沙箱中创建相同的绝对 cwd，但不会上传或挂载宿主工作区。文件与 Bash 变更只存在于 E2B；Cordis、模型调用、agent／会话状态、会话日志、skill（技能）和 SDK 缓冲仍在宿主上。该组合会在超时和资源释放时终止其沙箱。它是提供方组合 POC，而不是完整 harness 迁移或工作区同步功能。

## 高级配置

[`advanced.cordis.yml`](advanced.cordis.yml) 在测试组装中添加 Code Mode 和 Cordis 工具。

## 宿主绑定的集体实验室

[`collective-host.cordis.yml`](collective-host.cordis.yml) 是实验性的导入幂等性演示：Lead、一名调查者和一名审核者使用独立原生会话，每次仅进行一次推理。宿主在推理前持久化其功能身份。限制为 48 次调用和 15 分钟，包括最后八次审核者专用调用。这不会启用正常配置，也不提供通用编程任务。

调用 [CLI 运行时桥接](../../apps/cli/README.zh.md) 前，请确认本地 llama.cpp 服务器在 `127.0.0.1:8097` 提供 `qwen3.5:4b` 别名。该别名不要求 Ollama。配置不授予 shell、任意文件访问、记忆提升或云端回退。请使用新的空任务目录。宿主复用原生任务和同伴证据，不会为了通过审核而关闭未完成工作。即使产物通过，受阻任务仍保持受阻。

运行器通过 stdin 接受 `status`、`pause` 和终止性的 `stop`。退出后，相同运行时、配置和目录支持 `status`、`stop`，以及在原始截止时间内显式 `resume` 已暂停任务。单次运行内，除非产物、任务或协作证据发生变化，否则重复交接请求会被抑制。遗留所有者锁需要检查进程，不能自动删除。正常配置保持不变；退出实验室并使用正常启动器即可返回。

[`collective-host-v2.cordis.yml`](collective-host-v2.cordis.yml) 是独立变体，保持相同提示词、模型路由、限制和最终验证器。它为宿主绑定审核者的任务完成添加准入检查：对当前摘要的成功验证必须发生在收到同伴证据之后。过早的完成请求返回可操作错误，不改变任务。此变体不会替换历史结果。成功完成的冒烟测试不验证冷启动恢复时待处理收件箱的保留，也不验证跨进程交接去重。
