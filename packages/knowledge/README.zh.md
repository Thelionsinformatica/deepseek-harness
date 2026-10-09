---
description: "Leon 文档知识库工具的包地图，供组合 Leon 预设的用户与维护者阅读。"
kind: "package-group"
---

# knowledge/ — Leon 文档知识库

[English](README.md) | 中文

## 概述

`knowledge/` 组让 Leon agent 以只读方式访问 `.leon/knowledge` 根目录下的本地文档知识库。`tool-knowledge-base` 基于随包附带的 JSON 辅助程序提供 `knowledge_status` 和 `knowledge_search`。该组不属于 `dsh` 基础组合包；Leon 预设会把它与 `dsh-explicit-target-policy` 一起挂载，后者把这些工具限制在用户指定的精确根目录内。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 提供什么 |
|---|---|
| [`tool-knowledge-base/`](tool-knowledge-base/README.zh.md) | 针对一个精确 `.leon/knowledge` 根目录的只读 `knowledge_status` 和 `knowledge_search` 工具 |

-----

<a id="related-documentation"></a>
## 相关文档

- [工具子系统参考](../../docs/subsystems/tools.zh.md) — 这些工具注册到的工具调用管线，以及限制它们的守卫钩子。
- [显式目标策略](../guard/explicit-target-policy/README.zh.md) — 把这些工具绑定到最新直接人类消息所指定根目录的守卫。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-knowledge-base) — 两个工具面向模型的 schema。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
