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
  - [`apps/cli/config/agent-presets/leon/agent.cordis.yml`](../../apps/cli/config/agent-presets/leon/agent.cordis.yml) 中的 `automaticRecall: true`、`recallLimit: 4` 与 `recallMaxChars: 4000`

## 2) 当前测试覆盖率

- 记忆范围内的测试文件：
  - `packages/memory/memory/tests/memory.spec.ts`（7 个用例）
  - `packages/memory/memory-local/tests/memory-local.spec.ts`（7 个用例）
  - `packages/memory/tool-memory/tests/extractor.spec.ts`（4 个用例）
  - `packages/memory/tool-memory/tests/integration.spec.ts`（8 个用例）
  - `packages/memory/tool-memory/tests/loader-composition.spec.ts`（1 个用例）
  - `packages/memory/tool-memory/tests/policy.spec.ts`（10 个用例）
- 当前计数：记忆范围内有 **6 个 `.spec.ts` 文件**和 **37 个运行时用例**。
- 已覆盖范围：
  - `memory.spec.ts` 中的提供方选择、内容规范化、遥测与核心验证。
  - `memory-local.spec.ts` 中的本地隔离、持久性、修订处理与阻止事件遥测。
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
  - 工作区隔离，以及纠正与遗忘时的修订检查。
- V2 尚未实现：
  - 面向操作员的候选项人工审查与决策面板或流程。
  - 最终验证后，由 `store` 或 `confirm` 决策触发的自动写入。
  - 具有有效性与跨时间元数据控制的本地语义检索。
  - 具有去重与每会话 token 计费能力的安全上下文组合器。
  - 可执行的 LEON-EVAL-PTBR 套件。

## 4) 必须保持为约定的现有依赖项

- `@deepseek-ai/dsh-tool-memory` 将 `@deepseek-ai/dsh-memory` 声明为 peer 约定，并消费提供方中立的 `ctx.memory` 接缝。
- `@deepseek-ai/dsh-memory-local` 使用 `ctx.storageDomain` 保存持久本地状态。
- Leon preset 必须让记忆保持可选，以便不带记忆的 headless profile 继续有效。
- 此基线没有更改 Gemini 密钥，本阶段不得调整这些密钥。

## 5) 当前基线风险

- 六个聚焦记忆套件在 Windows 上通过，且不需要环境特定的前置条件。
- 仓库级 `check:all` 门禁也在 Windows 上通过；后续记忆 V2 阶段必须让聚焦覆盖与全局覆盖都保持绿色。

## 6) V2 里程碑交付项

1. 整合后的目标架构文档：已完成。
2. 事件层与确定性决策策略：初始实现已完成。
3. 影子模式与人工批准：本地提取、遥测和审查字段已存在；操作员 UI 仍待完成。
4. 混合检索与安全上下文组合：待完成。
5. 具有客观标准的 LEON-EVAL-PTBR：规范已存在；可执行套件仍待完成。
6. 可逆迁移与回滚计划：已记录。
