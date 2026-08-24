# Agent Note: Leon local-first model routing

Status: implemented

English | [中文](2026-08-22-leon-local-first-model-routing.zh.md)

## Problem

Leon is a provider-neutral personal assistant, not a DeepSeek-centered product. The inherited base composition selected `deepseek-official/deepseek-v4-flash`, which made an optional upstream provider appear to own Leon's identity and required a remote service for the primary path even though this Windows host already runs Ollama on an RTX 4070.

## Decision

The base composition now selects `ollama/qwen3.5:9b` as Leon's default and only shipped local model and declares a loopback-only `ollama` route through the existing provider-neutral pi-ai adapter. The route uses Ollama's OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1` and advertises the bounded capacity Leon uses for request planning. A fixed non-secret authorization marker satisfies the OpenAI client library; Ollama does not use it as a credential.

Gemini and other remote providers remain explicit user-configured routes. The shipped Web policy may select only a route that the user configured and authorized; it never embeds or invents a credential. The native DeepSeek packages remain installed as manual compatibility options and inherited package namespaces remain intact, but neither the model adapter nor its search provider is mounted in Leon's base composition. DeepSeek therefore does not appear in the normal shipped model catalog and can be added later only through an explicit profile.

Web retrieval follows the same boundary. The base composition mounts the provider-neutral Web seam but registers neither `web_search` nor `web_fetch` for the model, and mounts no search provider. A deployment that wants retrieval must explicitly add one provider and the corresponding tool; an existing DeepSeek credential alone cannot activate a remote request.

The Models settings surface presents active reference-free routes first, then other usable routes, then optional routes that still need setup. Its introduction describes local models as immediately usable and remote API keys as optional, so the user-visible provider order matches the routing policy.

The local selection stored in `$DSH_HOME/settings.yaml` was migrated from the former DeepSeek model to `ollama/qwen3.5:9b`. The obsolete provider-specific `reasoningEffort: max` value was removed so the local model may use its own supported reasoning behavior.

The Web gateway enables deterministic per-session adaptive routing across `ollama/qwen3.5:9b` and `google/gemini-3.6-flash`. A blank automatic session primes the 9B route at minimum effort before `session.models` reports current state, so a new conversation visibly begins on the efficient local tier. Short, self-contained prompts keep that route with reasoning off; longer, multi-line, code, technical, and contextual-continuation requests keep the same model and raise it to medium reasoning. Images, very large structured prompts, and explicit high-complexity markers use Gemini as the expert tier. Automatic goal rounds remain on Gemini so an objective does not return to the local model midway. The Ollama model profile explicitly maps `off` to the OpenAI-compatible `reasoning_effort: none` value, because omitting the parameter lets Qwen think by default. The model selector exposes `Leon Automatic` and shows the actual selected route and reasoning effort beside it. An explicit model or effort choice disables automation for that session, and the user can re-enable it from the same menu. Prompt wording can choose only between the routes named by deployment policy; it cannot introduce DeepSeek or another provider on its own.

## Verification

Ollama 0.32.15 detected the NVIDIA GeForce RTX 4070 and the installed `qwen3.5:9b` Q4_K_M model. The loopback OpenAI-compatible endpoint completed a Portuguese prompt, and the full Leon headless pipeline returned exactly `LEON LOCAL OK`. The Web host reports `provider: ollama`, `model: qwen3.5:9b`, and `cwd: E:\computador`. A fresh automatic session uses `ollama/qwen3.5:9b` with reasoning off for the pinned simple request. Classifier and bundle tests pin the same local model at medium effort for technical and contextual work, `google/gemini-3.6-flash` for expert and goal-round work, the absence of a 4B shipped route, and the absence of default DeepSeek model and search rows. Models presentation tests, Cordis configuration validation, API integration tests, and model-selector component tests pin the adaptive/manual state boundary, visible active route and effort, default selection, provider order, and absent model-facing Web tools. A live Gemini request remains the credential-gated deployment check.

## Alternatives considered

**Rename every inherited `@deepseek-ai/*` package immediately.** Rejected because package namespace is a compatibility and dependency-graph concern, not model routing or product identity. A mass rename would create broad migration risk without improving Leon's local execution.

**Keep DeepSeek as the default and describe Ollama as optional.** Rejected because it contradicts Leon's local-first privacy and availability goals.

**Wait for a local-model failure before calling Gemini.** Rejected because a weak local attempt can spend minutes, mutate files, and consume a goal round before the stronger model sees the task. Deterministic classification sends complex work to the authorized Gemini route before execution.

## Consequences

Leon can answer simple and medium requests without a cloud key when Ollama and the 9B local model are available. Removing the 4B option simplifies installation and avoids routing quality down to a second weaker local model; minimum versus medium effort still provides an efficiency tier on the same model. Expert automatic work requires the user-configured Google route and therefore may incur API cost and send the admitted conversation context to Gemini. The Windows installer must start or verify Ollama, ensure the single local model is installed, and make remote-provider authorization explicit. DeepSeek and Web retrieval remain manual, separately configured compatibility paths, and the technical upstream namespace can be migrated independently from runtime behavior.
