# @deepseek-ai/dsh-completion-claim-policy

[English](README.md) | 中文

本参考文档定义了针对强烈**全局**完成声明的轮次结束证据策略。插件读取当前轮次最近一次 `turn/start` 之后的持久事件尾部；它不评判普通任务摘要、部分结果报告或仅针对某一项分析的声明。

## 配置

```yaml
- id: completion-claim-policy
  name: '@deepseek-ai/dsh-completion-claim-policy'
  config:
    maxEvidenceRecoveries: 1
    maxRecoveryMessageBytes: 4096
    maxArtifactClaims: 32
    verifyAbsoluteArtifactClaims: true
    requireCurrentTurnEvidence: true
```

- `maxEvidenceRecoveries` 允许零至三次同轮次纠正，默认值为 `0`。
- `maxRecoveryMessageBytes` 把完整保留恢复消息限制在 512 至 65,536 个 UTF-8 字节，默认值为 `4096`。
- `maxArtifactClaims` 把文件系统检查限制在 1 至 256 个唯一引用路径，默认值为 `32`；超过上限仍视为证据缺口。
- `verifyAbsoluteArtifactClaims` 检查最终声明中用反引号括起的 Windows 绝对路径，默认值为 `false`。
- `requireCurrentTurnEvidence` 要求当前轮次至少有一个成功的工具结果，默认值为 `false`。

## 声明分类

分类器会分别评估句子和明确的分句边界。它刻意只识别肯定、无局部范围且高置信度的表述，例如“todas as ferramentas funcionam”“100% operacional”“pronto para qualquer tarefa”“everything works”和“all tools are operational”。否定、条件、引用、不确定、局部范围、部分完成和受阻表述都不会激活该策略；一个否定句也不能隐藏后续的肯定全局声明。

## 证据重建

对于识别到的声明，策略检查当前轮次中的以下内容：

- 最新 `todo/write` 快照中状态为 `pending` 或 `in_progress` 的项目；
- 没有匹配 `tool/result` 的 `tool/call` 事件；
- 每个精确操作（工具名称加持久参数载荷）的最新结果中 `ToolResultBlock.isError` 为 true 的结果；
- 带有非零 `exitCode` 或信号的终端展示元数据；
- 启用产物验证时，有界集合中不存在的、以反引号括起的 Windows 绝对路径，或超过配置路径检查数量的声明；
- 要求当前轮次证据时，当前轮次没有任何成功工具结果。

同一精确操作后续的成功结果会取代其早先失败。不同参数载荷不能隐藏早先失败，没有结果的调用仍是独立证据缺口。

## 停止行为

当仍有缺口且恢复次数尚未用尽时，`agent/turn-stopping` 会在同一轮次内注入一条带来源标记的插件 steering（中途引导）消息。完整 UTF-8 消息（包括框架和截断标记）不会超过 `maxRecoveryMessageBytes`。此钩子运行前，最初的 assistant 声明可能已经进入 transcript（文本记录）；策略通过强制纠正续答，阻止该声明成为轮次的最终结论。续答可以完成并验证工作，也可以用如实的部分完成或受阻报告替换原声明。

若模型在允许次数用尽后再次给出缺乏支持的强烈声明，监听器会抛出代码为 `COMPLETION_EVIDENCE_UNSATISFIED` 的 `HarnessError`。恢复次数为零时，第一条缺乏支持的声明会在 assistant 消息写入日志后使轮次以错误结束。

## 模型体验

### 证据恢复消息

#### 模型看到的内容

模型会收到以下保留的插件消息，其中包含一行或多行随数据变化的证据缺口。

##### 恢复模板

```markdown
A alegação global de conclusão não está sustentada pelo registro deste turno:
- <evidence gap>
Continue e produza/verifique as evidências faltantes, atualize as tarefas, ou responda honestamente que o resultado é parcial ou está bloqueado. Não declare que tudo está funcionando, 100% concluído ou plenamente operacional enquanto qualquer lacuna permanecer.
```

#### Token 影响

不存在被识别且缺乏支持的声明时为零 token。每次纠正会追加一条保留消息，其完整 UTF-8 表示受 `maxRecoveryMessageBytes` 限制；过大的证据详情会替换成可见的截断标记。

#### KV Cache 影响

仅追加。恢复消息位于已可复用的请求前缀之后；配置变更只影响之后是否追加消息，不改变此前的前缀。

## 已知限制与暂缓事项

- **钩子无法撤回已显示文本** — `agent/turn-stopping` 之前，缺乏支持的声明可能已经渲染；策略会强制同轮次纠正或产生错误，而不是把它静默展示成成功的最终状态。
- **全局声明模式刻意保持狭窄** — 为避免阻止普通摘要，不在 PT/EN 高置信度集合中的改写会被允许；扩展模式时必须加入误报测试。
- **产物检查仅覆盖有界数量的明确 Windows 代码跨度** — 相对路径、URL、正文路径和非 Windows 路径不会被检查；超过 `maxArtifactClaims` 会阻止全局声明，而不是静默信任未检查路径。
- **证据是结构性的，而非语义性的** — 成功工具结果只证明调用已结算，并不证明其输出支持模型声明中的每项事实。
