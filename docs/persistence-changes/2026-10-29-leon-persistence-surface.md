---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-leon-persistence-surface

English | [中文](2026-10-29-leon-persistence-surface.zh.md)

## Summary

The Leon layer records its durable Session contributions here: five message-source kinds (explicit-target-policy, failure-recovery-policy, completion-claim-policy, tool-memory, and the shared user source contract) join the injected-message unions, a new `task/validation` event records acceptance decisions, and a new `web/access` event records the per-session web grant.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Adding union variants widens the reader for injected-message sources; a reader that predates one kind treats it as unknown, and the branch's own projections accept every legacy kind. Both new event roots are additive and replace no existing one, and no existing discriminator changes meaning, so SESSION_FORMAT_VERSION does not move.

<a id="verification"></a>
## Verification

`pnpm run verify-persistence-changes` compares the extracted current schema with these digests; `pnpm run test` covers the projections that fold the new roots; the package suites under `packages/memory` and `packages/guard` assert the recorded message sources and events round-trip through the Session log.

<a id="dev-note"></a>
## Dev Note

None.
