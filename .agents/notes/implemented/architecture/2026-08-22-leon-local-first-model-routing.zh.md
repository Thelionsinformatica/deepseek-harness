# Agent Note: Leon 本地优先模型路由

Status: implemented

[English](2026-08-22-leon-local-first-model-routing.md) | 中文

## 问题

Leon 是提供方中立的个人助手，而不是以 DeepSeek 为中心的产品。继承的基础组合选择了 `deepseek-official/deepseek-v4-flash`，这让一个可选的上游提供方看起来拥有 Leon 的身份，并使主要路径依赖远程服务，尽管这台 Windows 主机已经在 RTX 4070 上运行 Ollama。

## 决定

基础组合选择 `ollama/qwen3.5:9b` 作为 Leon 的默认模型及唯一自动本地模型。根据[自动路由安全限制](../bug-fix/2026-08-28-leon-automatic-routing-safety-hold.zh.md)，Ornith 与两个 Qwen 3.8 变体保持为手动目录路由。每条本地路由都通过提供方中立的 pi-ai 适配器使用 Ollama 位于 `http://127.0.0.1:11434/v1` 的回环 OpenAI 兼容端点，并公布有界的已部署容量。一个固定的非秘密授权标记满足 OpenAI 客户端库要求；Ollama 不会把它用作凭据。

Gemini 与其他远程提供方仍是由用户显式配置的路由。随附 Web 策略只能选择用户已经配置并授权的路由；它绝不嵌入或虚构凭据。原生 DeepSeek 包继续作为手动兼容选项安装，继承的包命名空间也保持不变，但其模型适配器与搜索提供方都不会挂载到 Leon 的基础组合。因此 DeepSeek 不会出现在正常的随附模型目录中，只能日后通过显式 profile 添加。

Web 检索遵循同一边界。基础组合挂载提供方中立的 Web seam，但不为模型注册 `web_search` 或 `web_fetch`，也不挂载任何搜索提供方。需要检索的部署必须显式添加一个提供方和相应工具；仅存在 DeepSeek 凭据无法激活远程请求。

Models 设置界面首先呈现活跃且无需引用的路由，然后是其他可用路由，最后才是仍需设置的可选路由。引导文字把本地模型描述为可直接使用，把远程 API 密钥描述为可选项，因此用户可见的提供方顺序与路由策略保持一致。

`$DSH_HOME/settings.yaml` 中存储的本地选择已从原来的 DeepSeek 模型迁移为 `ollama/qwen3.5:9b`。过时的提供方专用 `reasoningEffort: max` 值已移除，让本地模型可以使用自身支持的推理行为。

Web 网关通过 Qwen 推理强度层级执行确定性的会话级自适应路由。空白自动会话会在 `session.models` 报告当前状态前以最低推理强度预置 Qwen，因此新会话会明确从高效本地层级开始。简短且独立的提示词关闭推理；较长、多行、代码、技术及依赖上下文的继续请求提升到 medium；图片、超大结构化提示词、明确的高复杂度标记及自动目标轮次提升到 high。在另一轮仍在收尾时获准进入的普通 follow-up 会按 `MessageId` 保留已经解析的路由；inbox 认领会在下一次提示词组装前应用该决定，而不改变活动轮次。丢弃消息会移除尚未应用的决定，之后的手动模型选择仍具有最高优先级。Ollama 模型配置会把 `off` 明确映射到 OpenAI 兼容的 `reasoning_effort: none`，因为省略该参数可能让本地模型默认继续思考。模型选择器公开 `Leon 自动`，并在旁边显示实际选中的路由和推理强度。显式选择模型或推理强度会在该会话中停用自动化，用户可以从同一菜单重新启用。提示词只能在部署策略已命名的路由之间选择，不能自行引入 DeepSeek 或其他提供方。

外部升级由失败触发并按顺序进行。Ollama 的 `TRANSPORT`、`TIMEOUT` 或 `SERVER` 故障可以切换到回环 `freellmapi/auto`；`UNKNOWN_MODEL` 与 `NO_ADAPTER` 会在本地路由上失败关闭。若 FreeLLMAPI 或它选择的上游不可用，Leon 会绕过网关，直接切换到 `google/gemini-3.1-pro-preview-customtools`，再切换到低推理强度的 `openai/gpt-5.6-luna`。每次合格切换都会追加 `llm/failover`，成为同一请求的活动路由，并持续显示在聊天中。外部 fallback 需要逐会话显式同意。FreeLLMAPI 负责上游选择与健康，但不持有 Leon 的 persona 或本地任务分类。直接路由仍通过凭据引用配置，没有用户提供的密钥就不会生效。Web 成本投影把每个本地目录模型定价为零，并记录当前 Gemini／OpenAI 直接调用的 token 价格快照；FreeLLMAPI 因所选上游不固定而保持未定价。规范化为 `QUOTA` 的跳转会显示为额度耗尽，而不是暂时提供方中断。

OpenCode 是下属执行器，而不是另一个 Leon persona。在 Windows 上，基础组合可以通过 `dsh-subagent-acp` 挂载 OpenCode 的官方 ACP 服务器，并将其公开为显式的 `opencode` 单次委派工具。两个提供方行会保持禁用，直到启动器验证 `E:\computador\.leon` 下由安装程序持有的可执行文件与配置并设置 `LEON_OPENCODE_ENABLED=1`；因此缺失的可选运行时不会阻塞基础组合。子进程只接收独立任务与所选 workspace 路径，以 Ornith 作为主模型、Qwen 作为小模型，并只返回最终文本。其配置启用项目内编辑、shell、LSP、快照与压缩，同时拒绝外部目录访问、嵌套 Agent、commit、push、hard reset 与递归删除。Leon 仍负责判断何时适合委派，并验证返回的工作。

## 验证

Ollama 检测到 NVIDIA GeForce RTX 4070 以及已安装的 Qwen 3.5 9B 与 Ornith 工件；两者都完成了葡萄牙语 OpenAI 兼容请求。聚焦的分类器与组合包测试固定 Qwen 处理每个自动层级、有序的 Ollama 到 FreeLLMAPI 到 Gemini 到 OpenAI 链、本地配置错误失败关闭、所有本地目录价格为零、不存在 4B 路由，以及不存在默认 DeepSeek 模型与搜索行。LEON-ACC-008 记录更长的自主执行证据及其触发的安全限制，而不是把短响应完成视为资格证明。

## 考虑过的替代方案

**立即重命名所有继承的 `@deepseek-ai/*` 包。** 已否决，因为包命名空间属于兼容性与依赖图问题，而不是模型路由或产品身份。大规模重命名会带来广泛迁移风险，却不会改善 Leon 的本地执行。

**保持 DeepSeek 为默认值，并把 Ollama 描述为可选项。** 已否决，因为这与 Leon 的本地优先隐私和可用性目标相矛盾。

**把复杂工作直接发送给 Gemini。** 已否决，因为 Qwen 仍是本地 high 强度路由，可以保留隐私与零 API 成本；云端路由属于韧性 fallback，而不是任务分类层级。

## 后果

当 Ollama 与 Qwen 3.5 9B 可用时，Leon 无需云端密钥即可回答日常、技术、复杂及目标驱动请求，但这一路由事实不证明长任务质量。Ornith 与 Qwen 3.8 保持为有意的手动实验，而不是自动承诺。运行层面的本地中断可能把已准入的会话上下文与工具 schema 发送给 FreeLLMAPI 选择的上游、Gemini 或 OpenAI，并可能产生 API 成本；聊天与成本界面必须明确显示这些后果。Windows 安装程序必须启动或验证 Ollama 与仅回环地址可用的 FreeLLMAPI，确保 Qwen 3.5 9B 已安装，配置服务启动与健康检查，并明确管理远程提供方授权和预算。DeepSeek 与 Web 检索仍是手动且分别配置的兼容路径，技术性上游命名空间也可以与运行时行为分开迁移。
