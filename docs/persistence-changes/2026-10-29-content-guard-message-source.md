---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-content-guard-message-source

English | [中文](2026-10-29-content-guard-message-source.zh.md)

## Summary

The tool-output content guard contributes a new injected-message source kind, `content-guard`, so its advisory notice is recorded as an injected `user/message` and the model-visible warning stays reconstructable from the Session log.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Adding a union variant widens the reader for injected-message sources; a reader that predates this kind treats it as unknown, and every existing source kind keeps its meaning, so SESSION_FORMAT_VERSION does not move. The guard registers no new Session event type.

<a id="verification"></a>
## Verification

`pnpm run verify-persistence-changes` compares the extracted current schema with these digests; the package tests in `packages/guard/content-guard` assert the notice is delivered as an added context, and the notice's source kind and form are what the loop commits to the injected `user/message` event.

<a id="dev-note"></a>
## Dev Note

None.
