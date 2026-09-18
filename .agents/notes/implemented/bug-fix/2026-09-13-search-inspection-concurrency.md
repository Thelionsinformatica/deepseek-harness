# Agent Note: Bounded search reconciliation inspections

Status: implemented

English | [中文](2026-09-13-search-inspection-concurrency.zh.md)

## Problem

Serial cold-log inspection can exhaust a search deadline before reconciliation commits, forcing the next search to repeat the same work.

## Decision

FTS reconciliation uses the existing persisted inspection concurrency setting. Workers stop claiming work after failure, all admitted reads settle before the serialized queue releases, and the existing stable-observation checks still precede the atomic index update. Source histories are not modified.

## Alternatives considered

Raising tool deadlines hides repeated cold work. Deleting WAL is unsafe and unrelated to source-inspection latency. Unlimited parallelism discards the deployment resource bound.

## Consequences

Cold search is faster but remains proportional to changed history. Tests cover bounded concurrency, unchanged revision reuse and cancellation with one worker. Dataset timings do not establish an upper bound for arbitrary corpora.
