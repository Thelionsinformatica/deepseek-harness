# Agent Note: Encrypted offline Leon recovery

Status: implemented

English | [中文](2026-08-27-encrypted-offline-leon-recovery.zh.md)

## Problem

Leon needs a portable recovery boundary for durable sessions, memory, personality, attachments, and profile configuration. A blind copy of the machine is neither portable nor safe: provider credentials and pasted secrets can exist beside the state, workspaces and model weights are independently recoverable, generated dependency trees contain links, and copying files while several backends write can produce a state that never existed.

## Decision

The launcher owns boot-free `dsh backup` and `dsh restore` modes. Backup selects an explicit authoritative allowlist below the resolved Harness home, hashes every regular single-link source, and creates one streaming `LEONBK1` container. Its encrypted manifest records the Leon/runtime version, workspace reference, best-effort loopback Ollama inventory, exclusions, and each path/size/SHA-256/owner mode. It excludes the managed credential store and named environment, credential, key, and certificate files, plus anonymous telemetry identity, derived caches, dependencies, workspace contents, repositories, executables, and model weights. This filename policy is not content redaction: sessions and other authored files may contain secrets pasted by the user, so whole-package encryption is the confidentiality boundary.

The package uses scrypt and AES-256-GCM. The manifest and each file have an independent authenticated record and unique nonce; path, size, hash, and mode are authenticated as additional data. There is no compression or general archive extractor. A hidden TTY prompt is the default key source, while bounded redirected stdin exists for trusted installer automation; argv and environment variables are not key channels.

A real backup requires the operator to stop every Leon process and pass `--confirm-stopped`; a listener on the default Web port also blocks it. The writer reads each planned file again while encrypting, verifies the hash and the final allowlisted path set, syncs a private same-parent staging file, and publishes through a no-clobber hard link. It then reopens and authenticates the package. Filesystems without hard-link support fail closed; post-publication cleanup or directory-sync failures are warnings instead of false claims that no package was created. A dry run performs the inventory and hashes without prompting or writing.

Restore is verification-only unless `--apply` is present. It authenticates the complete package and rejects unsafe/non-allowlisted paths, Windows aliases and ADS, duplicate/case/Unicode collisions, file-directory conflicts, unsupported versions, a manifest claiming the managed credential store, size/count limits, truncation, trailing data, or integrity failure. Apply additionally requires the stopped-process assertion and an exact Leon version. It authenticates the whole archive before creating staging, acquires an exclusive sibling restore lock, materializes each file through a disposable partial, and publishes only into an observed-missing destination. A stale lock fails closed. Version 1 never merges or intentionally replaces an existing home and never loads restored plugins or instructions during validation. The cooperative lock does not claim protection against a hostile non-cooperating process racing the filesystem on every supported operating system.

## Alternatives considered

**ZIP the complete Harness home.** Rejected because a general extractor adds traversal, duplicate-entry, symlink, and compression-bomb semantics, while a complete tree also captures credentials, dependency junctions, caches, and machine identity that the recovery contract explicitly excludes.

**Copy an active home and accept best-effort consistency.** Rejected for the first version because there is no global snapshot barrier across sessions, JSON storage, settings, attachments, and headless processes. Double hashing detects many changes but cannot prove a transaction across independent backends.

**Replace the current home with automatic rollback.** Deferred because destructive replacement needs a durable cross-process lock, journaled swap states, Windows ACL handling, and post-start validation. Restoring only into a missing destination gives the installer a non-destructive primitive first.

## Consequences

Leon now has a deterministic, encrypted state package that can be verified without mutation and restored as one staged directory into a new home. Managed credentials must be registered again; profile dependencies and model weights must be reinstalled; workspaces, source repositories, external `.leon` integration databases, and temporary spill artifacts require separate backup products. `--confirm-stopped` remains an operator assertion rather than a complete process lock, and Node permission bits do not establish a private Windows DACL. A future Windows installer must add lifecycle locking, ACL application, exact-version installation, project backup coordination, journaled replacement/rollback, and post-restore acceptance before it may replace an active installation.
