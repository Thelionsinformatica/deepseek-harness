# Agent Note: Confirmed personal interview

Status: implemented

English | [中文](2026-09-21-confirmed-personal-interview.zh.md)

## Problem

The personal-memory editor expects users to know what to record. A guided introduction makes preferences easier to express without treating every conversation as permission to store personal information.

## Decision

`GettingToKnowYou` in `ui-work-dashboard` asks five optional questions inside the Personal memory panel. Answers remain component-local drafts. Each review card uses the existing confirmed personal-memory operation only after an explicit save click. The question and edited answer are stored together without model inference. Closing discards unsaved drafts; saved entries remain available through the existing correction and forgetting controls.

The host retains authorization, sensitive-content checks, ownership isolation, persistence, and audit. Disabled or read-only memory disables saving. Client in-flight protection prevents repeated clicks during one save; an uncertain failure retains the draft and asks the user to inspect existing records before retrying. This is not a cross-request idempotency guarantee. Preferences are descriptive and never change permissions. Approved memories may later be recalled to an external provider under the existing configuration, which the panel discloses.

## Alternatives considered

**Automatic extraction from chat.** Rejected for this stage because it changes consent and introduces model-dependent interpretation rather than preserving the user's answer.

**A separate onboarding database.** Rejected because personal memory already owns storage and lifecycle operations. The interview is a presentation layer, not another source of truth.

**A complete memory graph.** Deferred because a graph needs verified relationships and provenance; the introduction does not infer either from personal answers.

## Consequences

Users can provide preferences gradually without model cost or granting operational permissions. Drafts are intentionally lost on unmount or refresh. The UI is a guided form, not a spontaneous chat conversation or a guarantee that every future response will recall every memory.

## Testing

Component tests cover no writes before confirmation, editing, skipping, discarding, repeated clicks, failed saves, and disabled writes. `apps/web/tests/personal-interview.e2e.ts` exercises the shipped Web composition with isolated persistence, checks that drafts do not appear in the host store, and reloads the confirmed entry. It makes no model request and does not validate model recall quality.
