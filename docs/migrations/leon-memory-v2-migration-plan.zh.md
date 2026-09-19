# Memory V2 迁移计划

[English](leon-memory-v2-migration-plan.md) | 中文

## 原则

在不丢失连续性的前提下进行可逆迁移。

## 当前状态

- 当前 `memory-local` 记录包含：
  - `id`、`scope.workspaceId`、`content`、`revision`、`source`、`createdAt` 与 `updatedAt`。

## 非破坏性目标状态

- `MemoryRecord` 增加可选字段：
  - `category`、`subject`、`importance`、`confidence`、`sensitivity`、`status`、`validFrom`、`validUntil`、`consentRequirement`、`supersedes`、`supersededBy`、`embeddingVersion` 与 `schemaVersion`。
- 现有字段继续有效。

## 迁移策略

1. 为现有版本 1 记录应用默认 `schemaVersion`。
2. 使用显式默认值丰富新记录。
3. 保留后备行为：
   - 将缺失字段视为版本 1，并采用保守行为。
4. 添加只读迁移 journal 以支持可观察性。

## 前滚与回滚

- 前滚：仅通过功能开关激活新策略，不删除现有记录。
- 回滚：
  - 禁用自动流水线与写入影子模式；
  - 保留现有数据；
  - 保留现有消费方。

## 完成前验证

- 运行以下场景：
  - 读取旧记录且不修改；
  - 使用新字段写入新记录；
  - 阻止跨 workspace 检索；
  - 重启后保持持久性。
