# Agent Note: 自动选择器直接入口

Status: implemented

[English](2026-09-13-automatic-selector-entry.md) | 中文

## Problem

用户无需检查模型目录即可找到自动路由。

## Decision

输入框菜单直接提供现有自动操作。手动选择保持可选。宿主保留路由和授权权限；打开菜单不会进行选择。此界面更改既不更改部署默认值，也不验证专家执行。

## Alternatives considered

拒绝将所有手动选择标记为自动，因为这会歪曲宿主状态。拒绝在打开菜单时授予云访问权限，因为展示不等于授权。

## Consequences

现有会话选择保持不变。针对性的组件和插件测试覆盖选择和授权。端到端自主任务质量不属于此展示更改的范围。
