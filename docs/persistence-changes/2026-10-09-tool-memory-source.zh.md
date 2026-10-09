---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-09-tool-memory-source

[English](2026-10-09-tool-memory-source.md) | 中文

## 概述

为 Leon 工作区与个人记忆回忆快照新增 tool-memory 消息来源类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-09-tool-memory-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-09-explicit-target-policy-source"
    after: "e597bd511c2bdc02d3bb7515d17f66b908004bfbb14912b58fb579d6bc652455"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-09-explicit-target-policy-source"
    after: "07d705b9b73cde0aed4a5759587614177671f6b92c8152e46714c4d719ab6556"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-09-explicit-target-policy-source"
    after: "7bd469ddb8abcd6805c814dc8a7c795cdefca4d18f7c97e598d496a8e9a12a61"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-09-explicit-target-policy-source"
    after: "b73128b1382abbe19c463f51c82f505ce11254849bda08a95eaa9f559ed9dfda"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

MessageSourceMap 可合并扩展，消费方对未知类型走默认分支，因此未包含 tool-memory 的读取方仍接受带有新类型的记录。现有 V4 记录不受影响。0.2.1 之前写入的 Leon 日志使用通用 plugin 类型，V3 到 V4 迁移会把它提升为仅运行时存在的 plugin:tool-memory 类型；tool-memory 投影同时接受两种类型，因此恢复的旧 Session 仍会撤下自己的快照。无需提升 Session 格式版本。

<a id="verification"></a>
## 验证

vitest run packages/memory packages/guard packages/storage/storage-domain：478 个测试通过，包括针对旧类型的 session-facts 投影测试；tsc -b packages/memory/tool-memory 未报告错误。

<a id="dev-note"></a>
## 开发备注

无。
