# @deepseek-ai/dsh-failure-recovery-policy

English | [中文](README.zh.md)

A deterministic self-recovery guard for tool failures. It stores one atomic recovery cell per session and, after the same exact tool call fails twice with an equivalent failure, injects one logged recovery notice. If the model requests that unchanged call again, a monotonic tool guard denies it before dispatch. The durable cell survives session resume and provider/model changes; the model can continue immediately by changing the tool, arguments, or strategy.

This package complements [`repeat-tool-reminder`](../repeat-tool-reminder/README.md): successful identical calls receive advisory reminders there; failed and downstream-blocked calls are owned here. Decision record: [the tool failure recovery Agent Note](../../../.agents/notes/implemented/feature/2026-08-24-tool-failure-recovery-policy.md).

## Config

```yaml
- id: failure-recovery-policy
  name: '@deepseek-ai/dsh-failure-recovery-policy'
  config:
    maxEquivalentFailures: 2 # default; integer >= 2
    include: []              # tool-name patterns to track; empty means all tools
    exclude: []              # tool-name patterns to ignore
```

`include` and `exclude` accept `*` wildcards. An invalid failure limit fails at plugin load instead of silently changing policy.

## Failure identity and lifecycle

The call identity is `(tool name, canonical arguments)`, where object keys are deeply sorted before serialization. Structured errors are equivalent when their error name and code match. Unstructured errors use the exact error message as process-local identity; the message is not copied into the recovery notice. A downstream `tools/post-execute` block is the stable `POST_EXECUTE_BLOCK` identity.

Success, a different tracked call, a different failure identity, or a new user prompt resets or starts a chain. Calls without an agent and nested Code Mode calls are ignored. State is serialized through the deployment's `storage-domain` write chain under the session id, so concurrent failure completions cannot lose increments and reopening the host restores the committed version.

## Adapter and atomic-store contracts

The package exports `ToolPolicy`, `InvocationOutcome`, `RecoveryEvent`, and `AtomicRecoveryStore`. A `ToolPolicy` is code-owned: it resolves canonical signature, equivalence family, normalized target, effect, retry safety, and an optional idempotency key without consulting the model. `InvocationOutcome` keeps provider transport, tool execution, external-effect uncertainty, and policy failures in separate domains.

`DomainAtomicRecoveryStore` persists recovery cells through `storage-domain`; `MemoryAtomicRecoveryStore` is the matching process-local implementation for isolated tests and explicit storage-free hosts. Both deduplicate events by id, serialize failure transitions, retain per-scope versions, and expose operation leases with TTL and monotonic fencing tokens. A stale holder cannot release a lease acquired after its expiry.

The current guard uses its established exact canonical arguments as both signature and equivalence family. Tool adapters can adopt the exported policy contract incrementally; no model-generated classification affects enforcement.

## Recovery and denial

After the configured number of equivalent failures, the plugin prepends a recovery message through `additionalContexts`. The agent loop records it as a plugin-sourced `user/message`, preserving the original `tool/result` and every downstream context. A later unchanged call is denied by `ctx.tools.guard()` before the tool implementation executes. The denied token is not counted as another failure, so the policy stays monotonic and does not flood history.

Changing the tool or its arguments clears the lock by beginning a different chain. The guard does not ask the model to expose private reasoning; it asks for a different observable action or a conclusion from existing evidence.

## Model Experience

### Recovery context message

#### What the model sees

After the configured equivalent-failure limit, the next model request includes exactly this compact recovery message with the concrete tool, count, and stable failure code substituted:

##### Recovery notice

```markdown
The same tool call has failed repeatedly with an equivalent failure.
- tool: <toolName>
- equivalent_failures: <count>
- failure_code: <failureCode>
Identify the likely cause from the logged tool results before continuing. Do not repeat this exact call. Change the tool, arguments, or strategy, or finish the task if the available evidence is sufficient.
```

#### Token effect

Zero tokens before the threshold. One compact notice is retained in that agent's logged history; raw arguments and unstructured error text are not duplicated.

#### KV Cache effect

Append-only: the recovery context follows the reusable request prefix and does not invalidate existing prefix-cache entries.

## Known Limitations and Deferred Work

- Detection is exact, not fuzzy; a meaningful argument change is intentionally allowed.
- Calls already admitted in the same parallel batch can finish; atomic failure recording prevents lost counts, while only later dispatches see the accumulated failures.
- A pre-existing pre-execute denial already prevents dispatch; this policy observes the resulting failure but does not replace the earlier reason.
- Nested Code Mode calls are excluded so a program controls its own internal retry policy.
- The policy changes tool strategy, not model/provider routing; transport failover remains the router's responsibility.
- Operation leases and uncertain-outcome records are available to effectful tool adapters, but this exact-failure guard does not reserve every tool call automatically.
- The configured JSON domain backend coordinates one Leon host process. Cross-process visibility requires a backend with a shared atomic record primitive.
