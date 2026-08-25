# Agent Note: Leon 本地优先模型路由

Status: implemented

[English](2026-08-22-leon-local-first-model-routing.md) | 中文

## 问题

Leon 是提供方中立的个人助手，而不是以 DeepSeek 为中心的产品。继承的基础组合选择了 `deepseek-official/deepseek-v4-flash`，这让一个可选的上游提供方看起来拥有 Leon 的身份，并使主要路径依赖远程服务，尽管这台 Windows 主机已经在 RTX 4070 上运行 Ollama。

## 决定

基础组合选择 `ollama/qwen3.5:9b` 作为 Leon 默认的日常模型，并加入 `ollama/ornith-1.5:9b` 作为本地编程与 Agent 专家。两者都通过提供方中立的 pi-ai 适配器使用 Ollama 位于 `http://127.0.0.1:11434/v1` 的回环 OpenAI 兼容端点，并公布适合这台 RTX 4070 部署的有界容量。一个固定的非秘密授权标记满足 OpenAI 客户端库要求；Ollama 不会把它用作凭据。

Gemini 与其他远程提供方仍是由用户显式配置的路由。随附 Web 策略只能选择用户已经配置并授权的路由；它绝不嵌入或虚构凭据。原生 DeepSeek 包继续作为手动兼容选项安装，继承的包命名空间也保持不变，但其模型适配器与搜索提供方都不会挂载到 Leon 的基础组合。因此 DeepSeek 不会出现在正常的随附模型目录中，只能日后通过显式 profile 添加。

Web 检索遵循同一边界。基础组合挂载提供方中立的 Web seam，但不为模型注册 `web_search` 或 `web_fetch`，也不挂载任何搜索提供方。需要检索的部署必须显式添加一个提供方和相应工具；仅存在 DeepSeek 凭据无法激活远程请求。

Models 设置界面首先呈现活跃且无需引用的路由，然后是其他可用路由，最后才是仍需设置的可选路由。引导文字把本地模型描述为可直接使用，把远程 API 密钥描述为可选项，因此用户可见的提供方顺序与路由策略保持一致。

`$DSH_HOME/settings.yaml` 中存储的本地选择已从原来的 DeepSeek 模型迁移为 `ollama/qwen3.5:9b`。过时的提供方专用 `reasoningEffort: max` 值已移除，让本地模型可以使用自身支持的推理行为。

Web 网关会在两个本地角色之间进行确定性的会话级自适应路由。空白自动会话会在 `session.models` 报告当前状态前以最低推理强度预置 Qwen，因此新会话会明确从高效本地层级开始。简短且独立的提示词保持 Qwen 并关闭推理；较长、多行、代码、技术及依赖上下文的继续请求保持 Qwen 并把推理强度提升到 medium。图片、超大结构化提示词、明确的高复杂度标记及自动目标轮次使用 high 强度的 Ornith。Ollama 模型配置会把 `off` 明确映射到 OpenAI 兼容的 `reasoning_effort: none`，因为省略该参数可能让本地模型默认继续思考。模型选择器公开 `Leon 自动`，并在旁边显示实际选中的路由和推理强度。显式选择模型或推理强度会在该会话中停用自动化，用户可以从同一菜单重新启用。提示词只能在部署策略已命名的路由之间选择，不能自行引入 DeepSeek 或其他提供方。

外部升级由失败触发并按顺序进行。第一个不可用的 Ollama 请求切换到回环 `omniroute/auto`；若 OmniRoute 或它选择的上游不可用，Leon 会绕过网关，直接切换到 `google/gemini-3.6-flash`，再切换到 `openai/gpt-5.6-terra`。每次合格切换都会追加 `llm/failover`，成为同一请求的活动路由，并持续显示在聊天中。在已配置远程路由时启用 Leon 自动模式，即表示部署所有者授权该回退，包括带图片的会话；要求更严格的部署可将替代路由标记为外部驻留，以拒绝图片的自动外传。OmniRoute 负责提供方健康、上游选择、配额及自身用量账本，但不持有 Leon 的 persona 或本地任务分类。直接路由仍通过凭据引用配置，没有用户提供的密钥就不会生效。Web 成本投影把两个本地模型定价为零，并记录当前 Gemini／OpenAI 直接调用的 token 价格快照；OmniRoute 的可变路由成本保留在它自己的权威账本中，而不是被猜成固定模型价格。

OpenCode 是下属执行器，而不是另一个 Leon persona。在 Windows 上，基础组合可以通过 `dsh-subagent-acp` 挂载 OpenCode 的官方 ACP 服务器，并将其公开为显式的 `opencode` 单次委派工具。两个提供方行会保持禁用，直到启动器验证 `E:\computador\.leon` 下由安装程序持有的可执行文件与配置并设置 `LEON_OPENCODE_ENABLED=1`；因此缺失的可选运行时不会阻塞基础组合。子进程只接收独立任务与所选 workspace 路径，以 Ornith 作为主模型、Qwen 作为小模型，并只返回最终文本。其配置启用项目内编辑、shell、LSP、快照与压缩，同时拒绝外部目录访问、嵌套 Agent、commit、push、hard reset 与递归删除。Leon 仍负责判断何时适合委派，并验证返回的工作。

## 验证

Ollama 检测到 NVIDIA GeForce RTX 4070 和已安装的 Qwen 3.5 9B 模型。官方 `ornith-1.5:9b` Ollama 工件已拉取，并通过 OpenAI 兼容端点正常完成葡萄牙语请求及带 `reasoning_effort: high` 的请求。OmniRoute 3.8.49 与 OpenCode 1.18.21 安装在 `E:\computador\.leon\tools` 下；OmniRoute 运行于 `127.0.0.1:20128`，其健康与存储诊断均无失败。聚焦的分类器与组合包测试固定 Qwen 处理 fast／main 工作、Ornith 处理 expert／goal-round 工作、有序的 Ollama 到 OmniRoute 到 Gemini 到 OpenAI 链、零本地价格、直接 GPT-5.6 Terra 价格快照、不存在随附的 4B 路由，以及不存在默认 DeepSeek 模型与搜索行。真实付费的 OmniRoute、Gemini 或 OpenAI 请求仍是受凭据与预算门控的部署检查。

## 考虑过的替代方案

**立即重命名所有继承的 `@deepseek-ai/*` 包。** 已否决，因为包命名空间属于兼容性与依赖图问题，而不是模型路由或产品身份。大规模重命名会带来广泛迁移风险，却不会改善 Leon 的本地执行。

**保持 DeepSeek 为默认值，并把 Ollama 描述为可选项。** 已否决，因为这与 Leon 的本地优先隐私和可用性目标相矛盾。

**复杂工作在尝试本地专家前直接发送给 Gemini。** 已否决，因为 Ornith 提供了专门的本地编程／Agent 层级，可保留隐私并避免 API 成本。确定性分类仍会在执行前提升复杂工作，但现在是从 Qwen 提升到 Ornith；云端路由属于韧性后备。

## 后果

当 Ollama 与两个 9B 本地模型可用时，Leon 无需云端密钥即可回答日常、技术、复杂及目标驱动请求。移除 4B 选项可避免把任务路由到较弱的本地模型，而 Qwen 与 Ornith 的分工提供了真正有意义的能力层级。本地中断可能把已准入的会话上下文与工具 schema 发送给 OmniRoute 选择的上游、Gemini 或 OpenAI，并可能产生 API 成本；聊天与成本界面必须明确显示这些后果。Windows 安装程序必须启动或验证 Ollama 与仅回环地址可用的 OmniRoute，确保两个本地模型均已安装，配置服务启动与健康检查，并明确管理远程提供方授权和预算。DeepSeek 与 Web 检索仍是手动且分别配置的兼容路径，技术性上游命名空间也可以与运行时行为分开迁移。
