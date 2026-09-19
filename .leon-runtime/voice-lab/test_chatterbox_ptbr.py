"""Generate a local Brazilian Portuguese Chatterbox voice sample for Leon."""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torchaudio


def parse_args() -> argparse.Namespace:
    """Parse the reusable voice-lab arguments."""
    voice_root = Path(os.getenv("LEON_VOICE_ROOT", r"E:\computador\leon-voice"))
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--text",
        default=(
            "Olá. Eu sou o Leon, seu assistente inteligente da The Lions Informática. "
            "Estou pronto para ajudar você com seus projetos e tarefas."
        ),
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=voice_root / "samples" / "pt_br_f2.wav",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=voice_root / "output" / "leon-chatterbox-ptbr-teste.wav",
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    """Load the official PT-BR checkpoint and generate one verified WAV file."""
    args = parse_args()
    voice_root = Path(os.getenv("LEON_VOICE_ROOT", r"E:\computador\leon-voice"))
    source_root = voice_root / "chatterbox-ptbr-space"
    model_root = voice_root / "models" / "chatterbox-ptbr"

    if not torch.cuda.is_available():
        raise RuntimeError("A RTX/CUDA não está disponível para o teste de voz.")
    if not args.reference.is_file():
        raise FileNotFoundError(f"Áudio de referência ausente: {args.reference}")

    sys.path.insert(0, str(source_root / "chatterbox" / "src"))
    from chatterbox.tts import ChatterboxTTS

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)

    started = time.perf_counter()
    model = ChatterboxTTS.from_local(model_root, "cuda")
    loaded_at = time.perf_counter()
    with torch.inference_mode():
        wav = model.generate(
            args.text[:300],
            audio_prompt_path=str(args.reference),
            language_id="pt",
            exaggeration=0.45,
            temperature=0.8,
            cfg_weight=0.45,
        )
    generated_at = time.perf_counter()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    wav = wav.detach().cpu()
    torchaudio.save(str(args.output), wav, model.sr)
    duration = wav.shape[-1] / model.sr

    print(f"arquivo={args.output}")
    print(f"amostragem_hz={model.sr}")
    print(f"duracao_s={duration:.2f}")
    print(f"carregamento_s={loaded_at - started:.2f}")
    print(f"geracao_s={generated_at - loaded_at:.2f}")
    print(f"pico_vram_gb={torch.cuda.max_memory_allocated() / 1024**3:.2f}")


if __name__ == "__main__":
    main()
