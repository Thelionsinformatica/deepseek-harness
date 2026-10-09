# Agent Note: Persisted per-profile skill availability

Status: implemented

English | [中文](2026-09-25-profile-skill-selection.zh.md)

## Problem

Installed skills were discoverable in the composer, but a person could not manage their availability in Settings. Hiding a composer entry would not stop the model loader, explicit invocation, or configured autoload. Editing shared skill files would also change unrelated profiles.

## Decision

The existing `agent-presets` settings namespace owns `disabledSkills`, a map from preset id to skill-name arrays. Missing entries preserve existing availability. The Settings Skills section lists installed metadata for a selected profile and optionally a registered workspace; the workspace changes discovery, not the profile-wide policy. Writes use the existing revision-checked `settings.mutate` contract and retain disabled names absent from the current inventory.

Each standing preset mount registers a live restriction with `ctx.skills`. Restrictions compose across the global and inherited scope chain; a nearer scope cannot override a denial. `snapshot()` and `list()` hide unavailable skills. `get()` checks availability after discovery, before loading the body, and again after asynchronous loading, without a bypass option. A settings-provider disposal retains the last confirmed restriction rather than enabling skills during teardown.

`inventory()` returns metadata including disabled skills, not definitions. The loopback-only `skill.catalog` RPC resolves the preset through its standing composition and a workspace through the host registry, without starting or resuming an agent. It rejects observations whose settings revision or preset generation changed during discovery. Source labels are normalized; bodies and filesystem paths are not returned.

This extends the [skill system](2026-07-05-skill-system.md) and [invocation-policy decision](2026-07-28-skill-invocation-policy.md). Both remain active: discovery and frontmatter invocation policy retain their separate ownership. Availability is an additional restriction, never an override of `modelInvocable` or `userInvocable`, and never execution authorization.

## Alternatives considered

**Only hide disabled entries in the browser.** Rejected because other consumers could still load their bodies and the displayed state would not describe host behavior.

**Rewrite each skill's frontmatter.** Rejected because shared files can serve several profiles, upgrades can replace them, and file edits lack the existing settings revision fence.

**Store a second catalog or browser-local preference.** Rejected because availability belongs to the host's persisted profile policy. The registry remains the single discovery mechanism and Settings remains the single preference store.

## Consequences

The selection survives host restart, applies to children inheriting the same standing profile, and does not change the default preset or other profiles. Concurrent edits receive explicit conflict results instead of overwriting newer settings. Incomplete discovery and read-only settings have visible UI states.

Disabling affects subsequent reads and loads; it does not erase instructions already recorded in a conversation or restrict independent filesystem tools. When discovery is incomplete, a consumer can retain its previous catalog summary, but a disabled body still cannot load. External catalog installation, package review, and sandbox permission changes are outside this delivery.

Registry, consumer, preset, API, and client tests pin these boundaries. The isolated `apps/web/tests/skills-settings.e2e.ts` uses the real Loader, file-backed settings, transport, and Chromium with no model adapter; it tests the toggle, host enforcement, page reload, sibling-profile independence, and an accessible UI snapshot.
