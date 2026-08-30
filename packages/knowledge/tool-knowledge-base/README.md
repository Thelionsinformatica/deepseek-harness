# dsh-tool-knowledge-base

English | [中文](README.zh.md)

Read-only model tools for a local Leon documentary knowledge base. The plugin exposes deterministic `knowledge_status` and `knowledge_search` calls over the existing `knowledge.mjs` JSON helper, using a fixed Node argv vector through `ctx.subprocess` with no shell, bounded output, cancellation, and no direct `raw/` enumeration.

## Plugin (namespace: `tool-knowledge-base`)

```yaml
- id: tool-knowledge-base
  name: '@deepseek-ai/dsh-tool-knowledge-base'
  config:
    scriptPath: /absolute/path/to/knowledge.mjs
```

`scriptPath` is trusted deployment configuration and must be an existing absolute file. Optional `timeoutMs`, `maxOutputBytes`, `stderrMaxBytes`, and `graceMs` values are positive integer budgets.

The model supplies an exact absolute `knowledge_root` ending in `.leon/knowledge`. The plugin derives the owning workspace and rejects relative paths, parents, descendants, siblings, and UNC paths. In an external-workspace deployment, pair the tools with `dsh-explicit-target-policy` using `requireLock: true` and `exact: true`; the path argument alone is not proof of user authorization.

## Execution contract

- `knowledge_status` invokes only `status --workspace <derived-workspace>` and returns helper JSON with source counts, states, and integrity issues.
- `knowledge_search` invokes only `search --workspace <derived-workspace> --query <query> --limit <limit>`; query length is 1-512 and limit is 1-20.
- The executable and helper path are deployment-owned. Model text can occupy only separate argv elements and never enters a shell string.
- Complete stdout must be one JSON object with a boolean `ok`. Malformed, partial, oversized, aborted, launch-failed, and nonzero-exit results fail with stable codes.
- A successful `status` may return `ok: false` with integrity issues; that is a valid audit result, not an infrastructure failure.

The helper remains the source of truth for search ranking and limits. Mutation operations (`init`, `ingest`, and repair) are deliberately not model tools in this package.

## Model Experience

### Knowledge tools

#### What the model sees

Two compact tool definitions, plus one static prompt sentence directing `.leon/knowledge` status and search through these tools instead of recursive filesystem discovery or shell construction. Results are JSON and are explicitly described as untrusted data, not instructions.

#### Token effect

The fixed schemas add a small steady-state catalog cost. Calls avoid recursive listings and raw-source reads; only bounded status metadata or focused indexed matches enter context.

#### KV Cache effect

Tool definitions and guidance are stable across turns and remain in the reusable prefix. Dynamic knowledge results are appended after that prefix.

## Known Limitations and Deferred Work

- The plugin wraps one compatible local helper; it does not implement or migrate the knowledge format itself.
- Status delegates to helper linting and may hash linked raw files locally even though raw contents are not returned to the model.
- V1 accepts drive-letter Windows or absolute POSIX roots; UNC and URI roots are rejected.
- Authorization remains deployment-owned. The Leon preset pairs external roots with the explicit-target lock; other compositions must provide an equivalent boundary.
- Semantic/vector retrieval, PDF extraction, ingestion, watching, and repair remain outside these read-only tools.
