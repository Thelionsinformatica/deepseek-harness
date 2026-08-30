# dsh-credentials-local

English | [中文](README.zh.md)

File-backed [credentials](../credentials/README.md) provider: four layers, one honest precedence.

| Layer | Source id | Writable | Wins |
|---|---|---|---|
| Inherited process environment | `env` | no | always |
| `$DSH_HOME/.credentials.yaml` document | `file` | yes (`set`/`unset`) | over both `.env` layers |
| `<invocation cwd>/.env` | `project-env` | not here | over the user `.env` |
| `$DSH_HOME/.env` | `user-env` | not here | otherwise |

The launching environment wins because a per-run override (`DEEPSEEK_API_KEY=… dsh`, a CI secret, a container `-e`) is operator intent for this run — and because it cannot be edited from inside, it must be *visibly* read-only: `describe()` reports `source: 'env', writable: false`, and `set`/`unset` reject instead of writing a change the reader would never see.

Everything below it loses to the managed store, so a key written by the Models page takes effect immediately even when an older key sits in a `.env`. Those two layers still resolve when nothing is stored, and `describe()` names them `project-env` or `user-env` with `writable: true` — storing a key replaces them as the effective source.

Under the product CLI, resolution reads the launcher's frozen [environment snapshot](../../util/launch-environment/README.md) rather than `process.env`: only the snapshot can say whether a value came from the launching shell or from a file. A composition the product CLI did not boot has the inherited environment as its only layer, which keeps embedders on the semantics they already had.

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | Credentials document location. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted. |
| `watch` | `true` | Hot-publish external edits. |
| `debounceMs` | `100` | Watcher write-settle window. |

## The document

The logical store is a versioned YAML document with one section per key space, and nothing else:

```yaml
version: 1

refs:
  DEEPSEEK_API_KEY: sk-…
  OPENAI_API_KEY: sk-…

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:                    # written verbatim; this provider does not interpret it
      type: oauth
      access: eyJhbGciOi…
      refresh: rft_9f8e7d…
      expires: 1786000000000
  llm-pi-ai/amazon-bedrock:
    kind: api-key               # environment values, no key: this route uses an AWS profile
    env:
      AWS_PROFILE: prod
  llm-pi-ai/amazon-bedrock-dev:
    kind: api-key               # neither: the owner confirmed the ambient credential chain
```

POSIX stores that version-1 document directly under owner-only permissions. Windows stores the whole logical document as the payload of a version-2 envelope:

```yaml
version: 2
protection: windows-dpapi-current-user
payload: "<opaque DPAPI blob encoded as canonical base64>"
```

The payload is protected by Windows Data Protection API (DPAPI) with `CurrentUser` scope and package-specific optional entropy. Its credential names, values, records, and comments are not readable at rest from the file. Each protection result is decrypted and compared in memory before the atomic replacement; a failed protect, decrypt, or comparison aborts the write without replacing the last document.

The document holds credentials only, so every deviation is a rejection rather than a skipped entry — a silently ignored key would read as "the credential I stored has no effect". A non-mapping root, an unknown top-level key, a key that is not addressable in its space, a wrong-typed value, an empty string, an unknown record tag or field, a duplicate key, and malformed YAML all fail: loud at boot, and warn-and-keep-the-last-good-snapshot on a live reload.

A `grant` payload must survive a JSON round trip, enforced in both directions. YAML spells values JSON has none for — `.inf`, alias cycles — and an owner may hand over a `Date` or a `bigint`; either way the store refuses rather than saving something it could not read back exactly as written.

The pre-release layout was a flat mapping with no `version`. A boot that recognizes it exactly — addressable names over non-empty string scalars, no directives — upgrades it under the writer lock: the original lines nest verbatim under `refs:`, so values, comments, and spellings survive byte for byte. On Windows the same locked migration accepts either that flat layout or a version-1 document, validates it, protects and verifies it, then atomically commits only the version-2 envelope; a failed migration leaves the plaintext source byte-for-byte intact and aborts activation. Concurrent boots re-read after acquiring the lock, so a process that finds another process's completed envelope uses it without rewriting. Any flat shape the recognizer cannot prove is refused rather than read as an empty store.

Writes patch the parsed logical document rather than rebuilding it, so comments and the formatting of every untouched entry survive inside the Windows payload as well as in the POSIX file. A comment directly above an entry is that entry's annotation and is removed with it. Every write first re-reads the document under the cross-process writer lock of [`dsh-atomic-write`](../../util/atomic-write/README.md) and publishes anything it had not observed, then commits atomically with mode `0600` under an owner-only (`0700`) directory — so a concurrent writer or an external edit inside the watcher's debounce window is folded in rather than overwritten. An on-disk document that no longer parses or decrypts fails the write instead of overwriting content the provider could not understand.

Any string value round-trips, multi-line values included, so no entry is unwritable for want of a quoting style. An empty stored value is absent, per the seam rule — which is why an empty string in the document is rejected outright: `unset` removes a key, it does not blank it.

## Permissions

The provider creates the directory `0700` and creates or atomically replaces the document `0600`. It holds what it *reads* to that same bound: on POSIX a document carrying any group or other permission bit fails before its contents are parsed — at boot and on every reload — and the error names the `chmod 600` repair. Windows has no POSIX mode to inspect, so that check is skipped rather than faked; DPAPI binds the protected payload to the current Windows user, and a copied envelope does not become plaintext merely because its file ACL is readable elsewhere.

## Hot reload

External edits publish `credentials/reference-updated` per changed reference after the snapshot is replaced **wholesale** — an entry deleted on disk never lingers in memory. Before Chokidar opens the target, the provider realpaths its deepest existing ancestor and restores any missing suffix; file access and diagnostics retain the configured path, while Windows cannot mix an 8.3 alias with long-form libuv events. The provider's own writes are recognized by content and publish exactly their one commit event. On Windows a live protected envelope may come from another current-user provider process; a live plaintext downgrade is rejected and keeps the last good snapshot until restart performs the locked migration. An unreadable, invalid, or undecryptable document at runtime keeps the last good snapshot and warns; an absent file is an empty store; the same failures at boot abort activation.

## Security boundary

On Windows, DPAPI protects credentials at rest against offline inspection and processes running as a different Windows user. It does **not** isolate credentials from a process already running as the same user: such a process can invoke DPAPI itself, and the provider necessarily holds decrypted values in memory while serving requests. On POSIX the logical document remains plaintext behind `0700`/`0600`; those permissions stop other OS users, not a same-UID process.

The harness never hands the model the document path and never loads managed credentials into the process environment — unlike `$DSH_HOME/.env`, the ordinary environment layer (see [app-boot's Harness-home layers](../../boot/app-boot/README.md#profiles)). That reduces accidental disclosure but is not an agent-isolation boundary. A deployment that must keep provider keys away from every same-user tool process still needs a brokered keychain or service whose decrypt operation those processes cannot invoke.

## Model Experience

Indirectly, through the consuming LLM adapters: stored values authorize their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **Same-reference concurrent writes are last-write-wins** — the writer lock and the read-modify-write keep concurrent writers from dropping each other's entries, but two writers editing one reference still resolve to the later write; there is no revision check.
- **Same-user processes remain trusted** — see [Security boundary](#security-boundary): Windows DPAPI prevents plaintext-at-rest disclosure but allows the same Windows user to decrypt; POSIX relies on owner-only file permissions.
- **Environment changes are invisible** — the snapshot is frozen at launch, so a variable exported after startup reaches neither resolution nor `describe`; changing an environment-sourced credential takes a restart.
- **Atomic, not crash-durable** — inherited from `dsh-atomic-write`; the store re-reads on boot.
