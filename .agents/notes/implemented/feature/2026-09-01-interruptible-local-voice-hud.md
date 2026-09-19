# Agent Note: Interruptible local voice and activity HUD

Status: implemented

English | [中文](2026-09-01-interruptible-local-voice-hud.zh.md)

## Problem

Leon could capture and transcribe a microphone clip, but it neither spoke a completed answer nor showed one compact state that distinguished listening, model work, tool execution, pending human interaction, and failure. A user could therefore see a static composer while the session continued working. Importing a second assistant server or a parallel event stream would duplicate the existing conversation projection and create conflicting cancellation and approval semantics.

## Decision

The `ui-voice` client plugin owns one shared capture controller and one shared interruptible playback controller. The microphone stays in `conversation.input.right`; a non-interactive HUD occupies `conversation.composer.dock`. Its pure projection reads capture and playback views plus the ordinary `ConversationSnapshot` fields `running`, `runningCalls`, `pending`, `partial`, `promptError`, and `lastAgentError`. It never manufactures progress outside those sources.

The first playback driver uses the browser operating-system speech catalog, accepts only voices with `localService === true`, prefers `pt-BR` and Microsoft Daniel, and fails closed when only remote voices exist. `VoicePlaybackDriver` remains replaceable so a later Host synthesizer does not alter the controller or UI contract.

A microphone-submitted prompt uses the ordinary composer transaction but awaits its causal admission receipt. The Host returns the exact durable user-message id, and the Chat projection supplies that message's resolved turn. A FIFO coordinator retains multiple voice follow-ups in submission order even if admission receipts arrive out of order. Only the last finalized, non-interrupted assistant prose from each exact turn can speak. Reasoning, tool blocks, fenced code, restored history, typed turns, and empty responses stay silent; prose is capped at 1,200 characters.

Selecting the microphone during speech aborts audio but never invokes session stop or tool cancellation. A live voice session reopens capture after completed playback or an intentionally silent finalized turn and provides a separate end control that stops voice resources without stopping the task. A capture may start while an agent turn is active and its recognized follow-up uses the ordinary queue. Automatic sending requires an empty, unchanged composer; existing or concurrently typed text, attachments, references, and slash commands leave the transcript in the draft for review. Pending human interactions and non-plain composer transactions remain blocking boundaries. Session changes and the explicit end control advance a lifecycle epoch, cancel capture and transcription, stop speech, clear queued voice replies, and make every late Host receipt inert. An admission or projection that remains unobservable for 30 seconds ends voice mode visibly without cancelling the ordinary task.

The state-driven orb, separate speech interruption, and truthful tool activity were informed by the interaction patterns in [`eadmin2/jarvis_ai` at `88998de`](https://github.com/eadmin2/jarvis_ai/tree/88998de8369e9d36f6d434b5e01feb93fcf1c33f). The implementation is original Leon code; no source or CSS from that repository was copied.

## Alternatives considered

**Adopt the external HUD and Hermes server.** Rejected because it would add another session engine, router, approval path, and WebSocket protocol beside Leon's existing runtime.

**Synthesize every assistant message.** Rejected because restored history, typed work, tool output, code, and sensitive operational text must not start speaking without a voice-initiated turn.

**Bundle Piper or a cloned neural voice now.** Rejected for the first cut because the installed Piper runtime has GPL distribution implications, neural providers add model and hardware cost, and a reference voice requires explicit rights. The driver interface preserves this future option.

**Add a separate activity event stream.** Rejected because `ConversationSnapshot` already contains the authoritative facts and a second channel could drift or report a state for the wrong session.

## Consequences

Leon now exposes local turn-continuous speech, task-safe interruption, and a visible working state without another model, GPU allocation, cloud TTS call, or agent loop. Browser and Windows voice availability determine the first provider's voice quality; no custom identity voice is bundled. Clip transcription and finalized-answer playback are not a simultaneous full-duplex stream, and partial STT/TTS remains deferred. Causal Host receipts and ordered reply coordination remove text-and-timing ambiguity, while draft compare-and-swap, lifecycle epochs, projection timeout, and explicit interaction gates prevent stale speech or approval bypass. Unit tests pin local-only voice selection, cancellation propagation, resource cleanup under browser failures, timeout, interruption, live relisten, session isolation, exact-turn reply correlation, out-of-order receipts, concurrent draft edits, state priority, and the two slot registrations. Assembled Web validation still owns browser integration, actual microphone permission, acoustic behavior, and visual regression coverage.
