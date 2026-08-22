# Agent Note: Leon local product profile

Status: implemented

English | [中文](2026-08-21-leon-local-product-profile.zh.md)

## Problem

The fork's product identity existed only as local patches applied after installation. Those patches were overwritten by rebuilds, kept the original product name in several surfaces, and made the running application differ from the reviewed source. Portuguese was available only through the generic fallback layer, so settings owned by client plugins and known permission names still appeared in English. The deployment also shipped no first-class Leon preset.

The official brand embedded a 2398 by 603 PNG in its JavaScript bundle even though the application already publishes a compact favicon. The Web document advertised English and a fullscreen PWA, which did not match the localized desktop-like experience. The production dependency graph also contained known advisories in transitive packages with compatible patched releases available.

## Decision

Leon is a source-owned product profile in this fork. The CLI ships a `leon` preset beside the existing presets, with Portuguese metadata, a Leon persona, and a 12-round cap for the Ralph workflow. The browser localizes the high-traffic settings, plugin inventory, preset, and permission surfaces in Brazilian Portuguese. Known permission identifiers are translated at their presentation boundary; custom permission names remain unchanged.

The preset bundles the `leon-project-engineer` skill and resolves its directory relative to the preset itself. Only agents using Leon receive that catalog entry, alongside user and project skills. The skill distinguishes explanation, diagnosis, implementation, and external publication; it guides project inspection, scoped edits, proportional verification, diff review, progress reporting, and evidence-backed handoff without granting another tool or permission.

The official brand renders the already-public `/favicon.ico` instead of importing the large raster asset into the client bundle. Its small company label remains legible, including in forced-colors mode. The Web document declares `pt-BR`, and the manifest uses `standalone` display with colors that match the dark application shell.

Security fixes use range-scoped workspace overrides for compatible patched releases of affected transitive packages. This keeps the existing package API boundaries while removing the audited production advisories. The lockfile records the resolved versions.

Pull-request CI preserves the original project's private enterprise runners in the upstream repository and selects standard GitHub-hosted Linux and Windows runners in forks. This makes the inherited workflow executable after Actions is enabled on the fork without weakening upstream capacity or failover policy.

The built fork is the runtime source of truth. Local startup code may select a data directory and protect it with operating-system access controls, but it does not patch installed dependencies or rewrite provider credentials. Provider configuration remains user-owned runtime state.

## Testing

The shipped Web composition test mounts Leon, confirms the skill remains absent from the global layer, and loads its full instructions through the real skill tool. A keyless Loader snapshot pins the model-visible catalog summary, bundled source metadata, resource directory, and loaded content.

## Alternatives considered

**Continue patching `node_modules` after every installation.** Rejected because the result is not reviewable in the fork, disappears on reinstall, and can leave source, build output, and runtime showing different identities.

**Translate only through the generic Portuguese fallback.** Rejected because plugin-owned copy and dynamic permission labels bypass that dictionary. Native dictionaries at each owner preserve live language switching and make missing coverage testable.

**Rename every `@deepseek-ai` package immediately.** Deferred. The package family is an internal monorepo protocol spanning manifests, generated artifacts, documentation, and release automation. A partial rename would break workspace composition; a complete public-scope migration needs its own release decision.

**Apply blanket major-version dependency overrides.** Rejected because that could silently cross API contracts. Overrides are limited to patched releases compatible with the dependency ranges already consumed by the repository.

**Keep the upstream-only runner labels in the fork.** Rejected because jobs would wait forever for private runner pools the fork cannot access. Repository-aware runner selection retains one workflow contract while giving forks an available execution path.

**Put the project workflow in Leon's persona.** Rejected because every request would pay the prompt cost and unrelated conversations would receive software-project instructions. A discoverable skill keeps the catalog entry short and loads the workflow only for matching work.

**Copy Codex product internals into the fork.** Rejected because the transferable behavior is the project workflow, while product-specific internals would create an unsupported dependency and would not fit the harness skill interface.

## Consequences

A clean official build now produces the Leon identity and Brazilian Portuguese interface without a post-install mutation. The same preset is available to new installations, while an existing local preset with the same id can still be selected according to the roster's normal root precedence.

Leon sessions automatically discover the bundled project workflow without affecting other presets. The model sees one additional catalog summary on those sessions and pays for the full instructions only after the task matches the skill or the user invokes it.

Only the highest-use namespaces are native Portuguese in this increment. The existing fallback dictionary continues to cover unported strings, so later packages can move to owner-local dictionaries independently.

The official brand bundle no longer contains the large inline PNG, and the installed PWA behaves as a standalone application. Production dependency audit results are clean at this decision point; future lockfile updates must rerun the audit rather than assuming the overrides remain sufficient.

Local provider credentials are neither copied into the repository nor changed by the build or launcher. Operational access-control setup remains platform-specific and must fail visibly if it cannot protect the selected data directory.

The fork still requires its owner to enable GitHub Actions once in repository settings; runner selection cannot override that GitHub safety control.
