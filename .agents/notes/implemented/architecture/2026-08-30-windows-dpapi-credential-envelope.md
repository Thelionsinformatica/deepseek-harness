# Agent Note: Windows DPAPI credential envelope

Status: implemented

English | [中文](2026-08-30-windows-dpapi-credential-envelope.zh.md)

> Scope: add at-rest protection to the local Windows credential document without weakening the atomic registration and same-user boundary documented in [credential boundaries](2026-07-30-credential-boundaries-and-atomic-registration.md).

## Problem

`credentials-local` stored its logical version-1 YAML document as plaintext on Windows. The file ACL limited ordinary access to the current user, administrators, and SYSTEM, but an accidental copy, diagnostic bundle, or offline disk read could expose provider names and values directly. Boot and write paths also needed one transition rule that could not silently replace a valid plaintext source with an unreadable encrypted document.

## Decision

On Windows, the provider stores the complete version-1 logical document inside a version-2 YAML envelope protected with Windows DPAPI `CurrentUser` scope and package-specific optional entropy. The envelope exposes only its version, protection identifier, and canonical-base64 payload; credential references, records, values, comments, and formatting remain inside the protected payload.

Protection is fail-closed. Each new blob is immediately decrypted and compared with the source bytes before the atomic replacement. A protect, decrypt, UTF-8, comparison, or parse failure aborts activation or the write and leaves the last disk document intact. Credential bytes travel to the fixed inbox Windows PowerShell helper through standard input and output, never through argv, the child environment, or diagnostics.

Boot accepts the recognized pre-release flat layout and the version-1 document as migration sources. It re-reads under the existing cross-process writer lock, validates the logical document, protects and verifies it, then atomically commits the version-2 envelope. A competing boot that finds an already committed envelope uses it without rewriting. A live plaintext downgrade is rejected and retains the last good snapshot until a restart can perform the locked migration.

POSIX keeps the version-1 document under `0700`/`0600`; this change does not claim a portable cross-platform keychain. DPAPI is an at-rest boundary against offline inspection and other Windows users, not against a process already running as the same Windows user. Same-user tools can invoke DPAPI, and a genuinely isolated deployment still requires a brokered keychain or service whose decrypt operation is unavailable to those tools.

## Verification

The provider test suite covers protected reads and writes, plaintext migration, concurrent migration, malformed envelopes, unsupported protection identifiers, non-canonical payloads, protection and verification failures, live downgrade rejection, secret-free diagnostics, output bounds, and a native synthetic DPAPI round trip on Windows. Existing atomic-write, watcher, record, drain, and comment-preservation tests run through an injected deterministic protector so their logical-document guarantees remain exercised.

## Alternatives considered

- **Encrypt individual values** — rejected because credential names, record metadata, comments, and document structure would remain readable and every editor path would need encryption-aware scalar handling.
- **Use file ACLs alone** — retained as defense in depth but rejected as the only at-rest control because copies and offline reads can escape the intended ACL context.
- **Present DPAPI as model isolation** — rejected because tools and the provider execute as the same Windows user; the operating system permits that user to invoke the same decrypt primitive.
- **Silently fall back to plaintext** — rejected because a protection outage must stop the operation rather than downgrade the credential store without notice.

## Consequences

The Windows credentials document is no longer portable as a self-contained plaintext artifact and must not be treated as a machine-independent backup. Leon's backup flow continues to exclude the credential vault, so credentials are registered again after restoration. Every protected read or write starts a bounded local helper process, adding latency to rare credential-management operations while preserving the existing in-memory provider API. A plaintext version-1 Windows document migrates on the next successful provider boot; its original bytes remain untouched if protection cannot be completed and verified.
