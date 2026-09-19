# Agent Note: Model selector external consent

Status: implemented

English | [中文](2026-09-12-model-selector-external-consent.zh.md)

## Problem

The automatic-model pane offered external API consent whenever adaptive routing existed, including deployments whose policy declared no external failover. The control implied a route and data-transfer possibility that the running configuration could not use.

## Decision

`session.models` reports whether the automatic policy declares an external failover. The model selector renders the consent control only when that fact is true. Older hosts omit the field and clients interpret omission as false. Catalog rows remain configuration metadata rather than live health claims.

## Alternatives considered

**Always show a disabled control.** Rejected because it preserves the misleading suggestion that the deployment has an external route.

**Infer availability from cloud providers in the catalog.** Rejected because manually selectable providers do not prove that the automatic policy can route to them.

## Consequences

Local-only deployments present a simpler automatic pane and cannot collect meaningless consent. Deployments with external failover preserve the existing warning and deny-by-default choice. Separate runtime health reporting remains required before the selector can label a configured model as operational.
