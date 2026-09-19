# Agent Note: Leon default Windows workspace

Status: implemented

English | [中文](2026-08-22-leon-default-windows-workspace.zh.md)

## Problem

Leon needs one predictable project directory on Windows so Web sessions, one-shot sessions, filesystem tools, and sandbox policy do not silently start from different launch directories. The same policy must remain configurable for a future installer and usable on hosts without an `E:` drive.

## Decision

`resolveDefaultWorkspace()` is the single resolver for new-session and deployment fallback paths. It accepts an explicit path, then `$LEON_DEFAULT_WORKSPACE`, `$DSH_DEFAULT_WORKSPACE`, and `$DSH_CWD`; blank values are ignored. With no override it returns `E:/computador` on Windows and the invoking directory on other platforms. Every result is absolute, relative values resolve from the invoking directory, and supported tilde prefixes expand through the shared path helper.

The Web API gateway and headless runner assign this result to new sessions. The base sandbox policy, sandboxed filesystem, and minimal preset use the same resolver. A client-selected workspace and a session's persisted workspace remain authoritative after session creation.

The resolver does not create the selected directory. The current Leon machine and a future Windows installer create it before launch; an operator who configures another path owns that directory and its permissions.

## Verification

Unit coverage pins override precedence, blank handling, path normalization, tilde expansion, and platform fallback. Loader composition coverage proves `!!js` entries can call the resolver, and headless coverage proves the resolved path is written into the new Session header. Configuration validation checks the shipped bundle and preset expressions.

## Alternatives considered

**Keep the invoking directory everywhere.** Rejected because shortcuts, services, terminals, and development launches can have different invoking directories, making Leon's writable project root unpredictable on Windows.

**Hardcode `E:/computador` independently in every consumer.** Rejected because the copies could diverge and an installer would need to patch multiple packages and configuration files.

**Create the directory from every runtime consumer.** Rejected because path creation and permission setup belong to installation or deployment. A library silently creating a configured path would hide installation errors and duplicate side effects across processes.

## Consequences

Leon has one stable Windows project root and one installer-facing override. Existing `DSH_DEFAULT_WORKSPACE` and `DSH_CWD` integrations remain usable below the Leon-specific variable. Machines without a usable `E:` drive must set `$LEON_DEFAULT_WORKSPACE` or receive an installer-selected path before starting Leon; the runtime fails through the consuming filesystem or process operation instead of silently moving work elsewhere.
