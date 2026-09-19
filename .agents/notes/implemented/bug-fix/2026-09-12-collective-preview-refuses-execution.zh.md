# Agent Note: 集体预览拒绝执行

Status: implemented

[English](2026-09-12-collective-preview-refuses-execution.md) | 中文

## Problem

一个 CLI 演示用虚构的交付和测试结果填充内存任务板，随后将所声称的经验追加到 JSONL 文件。这无法证明执行、宿主身份、独立审核或跨会话学习。

## Decision

没有显式运行时时，CLI 仅输出未执行的 dry-run 计划，或在任何副作用之前返回 `COLLECTIVE_RUNTIME_UNAVAILABLE`，退出码为 2。公开 CLI 对私有实验包没有运行时依赖。预览辅助类拒绝操作性修改、完成、经验生成和持久化，包括直接调用。读取路径返回独立计划副本，绝不授权完成。历史记录保持不变，不追溯批准或重新分类。

## Alternatives considered

**为预览任务板添加权限和持久化** 会创建另一个任务权威源，却没有原生会话来源、版本检查或持久审核。原生 TeamService 已负责这些职责。

**在 run 命令后保留带警告的模拟** 仍会产生可能被调用方误当作证据的批准。保留的 dry-run 只输出拟议任务，不输出模拟结果。

## Consequences

预览不执行任务；独立的[显式运行时桥接](../feature/2026-09-12-explicit-collective-runtime-bridge.zh.md)委托操作者选定的实验室。原生 TeamService 保持完整。已有报告只能作为未验证数据查阅；记忆审批仍由其现有所有者负责。源码入口子进程测试与直接原型测试在无推理的情况下验证拒绝和保留行为。构建入口快照需要重新构建 CLI 产物；这里的测试不能证明模型性能或一般集体能力。
