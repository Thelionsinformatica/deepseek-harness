# dsh-explicit-target-policy

[English](README.md) | 中文

单调工具守卫：将根文件系统调用限制在当前轮次最新一条直接人类消息明确指定的 Windows 绝对目标内。它防止模型把用户要求的 `D:/SampleWorkspace/.leon/knowledge` 静默替换为 `.`、工作区、父目录或其他路径。

## 插件（命名空间：`explicit-target-policy`）

本包是基于 `ctx.tools` 的 Cordis 函数／命名空间插件（`name`／`inject`／`apply`）。配置一个或多个用于识别受保护目标的后缀标记：

```yaml
- id: explicit-target-policy
  name: '@deepseek-ai/dsh-explicit-target-policy'
  config:
    markers:
      - '.leon/knowledge'
    additionalToolRules:
      - name: knowledge_status
        argument: knowledge_root
        requireLock: true
        exact: true
    blockedToolsWhileLocked:
      - glob
      - grep
      - read
      - pwsh
    requiredToolsWhileLocked:
      - knowledge_status
    maxRequiredToolRecoveries: 1
```

`markers` 为必填项，并且必须至少包含一个非空白字符串。`additionalToolRules` 可选。每一项添加一个模型工具及其路径参数，且不能覆盖内置规则。`requireLock` 会在最新直接人类消息建立带标记目标前拒绝该工具；`exact` 也会拒绝目标的后代路径。`blockedToolsWhileLocked` 会在整个锁定轮次拒绝指定的根模型工具，包括没有路径参数的工具，因此部署可以强制使用专用有界接口。重复或空白的工具名会在加载时失败。

`requiredToolsWhileLocked` 可选，用于指定直接人类目标锁生效时必须成功完成的、携带路径的根模型工具。每个必需工具名都必须具有内置路径规则或 `additionalToolRules` 路径规则，并且不能同时被阻止；缺少规则、名称重复或名称空白都会在加载时失败。`maxRequiredToolRecoveries` 将同轮续行次数限制为 0 到 3 的整数。其默认值 `0` 不允许续行：必需工具集合不完整时会立即以 `REQUIRED_TOOLS_MISSING` 结束，而不会完成轮次。

## 目标捕获

在已接受的 `agent/pre-step` 中，插件只检查来源严格为 `source.kind: user` 的消息。插件、系统、助手、记忆和工具内容都不能建立或替换目标锁。

对于每个已配置的标记，捕获过程会：

1. 使用 NFKC 规范化 Unicode；
2. 统一 `\` 与 `/` 分隔符并忽略大小写比较；
3. 查找标记之前最后一个 Windows 盘符前缀（`X:/`）；
4. 记录从该前缀到标记末尾的绝对路径。

当前轮次最新的直接用户消息具有权威性。目标锁会在同一轮次仅含插件消息的步骤间保持；后续人类轮次若没有绝对的带标记目标，则会清除目标锁。

## 强制执行

存在目标锁时，守卫只处理根调用：

| 工具 | 路径参数 |
| --- | --- |
| `glob`、`grep` | `path` |
| `read`、`read_image`、`write`、`edit` | `file_path` |

原始参数永远不会被改写。只有当规范化后的绝对路径正好等于锁定目标或位于其子树内时，调用才会放行。缺失、非字符串、相对路径、`.`、父目录、同级目录、其他盘符、向外穿越和前缀碰撞目标都会在工具主体运行前被拒绝。模型可见的原因以 `TARGET_DRIFT` 开头，并要求模型在精确目标上重新调用。

部署自定义规则使用同样的规范化。若直接人类文本未建立目标，`requireLock` 规则会以 `TARGET_REQUIRED` 失败；插件上下文、历史、记忆、元数据和工具结果都不能授予锁。`exact` 规则只接受锁定路径本身。

当直接人类目标锁处于活动状态时，配置在 `blockedToolsWhileLocked` 中的工具会在主体运行前以 `TARGET_TOOL_RESTRICTED` 失败。拒绝信息会指出受保护目标，并引导模型回到 Skill 的专用工具；它不会改写请求，也不会静默选择替代方案。

必需完成按工具和已授权目标分别计算：每个已配置的必需工具都必须在锁定轮次捕获的每个目标上分别成功一次。实时完成只由根执行的最终不可变 `tools/result` 事件确认；该执行必须在同一轮次中已有匹配的持久 `tool/call`，并且其已配置路径参数必须解析到该精确目标。带 `isError` 的结果、缺少持久调用、嵌套调用或在其他目标上的成功都不计入。

当 `agent/turn-stopping` 发现缺失的工具－目标组合且仍有恢复次数时，插件会通过 `agent.steer()` 发送一条来源于插件并列出缺失工具和目标的纠正消息，使正在运行的 agent 在同一轮次再执行一个步骤。`maxRequiredToolRecoveries` 用尽后，listener 会抛出稳定的 `REQUIRED_TOOLS_MISSING` 错误；必需任务未完成时，受保护轮次不允许成功结束。

在之后的每个 pre-step 中，包括插件重新挂载之后，策略都会从同一开放轮次的持久 `user/message`、`tool/call` 和 `tool/result` 事件重建目标锁、成功的工具－目标组合以及已消耗的恢复次数。新轮次或锁定目标变更会建立新的完成集合；其他轮次的持久记录永远不能满足当前要求。

没有代理的调用、表外工具以及嵌套子调用（`parent !== undefined`）会被有意忽略。

## 安全边界

本策略是确定性的目标漂移屏障，不是文件系统沙箱或授权系统。它不会检查嵌套工具的内部 I/O；当最新的直接人类消息没有指定以已配置标记结尾的绝对路径时，它也不会限制调用。对于破坏性操作，应同时使用平台权限与确认策略。

## 模型体验

### 目标策略

#### 模型看到的内容

插件不添加常驻提示词或工具 schema。发生目标漂移时，被拒绝的调用返回一条以 `TARGET_DRIFT:` 开头并包含规范化目标的紧凑错误结果；缺少直接人类授权的受保护外部路径工具返回 `TARGET_REQUIRED:`；锁定期间被禁止的通用工具返回 `TARGET_TOOL_RESTRICTED:`；合规重试会留在用户选择的目录树内或使用专用有界接口。如果锁定轮次尝试结束时仍有恢复次数，下一次同轮请求会收到一条来源于插件的紧凑指令，其中列出每个缺失工具和目标。如果恢复次数已经用尽，轮次会以 `REQUIRED_TOOLS_MISSING` 结束，而不会把未完成工作呈现为成功结论。

#### Token 影响

允许的调用不会增加 token。拒绝会添加一条简短的模型可见结果。每次允许的必需工具恢复会添加一条紧凑消息和一次额外模型请求；`maxRequiredToolRecoveries` 会同时限制两者。终止性的 `REQUIRED_TOOLS_MISSING` 错误不会增加恢复请求。

#### KV Cache 影响

拒绝或必需工具恢复只会在可复用请求前缀之后追加，因此不会使之前的 KV Cache 条目失效。从持久日志重建完成状态不会添加提示词内容。

## 已知限制与暂缓事项

- 仅捕获 Windows 盘符路径；不捕获 UNC、设备、URI 或 POSIX 路径。
- 标记是经过规范化的字面后缀片段，不是 glob 或正则表达式。
- 自定义工具规则只声明携带路径的根调用；不会检查工具内部 I/O。
- 阻止规则在整个活动锁内按工具名生效；无法区分同一轮次中该工具在其他位置的无害用途。
- 只有同轮次持久根调用才能满足必需完成；每个必需工具都必须在每个已授权目标上分别成功，嵌套编排不能满足该任务。
- 一条直接消息包含多个已配置标记时，可以建立多个目标。
- 嵌套工具编排有意由所属工具负责。
