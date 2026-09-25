# Agent Note: Session-scoped memory and capability overview

Status: implemented

English | [中文](2026-09-21-memory-capabilities-overview.zh.md)

## Problem

An installed skill can be invisible to the active preset. A memory editor alone cannot explain this distinction, and remembering that a capability exists can become stale when the session composition changes.

## Decision

The existing memory control provides a read-only Overview tab. Project memories, personal memories and session skills come from their owning services when the tab opens or the user refreshes it. The profile card shows the effective preset and bounded source counts. Selectable nodes, zoom and a list view support inspection; lines represent only computed similarity edges whose endpoint revisions match the displayed memories. Group positions imply no factual relationships, and the view maintains no second memory database. Personal-memory writes, confirmation, redaction and disabling remain in the existing administrative controls.

`skill.inspect` reports the effective persisted preset, scoped provider snapshot and visibility of the registered skill loader without starting an agent or inference. Execution authorization is explicitly `not-evaluated`: inspection does not run guards or ask for approval, and catalog visibility does not promise that a call is permitted. Session changes invalidate the view. Missing providers produce source-specific errors, partial snapshots remain incomplete, and no functional test is inferred from installation or tool registration.

The overview displays the latest stored revision and update timestamp of returned memories, not an exhaustive audit trail or historical diff. Its calendar marks days represented by those timestamps, not every past edit. It discloses bounded pages and limits the diagram independently of the accessible item list. Source-specific errors remain errors rather than zero counts. Skill descriptions are untrusted display data; they are not executed by inspection.

## Alternatives considered

**Import another agent's memories or scan all presets.** Rejected because it bypasses ownership and mixes installed material with session-visible capabilities.

**Use a model to construct the diagram.** Rejected because grouping existing records is deterministic and requires neither API spending nor inferred facts.

**Advertise every installed skill as tested.** Rejected because discovery and loader success do not establish that external dependencies or workflows work.

**Run execution guards while inspecting the catalog.** Rejected because guards depend on invocation arguments and may request approval or consume execution state. Authorization belongs to the actual call, not a read-only inventory.

## Consequences

Users can inspect memory and capability availability without changing models, permissions, personal records or the active preset. Updates are on demand rather than a continuous background agent. Historical memory diffs and automatic experience promotion are outside this implementation.

## Verification

Component tests cover independent source failure, partial catalogs, disabled personal memory, refresh and stale responses. Host tests cover effective preset resolution, scope isolation and read-only inspection, including a visible loader whose execution guard rejects the actual call. The wire rejects missing or fabricated authorization states. The browser scenario uses the shipped Web composition and isolated synthetic data, compares visible output and verifies no extra model response or memory mutation. These checks do not prove model selection of a skill in an unrestricted real task.
