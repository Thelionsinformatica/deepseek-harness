# Agent Note: Explicit collective runtime bridge

Status: implemented

English | [中文](2026-09-12-explicit-collective-runtime-bridge.zh.md)

## Problem

The product CLI needs an operator-visible entry to the native collective laboratory without importing private experimental packages, altering normal profiles or turning a demonstration into evidence of execution.

## Decision

An explicit runtime, composition, workspace, action and bounded `import-idempotency` scenario authorize a separate Node process. The release launcher validates local absolute paths, refuses arbitrary mission text, and forwards the runtime's output and exit code without synthesizing results. Runtime and composition files are trusted operator inputs, not model-generated executable attachments. No TypeScript loader, package installation or shell is injected. The child inherits only OS path/temp variables plus a fixed local placeholder, not provider credentials, Node flags or the user's Harness home.

The [preview denial](../bug-fix/2026-09-12-collective-preview-refuses-execution.md) remains active for calls without an explicit runtime. Dry-run always wins and cannot execute the child. Native persistence, permissions, bounded inference and completion verification remain the laboratory runtime's responsibilities. Interruption waits for the child to close and returns a cancellation code; only the explicit runtime STOP operation owns durable cancellation.

## Alternatives considered

**Importing the experimental package into the release CLI** makes a private prototype a production dependency and allows ordinary startup to mount it accidentally.

**Running an arbitrary task string through the bridge** implies general task support that the fixed import scenario does not implement. The operator must select the supported scenario instead.

## Consequences

The bridge enables explicit local integration without promoting the laboratory. Scrubbing environment variables reduces ambient credential exposure but is not a filesystem or OS sandbox. Runtime trust, model quality, STOP persistence and mission evidence need their own validation. Source-entry subprocess tests cover exact arguments, inherited output, nonzero exits, invalid paths, dry-run precedence and interruption; a scripted JavaScript child does not establish model competence.
