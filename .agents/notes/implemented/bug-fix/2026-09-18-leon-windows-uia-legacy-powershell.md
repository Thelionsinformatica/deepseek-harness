# Agent Note: Windows UIA connector under Windows PowerShell 5.1

Status: implemented

English | [中文](2026-09-18-leon-windows-uia-legacy-powershell.zh.md)

## Problem

Two .NET Core-only calls broke the connector's `screenshot` when `resolvePwshPath` falls back to `powershell.exe` (Windows PowerShell 5.1, .NET Framework): the `System.Drawing.Common` assembly name does not exist, and `[IO.Path]::IsPathFullyQualified` was added in .NET Core 2.1. Separately, the test fixture relied on WinForms controls reporting `Name` as the UIA AutomationId; under stock .NET Framework the MSAA bridge reports `Pane` elements with HWND-derived ids, so `-AutomationId LeonEditor` never resolved.

## Decision

The connector loads `System.Drawing` or `System.Drawing.Common` by `$PSVersionTable.PSEdition`, and validates absolute output paths with an explicit drive-letter or UNC check that preserves the `IsPathFullyQualified` contract. The test fixture is reimplemented as a WPF window: WPF UIA providers are native and report `Name` as AutomationId on both editions. The fixture contract (MarkerPath/ReadyPath/Title parameters, non-activating low-opacity window, PID in the ready file, click writes the editor text) is unchanged.

## Verification

`apps/cli/tests/leon-windows-uia.spec.ts` passes all 6 tests under `powershell.exe` 5.1, including set-value, invoke, screenshot, and the two-identical-windows allowlist case. Behavior on PowerShell 7 is unchanged.

## Alternatives considered

Requiring PowerShell 7 narrows supported machines for no product reason. AppContext accessibility switches were verified not to make legacy WinForms providers report AutomationId. Relaxing the AutomationId contract would weaken the semantic targeting the connector exists to prove.

## Consequences

The leon-windows skill works under both PowerShell editions. The connector's read-only default, exact-allowlist mutation gate, audit trail, and refusal rules are unchanged.
