# Agent Note: Web technical context visibility

Status: implemented

English | [中文](2026-08-29-web-technical-context-visibility.zh.md)

## Problem

The transcript rendered every non-user prompt-assembly message beside user and assistant messages. System instructions, skill catalogs, and time context are required model inputs and durable audit evidence, but displaying each one in normal chat made prompt preparation look like user-facing work and obscured task progress.

## Decision

The Host-backed `ui-conversation.showTechnicalContext` preference controls only transcript presentation and defaults to `false`. ChatView removes context nodes whose projected provenance role is `inject` from its visible order before rendering and scroll calculations. The Conversation snapshot, durable session log, context renderer, model request, and exported session remain unchanged.

General Settings exposes `Hidden` and `Shown` choices backed by the same reactive preference source as ChatView. Changing the preference updates the open conversation without starting a new session or rewriting history.

Context with provenance role `recall` remains visible regardless of the preference because it explains the source of cross-session continuity to the user. Its existing collapsed disclosure and producer label remain available.

## Alternatives considered

**Remove injected messages from projection or persistence.** Rejected because model-visible context must remain reconstructable from the session log, and session exports need the same audit evidence.

**Hide context rows with CSS.** Rejected because hidden DOM nodes would still affect accessibility, scroll anchors, and rendered-row calculations.

**Hide recalled session context with other injections.** Rejected because recall is user-relevant continuity evidence rather than internal prompt preparation.

## Consequences

Normal chat emphasizes user requests, task activity, and assistant results while retaining an explicit diagnostic opt-in. The visible-order filter must participate in first-node, last-node, length, paging-anchor, and follow-scroll calculations so hidden injections do not move the reader. Tests pin the default, Host persistence, live toggle, recall exception, and unchanged ordinary messages.
