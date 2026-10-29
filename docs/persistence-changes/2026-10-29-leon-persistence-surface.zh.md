---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-leon-persistence-surface

[English](2026-10-29-leon-persistence-surface.md) | 中文

## 概述

Leon 层在此记录其持久的 Session 贡献：五种消息来源类型（explicit-target-policy、failure-recovery-policy、completion-claim-policy、tool-memory，以及共享的 user 来源契约）加入注入消息的联合类型，新增的 `task/validation` 事件记录验收决定，新增的 `web/access` 事件记录按会话的 web 授权。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-leon-persistence-surface
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a8fccf06a651a180c6efec4c099a18baade056b357b33679e4772c4df6efa927"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "91a6751e80a862f34398ea8f64a6072faa18478dbf3945437b44857102efb909"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "266cad00ff46a66860fa4b2e6289621ab9d57e70ad262396e61f89f2366602d1"
    decision: same-version
  - root: "event:task/validation"
    previous: null
    after: "91b0df7a1bec95156e81e06c36ba6cc260dab0830b3a3c7f44640a61c992eda2"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "6d081a6bc6374cdbd3e910ad4abf74a275dd7c0c737d5d63c7ca47ea7d48e3ef"
    decision: same-version
  - root: "event:web/access"
    previous: null
    after: "5186d42540d72069270711837a91a81011179a8af785f32b859ec0dc6d327559"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

增加联合类型变体扩展了注入消息来源的读取方；早于某类型的读取方会把它当作未知，而本分支的投影接受所有旧类型。两个新增事件根都是附加的，不替换任何现有根，也没有改变任何现有判别值的含义，因此 SESSION_FORMAT_VERSION 不变。

<a id="verification"></a>
## 验证

`pnpm run verify-persistence-changes` 将提取的当前 schema 与这些摘要比对；`pnpm run test` 覆盖折叠新根事件的投影；`packages/memory` 与 `packages/guard` 下的包测试断言记录的消息来源与事件能通过 Session 日志往返。

<a id="dev-note"></a>
## 开发备注

无。
