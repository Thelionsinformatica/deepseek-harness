# Agent Note: Local-first browser voice capture for Leon

Status: implemented

English | [中文](2026-08-23-leon-browser-voice-capture.zh.md)

## Problem

Leon exposed a text composer but no real microphone control. A decorative button or browser speech-recognition shortcut would not solve the product need: the user must see whether Leon is requesting permission, listening, processing, or failing, while local audio must not be sent to an undisclosed cloud service and microphone resources must not survive a Session or plugin lifetime.

## Decision

The new `@deepseek-ai/dsh-client-ui-voice` browser plugin occupies the existing session-scoped `conversation.input.right` list seat. Its `BrowserVoiceCaptureDriver` is the sole owner of `getUserMedia`, `MediaRecorder`, Web Audio analysis, media tracks, and `AudioContext`; the `VoiceCaptureController` owns the request/listen/process/captured/error state machine, polling, speech-followed-by-silence stop policy, one-minute duration guard, and late-permission/disposal generation checks. The React component receives the controller as an injected observable hook and remains a pure presentation surface.

Audio is ephemeral and private. The observable view carries only status, normalized level, duration, a clip summary, a stable error code, and an optional transcript. No Session event is authored because capture alone is not durable business state. The optional `VoiceTranscriber` seam accepts the private clip in a future composition; recognized text then enters the existing `InputActions.setDraft` path, so the established conversation submit, automatic model routing, permissions, and memory behavior remain the only route to a model.

The first shipped composition intentionally installs no transcriber and no TTS provider. A successful capture proves microphone access and cleanup, reports that local transcription is the next stage, and discards the recording. This is preferable to silently using browser speech recognition, whose remote processing and support differ by browser.

## Alternatives considered

**Use the browser `SpeechRecognition` API.** Rejected because support is inconsistent, especially outside Chromium configurations, and audio processing may leave the local machine without a Leon-owned provider or authorization boundary.

**Place microphone logic inside `InputBar`.** Rejected because it would make the conversation package own browser media and a particular voice implementation. The existing named slot provides the correct independent plugin boundary.

**Persist the raw recording in the Session log.** Rejected for this stage because audio bytes are sensitive, large, and useless until a transcription or attachment domain defines retention, consent, and deletion policy. The capture view therefore contains only metadata.

**Call Gemini directly from the microphone control.** Rejected because the UI must not own provider credentials or bypass Leon Automatic. Speech-to-text, routing, and text-to-speech remain separate replaceable capabilities.

## Testing

Controller tests cover request-to-listening-to-captured flow, live level projection, stable permission errors, automatic silence stop, disposal during a pending browser permission request, and the future transcriber handoff. Component tests cover start/stop interaction, localized failure copy, and transcript insertion through the ordinary draft action. Plugin composition tests prove optional slot declaration order, teardown, and resource-free idle state. Package typechecking, the focused 12-test suite, and client bundling validate the first stage.

## Consequences

Leon now has a real, visible, local-first microphone foundation without changing model routing or exposing credentials. The user can validate browser permission and capture behavior immediately. The next stage has a narrow task: provide local speech-to-text through `VoiceTranscriber`, then add a separate TTS/playback capability for the full listening, thinking, and speaking loop. Until those providers exist, Leon describes capture truthfully and never pretends that recorded audio was understood.
