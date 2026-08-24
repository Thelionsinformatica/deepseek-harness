# Memory V2 migration plan

English | [中文](leon-memory-v2-migration-plan.zh.md)

## Principle

Migrate reversibly without losing continuity.

## Current state

- Current `memory-local` records contain:
  - `id`, `scope.workspaceId`, `content`, `revision`, `source`, `createdAt`, and `updatedAt`.

## Non-destructive target state

- `MemoryRecord` gains optional fields:
  - `category`, `subject`, `importance`, `confidence`, `sensitivity`, `status`, `validFrom`, `validUntil`, `consentRequirement`, `supersedes`, `supersededBy`, `embeddingVersion`, and `schemaVersion`.
- Existing fields remain valid.

## Migration strategy

1. Apply the default `schemaVersion` for existing version 1 records.
2. Enrich new records with explicit defaults.
3. Retain a fallback:
   - treat an absent field as version 1 with conservative behavior.
4. Add a read-only transition journal for observability.

## Roll-forward and rollback

- Roll-forward: activate the new policy only through a feature flag, without deleting existing records.
- Rollback:
  - disable the automatic pipeline and write-shadow mode;
  - retain existing data;
  - retain existing consumers.

## Validation before completion

- Run scenarios for:
  - reading old records without modification;
  - writing new records with the new fields;
  - preventing cross-workspace retrieval;
  - persistence across restart.
