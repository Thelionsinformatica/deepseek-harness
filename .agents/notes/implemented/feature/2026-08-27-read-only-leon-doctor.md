# Agent Note: Read-only Leon doctor command

Status: implemented

English | [中文](2026-08-27-read-only-leon-doctor.zh.md)

## Problem

Leon needs one support entry point that distinguishes an incomplete installation, a stopped optional service, and a port conflict before a profile boots. Starting the full application to diagnose it can initialize profiles, open a browser, mount tools, and obscure the failing prerequisite.

## Decision

The launcher owns `dsh doctor` as a boot-free read-only mode. It checks the supported Node runtime, PowerShell on Windows, Harness home and workspace access, installed profile files, built launcher, Ollama model inventory, and the expected loopback Web endpoint. Every network probe is a bounded GET that sends no prompt or credential; filesystem probes never create or repair a path.

The human report uses PT-BR status lines. The JSON report has `schemaVersion: 1`, stable check ids, sanitized summaries, and no credential values or file contents. A recoverable absence such as a stopped Web process, unavailable Ollama service, uninitialized profile, or source-only build is a warning and exits 0. A prerequisite failure or a non-Leon service occupying the expected Web port exits 1.

The command checks readiness but does not own installation, service supervision, backup, recovery, or repair. Those operations may consume the JSON report without changing this diagnostic's read-only behavior.

## Alternatives considered

**Boot the selected profile and inspect its services.** Rejected because the diagnostic would depend on the system it must diagnose and could initialize user state or activate external capabilities before reporting a missing prerequisite.

**Expose diagnosis as a model-facing tool.** Rejected because installation recovery must work before an agent or model provider is available, and model mediation would add cost and authority to deterministic host checks.

**Probe every configured provider and external connector.** Rejected because health requests could cross a privacy or billing boundary. The first version probes only Ollama's model directory and the loopback Web page; provider validation remains explicit and separately authorized.

## Consequences

Operators and future installers receive one deterministic readiness report without changing the machine. The report captures a point-in-time observation and does not prove long-duration service health, model quality, database integrity, external credentials, or successful task execution. Bounded probes trade exhaustive response inspection for predictable latency and memory use.
