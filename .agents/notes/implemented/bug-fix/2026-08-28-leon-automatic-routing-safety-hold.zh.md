# Agent Note: Leon 根据自主执行证据收紧自动路由

Status: implemented

[English](2026-08-28-leon-automatic-routing-safety-hold.md) | 中文

## 问题

在 Qwen 与 Ornith 均未完成长时自主执行验收之前，Leon Automatic 会把复杂工作与目标驱动工作从 Qwen 提升到 Ornith。首次 LEON-ACC-008 运行表明，Qwen 产出了通过预言机的实现，但违反了任务协议与预算；Ornith 则耗尽恢复阶段的执行时间预算，且未修复注入的回归。因此，模型目录条目或短响应成功不足以证明自动专家提升是合理的。

Ollama 故障转移边还把 `UNKNOWN_MODEL` 与 `NO_ADAPTER` 当作服务中断。这两个代码表示部署配置错误；把同一请求发送给外部提供方会掩盖该错误，并因错误原因越过本地到外部的驻留边界。

## 决定

Leon Automatic 的 fast、main、expert 与自动目标轮次层级都使用 `ollama/qwen3.5:9b`。分类器仍会把推理强度从 off 提升到 medium 或 high，因此 UI 会保留可见的层级与强度行为，同时不选择尚未通过验收的专家模型。Ornith 保留在 Ollama 目录中供显式手动选择，并从自动预检候选列表中移除。

手动目录还在现有 Heretic 路由旁公开上下文窗口为 16,384 token 的 `ollama/qwen3.8-distill:9b-q8`。两个 Qwen 3.8 条目与 Ornith 都不会进入自动路由或 shadow 路由，直至后续策略变更获得长时自主执行证据支持。

Ollama 到 FreeLLMAPI 的边只接受 `TRANSPORT`、`TIMEOUT` 与 `SERVER`。`UNKNOWN_MODEL` 和 `NO_ADAPTER` 会停在本地路由并暴露配置错误。后续 FreeLLMAPI 到 Gemini 及 Gemini 到 OpenAI 的边保留各自提供方专属的合格条件。

shadow 策略修订为 `leon-shadow-v2`。Qwen 是唯一的本地候选，并使用已部署的专家质量层级，因为它是当前 high 强度路由；外部候选仍仅用于 fallback。只读 doctor 只要求 `qwen3.5:9b` 满足自动路由就绪条件，手动模型是否存在只作为信息。

## 验证

已记录的 LEON-ACC-008 工件状态为失败，并保留两个本地模型摘要、仅本地请求证据、通过的实现预言机、注入回归后失败的恢复预言机、协议违规与预算失败。聚焦的组合包和路由测试固定所有提示词层级只使用一个自动模型、shadow 目录不包含 Ornith、两个配置错误失败关闭、手动 Qwen 3.8 目录条目及其零本地费用，以及 doctor 只要求 Qwen。

## 考虑过的替代方案

**因为短提示词成功而保留 Ornith 自动路由。** 已否决，因为短响应完成不能证明自主诊断、受约束工具使用、恢复或基于证据的完成。

**从目录中移除 Ornith 与 Qwen 3.8 路由。** 已否决，因为手动选择属于用户的显式决定，仍可用于受控评估；当前证据只否定自动提升。

**为保持可用性而对所有 Ollama 错误执行故障转移。** 已否决，因为可用性不能成为通过向外传输本地上下文来掩盖无效模型或缺失适配器的理由。

## 后果

在其他候选模型通过所需的长时自主执行证据之前，自动会话会以不同推理强度使用一个已知本地模型。这会减少自动模型多样性，也不声称 Qwen 已通过 LEON-ACC-008；它会移除已观察到的 Ornith 提升失败，并为后续工作保留确定性路由。配置缺陷会保持可见且留在本地。手动专家模型不具备自动健康保证，必须由用户主动选择。
