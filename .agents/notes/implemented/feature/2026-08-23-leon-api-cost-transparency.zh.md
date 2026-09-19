# Agent Note: Leon API 成本透明度

Status: implemented

[English](2026-08-23-leon-api-cost-transparency.md) | 中文

## 问题

Leon 自动可以把工作从本地 Ollama 路由转移到已授权的 Gemini 路由，但现有 token meter 只报告 token 数量。用户虽然能看到实际运行的模型，却无法在 Leon 内估算由此产生的 API 费用。如果提供方调价、账户使用免费或 Priority 层级，或新选择的模型没有已知价格，单个硬编码总额同样会产生误导。

## 决定

`sessionStats` projection 接受部署方所有的精确提供方/模型价格表，并在现有全日志数字旁发布 `estimatedApiCostUsdNanos`、`pricedModelCalls` 与 `unpricedModelCalls`。提供方上报且彼此独立的输入、输出、缓存读取及缓存写入 usage，会以 1 美元的十亿分之一为整数定价。同一步的最终消息会替换较早的流式样本，因此常规 usage 交付不会重复计费。价格表中不存在的精确路由会增加未定价计数，而不是消失在一个看似完整的零值中。

价格仍位于 pi-ai 适配器之外，也不推翻[已声明提供方目录](../architecture/2026-08-03-pi-ai-declared-provider-catalog.zh.md)中不在适配器内定价的决定。适配器拥有提供方 usage 与实际模型身份；部署方拥有价格，因为计费方案、货币、生效日期与选定安全余量都属于安装策略。已配置的本地 Ollama 路由使用显式零价格，使 UI 能区分「定价为零」与「价格未知」。

会话统计条显示当前会话估算值及未定价调用警告。Leon Work 仪表板汇总所有已存储会话的 projection，包括调用仍然产生成本的已归档会话与 subagent 会话，并把结果标为累计 API 使用。随附 Web 价格表采用 2026-08-23 可用的 Google 付费 Standard token 价格，其中包括有效期至 2026-12-31 的 Gemini 3.6 与 3.7 Flash 引导价格。它是可编辑估算值，而不是提供方账单。Search 或 Maps grounding 查询、缓存存储时长、媒体时长费用、税费、抵扣、免费额度、非 Standard 倍率以及失败且未上报 usage 的调用，均不在 token 估算内。

## 考虑过的替代方案

**在提供方适配器中硬编码价格。** 已否决，因为同一模型可能采用 Free、Standard、Batch、Flex、Priority 或协商价格，商业策略变化不应要求修改请求转换。

**在浏览器中根据聚合 token meter 推导成本。** 已否决，因为聚合 bucket 不再标识每次调用由哪个精确模型产生，尤其是在自动路由或故障转移后；浏览器分页也不能改变计费。

**完全依赖提供方账单控制台。** 已否决，因为控制台仍是账单权威，但无法向 Leon 提供即时的单会话估算，也不会在产品内暴露选定路由缺少配置价格的事实。

## 测试

Projection 测试固定精确 token 数学、零成本本地调用、流式样本到最终样本的替换、未知路由计数与重复价格拒绝。会话测试固定小额格式化、会话估算、本地零值和未定价警告。仪表板测试固定累计 projection 总额、空状态与警告状态。Loader 与类型检查验证配置边界和跨包 projection 形状。

## 后果

Leon 现在会立即、持久地向用户提示 API 支出，同时继续暴露未知部分。该值可能与最终账单不同，并且必须在费率或方案变化后更新。Leon 要估算 grounded search 查询或周期性缓存存储等非 token 功能，未来仍需要操作账本。
