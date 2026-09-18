# Agent Note: 只读过程候选列表

Status: implemented

[English](2026-09-18-procedure-candidate-listing.md) | 中文

## Problem

由 `procedure_propose` 创建的持久过程候选只能通过同一轮返回的 id 找到。用户事后想审查待处理的候选时,没有面向模型的列举方式,这使审查跟踪脱离了工作区记录。

## Decision

`ProcedureLearningService` 暴露 `listCandidates`,按时间倒序返回当前工作区的候选记录。`procedure_candidates` 工具以只读查询的形式把该列表发布给模型:它不批准、不执行,也不修改记忆或技能;条目在人工审查裁决后离开列表。审查仍需要精确的 `/procedure-review` 命令。

## Alternatives considered

曾考虑通过通用记忆搜索呈现候选,但被否决:审查状态属于过程职责而非检索职责,且搜索排序会掩盖确切的待处理集合。曾考虑列举时自动晋升候选,也被否决:人工审查才是晋升的权威。

## Consequences

待审查集合可以在会话内重建,并由无钥匙 headless 快照覆盖。接受与拒绝的行为不变。
