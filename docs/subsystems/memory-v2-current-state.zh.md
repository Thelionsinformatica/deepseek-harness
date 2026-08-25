# 记忆 V2 计划 — 当前状态（Leon 基线）

[English](memory-v2-current-state.md) | 中文

## 1) 当前状态诊断

- 当前分支：`leon/identity-pt-br`（`git branch --show-current`）。
- 本地应用端点：`http://127.0.0.1:3080/`。
- 记忆核心已经存在并可用，采用提供方中立、限定于工作区的架构：
  - `ctx.memory` 服务接缝：[`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
  - 本地提供方：[`packages/memory/memory-local/src/index.ts`](../../packages/memory/memory-local/src/index.ts)
  - 工具与回忆消费方：[`packages/memory/tool-memory/src/index.ts`](../../packages/memory/tool-memory/src/index.ts)
  - 共享类型：[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)
- Leon preset 具有由配置控制的自动记忆：
  - [`apps/cli/config/agent-presets/leon/agent.cordis.yml`](../../apps/cli/config/agent-presets/leon/agent.cordis.yml) 中的 `automaticRecall: true`、`recallLimit: 4`、`recallMaxChars: 4000` 与确定性最终排序权重

## 2) 当前测试覆盖率

- 当前计数：记忆范围内有 **9 个 `.spec.ts` 文件**和 **128 个运行时用例**，另有审查面板浏览器组件用例。
- 已覆盖范围：
  - `memory.spec.ts` 中的提供方选择、内容规范化、遥测与核心验证。
  - 两个 `memory-local` suite 覆盖本地隔离、持久性、修订处理、阻止事件遥测、语义配置边界、词法回退和同义召回。
  - 真实 Loader 组合同时覆盖仅审查候选提取和需显式启用的混合语义检索。
  - 真实代理流程中的显式操作、只读自动回忆、影子候选项持久化与敏感数据阻止。
  - 确定性策略决策，包括阻止、拒绝、确认与存储路径。
- 已识别缺口：
  - 尚无覆盖长期回归、性能与已生成跨作用域安全场景的专用 LEON-EVAL 套件。
  - 尚无可执行的 LEON-EVAL-PTBR 场景套件。

## 3) 当前状态与记忆 V2 的差异

- 已实现：
  - 通过 `memory_*` 工具实现限定于工作区的显式记忆。
  - 通过 `MEMORY_SENSITIVE_CONTENT` 提供针对显式凭据的基础保护。
  - 通过 `agent/pre-step` 执行只读自动快照检索。
  - 对显式或稳定的人类陈述执行选择加入的本地影子提取，不写入持久记忆。
  - 在 `memory_candidate.candidates` 中持久化影子候选项，包含置信度、分数、插入与敏感信息省略元数据。
  - 确定性的提取候选策略，覆盖 `block`、`reject`、`shadow`、`confirm` 以及仅供审查的 `store`，并具有 `policyVersion`、`policyDecision` 与 `policyReason` 可追踪性。
  - 审查词汇与持久审查字段，包括 `reviewed`、`reviewDecision`、`reviewedAt` 与 `reviewedBy`。
  - 会话头部审查面板只列出当前 workspace 分区，并记录不可变的批准或拒绝决定，不写入最终记忆。
  - 面向浏览器的安全 Remote 投影会省略内部 workspace 与所有者标识符。
  - 操作员明确批准后才允许最终受控写入，并由总开关以及精确的用户与 workspace 允许列表共同门控，同时持久记录 `skipped`、`writing`、`stored` 或 `failed` 状态。
  - 通过仅允许回环地址的 Ollama 与 `nomic-embed-text:latest` 提供可选的本地混合语义检索；在 embedding 前执行 workspace 过滤，并带有有界临时缓存、不含正文的指标和确定性词法回退。
  - 显式搜索与自动回忆共享一个确定性最终排序，包含提供方输出验证、id 去重、可配置的相关性、新近程度、importance 与确认权重、有界的额外候选获取，以及提供方分数回滚。
  - 安全的自动上下文组合器，包含 workspace 与敏感内容复查、id 去重、来源标注、严格字符预算和 `instructionAuthority: none`。
  - Schema V2 时间谱系，包含激活、过期、`supersedes`、`supersededBy`、默认仅活动检索、显式审计历史、本地原子修订保留，以及 `historyMode: v1` 回滚。
  - 工作区隔离，以及纠正与遗忘时的修订检查。
- V2 尚未实现：
  - 用于更改自动写入允许列表的设置 UI；随产品提供的 Host 组合仍默认关闭。
  - 整个会话范围内基于精确 tokenizer 的计费；当前自动快照使用确定性的严格字符预算。
  - 可执行的 LEON-EVAL-PTBR 套件。

## 4) 必须保持为约定的现有依赖项

- `@deepseek-ai/dsh-tool-memory` 将 `@deepseek-ai/dsh-memory` 声明为 peer 约定，并消费提供方中立的 `ctx.memory` 接缝。
- `@deepseek-ai/dsh-memory-local` 使用 `ctx.storageDomain` 保存持久本地状态。
- Leon preset 必须让记忆保持可选，以便不带记忆的 headless profile 继续有效。
- 此基线没有更改 Gemini 密钥，本阶段不得调整这些密钥。

## 5) 当前基线风险

- 九个聚焦记忆套件在 Windows 上通过，且不需要环境特定的前置条件。
- 仓库级 `check:all` 门禁也在 Windows 上通过；后续记忆 V2 阶段必须让聚焦覆盖与全局覆盖都保持绿色。

## 6) V2 里程碑交付项

1. 整合后的目标架构文档：已完成。
2. 事件层与确定性决策策略：初始实现已完成。
3. 影子模式与人工批准：本地提取、遥测、审查字段和操作员决策 UI 已完成；最终记忆写入仍有意保持禁用。
4. 混合检索、安全上下文组合和时间历史：已实现；语义检索仍保持默认关闭，等待评估。
5. 具有客观标准的 LEON-EVAL-PTBR：规范已存在；可执行套件仍待完成。
6. 可逆迁移与回滚计划：已记录。
