# Letta memory provider experiment

English | [中文](letta-memory-provider-experiment.zh.md)

## Verdict

Leon does not adopt Letta as a `MemoryProvider`. The local provider remains the source of truth and the shipped default. This is a completed no-go decision, not an unfinished migration.

## Baseline

The local path passed all 31 LEON-EVAL-PTBR scenarios across three stable runs. Oracle precision and Recall@k were 100%, while workspace, user, sensitive-data, and cloud leakage remained zero. The memory package scope also passed 139 tests.

## Compatibility gate

| Requirement | Local provider | Current Letta candidate |
|---|---|---|
| Workspace-owned records | Native and fail-closed | Must be invented by an adapter |
| Exact compare-and-set revision | Native | No matching Agent SDK contract |
| Temporal history and supersession | Native | Different git/block memory model |
| Bounded administrative listing | Native | Different agent/repository APIs |
| Create, search, correct, forget parity | Complete | No current provider-shaped API |
| Cheap `available()` without network I/O | Complete | Requires another runtime |
| No extra model or cloud cost | Complete | Depends on selected Letta backend |

The official Letta project retired its V1 server and moved active development to Letta Agent and the App Server. The checked-in community MCP example remains useful only for an existing V1 0.16.x deployment; it does not make Letta a Leon memory provider and must not be connected to the current App Server.

## Adoption threshold

A future adapter is eligible for another experiment only when it:

1. passes every critical LEON-EVAL isolation, privacy, consent, and injection case;
2. improves paraphrase recall by at least 10 percentage points over the local baseline;
3. keeps p95 retrieval latency at or below 2,000 ms on the deployment machine;
4. preserves revision conflict detection, temporal history, and deterministic deletion;
5. performs no cloud transfer or billable model call without explicit consent; and
6. remains optional, with `LocalMemoryProvider` as the rollback path.

## Environment observation

At evaluation time, this Windows deployment had no Letta CLI, Letta MCP bridge, Docker, Podman, or responding legacy endpoint at `127.0.0.1:8283`. Installing a second agent harness solely to manufacture a benchmark would not demonstrate provider compatibility, so the experiment stopped before transmitting memory or adding machine-wide dependencies.

## Related decisions

- [Provider-neutral workspace memory](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.md)
- [Rejected direct Letta provider](../../.agents/notes/rejected/architecture/2026-08-25-direct-letta-memory-provider.md)
- [LEON-EVAL-PTBR](leon-eval-ptbr.md)
