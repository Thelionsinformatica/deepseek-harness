---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-10-leon-web-access

[English](2026-10-10-leon-web-access.md) | 中文

## 概述

新增 web/access 会话事件：用户对原生 Web 工具的会话级授权在变更后的完整状态。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-10-leon-web-access
baseline: false
changes:
  - root: "event:web/access"
    previous: null
    after: "5186d42540d72069270711837a91a81011179a8af785f32b859ec0dc6d327559"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 V4 记录不受影响；该事件只在 dsh-web-access 运行且用户切换授权时出现。与其他自有事件一样，它按设计在读取时为必需：未包含 dsh-web-access 的构建会拒绝含有该事件的日志，而不是在缺少已记录同意决定的情况下恢复。0.2.1 之前写入的 Leon 日志在转换时已把分支时期的 web/access 事件移入 leon-legacy-events.jsonl 旁路文件，因此没有历史日志包含它。无需提升 Session 格式版本。

<a id="verification"></a>
## 验证

vitest run packages/web/web-access 与 packages/guard/web-egress-approval 通过；两个包的 tsc -b 均未报告错误。

<a id="dev-note"></a>
## 开发备注

无。
