# Agent Note: Reserve final inference calls for review

Status: implemented

English | [中文](2026-09-07-review-call-reserve.zh.md)

## Problem

The coordinator can exhaust a mission before a worker verifies its final artifact. A pre-step investigation limit does not protect the remaining calls from the coordinator or queued requests.

## Decision

The experimental execution plugin accepts an optional named-teammate review reserve. It checks the persisted count inside its single-generation slot before consuming a reservation. Other members, including Lead, cannot consume the final allocation. The composition retains responsibility for requesting review and proving the current artifact; this policy grants neither approval nor extra budget.

## Alternatives considered

**Prompt-only reservation:** cannot deny a queued coordinator call at dispatch.

**Increasing the mission ceiling:** hides coordination waste and changes the evaluation budget.

## Consequences

The keyless Loader scenario uses actual Team membership to select fixture behavior; role words in received messages are not identity. Its negative configuration reserves 47 of 48 calls for checker and asserts persisted denial, unchanged artifact and blocked completion. The ordinary scenario retains successful collaboration and STOP reopening checks. These controlled responses validate composition rather than local-model capability.

The normal composition remains unchanged. Invalid or late artifacts may still fail, and the reviewer may waste its allocation. The guarantee applies to calls through one executor, not direct host reservations or concurrent processes. Focused tests exercise coordinator denial, named reviewer admission, and concurrent requests; model reliability and full-team crash recovery require separate evaluation.
