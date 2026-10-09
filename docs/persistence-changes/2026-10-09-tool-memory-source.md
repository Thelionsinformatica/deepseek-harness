---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-09-tool-memory-source

English | [中文](2026-10-09-tool-memory-source.zh.md)

## Summary

Adds the tool-memory message source kind for Leon workspace and personal memory recall snapshots.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

MessageSourceMap is merge-extensible and consumers fall through unknown kinds, so readers built without tool-memory keep accepting records that carry the new kind. Existing V4 records are unchanged. Leon logs written before 0.2.1 used the generic plugin kind, which the V3-to-V4 migration lifts to the runtime-only kind plugin:tool-memory; the tool-memory projection accepts both kinds, so resumed legacy Sessions still retire their snapshots. No Session format bump is required.

<a id="verification"></a>
## Verification

vitest run packages/memory packages/guard packages/storage/storage-domain: 478 tests passed, including session-facts projection tests for the legacy kind; tsc -b packages/memory/tool-memory reported no errors.

<a id="dev-note"></a>
## Dev Note

None.
