# @deepseek-ai/dsh-client-ui-voice

English | [中文](README.zh.md)

This package gives Leon one local-first voice loop and one truthful ambient activity readout. The session-scoped `conversation.input.right` seat owns microphone start, stop, and speech interruption. The `conversation.composer.dock` seat shows ready, listening, local transcription, thinking, active tool, pending interaction, speaking, interruption, and error states derived from the ordinary conversation snapshot rather than a parallel progress channel.

`BrowserVoiceCaptureDriver` contains `getUserMedia`, `MediaRecorder`, Web Audio measurement, and resource release behind the narrow `VoiceCaptureDriver` interface. `VoiceCaptureController` publishes only a JSON-safe view; the recorded `Blob` remains private. A configured transcriber receives one `AbortSignal` for the processing operation and must settle promptly when capture is cancelled, its Session changes, or the plugin is disposed. The bundled adapter forwards that signal while sending the ephemeral clip to Leon's same-origin loopback Host. The Host keeps one lazy local Vosk worker warm, loads the model once, serializes clips through it, and destroys it after cancellation, timeout, or a protocol fault. The component writes recognized text through the conversation package's ordinary `InputActions.setDraft` and `submitTracked` path instead of inventing a second message channel.

`BrowserVoicePlaybackDriver` uses the browser's operating-system speech catalog and accepts only voices marked `localService`. It prefers Brazilian Portuguese and Microsoft Daniel when installed, then another local Portuguese voice, and fails closed when only remote voices exist. Playback is replaceable behind `VoicePlaybackDriver`; no voice model, audio recording, or cloud TTS dependency is bundled into this package.

A voice-submitted prompt enqueues exactly one causal spoken reply after the corresponding turn has ended. Host admission returns the exact durable Chat user-message id; its resolved turn is the only turn eligible for speech. Concurrent follow-ups stay in submission order even when Host receipts arrive out of order. Restored history, later typed turns, interrupted assistant output, reasoning, and tool blocks never enter speech; fenced code is removed and long prose is capped.

Selecting the microphone while Leon speaks cancels only audio and opens a new capture without cancelling the agent or its tools. A live voice session reopens the microphone after a spoken or intentionally silent answer finishes and exposes a separate end control that stops capture and playback without stopping the task. Speech captured while the agent is working enters the ordinary queue. Automatic sending is allowed only when the composer was empty and unchanged when capture began; typed text, attachments, references, and slash commands keep the transcript in the draft for review. Pending approvals/questions and non-plain composer transactions remain blocking boundaries, so voice cannot bypass explicit human interaction. Ending live mode or switching Sessions invalidates late Host receipts, and an admitted message that does not reach the Chat projection within 30 seconds ends voice mode without cancelling its task.

History-opening errors take precedence over the ready indicator. The HUD uses the existing conversation error without weakening persistence validation.

## Model Experience

None, as voice capture, playback, and the activity HUD register no model-facing tool or prompt; recognized text enters the existing user-message pipeline, leaving the configured router fully responsible for local versus API selection.

#### KV Cache effect

None beyond the ordinary recognized user text. Microphone levels, recording bytes, playback state, and HUD state never enter provider context.

## Known Limitations and Deferred Work

- **Transcription is clip-based** — speech is recorded locally and transcribed after capture ends. Live mode is continuous by completed turns; partial transcription and a simultaneous full-duplex stream are not implemented.
- **The first playback provider is browser-local** — available voices vary by Windows and browser. A future Host provider may add a product-controlled voice without changing the controller.
- **Speech is deliberately selective** — only a new finalized answer following a voice submission is read. Typed prompts, restored history, reasoning, tool arguments, fenced code, and empty answers remain silent.
- **Barge-in is task-safe, not task cancellation** — the microphone may capture a follow-up while Leon works, but interrupting speech stops audio only. The recognized message follows the ordinary queue policy; it does not secretly cancel tools or the active turn.
- **Reply correlation is causal** — `InputActions.submitTracked` carries the exact Host-admitted message id, so identical concurrent text cannot make Leon speak the wrong turn.
- **Draft review is fail-closed** — a capture auto-sends only from an empty, unchanged composer. Existing or concurrently typed text, images, references, and slash commands remain visible for manual review.
- **A projection timeout stops voice, not work** — if the admitted user message does not become observable within 30 seconds, the live voice cycle ends visibly while the ordinary conversation and task remain authoritative.
- **No custom or cloned voice is bundled** — a future installer must separately verify the engine, model, redistribution terms, and authorization for any reference voice.
- **Resources follow the client plugin lifetime** — disposal aborts capture, in-flight transcription, and playback, then ignores late browser callbacks. Switching sessions aborts capture and transcription and silently stops speech so one conversation is never read over another.
