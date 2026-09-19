# Agent Note: 解析显式凭据引用 fallback 链

Status: implemented

[English](2026-08-28-explicit-credential-reference-fallbacks.md) | 中文

## 问题

Leon 已将 Gemini 模型与 Google Search 配置统一到 `GEMINI_API_KEY`，但较早的安装可能只在 `GOOGLE_API_KEY` 下保存了同一把 Google API key。把机密复制到两个记录中会产生两个可独立轮换的值，也会让实际授权请求的是哪条凭据变得不明确。

在具名引用缺失后使用提供方原生 ambient discovery，并不是安全的迁移机制。无关的环境密钥可能认证另一个账户，而配置与缺少凭据的诊断都不会描述这条 fallback。

## 决策

pi-ai 提供方 profile 与 Google Search 提供方接受有序的 `apiKeyEnvFallbacks` 列表。它们先解析 `apiKeyEnv`，然后只尝试明确声明的兼容引用。重复引用会被拒绝；pi-ai 还会拒绝没有主引用的 fallback 列表。

通用 Google Search 包继续以 `GOOGLE_API_KEY` 且无 fallback 作为默认值。Leon 的 bundle 则在 Gemini 模型路由和 Google Search 两处显式声明 `GEMINI_API_KEY` 为主引用，并把 `GOOGLE_API_KEY` 作为唯一迁移 fallback。

配置与其他凭据记录都不会复制机密。两个消费者都会按操作解析最终命中的引用，因此轮换会作用于下一次模型调用或搜索。

## 曾考虑的替代方案

**升级时把 `GOOGLE_API_KEY` 复制到新的 `GEMINI_API_KEY` 记录。** 否决，因为这会复制机密，并产生含糊的轮换与删除行为。

**引用缺失后让提供方发现任意 ambient Google 密钥。** 否决，因为该 fallback 未被声明，可能向另一个账户计费或暴露数据。

**把通用 Google Search 默认值改为 Leon 的别名链。** 否决，因为包级行为不应静默获得部署特定的迁移策略。

## 后果

新的 Leon 安装使用 `GEMINI_API_KEY`。仅持有 `GOOGLE_API_KEY` 的既有安装无需改写凭据存储即可继续工作。引用链全部缺失时会明确失败并点名所有已声明引用，无关环境密钥会被忽略。

测试覆盖主引用优先级、旧引用 fallback、错误或重复引用链的验证、缺少凭据的诊断、bundle 组合，以及拒绝读取未声明的 ambient Google 密钥。
