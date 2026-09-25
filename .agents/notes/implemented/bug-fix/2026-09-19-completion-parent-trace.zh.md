# Agent Note: Parent execution evidence for isolated completion review

Status: implemented

[English](2026-09-19-completion-parent-trace.md) | 中文

本文描述的父会话投影由[分页团队审查](2026-09-20-completion-incomplete-evidence-gate.zh.md)补充：该机制交付直接子会话证据，并拒绝尚未读取的页面。

## Problem

全新审核器没有父会话历史，因此无法通过自身的会话搜索验证执行器的委派顺序。

## Decision

审核提示包含宿主捕获、带摘要且有长度上限的父会话工具调用和结果，包括目标创建之前的操作。工具文本仍不可信。超限记录使用不完整标记，不能把部分事件当作完整历史。现有 subagent 机制持久化该提示，不创建第二个证据库。

## Alternatives considered

**执行器摘要：** 无法独立证明执行，因此采用宿主事件。

**全工作区历史搜索：** 会暴露无关会话，并依赖审核器未必继承的存储服务。

## Consequences

审核获得父会话调用与结果，但增加可配置的输入成本。它不证明子 agent 内部操作，也不授予额外文件权限。拒绝和时效检查保持不变。测试覆盖长度边界、原始数据保留及 Loader 组合；实时部署和子 agent 内部证据需要另行验证。
