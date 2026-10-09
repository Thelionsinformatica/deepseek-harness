---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-09-leon-guard-records

English | [中文](2026-10-09-leon-guard-records.zh.md)

## Summary

Adds the Leon guard records: the task/validation event, optional acceptance criteria on direct user sources, and the completion-claim-policy and failure-recovery-policy notice kinds.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing V4 records are unchanged; every new field and kind appears only when the Leon guards run. The notice kinds rely on merge-extensible MessageSourceMap consumers falling through unknown kinds. task/validation is required on read by design: a build without completion-claim-policy refuses a log that contains it instead of resuming without the recorded acceptance decisions. Leon logs written before 0.2.1 migrate the old plugin notices to plugin:completion-claim-policy and plugin:failure-recovery-policy, which both policies still count. No Session format bump is required.

<a id="verification"></a>
## Verification

vitest run packages/guard: completion-claim-policy, failure-recovery-policy and explicit-target-policy suites pass; tsc -b for both ported guards reported no errors.

<a id="dev-note"></a>
## Dev Note

None.
