"""Decode one browser recording and transcribe it with an offline Vosk model."""

from __future__ import annotations

import argparse
import io
import json
import sys

import numpy as np
from faster_whisper import decode_audio
from vosk import KaldiRecognizer, Model, SetLogLevel


SAMPLE_RATE = 16_000
CHUNK_SAMPLES = 8_000


def transcribe(data: bytes, model_path: str) -> str:
    """Return recognized PT-BR text for encoded browser audio bytes."""
    waveform = decode_audio(io.BytesIO(data), sampling_rate=SAMPLE_RATE)
    if waveform.size == 0:
        return ""
    pcm = np.clip(waveform * 32767.0, -32768, 32767).astype(np.int16)
    SetLogLevel(-1)
    recognizer = KaldiRecognizer(Model(model_path), SAMPLE_RATE)
    recognizer.SetWords(False)
    for start in range(0, pcm.size, CHUNK_SAMPLES):
        recognizer.AcceptWaveform(pcm[start : start + CHUNK_SAMPLES].tobytes())
    result = json.loads(recognizer.FinalResult())
    text = result.get("text", "")
    return text.strip() if isinstance(text, str) else ""


def main() -> int:
    """Read encoded audio from stdin and emit one JSON document to stdout."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    text = transcribe(sys.stdin.buffer.read(), args.model)
    sys.stdout.write(json.dumps({"text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
