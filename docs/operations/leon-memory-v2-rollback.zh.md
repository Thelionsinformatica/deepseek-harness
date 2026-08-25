# Memory V2 回滚

[English](leon-memory-v2-rollback.md) | 中文

## 目标

以低风险撤销增量，同时保留现有记忆。

## 总体策略

- 首先移除自动写入流水线。
- 其次移除新的提取与可观察性。
- 保持包括提供方与显式工具在内的当前核心不变。

## 回滚级别

### 级别 1 — 配置

- 设置 `autoRecallMode=off`。
- 设置 `automaticRecall=false`。
- 把 `memory-candidate-review` Host 配置设为 `automaticWrite: false`，并清空两个精确允许列表。
- 已有可选手动回忆时予以保留。

### 级别 2 — 按 workspace 或用户禁用

- 在不删除审查证据的情况下禁用受控写入：
  - `automaticWrite: false`
  - `automaticWriteWorkspaceIds: []`
  - `automaticWriteUserIds: []`
- 通过 `memory_remember`、`memory_search`、`memory_update` 与 `memory_forget` 保留显式后备路径。

### 级别 3 — 运行隔离

- 保留 `ctx.memory` 与 `memory-local`。
- 注销策略、队列与提取器服务。
- 从查询流水线中排除新事件。

### 级别 4 — 极端恢复

- 恢复 `leon-memory-v1-baseline` 等基线分支或标签。
- 保留本地表且不进行转换。
- 再次运行基线测试套件与重启验证。

## 安全撤回

- 初始回滚期间不得删除旧记忆记录。
- 未经授权的导出或导入，不得删除 journal。
- 未更新 preset 与文档时，不得更改公共接口。
- `autoWrite.status = writing` 的候选项代表先前写入结果不确定。不得自动重试；应先核对其本地记忆与 journal 记录。
