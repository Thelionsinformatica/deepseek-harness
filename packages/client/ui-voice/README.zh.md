# @deepseek-ai/dsh-client-ui-voice

[English](README.md) | 中文

本包在会话级 `conversation.input.right` 插槽中提供 Leon 的本地优先麦克风控件。点击后由浏览器请求麦克风权限、录制临时音频片段并展示实时音量；用户可手动停止，检测到说话后的静音也会自动停止，并有一分钟安全上限。权限被拒、未发现硬件、设备被占用、浏览器 API 不受支持、空音频及一般捕获故障都呈现为稳定的本地化状态，而不是暴露浏览器原始异常。

该状态机不拥有模型选择，也不会通过网络发送音频。`BrowserVoiceCaptureDriver` 把 `getUserMedia`、`MediaRecorder`、Web Audio 测量和资源释放封装在狭窄的 `VoiceCaptureDriver` 接口之后。`VoiceCaptureController` 只发布可 JSON 化的视图；`Blob` 保持私有，并在捕获结算后变为不可达。可选的 `VoiceTranscriber` 回调是未来本地语音转文字 provider 的扩展点。provider 返回文本后，组件会通过 conversation 包已有的 `InputActions.setDraft` 路径写入草稿，而不会发明第二条消息通道。

## 模型体验

无，因为浏览器端捕获不会注册任何面向模型的内容。

#### KV Cache 影响

无；麦克风状态与录音字节不会进入 provider 上下文。未来的转写器可以生成普通用户草稿文本，但只有用户发送该文本后，既有 conversation 流程才决定由本地模型还是 API 模型接收。

## 已知限制与后续工作

- **捕获并不等于转写** —— 第一阶段只验证权限、录音、音量显示、静音检测与清理。成功捕获会被如实报告，但由于尚未安装语音转文字 provider，音频随后会被丢弃。
- **暂不提供语音回复** —— 合成、播放打断、声音选择以及完整的聆听／思考／说话循环属于独立 TTS capability，因此可在不修改 composer 的情况下替换语音引擎。
- **以浏览器支持为准** —— 控件需要 `getUserMedia`、`MediaRecorder` 和 Web Audio。不受支持的浏览器会显示错误，绝不会暗中回退到云端识别器。
- **每个插槽声明只有一个麦克风生命周期** —— 切换或移除 conversation 插槽会取消活动捕获并释放所有媒体轨道。音频不会跨页面刷新或 Session 切换持久化。
