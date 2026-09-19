# dsh-tool-knowledge-base

[English](README.md) | 中文

面向本地 Leon 文档知识库的只读模型工具。插件通过现有 `knowledge.mjs` JSON 辅助程序提供确定性的 `knowledge_status` 与 `knowledge_search`，使用 `ctx.subprocess` 和固定 Node argv，不经过 shell；输出、取消和对 `raw/` 的暴露均受控。

## 插件（命名空间：`tool-knowledge-base`）

```yaml
- id: tool-knowledge-base
  name: '@deepseek-ai/dsh-tool-knowledge-base'
  config:
    scriptPath: /absolute/path/to/knowledge.mjs
```

`scriptPath` 是可信部署配置，必须是已存在的绝对文件路径。可选的 `timeoutMs`、`maxOutputBytes`、`stderrMaxBytes` 和 `graceMs` 都是正整数预算。

模型必须提供以 `.leon/knowledge` 精确结尾的绝对 `knowledge_root`。插件据此推导所属 workspace，并拒绝相对路径、父目录、后代目录、同级目录及 UNC 路径。若部署允许外部 workspace，应把工具与 `dsh-explicit-target-policy` 配合，并设置 `requireLock: true` 和 `exact: true`；路径参数本身不能证明用户授权。

## 执行契约

- `knowledge_status` 只执行 `status --workspace <derived-workspace>`，返回来源数量、状态与完整性问题。
- `knowledge_search` 只执行 `search --workspace <derived-workspace> --query <query> --limit <limit>`；查询长度为 1-512，限制为 1-20。
- 可执行文件和辅助程序路径由部署拥有。模型文本只能作为独立 argv 元素，绝不会进入 shell 字符串。
- 完整 stdout 必须是一个带布尔 `ok` 的 JSON 对象。格式错误、部分输出、超限、取消、启动失败和非零退出均以稳定错误码失败。
- 成功执行的 `status` 可以返回带完整性问题的 `ok: false`；这是有效审计结果，而不是基础设施故障。

辅助程序仍是搜索排序和限制的事实来源。本包刻意不把修改操作（`init`、`ingest` 和修复）暴露为模型工具。

## 模型体验

### 知识工具

#### 模型看到的内容

两个紧凑工具定义，以及一条静态提示：对 `.leon/knowledge` 的状态和搜索应使用这些工具，而不是递归文件发现或 shell 命令。结果为 JSON，并明确标记为不可信数据而非指令。

#### Token 影响

固定 schema 带来少量稳定目录成本。调用避免递归列表和原始来源读取；进入上下文的只有有界状态元数据或聚焦的索引匹配。

#### KV Cache 影响

工具定义和指导在各轮之间稳定，位于可复用前缀。动态知识结果追加在此前缀之后。

## 已知限制与后续工作

- 插件包装一个兼容的本地辅助程序；不会自行实现或迁移知识格式。
- 状态会委托辅助程序进行 lint，可能在本地计算已链接原始文件的哈希，但原始内容不会返回给模型。
- V1 接受 Windows 盘符路径或 POSIX 绝对根；拒绝 UNC 和 URI 根。
- 授权由部署负责。Leon preset 使用显式目标锁保护外部根；其他组合必须提供等价边界。
- 语义/向量检索、PDF 提取、摄取、监听和修复不在这些只读工具范围内。
