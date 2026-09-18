# llama.cpp request image compatibility

English | [中文](2026-09-14-llamacpp-request-image-png.zh.md)

The local qwen3.5-2b endpoint accepted a synthetic PNG (HTTP 200) and rejected the equivalent WebP (HTTP 400: Failed to load image or audio file). The affected conversation contains historical WebP screenshots; the Markdown uploads are text blocks, not media.

The provider option requestImageOutputFormat: png selects a deterministic PNG request variant. Stored attachments and session logs remain unchanged. The format participates in cache identity and cache validation; pixel and byte limits still apply. Other routes retain their previous behavior.

Focused tests cover original preservation, transparent WebP conversion, cache separation and reuse, and configuration validation. Live full-conversation replay remains distinct from the synthetic endpoint probe.
