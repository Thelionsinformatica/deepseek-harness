---
description: "Leon 的 profile 组合包：在 dsh Web 应用之上提供记忆服务、Leon 守卫和 leon agent 预设，供部署 Leon 的维护者阅读。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-leon

[English](README.md) | 中文

## 概述

`dsh-leon` 把 dsh Web 应用变为 Leon，即 The Lions Informática 的巴西葡萄牙语本地助手。在 profile 中列在 `dsh-base` 与 `dsh-web-app` 之后时，它在宿主上挂载工作区与个人记忆、候选审核与流程学习服务以及失败恢复守卫，把基础会话索引保存在磁盘上，并把 `leon` agent 预设设为默认。该预设组合 Leon persona、记忆工具、带目标守卫的文档知识库、完成声明策略以及 Leon skills。会话搜索来自可选的 `dsh-experimental-session-search` 组合包；Web 工具与 MCP 尚未组合。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 的 `package.json` 中把本组合包列在 Web 层之后：

```json
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-leon", "@deepseek-ai/dsh-experimental-session-search"] } } }
```

最后一个组合包提供 persona 依赖的 `session_search` 工具；Leon 本身不依赖任何实验性包。

之后新会话以 `leon` 预设启动。profile 自己的 `cordis.patch.yml` 仍在本组合包之后应用，因此本机 embeddings 端点运行后，部署可在其中启用语义记忆回忆：

```yaml
- id: memory-local
  config:
    semanticSearch: { enabled: true, api: openai-compatible, baseUrl: http://127.0.0.1:8099, model: nomic-embed-text, dimensions: 768 }
```

<a id="understand-the-implementation"></a>
## 理解实现

本组合包有两个 patch 文件。`cordis.patch.yml` 把 `session-query-sqlite` 改为首次搜索时打开的持久索引，把 agent 预设注册表的默认值设为 `leon`，并插入宿主行。`presets/leon.patch.yml` 插入一条 `@deepseek-ai/dsh-agent-preset` 声明，其插件按 agent 挂载。`skills/` 目录随包发布，并通过 `skill-filesystem` 加入预设的 skill 根目录。知识库工具运行 `dsh-tool-knowledge-base` 随附的辅助程序；`leon-knowledge-base` skill 内的副本供该 skill 的维护命令使用，必须保持逐字节一致，包测试会强制检查。

<a id="model-experience"></a>
## 模型体验

间接地，通过被挂载的包：本组合包只承载 patch 列表，Leon persona 通过 `dsh-persona` 到达模型。

#### KV Cache 影响

本组合包自身不向请求前缀添加任何内容；被组合的插件负责各自的段落和工具 schema。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **暂无 Web 工具** — 在 Leon 的逐次出站审批移植之前，`web_search` 与 `web_fetch` 不在预设中，因此预设从不在未经同意的情况下向外发送查询。
- **暂无 MCP 桌面自动化** — Cua 驱动桥接需要等待执行端审批与工具允许列表。
- **尚未移植** — 只读审计子代理、目标完成审计器以及 Leon 的客户端页面。
- **单一本地所有者** — 记忆所有者 id 针对单用户 Windows 部署固定；多用户宿主必须覆盖它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，不具权威性。本组合包取代了分支中的 `apps/cli/config/agent-presets/leon` 目录，因为 0.2.1 的预设是组合包中的插件行；[迁移 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.zh.md) 记录了迁移过程。

</details>
