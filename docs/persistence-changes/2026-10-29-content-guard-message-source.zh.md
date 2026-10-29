---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-content-guard-message-source

[English](2026-10-29-content-guard-message-source.md) | 中文

## 概述

工具输出内容守护引入了一个新的注入消息来源类型 `content-guard`，因此它的建议式通知会作为注入的 `user/message` 记录下来，模型可见的警告可以从 Session 日志重建。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-content-guard-message-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-29-leon-persistence-surface"
    after: "ab10de5cb18e9e7c94a78762939a49e393d29f14a5be0fbb93a23073404ef087"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-29-leon-persistence-surface"
    after: "9bbe3c2699f875418b5d8e31feb6c0f202a071e1707ebdf245c58db7defa4584"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-29-leon-persistence-surface"
    after: "f80a4f67ba90c03c3420a48a36f8404fe8e0d6976391fa20283ec1f580cfa607"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-29-leon-persistence-surface"
    after: "b2e69189ccc83bb367a1d47838ba57d466f5d5f34440b19c13ebb63cf36c7956"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

增加联合类型变体扩展了注入消息来源的读取方；早于该类型的读取方会把它当作未知，而所有既有来源类型的含义不变，因此 SESSION_FORMAT_VERSION 不变。守护不注册新的 Session 事件类型。

<a id="verification"></a>
## 验证

`pnpm run verify-persistence-changes` 将提取的当前 schema 与这些摘要比对；`packages/guard/content-guard` 的包测试断言通知作为附加上下文投递，且通知的来源类型与 form 正是循环提交到注入 `user/message` 事件的内容。

<a id="dev-note"></a>
## 开发备注

无。
