# Agent Note: Direct automatic selector entry

Status: implemented

English | [中文](2026-09-13-automatic-selector-entry.zh.md)

## Problem

Users should not need to inspect a model catalog to find automatic routing.

## Decision

The composer menu exposes the existing automatic action directly. Manual selection remains optional. The Host retains routing and consent authority; opening the menu makes no selection. This UI change neither changes deployment defaults nor validates specialist execution.

## Alternatives considered

Relabeling every manual selection as automatic was rejected because it would misrepresent the Host state. Granting cloud access on menu open was rejected because presentation is not authorization.

## Consequences

Existing session selections remain intact. Focused component and plugin tests cover selection and consent. End-to-end autonomous task quality is outside this presentation change.
