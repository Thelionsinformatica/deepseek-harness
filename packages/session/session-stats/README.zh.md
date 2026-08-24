# @deepseek-ai/dsh-session-stats

[English](README.md) | 中文

注册 `sessionStats` projection 单元的函数插件：从步边界、流式 chunk、工具配对与已组装的 assistant 消息折叠出全日志会话数字——轮/步计数，LLM、工具、首 token、解码墙钟时间，以及可选的配置型 API 成本估算——经 session-projection 缝对外提供（registry 快照、变更流，以及每一个 projection 载体：history 尾页、`session/projection` 推送帧、会话列表行）。客户端由此渲染分页与压缩都无法改变的全会话数字；参考消费者是 Web 聊天统计条与 Leon Work 仪表板。

## 折叠语义

- `steps` 统计 `step/end` 事件。agent loop 对每个进入的步在 `finally` 中恰好追加一条，因此完成、失败、取消、max-tokens 的步全部计入。若改按已组装的 assistant 消息计数，则会多算 max-tokens 的 usage 宿主消息（空内容、被排除在 surface 之外），并少算被取消的步（在消息组装前已中止）。
- `turns` 统计含至少一个已关闭步的不同 turn；被拒绝或空轮（未进入任何步即关闭）不计。turn 号由宿主分配、按会话单调递增，因此折叠只需保留最近计入的 turn。
- `llmMs` 按步累加 `step/start` → `assistant/message`（组装出消息的步；步内重试的等待与窗口折叠一样计入模型时间）。
- `ttftMs`/`ttftSteps` 累加并统计 `step/start` → 首个非空 delta chunk；首次尝试的边界在步内 `llm/retry` 后保留（与窗口 `resetForRetry` 对齐）。
- `decodeMs`/`decodeTokens` 累加首 token → 已组装消息的时长与提供方上报的输出 token，仅统计两者兼备的步。
- `toolMs` 按 callId 配对累加 `tool/call` → `tool/result`；未解决的调用在 `turn/end` 时丢弃（结果总在其轮内落地）。
- `estimatedApiCostUsdNanos` 通过精确配置的提供方/模型价格表为提供方上报的 usage 定价，并以 1 美元的十亿分之一为整数存储。同一步的流式 usage 样本会由最终消息样本替换，而不是重复计费。`pricedModelCalls` 包含已配置为零成本的本地路由；`unpricedModelCalls` 会明确暴露未知路由的 usage，避免把不完整估算静默呈现为完整结果。
- 每个字段在首个贡献事件之前均为 0。已装配的 registry 恒提供该键，客户端读取值本身，而非键的存在性。

## 组合

```yaml
- id: session-stats
  name: '@deepseek-ai/dsh-session-stats'
  config:
    prices:
      - provider: ollama
        model: qwen3.5:9b
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
      - provider: google
        model: gemini-3.6-flash
        inputUsdPerMillion: 0.75
        outputUsdPerMillion: 3.75
        cacheReadUsdPerMillion: 0.075
```

注入 `sessionProjections`——这是插件的全部用途；在没有 registry 的装配中 fiber 保持挂起，不注册任何内容。

价格表由部署方所有，因为提供方价格、付费/免费方案、货币、生效日期与模型标识都会独立于本包变化。省略 `prices` 会停用成本统计。Leon Web 的随附组合采用可编辑的付费 Standard 价格快照；显示金额是估算值，而不是提供方账单。

## 模型体验

无，因为插件只计算面向客户端的、由已写入日志的会话事件派生的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；插件从不组装或发送提供方请求。

## 已知局限与延后工作

- **步数统计的是已发生的工作，而非可见输出**——在产生任何可见内容前就失败的步仍以 `step/end` 关闭并计入；被崩溃打断的步在会话重新加载后计入，届时崩溃恢复为其补写合成的 `step/end`（dsh-session 的 `interruptedTurnClosers`）。
- **被取消的步计数但不计时**——没有组装出 assistant 消息，其部分流式时间不进入任何墙钟数字，与窗口折叠的无计时 interrupted 节点一致；反之 max-tokens 的 usage 宿主消息贡献 surface 上看不到的模型时间。
- **计数是日志口径，不是 surface 口径**——消息后来被压缩掉的步仍然计入；数字描述整个会话，而非当前模型可见 surface。
- **仅估算已上报的 token 费用**——Search/Maps grounding 请求、缓存存储时长、按时长计价的媒体、税费、抵扣、免费额度、Batch/Flex/Priority 倍率，以及失败且未上报 usage 的调用均不在本 projection 中。UI 会暴露未定价模型调用，但非 token 附加费用需要未来的操作账本或提供方账单控制台。
- **价格是部署快照**——插件不会实时获取价格，也不会推断账户计费层级。提供方调价或选择其他方案后，运维人员必须更新精确路由价格表。
- **仅挂载于 web-app bundle**——其他装配不提供 `sessionStats` 键，其消费者回退到窗口口径计数（Web 统计条的回退路径）。
