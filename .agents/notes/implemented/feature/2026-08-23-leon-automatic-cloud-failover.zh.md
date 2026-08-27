# Agent Note: Leon 自动云端故障转移

Status: implemented

[English](2026-08-23-leon-automatic-cloud-failover.md) | 中文

## Problem

Leon 自动模式会选择本地 Ollama 路由，但连接失败仍委托给提供方重试策略。本地服务不可用时，即使已配置的云端路由能够继续同一工作，系统仍会消耗五次尝试后才让该轮失败。模型指示器与记录中也缺少说明远程模型已接管请求的持久事实。

## Decision

`adaptiveRouting.failover` 会明确指定允许替换的失败提供方、规范化失败代码、替代提供方／模型，以及可选的替代推理强度。随附 Web 策略会把 Ollama 的 `TRANSPORT`、`TIMEOUT` 和 `SERVER` 失败替换为 `google/gemini-3.6-flash`。

API proxy 会在普通提供方重试之前安装 agent-scoped `agent/request-error` listener。自动会话解析已配置的替代路由，追加 `llm/failover`，同时更新当前与已组装选择，并返回 `{ kind: 'retry' }`，因此循环会通过替代路由重建同一请求，不经历本地退避。替代路由解析失败时继续委托给提供方重试策略。手动会话始终委托，绝不会自动跨提供方切换。

`llm/failover` 是持久、非 surface 事件，包含失败路由、替代路由、规范化失败、轮次和步骤。重试 invariant 配套模块要求该事件指向开启的请求路由，并指定不同的替代提供方。conversation UI 会渲染不暴露失败详情的本地化警告；model selector 则在活动轮次内收到该事件时重新加载 Host 选择。

## Alternatives considered

**等待所有本地重试结束后再使用 API。** 拒绝，因为重复连接失败不会提高任务质量，还会把已配置恢复路由隐藏在可避免的延迟之后。

**把每个失败的模型选择都切换到 Gemini。** 拒绝，因为身份验证、无效模型以及手动选择路由的失败需要明确修正，而不是未披露的提供方更换。合格性仍由部署配置与自动模式状态决定。

**在每个提示词前探测 Ollama，并把故障转移放在请求恢复之外。** 拒绝，因为健康响应不能证明所选模型请求能够完成，而规范化请求失败才是恢复必须处理的权威事实。

**不写入会话事件就更改路由。** 拒绝，因为重连、回放、用户通知与角落模型指示器需要一个持久解释来说明提供方替换。

## Testing

纯路由测试固定提供方与失败代码合格性。Host 集成测试派发真实 agent request-error waterfall，证明自动模式会绕过普通重试、下一请求使用替代路由，并证明手动模式继续委托。invariant 测试固定活动路由与不同提供方要求。conversation 投影及组件测试固定回放与本地化显示，model-selection 测试固定活动轮次刷新，随附 Web composition 测试固定 Ollama 到 Gemini 策略。

## Consequences

本地服务不可用时，Leon 只增加一次失败请求尝试便会通过已配置 API 继续，且记录会说明发生了什么。云端使用可能产生提供方费用，但只有自动模式与明确配置的失败才会授权该行为。后续提示词仍可再次选择已经恢复的本地层级；该决策不增加隐藏的故障计时器或永久提供方降级。
