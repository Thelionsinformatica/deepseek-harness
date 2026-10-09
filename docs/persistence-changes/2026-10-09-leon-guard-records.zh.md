---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-09-leon-guard-records

[English](2026-10-09-leon-guard-records.md) | 中文

## 概述

新增 Leon 守卫记录：task/validation 事件、直接用户来源上可选的验收标准，以及 completion-claim-policy 与 failure-recovery-policy 通知类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-09-leon-guard-records
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-09-tool-memory-source"
    after: "de6aff2e03b3d3cda034bd89cbf6b428c340f32a3e2b4e8d69130ecc42063315"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-09-tool-memory-source"
    after: "c977f3a3d468b5934de32ef6940b92a59213b41e31ed8f6bb29c520058cbf241"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-09-tool-memory-source"
    after: "e708838956bf020d43aeb2bb6a86eb79dbdcee61f8ffa0e8d863f6f53766e707"
    decision: same-version
  - root: "event:task/validation"
    previous: null
    after: "91b0df7a1bec95156e81e06c36ba6cc260dab0830b3a3c7f44640a61c992eda2"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-09-tool-memory-source"
    after: "5179471a82d11980dc5db71a36e6efefa31161ef1afbf3bc6863e1a5f1d24c7b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 V4 记录不受影响；所有新字段和类型只在 Leon 守卫运行时出现。通知类型依赖可合并扩展的 MessageSourceMap，消费方对未知类型走默认分支。task/validation 按设计在读取时为必需：未包含 completion-claim-policy 的构建会拒绝含有该事件的日志，而不是在缺少已记录验收决定的情况下恢复。0.2.1 之前写入的 Leon 日志会把旧的 plugin 通知迁移为 plugin:completion-claim-policy 和 plugin:failure-recovery-policy，两个策略仍会计数。无需提升 Session 格式版本。

<a id="verification"></a>
## 验证

vitest run packages/guard：completion-claim-policy、failure-recovery-policy 与 explicit-target-policy 测试套件通过；两个移植守卫的 tsc -b 均未报告错误。

<a id="dev-note"></a>
## 开发备注

无。
