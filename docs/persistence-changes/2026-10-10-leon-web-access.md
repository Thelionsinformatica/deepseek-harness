---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-10-leon-web-access

English | [中文](2026-10-10-leon-web-access.zh.md)

## Summary

Adds the web/access session event: the complete post-change state of the user's session-scoped grant for the native web tools.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing V4 records are unchanged; the event appears only when dsh-web-access runs and a user switches the grant. It is required on read by design, like other owned events: a build without dsh-web-access refuses a log that contains it instead of resuming without the recorded consent decision. Leon logs written before 0.2.1 kept their fork-era web/access events in a leon-legacy-events.jsonl sidecar during conversion, so no historical log carries it. No Session format bump is required.

<a id="verification"></a>
## Verification

vitest run packages/web/web-access and packages/guard/web-egress-approval pass; tsc -b for both packages reported no errors.

<a id="dev-note"></a>
## Dev Note

None.
