# Agent Note: Doctor follows the saved local backend

Status: implemented

English | [中文](2026-09-12-doctor-saved-local-backend.zh.md)

## Problem

A fixed Ollama model requirement reports a healthy llama.cpp installation as unavailable and can mistake a model catalogue for working inference. Metadata requests to an arbitrary configured provider can also contact a cloud gateway even when its URL uses loopback.

## Decision

The boot-free [doctor](../../../../apps/cli/src/doctor.ts) reads `agent-default-model` and `llm-pi-ai.providers` from the default `$DSH_HOME/settings.yaml` document. It accepts only explicitly selected `llamacpp` or `ollama` providers with HTTP(S) loopback URLs. Missing selections remain unverified rather than inheriting a historical model. Settings parser diagnostics and response bodies are not included in the report; credential fields are never copied into requests.

Service health, selected-model catalogue presence, and unexecuted inference are separate checks. llama.cpp uses `/health` and its configured OpenAI-compatible base URL plus `/models`; Ollama uses `/api/version` and `/api/tags`. A successful catalogue request does not prove a loaded model, GPU acceleration, tool use, or generation quality. The inference check always reports a warning because this command submits no generation request.

This specializes the [read-only diagnostic](../feature/2026-08-27-read-only-leon-doctor.md) without changing the [automatic routing safety policy](2026-08-28-leon-automatic-routing-safety-hold.md). Both earlier notes remain active for their independent boot-free and routing decisions. No task, model, credential, profile, or service is modified. Custom profile overrides of the settings path or dynamic provider configuration are outside this boot-free inspection; the report names the settings source it inspected.

## Alternatives considered

**Keep Qwen 9B as a required model.** Rejected because model inventory and explicit user selection can change independently of the doctor release.

**Probe every loopback provider.** Rejected because a gateway on localhost can route to an external service. The diagnostic does not query FreeLLMAPI or other providers.

**Boot the profile or send a generation request to establish readiness.** Rejected because diagnosis must not initialize state, activate tools, load models, or consume inference credits.

## Consequences

The report is useful before runtime startup but deliberately does not certify inference. Unit tests cover configured backends, unrelated models, independent health failures, malformed responses, settings failures, and non-loopback rejection. The assembled CLI snapshot reads isolated settings and contacts a temporary loopback HTTP server with no authorization headers; original settings and directory contents remain unchanged. These checks do not validate a real llama.cpp process, GPU performance, or model capability.
