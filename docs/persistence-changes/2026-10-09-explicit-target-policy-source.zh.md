---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-09-explicit-target-policy-source

[English](2026-10-09-explicit-target-policy-source.md) | 中文

## 概述

为 Leon 目标守卫的同轮次恢复通知新增 explicit-target-policy 消息来源类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-09-explicit-target-policy-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "72a7c2957ebf05974f52efc57524a0ea974addaf9126be83b2e01ce745b795c5"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "f0e6e543ce80f783c61eb01894e8e73bdb63953c3f3e627ad06d932a5f3e2f97"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "63b17624c32394b02e33e5b6ad9cc40ef5deadc51871186f0adbe4fc925a75df"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "fd35b70bdf85a3a807362fd9887f9493ae49d82ea44f419656666d2c2ea9b1fc"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

MessageSourceMap 可合并扩展，消费方对未知类型走默认分支，因此未包含该守卫的读取方仍接受带有新类型的记录。现有 V4 记录不受影响，因为只有守卫注入恢复通知时才会出现该类型。较新的读取方接受所有更早的记录。无需提升 Session 格式版本。

<a id="verification"></a>
## 验证

vitest run packages/guard/explicit-target-policy：48 个测试通过；tsc -b packages/guard/explicit-target-policy 未报告错误。

<a id="dev-note"></a>
## 开发备注

无。
