# Agent Note: 作用域工具描述压缩

Status: implemented

[English](2026-08-22-scoped-tool-description-compaction.md) | 中文

## 问题

本地模型在生成首个 token 前，需要读取每个可见工具的描述以及嵌套参数描述。Leon 这类能力完整的 preset 需要保留全部可调用工具，但每次请求重复发送冗长说明会占据其静态上下文的大部分。直接修改注册定义还会降低目录、验证诊断以及能够承担完整文本的其他 agent 的质量。

## 决定

`ToolRuntime.compactDescriptions(maxLength)` 为面向模型的描述声明一个可继承、限定于 agent scope 的字符上限。它会规范化空白，并使用省略号截断工具描述和嵌套参数描述。Native schema 与生成的 Code Mode SDK 使用压缩投影；`get()`、`schemas()`、验证、呈现回调和执行仍保留完整注册定义。

最近的 scope 声明优先，dispose 后恢复继承值。全局调用、非整数上限、小于三的值以及同一 scope 内的重复声明都会明确失败。`dsh-agent-tool-presentation` 通过可选的 `descriptionMaxLength` 公开该声明，使 preset 自己承担取舍，而不改变部署默认值。

Leon 使用 Native 呈现、120 字符描述上限、8 KiB workspace 指令预算和 120 字符 skill 目录摘要。它的真实 Web 组合把静态系统段限制为 8,000 字节、工具 schema 限制为 18,000 字节，两者序列化后的合计限制为 25,000 字节。

## 验证

作用域注册表测试覆盖祖先继承、近端覆盖、dispose、递归参数描述压缩、无效声明、重复声明以及注册定义保持完整。呈现行快照固定其配置与面向模型的输出。随附 Web 组合测试会启动真实 Leon preset 并测量组装后的静态上下文；记录的实现运行中，工具 schema 部分为 16,988 字节，而无上限投影为 28,971 字节。

## 考虑过的替代方案

**从 Leon 移除工具。** 已否决，因为这会降低能力，并使本地模型的行为偏离产品承诺的混合 agent。

**修改每个工具的规范描述。** 已否决，因为一个本地 preset 的延迟预算不应削弱生成目录、诊断或其他 preset。

**仅为减少 schema 而使用 Code Mode。** 已否决，因为生成的 SDK 加系统段在测量中大于 Leon 的 Native 静态上下文，还会改变本地模型调用工具的方式。

**通过提示词组装事件监听器压缩。** 已否决，因为挂载在 preset 常驻 scope 中的监听器不会沿注册表的继承 scope 链投影。该呈现策略应与 `presentAs()` 一起归属 `ToolRuntime`。

## 后果

Leon 向本地模型发送的固定文本显著减少，同时保留工具和提供方路由。截断描述可能省略上限之后的次要指导，因此 preset 使用适中的上限，并为检查保留完整定义。稳定的 scope 组合可保持 KV cache 前缀；更改上限会改变面向模型的前缀。
