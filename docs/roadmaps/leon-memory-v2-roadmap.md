# Leon Memory V2 roadmap

English | [中文](leon-memory-v2-roadmap.zh.md)

## Phases

### Phase M2-00 — Baseline audit

- Verify the baseline commit or tag.
- Consolidate the existing test inventory.
- Verify isolation, restart, and workspace flows.

### Phases M2-01/02 — Observability

- Add memory events.
- Add metrics and dashboards for decisions and blocks.

### Phase M2-03 — Shadow mode and extraction

- Extract candidates with `category`, `confidence`, and `importance`.
- Store them in a journal or pending queue without durable memory writes.

### Phases M2-04/05 — Deterministic policy and versioning

- Define the decision engine.
- Record `policyVersion`, reason, and trace.

### Phase M2-06 — Automatic write control

- Add per-user and per-workspace feature flags.
- Add progressive rules by category.

### Phase M2-07 — Hybrid retrieval and safe context

- Keep current lexical recall.
- Add optional local semantic retrieval.
- Add a token-bounded, priority-aware `MemoryContextComposer`.

### Phase M2-08 — Conflict and temporal validity

- Add explicit supersession and expiration support.
- Ignore obsolete versions by default during queries.

### Phase M2-09 — LEON-EVAL and stability

- Run the initial suites.
- Correct critical regressions.

### Phase M2-10 — Optional Letta experiment

- Compare `LocalMemoryProvider` and `LettaMemoryProvider`.
- Migrate only after objective improvement.

## Phase advancement rule

- No phase advances until:
  - required phase tests pass;
  - rollback is documented;
  - risk-bearing diffs are reviewed.

## Recommended horizon

Allow 1–2 weeks for phases 0 and 1, 2–3 weeks for phases 2–5, and 1–2 weeks for initial evaluation and stabilization.

## Priority rules

- First: safety and isolation.
- Second: consistency and reversibility.
- Third: performance.
