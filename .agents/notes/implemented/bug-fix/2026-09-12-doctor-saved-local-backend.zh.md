# Agent Note: Doctor 遵循已保存的本地后端

Status: implemented

[English](2026-09-12-doctor-saved-local-backend.md) | 中文

## Problem

固定的 Ollama 模型要求会把健康的 llama.cpp 安装报告为不可用，还可能把模型目录误当成推理（inference）成功。即使 URL 使用回环地址，对任意配置提供方的元数据请求仍可能联系云网关。

## Decision

无需启动 profile 的 [doctor](../../../../apps/cli/src/doctor.ts) 从默认 `$DSH_HOME/settings.yaml` 文档读取 `agent-default-model` 和 `llm-pi-ai.providers`。它只接受显式选择且使用 HTTP(S) 回环 URL 的 `llamacpp` 或 `ollama` 提供方。缺少选择时保持未验证，不继承历史模型。报告不包含设置解析器诊断或响应正文，凭据字段绝不复制到请求中。

服务健康、所选模型是否存在于目录中和未执行的推理分别报告。llama.cpp 使用 `/health` 以及配置的 OpenAI 兼容基础 URL 加 `/models`；Ollama 使用 `/api/version` 和 `/api/tags`。目录请求成功不证明模型已加载、GPU 加速、工具使用或生成质量。推理检查始终报告警告，因为此命令不提交生成请求。

这细化了[只读诊断](../feature/2026-08-27-read-only-leon-doctor.zh.md)，而不改变[自动路由安全策略](2026-08-28-leon-automatic-routing-safety-hold.zh.md)。两份早期说明仍因各自独立的无需启动和路由决策而保持有效。不会修改任务、模型、凭据、profile 或服务。自定义 profile 覆盖设置路径或动态提供方配置不在此无需启动的检查范围内；报告会明确所检查的设置来源。

## Alternatives considered

**继续要求 Qwen 9B。** 已否决，因为模型清单和用户显式选择可以独立于 doctor 版本变化。

**探测每个回环提供方。** 已否决，因为 localhost 网关可能路由到外部服务。诊断不查询 FreeLLMAPI 或其他提供方。

**启动 profile 或发送生成请求以确认就绪状态。** 已否决，因为诊断不得初始化状态、激活工具、加载模型或消耗推理额度。

## Consequences

报告在运行时启动前有用，但明确不认证推理。单元测试覆盖配置后端、无关模型、独立健康失败、格式错误响应、设置失败和非回环地址拒绝。完整 CLI（命令行界面）快照读取隔离设置，并联系不携带授权头的临时回环 HTTP 服务器；原始设置和目录内容保持不变。这些检查不验证真实 llama.cpp 进程、GPU 性能或模型能力。
