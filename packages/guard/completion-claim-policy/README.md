# @deepseek-ai/dsh-completion-claim-policy

English | [中文](README.zh.md)

This reference defines a final-turn evidence policy for strong **global** completion claims. The plugin reads the durable event tail after the open turn's latest `turn/start`; it does not judge ordinary task summaries, partial reports, or claims limited to one analysis.

## Config

```yaml
- id: completion-claim-policy
  name: '@deepseek-ai/dsh-completion-claim-policy'
  config:
    maxEvidenceRecoveries: 1
    maxRecoveryMessageBytes: 4096
    maxArtifactClaims: 32
    verifyAbsoluteArtifactClaims: true
    requireCurrentTurnEvidence: true
```

- `maxEvidenceRecoveries` permits zero to three same-turn corrections and defaults to `0`.
- `maxRecoveryMessageBytes` caps the complete retained recovery message at 512 to 65,536 UTF-8 bytes and defaults to `4096`.
- `maxArtifactClaims` caps filesystem checks at 1 to 256 unique quoted paths and defaults to `32`; exceeding the cap remains an evidence gap.
- `verifyAbsoluteArtifactClaims` checks absolute Windows paths quoted in backticks by the final claim and defaults to `false`.
- `requireCurrentTurnEvidence` requires at least one successful tool result in the open turn and defaults to `false`.

## Claim classification

The classifier evaluates sentences and explicit clause boundaries independently. It deliberately recognizes only affirmative, unscoped, high-confidence statements such as “todas as ferramentas funcionam”, “100% operacional”, “pronto para qualquer tarefa”, “everything works”, and “all tools are operational”. Negated, conditional, quoted, uncertain, local-scope, partial, and blocked statements do not activate the policy. A negative sentence cannot hide a later affirmative global claim.

## Evidence reconstruction

For a recognized claim, the policy checks the current turn for:

- the latest `todo/write` snapshot with `pending` or `in_progress` items;
- `tool/call` events without a matching `tool/result`;
- the latest result for each exact operation (tool name plus durable argument payload) when its `ToolResultBlock.isError` is true;
- terminal presentation metadata carrying a non-zero `exitCode` or a signal;
- the bounded set of backtick-quoted absolute Windows paths that do not exist, or a claim that exceeds the configured path-check count, when artifact verification is enabled;
- the absence of any successful current-turn tool result, when current-turn evidence is required.

A later successful result for the same exact operation supersedes its earlier failure. A different argument payload cannot hide the earlier failure, and calls without results remain independent gaps.

## Stop behavior

When gaps remain and recovery budget is available, `agent/turn-stopping` steers one attributed plugin message into the same turn. The complete UTF-8 message, including framing and truncation marker, stays within `maxRecoveryMessageBytes`. The initial assistant claim may already have reached the transcript before this hook runs; the policy prevents it from remaining the definitive turn ending by requiring a corrected continuation. The continuation may finish the work and verify it, or replace the claim with an honest partial or blocked report.

If the model repeats a strong unsupported claim after the configured allowance, the listener throws `HarnessError` with code `COMPLETION_EVIDENCE_UNSATISFIED`. With zero recoveries, the first unsupported claim ends the turn as an error after its assistant message has been logged.

## Model Experience

### Evidence recovery message

#### What the model sees

The model receives the following retained plugin message with one or more data-dependent gap lines.

##### Recovery template

```markdown
A alegação global de conclusão não está sustentada pelo registro deste turno:
- <evidence gap>
Continue e produza/verifique as evidências faltantes, atualize as tarefas, ou responda honestamente que o resultado é parcial ou está bloqueado. Não declare que tudo está funcionando, 100% concluído ou plenamente operacional enquanto qualquer lacuna permanecer.
```

#### Token effect

Zero tokens when no recognized unsupported claim exists. Each correction appends one retained message whose complete UTF-8 representation is bounded by `maxRecoveryMessageBytes`; oversized evidence details are replaced by a visible truncation marker.

#### KV Cache effect

Append-only. The recovery follows the already reusable request prefix; configuration changes affect whether a later message is appended, not the earlier prefix.

## Known Limitations and Deferred Work

- **The hook cannot retract displayed text** — an unsupported claim may render before `agent/turn-stopping`; the policy forces a same-turn correction or an error rather than silently presenting it as a successful final state.
- **Global-claim patterns are intentionally narrow** — paraphrases outside the PT/EN high-confidence set are allowed to avoid blocking ordinary summaries; expanding the patterns requires false-positive tests.
- **Artifact checks cover a bounded set of explicit Windows code spans only** — relative paths, URLs, prose paths, and non-Windows paths remain unchecked; exceeding `maxArtifactClaims` blocks the global claim instead of silently trusting unchecked paths.
- **Evidence is structural, not semantic** — a successful tool result proves that a call settled, not that its output establishes every factual clause in the model's claim.
