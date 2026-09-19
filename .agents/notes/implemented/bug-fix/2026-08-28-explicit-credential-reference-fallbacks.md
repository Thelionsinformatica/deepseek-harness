# Agent Note: Resolve explicit credential-reference fallback chains

Status: implemented

English | [中文](2026-08-28-explicit-credential-reference-fallbacks.zh.md)

## Problem

Leon standardized its Gemini model and Google Search configuration on `GEMINI_API_KEY`, while earlier installations may hold the same Google API key only under `GOOGLE_API_KEY`. Copying the secret into both records would create two independently rotatable values and make it unclear which credential actually authorized a request.

Using provider-native ambient discovery after a named reference misses is not a safe migration mechanism. An unrelated environment key could authenticate another account, and neither the configuration nor the missing-credential diagnostic would describe that fallback.

## Decision

The pi-ai provider profile and Google Search provider accept an ordered `apiKeyEnvFallbacks` list. They resolve `apiKeyEnv` first and then only those declared compatibility references. Duplicate references are rejected. Pi-ai also rejects a fallback list without a primary reference.

The generic Google Search package keeps `GOOGLE_API_KEY` with no fallbacks as its default. Leon's bundles explicitly declare `GEMINI_API_KEY` as primary and `GOOGLE_API_KEY` as its sole migration fallback for both the Gemini model route and Google Search.

No secret is copied into configuration or another credential record. Both consumers resolve the winning reference per operation, so rotation reaches the next model call or search.

## Alternatives considered

**Copy `GOOGLE_API_KEY` into a new `GEMINI_API_KEY` record during upgrade.** Rejected because it duplicates a secret and creates ambiguous rotation and deletion behavior.

**Let the provider discover any ambient Google key after a miss.** Rejected because the fallback would be undeclared and could charge or expose data to a different account.

**Change the generic Google Search default to Leon's alias chain.** Rejected because package-level behavior must not silently acquire deployment-specific migration policy.

## Consequences

Fresh Leon installations use `GEMINI_API_KEY`. Existing installations that hold only `GOOGLE_API_KEY` continue to work without rewriting the credential store. A missing chain fails closed and names every declared reference, while unrelated environment keys are ignored.

Tests cover primary precedence, legacy fallback, validation of malformed or duplicate chains, missing-reference diagnostics, bundle composition, and refusal to consult an undeclared ambient Google key.
