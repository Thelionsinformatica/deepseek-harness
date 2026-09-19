# Agent Note: Product action menu in the Leon composer

Status: implemented

English | [中文](2026-08-23-product-action-composer-menu.zh.md)

## Problem

The composer's leading plus button opened the low-level command catalog directly. Although the command path was real, the control did not explain the work-oriented actions available to a user and made files, Workspaces, goals, planning, and installed skills discoverable only through separate technical triggers.

## Decision

The plus button now opens a compact product-action menu inside `InputBar`. Every row delegates to an existing owner: Files and folders opens a native multi-image picker and feeds its selection through the existing attachment intake, Reference from project opens the `reference` input-trigger source, Work in a project reads the Workspace projection and uses the Workspace runtime to connect or register a native-picked directory, Goal seeds the claimed `/goal` command while preserving draft text, Planning mode submits `/plan` or `/plan off`, Plugins and skills opens the `skill` source, and Advanced commands opens the `command` source.

The menu is navigation over existing capabilities, not a second command system. The durable image service remains responsible for validating and retaining local selections, the existing input-trigger `MenuView` remains responsible for project reference, skill, and command discovery and selection, the Workspace runtime remains responsible for project state, and session commands remain responsible for goal and planning behavior. The product menu only renders actions whose required owner is available and does not advertise unavailable external connectors or unsupported generic document attachments.

## Alternatives considered

**Keep the plus button as a direct command launcher.** Rejected because it preserved technical access but did not provide the approachable Work-style entry point the Leon product requires.

**Copy every connector shown by another product.** Rejected because Leon must not promise integrations that are not installed and connected. Installed skills are shown through Leon's authoritative skill source, and future connectors must arrive with their own real capability owner.

**Implement separate file, skill, and project browsers inside the composer.** Rejected because duplicate discovery and persistence paths would drift from the existing input-trigger and Workspace domains.

## Testing

InputBar component tests cover menu visibility, the native local-picker launch and selected-image intake, project-reference and skill routing, advanced-command selection, goal draft preservation, plan entry and exit, Workspace listing, project switching, and local-folder registration. Injection tests continue to cover session-absent behavior and Workspace draft transfer. A keyless assembled-Web scenario connects a real Workspace, compares the product-action menu's stable accessibility tree with a committed golden, verifies that the chooser accepts multiple files, attaches a real PNG into the pending-image rail, and removes it again; the full build, 4,026 GUI tests, lint, and a local built-interface pass verify the shipped composition.

## Consequences

Leon exposes the most useful work actions from one familiar control without hiding the existing slash-command workflow. The menu improves discoverability and product clarity while preserving one source of truth for each capability. External service plugins remain a separate roadmap item and appear only after they are actually installed and connected.
