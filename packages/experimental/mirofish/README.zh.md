# `@deepseek-ai/dsh-experimental-mirofish`

[English](README.md) | 中文

这是 Leon 对独立运行的 [MiroFish](https://github.com/666ghj/MiroFish) 后端的可选集成。该软件包提供 `mirofish_simulate` 工具：上传种子文本，构建 MiroFish 图谱，准备并运行有上限的模拟，然后返回 Markdown 报告。

## 配置

```yaml
- id: mirofish
  name: '@deepseek-ai/dsh-experimental-mirofish'
  config:
    enabled: true
    baseUrl: 'http://127.0.0.1:5001'
    maxRounds: 40
```

只有在组合中设置 `enabled: true` 后工具才会注册。每次执行都会先请求 Leon 的共享审批服务，再把种子发送到 MiroFish。本桥接不会启动 Docker、安装依赖或保存 API 密钥。

`baseUrl` 指向 MiroFish Flask 后端。官方部署的后端端口为 `5001`，独立前端端口为 `3000`。MiroFish 必须单独配置并运行，包括其 LLM API 和 Zep Cloud 设置。本桥接使用已公开的图谱、模拟和报告接口，并以可取消且有时间上限的方式轮询异步任务。

## 安全与限制

结果是模拟报告，不是确定性的预测。种子受 `maxSeedChars` 限制，报告受 `maxReportChars` 限制，单次请求受 `timeoutMs` 限制，每个异步阶段受 `maxWaitMs` 限制。默认模拟上限为 40 轮，因为上游项目警告模拟可能消耗大量 LLM 资源。

本包为私有包，并将 MiroFish 的进程与许可证边界同 Leon 核心隔离。MiroFish 仍是独立的 AGPL-3.0 应用；本包只通过其 HTTP API 与之通信。

## 模型体验

### MiroFish 模拟工具

#### 模型看到的内容

一个可选工具 `mirofish_simulate`，其 schema 要求提供要模拟的种子文本。工具结果携带生成的 Markdown 报告；失败时返回桥接层有界的错误文本，而不是部分模拟输出。

#### Token 影响

种子参数受 `maxSeedChars` 限制，返回报告受 `maxReportChars` 限制，单次调用不会把无界文档送入上下文。

#### KV Cache 影响

无。该工具不添加提示词前缀，其结果仅作为普通工具结果出现。

## 已知限制与暂缓事项

- **外部后端生命周期**——Leon 不启动、监控或升级 MiroFish 服务器；后端缺失或配置错误只在调用时暴露。
- **上游模型质量不可见**——报告内容取决于 MiroFish 自身的 LLM 与 Zep 配置，本包无法验证。
- **许可证边界**——MiroFish 为 AGPL-3.0；桥接仅经 HTTP 通信，不内嵌上游代码。
