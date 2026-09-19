# Agent Note: Reject cyclic MCP tool discovery

Status: implemented

English | [中文](2026-09-12-mcp-discovery-cursor-cycle.zh.md)

## Problem

An MCP server can repeat a `tools/list` continuation cursor over empty pages without triggering duplicate-tool checks. Synchronization then waits indefinitely while startup or a queued list update remains unsettled.

## Decision

Each synchronization in [mcp-client](../../../../packages/mcp/mcp-client/README.md) records its non-empty continuation cursors and rejects reuse before requesting another page. This is the focused correction from [upstream commit 594305ce](https://github.com/deepseek-ai/deepseek-harness/commit/594305ce19765086472c6ef95c09c3f2a70ce37c), without session-format or framework migration. Cursor history is operation-local: a later notification or reconnection may legitimately reuse cursors.

Discovery remains transactional. A rejected fetch leaves the prior registrations and their callable executors untouched; strict startup reports the error and closes the failed client. Successful later discovery replaces the generation normally. Diagnostics omit the opaque cursor value.

## Alternatives considered

**Rely on duplicate tool names.** Empty pages and pages with distinct tools can still cycle.

**Keep cursors across synchronizations.** A server may use the same pagination tokens for an updated list, so global history would reject legitimate recovery.

**Set a new page or time limit.** This would introduce a new deployment policy unrelated to the repeated-cursor defect. A continuously distinct cursor chain remains an explicit limitation rather than being assigned an arbitrary cap.

## Consequences

Repeated cursors settle as a discovery error without publishing a partial tool generation. Cursor memory grows with the number of distinct pages in one synchronization; request timeout and unbounded distinct-cursor behavior remain unchanged. Unit and lifecycle regressions cover immediate and multi-page cycles, retained callable tools, empty terminal cursors, later cursor reuse, fatal startup, and notification recovery. The CLI snapshot exercises strict startup through its headless profile with a local stdio MCP fixture; no model inference is required.
