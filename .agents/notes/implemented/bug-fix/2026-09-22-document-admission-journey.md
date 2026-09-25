# Agent Note: Validated document admission and evidence journey

Status: implemented

English | [中文](2026-09-22-document-admission-journey.zh.md)

## Problem

Non-image uploads used the image store even without an image. Permissive base64 decoding accepted malformed input, and validation interleaved with writes left an earlier file when a later file was rejected. Adjacent prompt text visually joined the uploaded path.

## Decision

The host validates every non-image file's canonical base64 and existing per-file size limit before committing any attachment in that request. It avoids the image store for file-only input and separates path pointers with paragraph breaks. Validation failures have attachment-specific diagnostics without document contents or local paths. Files remain local until a tool reads them; the upload itself does not imply that the agent read or understood the document.

## Alternatives considered

**Client-only validation** cannot protect direct RPC callers and does not prevent partial writes in the host.

**A new document-memory subsystem** duplicates existing file tools and durable session history. The acceptance scenario instead exercises the shipped skill catalog, loader, read tool, browser and session persistence together.

## Consequences

Malformed requests produce neither uploads nor queued prompts. This does not make filesystem commits transactional: an I/O failure after validation can leave earlier uploads. Model-visible path pointers add paragraph separators but no document body. Existing image policy, models, permissions and memory are unchanged.

## Verification

The attachment unit regressions cover malformed later members, file-only operation without an image store, byte preservation and path confinement. The assembled browser document journey uploads synthetic Markdown, loads a discovered skill, reads the stored file through the real tool, rereads persisted events, and follows up after reloading the page without another read or duplicate catalog. Only inference is scripted; these checks do not measure real-model reasoning, prove process-restart recovery, or certify the production team.
