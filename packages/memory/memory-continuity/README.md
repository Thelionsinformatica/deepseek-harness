# @deepseek-ai/dsh-memory-continuity

English | [中文](README.zh.md)

Portable snapshots and idempotent restore for local memory lineage records.

## Consumer contract

Callers supply source domains and destination tables. The package does not configure storage, schedule backups, or expose model tools. It preserves the record format owned by memory-local and requires no PostgreSQL service.

Export validates records and adds SHA-256 checksums. Serialization is stable for the same snapshot; export timestamps vary unless supplied. Checksums detect corruption, not malicious modification by someone who can recompute them. Snapshots contain plaintext memory and require caller-controlled access.

Import validates the complete snapshot and all destination names and versions before writing. Duplicate domain names, destination names, and record IDs within a domain are rejected. Each missing ID is inserted through the table's atomic conditional mutation; existing IDs are skipped even if their contents differ.

There is no multi-domain transaction. A storage failure rejects with `Memory import incomplete` and may leave earlier writes committed. Repair storage and retry the same snapshot to skip existing records. Import does not roll back or overwrite concurrent writes. Destinations must implement the KvTable mutation contract.

## Journal and persistence

Import returns counters and a journal entry only after success. `exportJournal` constructs an export entry. Neither function persists a journal; callers own durable append, backup file writes, and recovery. A retry's counters describe that attempt, not all previous attempts.

## Verification

The write-interruption example injects child-process termination after a partial temporary file write and on either side of atomic rename. Fresh Loader processes reopen the complete expected state. Temporary files can remain after termination; the test does not implement automatic residue cleanup or simulate physical power loss.

The restart scenario also exits immediately with code 73 after an acknowledged write and snapshot export, bypassing plugin disposal. The parent verifies that the clean-shutdown marker is absent and then reopens the records in fresh processes. This tests process termination after commit, not interruption during a write or physical power loss.

The disk-backed restart example at `examples/headless-agent/memory-restart.cordis.yml` uses the built JSON backend and domain layer in separate processes. It verifies lineage after graceful process exit, restore into a new domain, idempotence after another restart and refusal of malformed storage without overwriting it. It does not simulate power loss or concurrent writers.

The example at `examples/headless-agent/memory-continuity.cordis.yml` loads the built plugin through Loader. Its test checks a snapshot file, import counters, missing-target rejection and service disposal without a model API call.

The focused tests cover lineage restore, repeated imports, invalid checksums, preflight rejection, simulated storage failure and retry, and concurrent conditional insertion with an in-memory table. The restart/model-change test reuses an in-memory pool; it does not prove live model switching, process-crash recovery, or multi-process disk concurrency.

Run from the repository root:

```sh
pnpm exec vitest run packages/memory/memory-continuity/tests/memory-continuity.spec.ts
pnpm exec tsc -b packages/memory/memory-continuity
```

## License

MIT - The Lions Informática Brasil

## Model Experience

None, as snapshot export and restore register no model tools or prompt sections.

#### KV Cache effect

This package does not assemble or modify model requests. Consumers own retrieval and any resulting changes to reusable request prefixes.

## Known Limitations and Deferred Work

- The package does not export embedding indexes, provide encryption, or implement an installer. A host must select domains explicitly and rebuild derived indexes as needed.
- Cross-domain rollback and journal persistence are caller responsibilities; the import and journal sections define retry and durability behavior.
