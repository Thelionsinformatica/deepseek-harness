# Agent Note: Capability-first local routing

Status: proposed

English | [中文](2026-09-05-capability-first-routing.zh.md)

## Problem

Text-oriented specialties and numbered goal rounds can select a model without image support. Prompt length also does not establish that an expert model will improve the answer.

## Proposal

The partial implementation adds an explicit vision route ahead of admission rules and a configurable size-only expert promotion switch. Both are deployment opt-ins. The host passes a conservative image-history flag derived from durable user messages and tool results; images can keep a visual route selected even after compaction. Existing availability and authorization checks remain in force. Activation waits for assembled application tests and independently verified task-failure handling.

## Alternatives considered

**Only replace the expert model:** specialties and goal rounds can still override it, so this does not resolve ordering.

**Always select the largest model:** parameter count alone is not evidence of task capability and needlessly increases local resource use.

## Acceptance criteria

Verify visual admission across specialties, recovery and goal rounds; verify retained-history images; demonstrate bounded escalation after a failed task check in a real composition; preserve external authorization and report the selected route. Passing classifier tests alone is insufficient for activation.

## Risks

A declared vision route may still be unavailable or misconfigured. The classifier does not inspect model weights, validate task correctness or implement a complete capability registry. The compatibility defaults retain existing behavior until deployment explicitly opts in.
