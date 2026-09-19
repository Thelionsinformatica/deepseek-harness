# Agent Note: Leon Work dashboard over real workspace projections

Status: implemented

English | [中文](2026-08-22-leon-work-dashboard.zh.md)

## Problem

Leon needs a work-oriented starting surface that feels closer to ChatGPT Work while preserving the existing local-first conversation experience. The generic blank-session Hero previously offered only identity, workspace selection, and the composer. Hard-coding product cards into the conversation package would couple Leon-specific presentation to a reusable domain shell, while showing invented GPU or provider status would misrepresent state the browser cannot currently observe.

## Decision

The conversation package declares one optional root-scoped `conversation.hero.dashboard` slot between the Hero headline and workspace controls. A new `ui-work-dashboard` product package occupies that slot in the shipped Web composition. Removing the package restores the previous Hero without changing the conversation package or its resident composer.

The dashboard derives every numeric card from the existing Workspace and Session projections: connected workspaces, ordinary nonarchived sessions that are running, sessions waiting for user interaction, and completed unopened sessions. Its recent-work list uses the three most recently updated nonblank, nonarchived, nonsubagent sessions. Starting work and opening recent work delegate to the owning Workspace and Session runtimes rather than reproducing navigation state.

The local-first card is explanatory and points users to the existing current-model composer chip. It makes no claim that a local model, GPU, Ollama service, or cloud API is healthy because no authoritative browser projection exists for those facts yet. Product copy is authored in Brazilian Portuguese with complete English and Simplified Chinese dictionaries.

## Alternatives considered

**Build the dashboard directly inside `ui-conversation`.** Rejected because the cards, Leon copy, and product roadmap are not conversation-domain invariants. A slot keeps the generic shell reusable and makes the whole dashboard removable through composition.

**Replace the application frame with a separate dashboard route.** Rejected for the first milestone because it would duplicate or interrupt the sidebar, blank-session composer, and session transition that already work. The optional Hero occupant provides a coherent starting surface without splitting navigation.

**Display placeholder GPU, Ollama, memory, and API health.** Rejected because attractive but fabricated status would erode trust. Those cards require explicit runtime projections and their own failure semantics before entering the dashboard.

## Testing

Component tests pin real metric derivation, exclusion of archived, blank, and subagent rows from recent work, recency ordering, empty state, task start, and recent-session navigation. Browser-plugin tests pin declaration order, locale and action injection, HMR collapse, and teardown on a real SlotRegistry. Conversation tests pin the new root-scoped slot and Hero render call. An assembled Web scenario boots the shipped composition, observes the dashboard on a fresh world, connects a workspace through the existing picker, and verifies the live project count without console repair warnings or page errors.

## Consequences

Leon now opens with a compact work overview while the same composer remains the place to start and execute a task. The first milestone improves continuity and discoverability without introducing a second source of truth. Live model-provider health, deliverable aggregation, scheduled work, memory review, and permission audit remain later milestones that must each arrive behind authoritative projections and tests.
