import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import sherpa_onnx
import uvicorn
from fastapi import FastAPI, File, UploadFile


def create_recognizer(model_dir: Path) -> sherpa_onnx.OfflineRecognizer:
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_dir / "model.int8.onnx"),
        tokens=str(model_dir / "tokens.txt"),
        num_threads=4,
        use_itn=True,
        language="auto",
    )


def decode_audio(ffmpeg: str, source: Path) -> np.ndarray:
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(source), "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


def build_app(recognizer: sherpa_onnx.OfflineRecognizer, ffmpeg: str) -> FastAPI:
    app = FastAPI()

    @app.get("/ready", status_code=204)
    async def ready() -> None:
        return None

    @app.post("/_lucarice/speech/transcribe")
    async def transcribe(audio: UploadFile = File(...)) -> dict[str, str]:
        suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
        with tempfile.TemporaryDirectory(prefix="lucarice-speech-") as directory:
            source = Path(directory) / f"audio{suffix}"
            source.write_bytes(await audio.read())
            samples = decode_audio(ffmpeg, source)
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        return {"text": stream.result.text.strip()}

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    args = parser.parse_args()

    app = build_app(create_recognizer(args.model_dir), args.ffmpeg)
    args.ready_file.write_text("ready", encoding="utf-8")
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
