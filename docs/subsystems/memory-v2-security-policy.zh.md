# 记忆 V2 — 安全与合规策略

[English](memory-v2-security-policy.md) | 中文

## 原则

1. 未经明确同意，不自动向外部模型发送个人数据。
2. 每次搜索、决策或写入之前都强制执行 `workspaceId` 隔离。
3. 不在 LLM 响应中暴露敏感数据或内部 `workspaceId` 值。
4. 确定性策略始终覆盖概率性决策。

## 策略模块

### 绝对阻止

- 密码、令牌、密钥、Cookie、环境秘密，以及被识别为凭据的片段。
- 绝不通过 `memory_remember` 或 `memory_update` 持久化这些内容。
- 在写入前和回忆期间运行 `looksSensitive` 或脱敏器。

## 确定性决策矩阵（已为影子追踪实现）

| 输入 | 规则 | 决策 |
|---|---|---|
| 没有结果（`total === 0`） | 没有连续性证据 | `reject` |
| 所有结果都被过滤（`inserted === 0`） | 没有可用候选项 | `reject` |
| 查询包含显式凭据模式 | 泄漏风险 | `block` |
| 低置信度（`confidence < 0.30` 或 `topScore < 0.35`） | 统计证据不足 | `reject` |
| 文本包含密码、密钥、令牌、财务或个人数据等敏感词 | 需要人工审查 | `confirm` |
| 高置信度、高分且数据量可控 | 足够稳定，可供未来自动存储 | `store` |
| 其他模糊情况 | 不自动决策 | `shadow` |

## 项目中记录的追踪信息

- 每个 `memory/candidate` 事件都包含：
  - `policyVersion`（`1`）
  - `policyDecision`（`block|reject|shadow|confirm|store`）
  - `policyReason`
- 事件和持久候选记录会存储 `queryLength`，绝不存储临时查询文本。
- 持久 `memory_candidate.candidates` 域包含相同字段，用于审查与回放。

### 强制确认

- 敏感个人、财务与医疗数据；人际关系；永久指令；以及作用域迁移。
- 需要用户在界面或工作流中明确确认。

### 允许的自动存储

- 仅在策略给出肯定决策、置信度高且类别稳定之后。
- 示例包括已确认的技术决策、非敏感配置或可重复的工作流程。

### 决策记录

- 每个候选项都会产生：
  - `candidate_id`
  - 策略版本
  - 原因（`policy_reason`）
  - 数据源
  - 决策（`shadowed`、`confirmed`、`stored` 或 `rejected`）
  - `confidence`、`importance` 与 `sensitivity`
  - 内部 `workspaceId` 与 `userId`
  - 时间戳

## 云端隐私与授权

- 升级到 Gemini 的策略必须要求逐操作同意，并说明作用域与成本。
- 默认不得向外部提供方发送回忆或决策记忆。

## 策略版本控制

- 每次规则变更都会获得一个 `policyVersion`，例如 `v1` 或 `v2`。
- 每个决策都会持久化所应用的版本，以支持回放与回滚。

## 安全失败（严重性状态）

- `cross_workspace_hit`：严重失败。
- `unmasked_sensitive_recall`：严重失败。
- `policy_bypass`：严重失败。
- `cloud_upload_without_consent`：严重失败。
- `revision_conflict`：通过受控拒绝处理的完整性失败。

## 当前状态

- 不产生自动写入效果的确定性追踪策略：已实现。
- M2-006/07 的建议下一阶段：把 `confirm` 与 `store` 连接到审查队列，并且只在验证后持久化。
