# Agent Note: Host-owned model assignments

Status: implemented

English | [中文](2026-09-13-host-model-assignments.zh.md)

## Problem

Selecting a conversation model does not configure independently invoked titles, summaries, delegated workers or completion auditors. A settings-only representation without consumers makes the displayed role misleading.

## Decision

The optional policy in [agent-default-model](../../../../packages/core/agent-default-model/README.md) owns a single settings section for five host-assigned functions. Existing consumers resolve its selection before their normal logging or child creation. Unconfigured compositions preserve their behavior, including frozen laboratories. A provider is local only when the deployment explicitly lists it; external routes require role-specific consent. The UI uses the existing settings API with optimistic concurrency and performs no inference during catalog refresh.

## Alternatives considered

**Another multi-agent framework:** rejected because existing delegation and auditing already own sessions and completion evidence.

**Route by participant display name or localhost URL:** rejected because names do not establish authority and gateways can forward to paid external providers.

**Editable placeholders for every reference-image function:** rejected because unsupported MCP, approval and skill consumers would falsely suggest independent dispatch.

## Consequences

The UI separates main, auxiliary and collaboration assignments without changing permission policy, creating extra agents, or weakening auditing. Existing children retain their captured model; clearing a role restores its consumer's inherited configuration. Per-role API consent is not a monetary cap. Keyless Loader coverage records the actual title route; UI and service tests cover writes, conflicts and external-consent rejection. Paid inference and experimental mixture presets remain outside this delivery.
