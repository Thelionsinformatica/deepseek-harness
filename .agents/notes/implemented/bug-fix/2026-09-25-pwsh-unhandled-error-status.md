# Agent Note: Stop unhandled PowerShell errors before later success masks them

Status: implemented

English | [中文](2026-09-25-pwsh-unhandled-error-status.zh.md)

## Problem

PowerShell's default continuation policy lets a method invocation or cmdlet emit an error and continue to a successful statement. A hash-inspection command passed a hexadecimal string to `BitConverter.ToString`, which expects bytes; the interpolation emitted an empty hash, later output succeeded, and the process exited 0. The tool correctly returned the process result, but no nonzero exit marker warned its consumer that execution had failed partway through.

## Decision

The `pwsh-local` argv preamble sets `$ErrorActionPreference = 'Stop'` before caller text. Unhandled PowerShell errors terminate foreground and background commands; `pwsh-sandbox` inherits the same invocation. Error diagnostics and process status stay owned by PowerShell and the subprocess collector. There is no stderr classification or history scan.

Explicit `try/catch`, `-ErrorAction`, and script preference overrides preserve PowerShell semantics. Native stderr is not an error signal, and native exit forwarding remains explicit through `exit $LASTEXITCODE`. A script can deliberately continue or suppress an error; the executor does not override that decision or infer whether the command's business result is correct.

The tool result contract stays unchanged: `isError` describes tool/transport failure, while a completed command returns typed exit, timeout, abort, and signal facts. A nonzero command exit renders its existing `[exit code: N]` marker. This preserves the result and presentation contract from the [PowerShell tool decision](../feature/2026-08-01-pwsh-tool-and-executor.md).

## Alternatives considered

**Match error-looking stderr text.** Rejected because programs can legitimately write diagnostics, quote error messages, or localize them. Text matching would misclassify valid commands and suppress legitimate stream content.

**Treat any `$Error` entry as failure.** Rejected because PowerShell retains errors that a caller caught or explicitly suppressed. That would mark handled failures as unsuccessful.

**Wrap every command in a custom catch and synthesize tool errors.** Rejected because it changes error formatting and conflates command failure with executor failure. PowerShell already supplies termination and an exit status under its stop policy.

## Consequences

Unhandled PowerShell errors stop dependent statements instead of allowing misleading success output. Scripts that intentionally recover must express their handling; the executor does not act as a verifier of hashes, files, or claims. Native executable status, output truncation, deadlines, cancellation, and process ownership remain unchanged. Persistent terminal sessions are a separate provider and are not changed by this decision.

Real-process tests cover the interpolation failure, cmdlet and nested-script errors, explicit handling, legitimate stderr, native exit forwarding, background settlement, and the Windows PowerShell fallback. The runnable `examples/headless-agent/pwsh-error-status.cordis.yml` scenario feeds real tool results back into a scripted model and checks persisted session evidence without an external model call.
