# @deepseek-ai/dsh-completion-claim-policy

[English](README.md) | 中文

本参考文档定义了针对强烈**全局**完成声明的轮次结束证据策略。插件读取当前轮次最近一次 `turn/start` 之后的持久事件尾部；它不评判普通任务摘要、部分结果报告或仅针对某一项分析的声明。

## 配置

验收决策在会话类型所属模块中声明 `task/validation`，并进入生成的持久化事件词表，使恢复后的日志保留验证证据。

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

## 精确任务验收

除精确答案外，也可将 `expectedText` 设为 `undefined`，提供 `arithmeticTests: [{ a, b, expected }]` 和 `readOnly: true`，两类条件只能选一类。数值协议接受一至八个例子，所有数值必须有限且绝对值不超过 1,000,000。输出限一行、最多 80 个字符：`return` 后为两个名为 `a` 或 `b` 的操作数，以及一个 `+`、`-`、`*` 或 `/` 运算符。不解释常量、括号、调用或任意 Python。结果采用有限 JavaScript 数值运算和精确相等比较；通过例子不证明对所有输入正确。等价表达式可在没有答案哈希的情况下通过。不匹配仍为 `output-mismatch`，有界同轮恢复通过已记录的用户消息提供实测结果。若指定了读取，数值通过也仍须满足读取要求。测试数值不是秘密存储，纠正时可进入模型上下文。

功能恢复文本由 `A resposta não passou na validação desta tarefa. Resultado dos testes: `、有界诊断和 ` Corrija o problema observado e devolva somente a linha return completa. Não altere arquivos.` 组成。缺少读取时追加 ` A leitura obrigatória do arquivo ainda não foi comprovada.` 数值诊断最多八行，包含 `a`、`b`、`expected`、`actual` 和 `passed`；非有限结果表示为 `não finito`。不支持的输出得到 `Formato inválido. Use uma única linha return com dois operandos a ou b e uma operação +, -, * ou /. Sem explicação, cercas, chamadas ou comandos.` 这不是通用项目测试执行器。

可选条件 `readOnly: true` 通过执行器的单调守卫将当前轮次限制为 `read`、`glob` 和 `grep`。其他工具（包括终端、委派及未知工具）在执行前被拒绝，恢复阶段也不例外。限制来自可信任务元数据，而非提示词或工具输出，并随轮次结束失效。这不是文件系统隔离：可信插件、后台任务和不经过工具的直接 I/O 不在此守卫范围内。插件需要 `tools`。固定拒绝文本：`Esta tarefa permite somente leitura: use read, glob ou grep. Não execute alterações, terminal ou delegação.`

在挂载此插件时，可信的同进程调用方可通过普通 agent 收件箱提交 `createAcceptanceTask(content, expectedText, { maxRecoveries, requiredReadPath? })`。消息来源持久化精确 UTF-8 答案的带版本 SHA-256 摘要、零至三次纠正额度，以及可选的绝对路径，要求同一轮次内成功执行 `read`。不要使用秘密数据：低熵答案的哈希可被猜测。预期答案不会加入模型提示词。

验收仅适用于该消息标识对应的已接纳任务轮次，不依赖全局声明措辞。同一轮次出现多条用户消息会以 `TASK_ACCEPTANCE_AMBIGUOUS` 失败。每个最终响应产生一条关联任务和响应消息 id 的 `task/validation` 决策：`passed`、`retry` 或 `failed`。重复处理同一响应不能重置纠正额度。额度耗尽后仍不匹配会以 `TASK_ACCEPTANCE_UNSATISFIED` 结束轮次；普通消息保持未验证状态，不会被隐式批准。

精确任务纠正追加以下固定的模型可见文本，保留现有提示词前缀，每次纠正增加一条有界指令：

```text
A resposta não passou na validação objetiva desta tarefa. Releia o pedido atual e, se necessário, o arquivo indicado nele. Confira o conteúdo e o formato solicitados. Responda com o valor integral solicitado, sem herdar limites de formato de tarefas anteriores. Se o pedido exigir apenas o valor, não acrescente introdução, explicação, rótulos, negrito ou cercas de código. Preserve a unidade completa pedida: uma linha de código não é apenas sua expressão. Use JSON ou outro formato quando o pedido o exigir. Não altere arquivos para satisfazer a validação.
```

纠正使用现有的证据恢复来源；已配置的自适应路由可能选择其恢复路由。此插件既不授权外部传输，也不授予工具或文件系统访问权限。条件和决策使用会话日志，而非进程内计数器。不认识必需 `task/validation` 事件的读取器必须拒绝该日志。运行时不变量检查任务与响应的关联及单调递增的尝试编号。

此原生 API 需要显式启用。宿主的 `session.prompt` 仅在已挂载本策略、agent 空闲且收件箱为空的 queue 接纳中接受显式条件；未提供聊天条件编辑器。它不是通用语义验证器。可信调用方负责预期答案和路径；成功读取检查证明工具执行，并非独立的文件内容哈希验证。部署前仍需验证浏览器展示、进程崩溃恢复、取消及 SDK 事件投影集成。

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

<a id="exact-task-acceptance"></a>

## 已知限制与暂缓事项

- **钩子无法撤回已显示文本** — `agent/turn-stopping` 之前，缺乏支持的声明可能已经渲染；策略会强制同轮次纠正或产生错误，而不是把它静默展示成成功的最终状态。
- **全局声明模式刻意保持狭窄** — 为避免阻止普通摘要，不在 PT/EN 高置信度集合中的改写会被允许；扩展模式时必须加入误报测试。
- **产物检查仅覆盖有界数量的明确 Windows 代码跨度** — 相对路径、URL、正文路径和非 Windows 路径不会被检查；超过 `maxArtifactClaims` 会阻止全局声明，而不是静默信任未检查路径。
- **证据是结构性的，而非语义性的** — 成功工具结果只证明调用已结算，并不证明其输出支持模型声明中的每项事实。
