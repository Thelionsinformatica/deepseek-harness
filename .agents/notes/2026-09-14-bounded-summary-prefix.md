# Bounded auxiliary summary prefixes

English | [中文](2026-09-14-bounded-summary-prefix.zh.md)

The compression auxiliary may be smaller than the coordinator. Range selection reserves its declared capacity for the replay header, compaction instruction and output before selecting a balanced prefix. Each prefix is committed using the existing compaction transaction; source events remain in the log. No additional retries or model changes are introduced.

The same budget applies to automatic pressure, overflow and manual range selection. Explicit compactRegion requests keep their exact requested span and the existing preflight rejects oversized inputs. An indivisible first span cannot be recovered by this change. Token estimates remain heuristic; image capability and summary quality still require independent validation.

Focused compaction, manual recovery and existing Loader suites passed: 121 tests. Added cases verify budget selection, original-surface preservation, balanced tool pairs and header/output reservation. Full recovery of the user's large session and live model delegation have not yet been executed.
