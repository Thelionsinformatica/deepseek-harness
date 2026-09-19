# Agent Note：保持 upstream 监控只读

Status: implemented

[English](2026-08-27-read-only-upstream-monitor.md) | 中文

## Problem

Leon 需要发现原始 harness 中值得关注的变更，同时不能让自动更新覆盖本地的身份、路由、记忆、安全或 Windows 集成工作。常规 `git fetch` 会更改仓库引用，而自动合并会把未经审阅的 upstream 行为与高度定制的工作树结合起来。

## Decision

根命令 `pnpm run check:leon-upstream` 运行 `scripts/check-leon-upstream.ts`。它读取已配置的 upstream URL、当前 commit、缓存的 `upstream/master` commit，以及 `git ls-remote` 返回的在线 `master` commit。它绝不 fetch、merge、rebase、checkout、写文件或更改 Git 引用。

结果区分 upstream 未变化、需要人工审阅的新在线 commit，以及本地比较基线缺失。`--json` 为未来的本地调度器提供相同结果，`--remote` 和 `--branch` 则支持经过明确决定的仓库布局变更。

## Alternatives considered

**自动 fetch。** Fetch 不编辑源码文件，但会修改远程跟踪引用，并让监控作业成为仓库状态的一部分。监控只需要在线对象标识，因此 `ls-remote` 已经足够。

**自动 merge。** 拒绝，因为即使 Git 没有报告文本冲突，upstream 变更仍可能与 Leon 专属行为产生语义冲突。

## Consequences

该命令可以作为观察步骤安全运行，并会清楚报告何时需要人工 upstream 审计。在经批准的 fetch 刷新缓存基线之前，该命令会持续报告同一项在线变更；这种重复是有意的，避免把一次观察误认为已接受更新。
