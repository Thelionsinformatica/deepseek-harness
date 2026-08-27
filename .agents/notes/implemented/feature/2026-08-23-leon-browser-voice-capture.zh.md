# Agent Note: Leon 的本地优先浏览器语音捕获

Status: implemented

[English](2026-08-23-leon-browser-voice-capture.md) | 中文

## Problem

Leon 已有文本 composer，但没有真实的麦克风控件。装饰性按钮或浏览器语音识别捷径无法满足产品需求：用户必须看见 Leon 是在请求权限、聆听、处理还是失败；同时，本地音频不能被发送到未披露的云服务，麦克风资源也不能超出 Session 或插件生命周期继续存在。

## Decision

新的 `@deepseek-ai/dsh-client-ui-voice` 浏览器插件占用现有的会话级 `conversation.input.right` 列表插槽。`BrowserVoiceCaptureDriver` 是 `getUserMedia`、`MediaRecorder`、Web Audio 分析、媒体轨道与 `AudioContext` 的唯一 owner；`VoiceCaptureController` 负责请求／聆听／处理／已捕获／错误状态机、轮询、说话后静音停止策略、一分钟时长保护，以及权限延迟返回和销毁时的 generation 检查。React 组件通过注入的 observable hook 获取控制器，保持纯展示层。

音频是临时且私有的。observable 视图只携带状态、归一化音量、时长、片段摘要、稳定错误码和可选转写文本。仅捕获不属于持久业务状态，因此不会创建 Session 事件。未来组合可通过可选 `VoiceTranscriber` 接口接收私有音频；识别文本随后进入既有 `InputActions.setDraft` 路径，因此 conversation 提交、自动模型路由、权限与记忆行为仍是抵达模型的唯一通道。

首个发布组合有意不安装转写器，也不安装 TTS provider。成功捕获会验证麦克风访问与资源清理，如实提示本地转写是下一阶段，然后丢弃录音。这优于暗中使用浏览器语音识别，因为其远程处理方式与支持范围会因浏览器而异。

## Alternatives considered

**使用浏览器 `SpeechRecognition` API。** 否决，因为其支持不一致，尤其在不同 Chromium 配置之外，而且音频可能在没有 Leon provider 与授权边界的情况下离开本机。

**把麦克风逻辑放进 `InputBar`。** 否决，因为那会让 conversation 包拥有浏览器媒体和特定语音实现。现有命名插槽正是正确的独立插件边界。

**把原始录音持久化到 Session 日志。** 本阶段否决，因为音频字节敏感且体积大；在 transcription 或 attachment 领域定义保留、同意与删除策略之前没有持久化价值。因此捕获视图只包含元数据。

**由麦克风控件直接调用 Gemini。** 否决，因为 UI 不应拥有 provider 凭证，也不应绕过 Leon Automatic。语音转文字、路由和文字转语音仍是相互独立、可替换的 capability。

## Testing

控制器测试覆盖从请求到聆听再到捕获、实时音量投影、稳定权限错误、静音自动停止、浏览器权限尚未返回时销毁，以及未来转写器交接。组件测试覆盖开始／停止交互、本地化故障文案，以及通过普通草稿 action 写入转写文本。插件组合测试证明可选插槽声明顺序、销毁和无资源 idle 状态。包级类型检查、12 项聚焦测试与客户端打包共同验证第一阶段。

## Consequences

Leon 现在拥有真实、可见、本地优先的麦克风基础，而无需修改模型路由或暴露凭证。用户可以立即验证浏览器权限与捕获行为。下一阶段任务边界清晰：通过 `VoiceTranscriber` 提供本地语音转文字，然后增加独立的 TTS／播放 capability，形成完整的聆听、思考与说话循环。在这些 provider 到位前，Leon 会如实描述捕获状态，绝不会假装已经理解录音。
