# @deepseek-ai/dsh-personal-memory

English | [中文](README.zh.md)

`PersonalMemoryRuntime` (`ctx.personalMemory`) is the provider-neutral service for durable facts that belong to one explicit local owner rather than one project workspace. It has an independent provider registry and never treats a path, hidden workspace, account id, or telemetry id as personal ownership.

## Behavior

Every create, search, list, correct, and forget request carries a bounded `PersonalMemoryOwnerId`. Content and queries are trimmed and bounded before provider execution. Corrections and forgetting require the exact `MemoryId` and revision, so stale context cannot overwrite a newer fact.

The service rejects known credential-like patterns before persistence, including common API keys, access tokens, private keys, passwords, JWTs, and cloud credentials. This is conservative defense in depth, not a general data-loss-prevention system. Callers still restrict writes to explicit user intent or confirmed durable facts.

Provider selection is registration-order independent. An explicit provider must be present and available; otherwise exactly one usable provider is required. Content-free `personal-memory/operation` and `personal-memory/blocked` events expose operation health without memory text.

The runtime also accepts a live enablement preference. When disabled, model recall, creation, and correction fail before provider execution. Administrative listing and permanent forgetting remain available, so disabling the feature never prevents the user from inspecting or deleting local data.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-memory`, which contributes explicit personal remember, search, correct, and forget tools plus optional bounded first-step recall when configured with a valid `personalOwnerId`; this service adds no model-visible tools or prompt content by itself.

#### KV Cache effect

None directly. A Consumer owns model-visible tools, prompt sections, and recalled snapshots.

## Known Limitations and Deferred Work

- The shipped contract targets one local owner partition per Leon deployment; authenticated multi-user ownership is not inferred.
- Local storage encryption is not implemented. Files inherit the configured storage backend and operating-system access controls.
- The Leon Web composition provides a confirmed browser administration panel through `@deepseek-ai/dsh-tool-memory/review`; other compositions must supply their own owner-facing controls.
- Credential detection cannot identify every secret format, and personal memory is not appropriate for document bodies or regulated records.
