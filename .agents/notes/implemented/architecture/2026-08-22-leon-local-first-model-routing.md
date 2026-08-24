# Agent Note: Leon local-first model routing

Status: implemented

English | [中文](2026-08-22-leon-local-first-model-routing.zh.md)

## Problem

Leon is a provider-neutral personal assistant, not a DeepSeek-centered product. The inherited base composition selected `deepseek-official/deepseek-v4-flash`, which made an optional upstream provider appear to own Leon's identity and required a remote service for the primary path even though this Windows host already runs Ollama on an RTX 4070.

## Decision

The base composition selects `ollama/qwen3.5:9b` as Leon's default everyday model and adds `ollama/ornith-1.5:9b` as the local coding and agent specialist. Both use the provider-neutral pi-ai adapter through Ollama's loopback OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1` and advertise bounded capacities appropriate for this RTX 4070 deployment. A fixed non-secret authorization marker satisfies the OpenAI client library; Ollama does not use it as a credential.

Gemini and other remote providers remain explicit user-configured routes. The shipped Web policy may select only a route that the user configured and authorized; it never embeds or invents a credential. The native DeepSeek packages remain installed as manual compatibility options and inherited package namespaces remain intact, but neither the model adapter nor its search provider is mounted in Leon's base composition. DeepSeek therefore does not appear in the normal shipped model catalog and can be added later only through an explicit profile.

Web retrieval follows the same boundary. The base composition mounts the provider-neutral Web seam but registers neither `web_search` nor `web_fetch` for the model, and mounts no search provider. A deployment that wants retrieval must explicitly add one provider and the corresponding tool; an existing DeepSeek credential alone cannot activate a remote request.

The Models settings surface presents active reference-free routes first, then other usable routes, then optional routes that still need setup. Its introduction describes local models as immediately usable and remote API keys as optional, so the user-visible provider order matches the routing policy.

The local selection stored in `$DSH_HOME/settings.yaml` was migrated from the former DeepSeek model to `ollama/qwen3.5:9b`. The obsolete provider-specific `reasoningEffort: max` value was removed so the local model may use its own supported reasoning behavior.

The Web gateway enables deterministic per-session adaptive routing across the two local roles. A blank automatic session primes Qwen at minimum effort before `session.models` reports current state, so a new conversation visibly begins on the efficient local tier. Short, self-contained prompts keep Qwen with reasoning off; longer, multi-line, code, technical, and contextual-continuation requests keep Qwen and raise it to medium reasoning. Images, very large structured prompts, explicit high-complexity markers, and automatic goal rounds use Ornith at high effort. The Ollama profiles explicitly map `off` to the OpenAI-compatible `reasoning_effort: none` value, because omitting the parameter can let a local model think by default. The model selector exposes `Leon Automatic` and shows the actual selected route and reasoning effort beside it. An explicit model or effort choice disables automation for that session, and the user can re-enable it from the same menu. Prompt wording can choose only between routes named by deployment policy; it cannot introduce DeepSeek or another provider on its own.

External escalation is failure-driven and ordered. The first unavailable Ollama request moves to loopback `omniroute/auto`; if OmniRoute or its selected upstream is unavailable, Leon bypasses the gateway through direct `google/gemini-3.6-flash`, then direct `openai/gpt-5.6-terra`. Every eligible transition appends `llm/failover`, becomes the active route for the same request, and remains visible in the chat. OmniRoute owns provider health, upstream selection, quotas, and its own usage ledger, but it does not own Leon's persona or local task classification. Direct routes remain credential-referenced and inactive without user-provided keys. The Web cost projection prices the two local models at zero and records current direct Gemini/OpenAI token-price snapshots; OmniRoute's variable routed cost stays in its own authoritative ledger rather than being guessed as a fixed model price.

OpenCode is a subordinate executor rather than another Leon persona. On Windows the base composition mounts OpenCode's official ACP server through `dsh-subagent-acp` and exposes it as the explicit `opencode` one-shot delegation tool. The child receives only the standalone task plus the selected workspace path, uses Ornith as its main model and Qwen as its small model, and returns only its final text. Its installer-owned configuration under `E:\computador\.leon` enables project-local edits, shell, LSP, snapshots, and compaction while denying external-directory access, nested agents, commit, push, hard reset, and recursive deletion. Leon remains responsible for deciding when delegation is useful and for validating the returned work.

## Verification

Ollama detected the NVIDIA GeForce RTX 4070 and the installed Qwen 3.5 9B model. The official `ornith-1.5:9b` Ollama artifact was pulled and completed Portuguese OpenAI-compatible requests both normally and with `reasoning_effort: high`. OmniRoute 3.8.49 and OpenCode 1.18.21 were installed below `E:\computador\.leon\tools`; OmniRoute runs on `127.0.0.1:20128`, and its health/storage diagnostics complete without failures. Focused classifier and bundle tests pin Qwen for fast/main work, Ornith for expert/goal-round work, the ordered Ollama-to-OmniRoute-to-Gemini-to-OpenAI chain, zero local prices, the direct GPT-5.6 Terra price snapshot, the absence of a 4B shipped route, and the absence of default DeepSeek model and search rows. A paid OmniRoute, Gemini, or OpenAI request remains a credential- and budget-gated deployment check.

## Alternatives considered

**Rename every inherited `@deepseek-ai/*` package immediately.** Rejected because package namespace is a compatibility and dependency-graph concern, not model routing or product identity. A mass rename would create broad migration risk without improving Leon's local execution.

**Keep DeepSeek as the default and describe Ollama as optional.** Rejected because it contradicts Leon's local-first privacy and availability goals.

**Send complex work directly to Gemini before trying a local specialist.** Rejected because Ornith provides a purpose-built local coding/agent tier that preserves privacy and avoids API cost. The deterministic classifier promotes complex work before execution, but now promotes it from Qwen to Ornith; cloud routes are resilience fallbacks.

## Consequences

Leon can answer ordinary, technical, complex, and goal-driven requests without a cloud key when Ollama and both 9B local models are available. Removing the 4B option avoids routing quality down to a weaker local model, while Qwen-versus-Ornith provides a meaningful capability tier. A local outage may send admitted conversation context and tool schemas to an OmniRoute-selected upstream, Gemini, or OpenAI and may incur API cost; the chat and cost surfaces must make those consequences visible. The Windows installer must start or verify Ollama and loopback OmniRoute, ensure both local models are installed, configure service startup and health checks, and keep remote-provider authorization and budgets explicit. DeepSeek and Web retrieval remain manual, separately configured compatibility paths, and the technical upstream namespace can be migrated independently from runtime behavior.
