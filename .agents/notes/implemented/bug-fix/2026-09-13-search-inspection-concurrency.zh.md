# Agent Note: 有界搜索协调检查

Status: implemented

[English](2026-09-13-search-inspection-concurrency.md) | 中文

## Problem

串行冷日志检查可能在协调提交前耗尽搜索期限，导致后续搜索重复相同工作。

## Decision

FTS 协调使用现有持久化检查并发配置。工作单元在失败后停止领取工作，所有已接受读取结束后才释放串行队列，现有稳定观察检查仍在原子索引更新前执行。源历史不被修改。

## Alternatives considered

提高工具期限会隐藏重复冷读取。删除 WAL 不安全且与源检查延迟无关。无限并发会丢弃部署资源限制。

## Consequences

冷搜索更快，但仍与变更历史规模相关。测试覆盖有界并发、不变修订复用以及单工作单元取消。数据集计时不能证明任意语料库的时间上限。
