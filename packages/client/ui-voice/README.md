# @deepseek-ai/dsh-client-ui-voice

English | [中文](README.zh.md)

This package fills the session-scoped `conversation.input.right` seat with Leon's local-first microphone control. A click requests browser microphone permission, records an ephemeral audio clip, projects a live level meter, and stops either on explicit input, after speech followed by silence, or at the one-minute safety limit. Permission denial, missing hardware, an occupied device, unsupported browser APIs, empty audio, and generic capture failure are presented as stable localized states rather than raw browser exceptions.

The state machine owns no provider choice and sends no audio over the network. `BrowserVoiceCaptureDriver` contains `getUserMedia`, `MediaRecorder`, Web Audio measurement, and resource release behind the narrow `VoiceCaptureDriver` seam. `VoiceCaptureController` publishes only a JSON-safe view; the `Blob` remains private and becomes unreachable after the capture settles. Its optional `VoiceTranscriber` callback is the extension point for a future local speech-to-text provider. When that provider returns text, the component writes it through the conversation package's ordinary `InputActions.setDraft` path instead of inventing a parallel message channel.

## Model Experience

None, as browser-side capture registers nothing model-facing.

#### KV Cache effect

None; microphone state and recording bytes never enter provider context. A future transcriber may produce ordinary user draft text, but only after the user sends that text does the existing conversation pipeline decide which local or API model receives it.

## Known Limitations and Deferred Work

- **Capture is intentionally not transcription** — this first stage proves permission, recording, metering, silence detection, and cleanup. It reports a successful local capture honestly and discards it because no speech-to-text provider is installed yet.
- **No spoken response yet** — synthesis, playback interruption, voice selection, and the full listening / thinking / speaking loop belong to a separate TTS capability so a voice engine can be replaced without changing the composer.
- **Browser support is authoritative** — the control requires `getUserMedia`, `MediaRecorder`, and Web Audio. Unsupported browsers show an error; they never fall back to an undisclosed cloud recognizer.
- **One microphone lifetime per seat declaration** — changing or removing the conversation seat cancels an active capture and releases every media track. Audio is not persisted across a page reload or Session switch.
