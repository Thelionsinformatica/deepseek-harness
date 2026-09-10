# @deepseek-ai/dsh-completion-claim-policy

English | [中文](README.zh.md)

This reference defines a final-turn evidence policy for strong **global** completion claims. The plugin reads the durable event tail after the open turn's latest `turn/start`; it does not judge ordinary task summaries, partial reports, or claims limited to one analysis.

## Config

Acceptance decisions declare `task/validation` on the owning session types module and enter the generated persistence vocabulary, so restored logs retain their validation evidence.

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

## Exact task acceptance

As an alternative to an exact answer, pass `undefined` for `expectedText` and supply `arithmeticTests: [{ a, b, expected }]` with `readOnly: true`. Supply exactly one criterion type. The restricted numeric protocol accepts one to eight examples with finite values of magnitude at most 1,000,000. Output is one line of at most 80 characters: `return` followed by two operands named `a` or `b` and one `+`, `-`, `*` or `/` operator. No constants, parentheses, calls or arbitrary Python are interpreted. Results use finite JavaScript numeric arithmetic with exact equality; passing examples is not a proof for all inputs. Equivalent expressions can pass without a reference-answer hash. A mismatch remains `output-mismatch`; the same bounded turn recovery includes measured examples in a logged user message. A successful evaluation still requires any designated read. Test values are not secret storage and may enter model context during correction.

Functional recovery uses `A resposta não passou na validação desta tarefa. Resultado dos testes: `, the bounded test diagnostic, and ` Corrija o problema observado e devolva somente a linha return completa. Não altere arquivos.` A missing read adds ` A leitura obrigatória do arquivo ainda não foi comprovada.` Numeric diagnostics contain at most eight rows of `a`, `b`, `expected`, `actual` and `passed`; non-finite results are `não finito`. Unsupported output receives `Formato inválido. Use uma única linha return com dois operandos a ou b e uma operação +, -, * ou /. Sem explicação, cercas, chamadas ou comandos.` This is a narrow validator, not a general project-test runner.

The optional `readOnly: true` criterion restricts the admitted turn to `read`, `glob` and `grep` through the executor's monotonic guard. Other tools, including shell, delegation and unknown tools, are denied before their bodies run, even during recovery. The restriction comes from trusted task metadata, not prose or tool output, and expires with the turn. This is not filesystem containment: trusted plugins, background jobs and direct non-tool I/O remain outside this guard. The plugin requires `tools`. Stable denial: `Esta tarefa permite somente leitura: use read, glob ou grep. Não execute alterações, terminal ou delegação.`

Trusted same-process callers can submit `createAcceptanceTask(content, expectedText, { maxRecoveries, requiredReadPath? })` through the normal agent inbox when this plugin is mounted. The message source persists a versioned SHA-256 digest of the exact UTF-8 answer, a zero-to-three correction allowance, and an optional absolute path requiring a successful `read` in the same turn. Do not use secrets: low-entropy answer hashes are guessable. No expected answer is added to the model prompt.

Acceptance applies only to the identified task's admitted turn, independently of global-claim wording. Multiple user messages in that turn fail with `TASK_ACCEPTANCE_AMBIGUOUS`. Each final response produces one `task/validation` decision correlated with task and response message ids: `passed`, `retry`, or `failed`. Repeating a decision for the same response cannot reset the recovery allowance. A mismatch after the allowance ends the turn with `TASK_ACCEPTANCE_UNSATISFIED`; ordinary messages remain unvalidated, not implicitly approved.

Exact-task recovery appends this fixed model-visible text, retaining the existing prompt prefix and adding one bounded instruction per correction:

```text
A resposta não passou na validação objetiva desta tarefa. Releia o pedido atual e, se necessário, o arquivo indicado nele. Confira o conteúdo e o formato solicitados. Responda com o valor integral solicitado, sem herdar limites de formato de tarefas anteriores. Se o pedido exigir apenas o valor, não acrescente introdução, explicação, rótulos, negrito ou cercas de código. Preserve a unidade completa pedida: uma linha de código não é apenas sua expressão. Use JSON ou outro formato quando o pedido o exigir. Não altere arquivos para satisfazer a validação.
```

The correction uses existing evidence-recovery provenance; configured adaptive routing may select its recovery route. This plugin neither authorizes external transmission nor grants tools or filesystem access. Criterion and decision records use the session log, not process-local counters. Readers unaware of the required `task/validation` event must refuse that log. Runtime invariants check task/response correlation and monotonic attempt numbers.

The native API is opt-in. The host's `session.prompt` accepts explicit criteria only for idle, empty-inbox queue admission with this policy mounted; no chat criterion editor is provided. It is not a general semantic validator. The trusted caller owns the expected answer and path; the successful-read check establishes tool execution, not an independent hash of file contents. Browser presentation, process-crash recovery, cancellation, and SDK event projections require integration verification before deployment.

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
