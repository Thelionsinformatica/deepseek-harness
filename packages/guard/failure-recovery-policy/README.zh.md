# @deepseek-ai/dsh-failure-recovery-policy

[English](README.md) | 中文

这是一个针对工具失败的确定性自恢复 guard。它为每个会话存储一个原子恢复单元；同一条完全相同的工具调用以等价原因失败两次后，会注入一条带日志记录的恢复提示。如果模型随后仍请求这条未改变的调用，单调工具 guard 会在分发前拒绝它。持久单元可跨会话恢复及供应商／模型切换保留；模型只要更换工具、参数或策略即可立即继续。

本包与 [`repeat-tool-reminder`](../repeat-tool-reminder/README.zh.md) 互补：成功的相同调用由后者给出建议提醒，失败及被下游阻止的调用由本包统一处理。决策记录见[工具失败恢复 Agent Note](../../../.agents/notes/implemented/feature/2026-08-24-tool-failure-recovery-policy.zh.md)。

## 配置

```yaml
- id: failure-recovery-policy
  name: '@deepseek-ai/dsh-failure-recovery-policy'
  config:
    maxEquivalentFailures: 2 # default; integer >= 2
    include: []              # tool-name patterns to track; empty means all tools
    exclude: []              # tool-name patterns to ignore
```

`include` 和 `exclude` 接受 `*` 通配符。失败上限无效时，插件会在加载阶段明确报错，而不是静默改变策略。

## 失败身份与生命周期

调用身份为「`(tool name, canonical arguments)`」；对象键会在序列化前进行深度排序。结构化错误在错误名称和代码都相同时视为等价。非结构化错误使用精确错误消息作为仅驻留进程的身份；该消息不会复制到恢复提示中。下游 `tools/post-execute` 阻止使用稳定身份 `POST_EXECUTE_BLOCK`。

成功、不同的受跟踪调用、不同的失败身份或新的用户提示都会重置链或启动新链。没有 agent 的调用和嵌套 Code Mode 调用会被忽略。状态通过部署的 `storage-domain` 写入链按会话 id 串行化，因此并发完成的失败不会丢失计数，主机重新打开后也会恢复已提交版本。

## 适配器与原子存储约定

本包导出 `ToolPolicy`、`InvocationOutcome`、`RecoveryEvent` 和 `AtomicRecoveryStore`。`ToolPolicy` 由代码拥有：它在不咨询模型的情况下解析规范签名、等价族、规范目标、效果、重试安全性以及可选幂等键。`InvocationOutcome` 将供应商传输、工具执行、外部效果不确定性和策略失败分成不同领域。

`DomainAtomicRecoveryStore` 通过 `storage-domain` 持久化恢复单元；`MemoryAtomicRecoveryStore` 为隔离测试及明确不使用存储的主机提供相同的进程内实现。两者都按事件 id 去重、串行化失败转换、保留逐范围版本，并提供带 TTL 和单调 fencing token 的操作租约。过期的旧持有者不能释放后来重新获得的租约。

当前 guard 使用既有的精确规范参数同时作为签名和等价族。工具适配器可以逐步采用导出的策略约定；模型生成的分类不会影响强制执行。

## 恢复与拒绝

达到配置的等价失败次数后，插件通过 `additionalContexts` 将恢复消息放在最前。agent loop 会把它记录为来源于插件的 `user/message`，同时保留原始 `tool/result` 和全部下游上下文。之后未改变的调用会在工具实现执行前由 `ctx.tools.guard()` 拒绝。被拒绝的 token 不会再次计为失败，因此策略保持单调，不会淹没历史记录。

更换工具或参数会通过启动另一条链解除锁定。guard 不要求模型展示私有推理；它只要求采取另一项可观察动作，或根据现有证据结束任务。

## 模型体验

### 恢复上下文消息

#### 模型看到的内容

达到配置的等价失败上限后，下一次模型请求会包含以下紧凑恢复消息，并代入具体工具、次数和稳定失败代码：

##### 恢复提示

```markdown
The same tool call has failed repeatedly with an equivalent failure.
- tool: <toolName>
- equivalent_failures: <count>
- failure_code: <failureCode>
Identify the likely cause from the logged tool results before continuing. Do not repeat this exact call. Change the tool, arguments, or strategy, or finish the task if the available evidence is sufficient.
```

#### Token 影响

达到阈值前为零 token。只在该 agent 的日志历史中保留一条紧凑提示；不会重复原始参数或非结构化错误文本。

#### KV Cache 影响

仅追加：恢复上下文位于可复用请求前缀之后，不会使已有前缀缓存条目失效。

## 已知限制与暂缓事项

- 检测采用精确匹配而非模糊匹配；有意义的参数变化会被有意允许。
- 同一并行批次中已经准入的调用仍可完成；原子失败记录可防止计数丢失，只有后续分发会看到累计失败。
- 已有的 pre-execute 拒绝已经阻止分发；本策略会观察其失败，但不会替换原始原因。
- 嵌套 Code Mode 调用被排除，使程序自行控制内部重试策略。
- 本策略改变工具使用策略，而不改变模型／供应商路由；传输故障转移仍由路由器负责。
- 操作租约和不确定结果记录可供具有外部效果的工具适配器使用，但这个精确失败 guard 不会自动为每次工具调用预留租约。
- 已配置的 JSON 领域后端只协调一个 Leon 主机进程。跨进程可见性需要具有共享原子记录原语的后端。
