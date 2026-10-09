---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-09-explicit-target-policy-source

English | [中文](2026-10-09-explicit-target-policy-source.zh.md)

## Summary

Adds the explicit-target-policy message source kind for the Leon target guard's same-turn recovery notice.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

MessageSourceMap is merge-extensible and consumers fall through unknown kinds, so readers built without the guard keep accepting records that carry the new kind. Existing V4 records are unchanged because the kind only appears when the guard injects a recovery notice. Newer readers accept every earlier record. No Session format bump is required.

<a id="verification"></a>
## Verification

vitest run packages/guard/explicit-target-policy: 48 tests passed; tsc -b packages/guard/explicit-target-policy reported no errors.

<a id="dev-note"></a>
## Dev Note

None.
