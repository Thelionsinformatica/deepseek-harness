"""Run one persistent offline Vosk worker over framed stdin/stdout messages."""

from __future__ import annotations

import argparse
import io
import json
import sys
from typing import BinaryIO

import av
from vosk import KaldiRecognizer, Model, SetLogLevel


PROTOCOL_VERSION = 1
MAX_HEADER_BYTES = 1_024
MAX_RESPONSE_BYTES = 64 * 1_024
MAX_TRANSCRIPT_BYTES = 32 * 1_024
SAMPLE_RATE = 16_000
MAX_AUDIO_SECONDS = 60
MAX_PCM_SAMPLES = SAMPLE_RATE * MAX_AUDIO_SECONDS


class ProtocolError(Exception):
    """The host sent a malformed or out-of-bounds worker frame."""


class ClipError(Exception):
    """The current bounded recording is invalid without poisoning the worker."""


def positive_integer(value: str) -> int:
    """Parse one positive command-line integer."""
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def emit(message: dict[str, object]) -> None:
    """Write and flush one bounded JSON protocol line."""
    encoded = (json.dumps(
        message, ensure_ascii=False, separators=(",", ":")
    ) + "\n").encode("utf-8")
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ValueError("response limit exceeded")
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_header(stream: BinaryIO) -> dict[str, object] | None:
    """Read one newline-delimited header without accepting an oversized line."""
    line = stream.readline(MAX_HEADER_BYTES + 1)
    if line == b"":
        return None
    if len(line) > MAX_HEADER_BYTES or not line.endswith(b"\n"):
        raise ProtocolError("invalid header length")
    try:
        value = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError("invalid header JSON") from error
    if not isinstance(value, dict):
        raise ProtocolError("header must be an object")
    return value


def request_fields(header: dict[str, object], max_bytes: int) -> tuple[int, int]:
    """Validate one versioned transcription header and return its id and size."""
    request_id = header.get("id")
    byte_count = header.get("bytes")
    if (
        header.get("v") != PROTOCOL_VERSION
        or header.get("type") != "transcribe"
        or type(request_id) is not int
        or request_id < 1
        or type(byte_count) is not int
        or byte_count < 1
        or byte_count > max_bytes
    ):
        raise ProtocolError("invalid request header")
    return request_id, byte_count


def read_exact(stream: BinaryIO, size: int) -> bytes:
    """Read exactly one frame payload or reject a truncated host stream."""
    data = bytearray(size)
    view = memoryview(data)
    offset = 0
    while offset < size:
        read = stream.readinto(view[offset:])
        if read is None or read == 0:
            raise ProtocolError("truncated request payload")
        offset += read
    return bytes(data)


def transcribe(data: bytes, model: Model) -> str:
    """Return recognized PT-BR text using the already-loaded Vosk model."""
    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(False)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    decoded_samples = 0
    try:
        with av.open(io.BytesIO(data), mode="r", metadata_errors="ignore") as container:
            for source_frame in container.decode(audio=0):
                for frame in resampler.resample(source_frame):
                    pcm = frame.to_ndarray().reshape(-1)
                    decoded_samples += pcm.size
                    if decoded_samples > MAX_PCM_SAMPLES:
                        raise ClipError("decoded audio duration limit exceeded")
                    recognizer.AcceptWaveform(pcm.tobytes())
            for frame in resampler.resample(None):
                pcm = frame.to_ndarray().reshape(-1)
                decoded_samples += pcm.size
                if decoded_samples > MAX_PCM_SAMPLES:
                    raise ClipError("decoded audio duration limit exceeded")
                recognizer.AcceptWaveform(pcm.tobytes())
    except (av.FFmpegError, EOFError, LookupError, ValueError) as error:
        raise ClipError("invalid encoded audio") from error
    if decoded_samples == 0:
        return ""
    result = json.loads(recognizer.FinalResult())
    text = result.get("text", "")
    if not isinstance(text, str):
        return ""
    normalized = text.strip()
    if len(normalized.encode("utf-8")) > MAX_TRANSCRIPT_BYTES:
        raise ClipError("transcript limit exceeded")
    return normalized


def serve(model_path: str, max_bytes: int) -> int:
    """Load Vosk once, then serialize framed recordings until host EOF."""
    SetLogLevel(-1)
    model = Model(model_path)
    emit({"v": PROTOCOL_VERSION, "type": "ready"})
    while True:
        try:
            header = read_header(sys.stdin.buffer)
            if header is None:
                return 0
            request_id, byte_count = request_fields(header, max_bytes)
            data = read_exact(sys.stdin.buffer, byte_count)
        except ProtocolError:
            emit({"v": PROTOCOL_VERSION, "type": "fatal", "code": "INVALID_REQUEST"})
            return 2
        text = ""
        try:
            try:
                text = transcribe(data, model)
            except ClipError:
                emit({
                    "v": PROTOCOL_VERSION,
                    "type": "result",
                    "id": request_id,
                    "ok": False,
                    "code": "TRANSCRIPTION_FAILED",
                })
            except Exception:
                emit({
                    "v": PROTOCOL_VERSION,
                    "type": "fatal",
                    "code": "WORKER_FAILED",
                })
                return 3
            else:
                emit({
                    "v": PROTOCOL_VERSION,
                    "type": "result",
                    "id": request_id,
                    "ok": True,
                    "text": text,
                })
        finally:
            # Drop the request-owned recording and transcript before idle.
            # Python cannot promise physical zeroization, but it retains no
            # intentional application reference after this request settles.
            data = b""
            text = ""


def main() -> int:
    """Parse deployment arguments and run the persistent worker."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--max-bytes", required=True, type=positive_integer)
    args = parser.parse_args()
    return serve(args.model, args.max_bytes)


if __name__ == "__main__":
    raise SystemExit(main())
