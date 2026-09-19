# Agent Note: Leon automatic cloud failover

Status: implemented

English | [中文](2026-08-23-leon-automatic-cloud-failover.zh.md)

## Problem

Leon Automatic selected a local Ollama route but delegated connection failures to the provider retry policy. An unavailable local service therefore consumed five attempts before the turn failed, even when a configured cloud route could continue the same work. The model indicator and transcript also lacked a durable fact explaining that a remote model had assumed the request.

## Decision

`adaptiveRouting.failover` explicitly names the eligible failed providers, normalized failure codes, replacement provider/model, and optional replacement effort. The shipped Web policy replaces Ollama `TRANSPORT`, `TIMEOUT`, and `SERVER` failures with `google/gemini-3.6-flash`.

The API proxy installs an agent-scoped `agent/request-error` listener ahead of ordinary provider retry. Automatic sessions resolve the configured replacement, append `llm/failover`, update both the current and assembled selection, and return `{ kind: 'retry' }`, so the loop rebuilds the same request through the replacement without a local backoff. A replacement-resolution failure delegates to the provider retry policy. Manual sessions always delegate and never cross providers automatically.

`llm/failover` is a durable, non-surface event containing the failed route, replacement route, normalized failure, turn, and step. The retry invariant companion requires the event to identify the open request route and a different replacement provider. The conversation UI renders a localized warning without exposing failure details, while the model selector reloads the Host selection when that event arrives during an active turn.

## Alternatives considered

**Wait for all local retries before using the API.** Rejected because repeated connection failures do not improve task quality and hide an already configured recovery route behind avoidable delay.

**Switch every failed model selection to Gemini.** Rejected because authentication, invalid-model, and manually selected route failures require explicit correction rather than an undisclosed provider change. Eligibility remains deployment configuration and automatic-mode state.

**Probe Ollama before every prompt and keep failover outside request recovery.** Rejected because a health response does not prove that the selected model request will complete, while the normalized request failure is the authoritative fact that recovery must handle.

**Change the route without a session event.** Rejected because reconnect, replay, the user notice, and the corner model indicator need one durable explanation of the provider replacement.

## Testing

Pure routing tests pin provider and failure-code eligibility. Host integration tests dispatch the real agent request-error waterfall, prove ordinary retry is bypassed in automatic mode, prove the next request uses the replacement, and prove manual mode delegates. Invariant tests pin the active-route and distinct-provider requirements. Conversation projection and component tests pin replay and localized display, model-selection tests pin the active-turn refresh, and the shipped Web composition test pins the Ollama-to-Gemini policy.

## Consequences

An unavailable local service adds one failed request attempt before Leon continues through the configured API, and the transcript states what happened. Cloud use may incur provider cost, but only automatic mode and explicitly configured failures authorize it. A later prompt may select a recovered local tier again; this decision adds no hidden outage timer or permanent provider demotion.
