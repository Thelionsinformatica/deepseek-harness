# Agent Note: Mission reserve requires a host-bound session identity

Status: implemented

English | [中文](2026-09-12-mission-reviewer-session-identity.zh.md)

## Problem

The experimental execution guard accepted reviewer display names and their prefixes or suffixes. A model-controlled label could therefore claim the final inference reserve without an authorized review assignment.

## Decision

The host configures `reviewReserve.reviewerSessionId` with a native, persistent teammate ID. Execution copies that policy on installation. Before admitting any inference or tool, it checks that the ID belongs to this mission's persisted roster and is neither the Lead nor a failed or provisioning participant. Inactive teammates remain eligible for native resume. Native membership still checks the exact live Agent object. Display names carry no review authority.

Legacy `reviewerName` configurations fail closed; the runtime does not convert names or edit frozen laboratory manifests. A host must provision and bind the reviewer before using the reserve. The normal composition is unchanged, and the guard does not auto-complete tasks, increase budgets, revise criteria, or authorize cloud fallback. STOP and deadlines remain authoritative.

The source-resolution facade includes the three experimental Loader entries and the Web-access UI entry. The package-files check includes the explicit private laboratory bundles and shared chunks without admitting an experimental runtime dependency into the official CLI.

## Alternatives considered

**Exact display-name matching.** This closes only the prefix/suffix defect; a model could still choose the privileged exact name.

**An independent role or task database.** Native session identity and the existing roster already provide the required authority. Duplicating them introduces reconciliation and recovery ambiguity.

**Automatic migration of old laboratory configurations.** Inferring authority from labels changes a frozen experiment and cannot demonstrate that the host selected the participant.

## Consequences

Name spoofing and mutable caller-owned config objects cannot grant the review reserve. Missing, failed, foreign, provisioning or Lead IDs fail before spending inference calls. Experiments using name-based assignment require an explicit host-side integration; this patch does not claim to complete that bootstrap workflow or solve repeated host feedback after an admission refusal.

## Verification

The mission-control suite exercises persistent teammate resume, exact-name/prefix/suffix impersonation, config mutation, concurrent reservations, invalid reviewer composition, STOP and budget retention. Fixture provisioning and resume use scripted responses before admission; those tests prove authorization of existing sessions, not real-model bootstrap within the mission budget. The headless Loader scenario independently records a blocked mission with zero admitted calls and unchanged import policy when no reviewer ID is bound. No real-model performance is inferred from these tests.
