# Agent Note: Leon localized work status

Status: implemented

English | [中文](2026-08-23-leon-localized-work-status.zh.md)

## Problem

The chat activity label used an English phrase beginning with “Deep” even though it described generic work rather than a model provider. In the Leon product this looked like a DeepSeek route disclosure, and retry rows fell back to English in the Brazilian Portuguese interface. A local-model failure therefore obscured both who was working and whether the page was still active.

## Decision

The live turn status renders a conversation-locale entry that identifies Leon. English displays `Leon is working…`, Brazilian Portuguese displays `Leon está trabalhando…`, and every supported locale owns an equivalent entry instead of relying on a component literal.

Retry presentation uses the provider recorded by the durable retry node. Ollama attempts use local-model labels; other providers retain neutral model-request labels. An active retry includes an ellipsis before the existing changing countdown, while completed and cancelled rows keep static labels. The Brazilian Portuguese fallback pack translates all retry states, the retry delay, and the failure reason.

## Alternatives considered

**Replace only the live activity phrase.** Rejected because a local Ollama failure would still expose English retry copy immediately below the corrected Portuguese status.

**Call every retry a local-model retry.** Rejected because Gemini and manually configured remote providers share the same retry projection; the durable provider field allows accurate local wording without mislabeling cloud work.

**Remove the countdown to match a shorter sentence exactly.** Rejected because the changing value is direct evidence that the page remains active during backoff. The sentence and attempt count stay intact, followed by the countdown.

## Testing

Conversation component tests pin the localized live-turn entry, elapsed-time rendering, provider-aware Ollama labels, generic provider labels, retry states, and countdown updates. Locale tests pin the Brazilian Portuguese work and retry copy. Assembled Web snapshots pin the activity label in running conversation states.

## Consequences

Leon identifies its own work without suggesting that DeepSeek is selected, and local retry rows explain the current action in Brazilian Portuguese while continuing to show live progress. Retry wording depends on the provider id being recorded accurately; an unknown or remote provider deliberately receives neutral copy rather than a guessed brand.
