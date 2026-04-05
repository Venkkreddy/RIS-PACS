"""
TD|ai Wav2Vec2 Transcription Server (Open-Source Tier)

FastAPI server for speech-to-text using:
  1. An English-optimized Wav2Vec2 checkpoint for transcription (fully local, no API keys)
  2. Ollama for radiology report formatting (fully local)

Implements the same API contract as MedASR so the Node.js backend can
call either server interchangeably.
"""

import io
import os
import time
import logging
import re
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ollama_correction import OllamaCorrector, RadiologyReport
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("wav2vec2-server")

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

asr_backend = None
asr_model_name = None
whisper_model = None
wav2vec2_model = None
wav2vec2_processor = None
device: Optional[torch.device] = None
ollama_corrector: Optional[OllamaCorrector] = None


class TranscribeResponse(BaseModel):
    raw_transcript: str
    corrected_transcript: Optional[str] = None
    report: Optional[RadiologyReport] = None
    confidence: float
    processing_time_ms: float
    model_used: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str
    model_name: str
    llm_mode: str


def load_model():
    global asr_backend, asr_model_name, whisper_model, wav2vec2_model, wav2vec2_processor, device

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(dev)
    asr_backend = settings.ASR_BACKEND.strip().lower()

    if asr_backend == "faster-whisper":
        model_name = settings.FASTER_WHISPER_MODEL
        whisper_device = settings.FASTER_WHISPER_DEVICE if settings.FASTER_WHISPER_DEVICE != "auto" else dev
        logger.info(
            "Loading Faster-Whisper model: %s on %s (%s)",
            model_name,
            whisper_device,
            settings.FASTER_WHISPER_COMPUTE_TYPE,
        )

        try:
            from faster_whisper import WhisperModel

            whisper_model = WhisperModel(
                model_name,
                device=whisper_device,
                compute_type=settings.FASTER_WHISPER_COMPUTE_TYPE,
            )
            asr_model_name = f"faster-whisper:{model_name}"
            logger.info("Faster-Whisper model loaded successfully on %s", whisper_device)
            return
        except Exception as e:
            logger.error("Failed to load Faster-Whisper model: %s", e)
            logger.warning("Falling back to Wav2Vec2 backend")
            asr_backend = "wav2vec2"

    model_name = settings.WAV2VEC2_MODEL
    logger.info("Loading Wav2Vec2 model: %s on %s", model_name, dev)

    try:
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        wav2vec2_processor = Wav2Vec2Processor.from_pretrained(model_name)
        wav2vec2_model = Wav2Vec2ForCTC.from_pretrained(model_name).to(device)
        wav2vec2_model.eval()
        asr_model_name = model_name
        logger.info("Wav2Vec2 model loaded successfully on %s", dev)
    except Exception as e:
        logger.error("Failed to load Wav2Vec2 model: %s", e)
        logger.warning("Server will run in correction-only mode — /v1/correct still works.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Initializing TD|ai Wav2Vec2 Transcription Server (Open-Source)...")
    load_model()

    global ollama_corrector
    ollama_corrector = OllamaCorrector()

    logger.info(
        "Server ready | Backend: %s | ASR: %s | LLM: %s",
        asr_backend,
        asr_model_name,
        ollama_corrector._mode,
    )
    yield
    logger.info("Shutting down...")


app = FastAPI(
    title="TD|ai Wav2Vec2 Transcription Server",
    description="Open-source speech-to-text with Wav2Vec2 + Ollama for radiology",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:8081").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_audio(audio_bytes: bytes) -> np.ndarray:
    """Decode audio bytes to 16kHz mono float32 numpy array."""
    audio = None
    sr = None

    try:
        audio, sr = sf.read(io.BytesIO(audio_bytes))
        logger.info("Decoded with soundfile: sr=%s, shape=%s", sr, audio.shape)
    except Exception as e:
        logger.info("soundfile failed: %s — trying torchaudio", e)

    if audio is None:
        import tempfile, os
        try:
            import torchaudio
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name
            try:
                waveform, sample_rate = torchaudio.load(tmp_path)
                audio = waveform.numpy().squeeze()
                sr = sample_rate
                logger.info("Decoded with torchaudio: sr=%s, samples=%s", sr, len(audio))
            finally:
                os.unlink(tmp_path)
        except Exception as e:
            logger.info("torchaudio failed: %s — trying ffmpeg", e)

    if audio is None:
        import tempfile, subprocess, os
        ext = ".webm" if b"webm" in audio_bytes[:64] else ".bin"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        wav_path = tmp_path + ".wav"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
                capture_output=True, check=True,
            )
            audio, sr = sf.read(wav_path)
            logger.info("Decoded with ffmpeg: sr=%s, samples=%s", sr, len(audio))
        except FileNotFoundError:
            raise RuntimeError(
                "Cannot decode audio. Install ffmpeg or ensure audio is sent as WAV format. "
                "Received %d bytes." % len(audio_bytes)
            )
        finally:
            for p in [tmp_path, wav_path]:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    if isinstance(audio, tuple):
        audio = np.asarray(audio[0])

    audio = np.asarray(audio, dtype=np.float32)

    if audio.ndim > 1:
        # soundfile returns (samples, channels); torchaudio often returns (channels, samples)
        channel_axis = 1 if audio.shape[0] >= audio.shape[1] else 0
        audio = audio.mean(axis=channel_axis)

    audio = np.squeeze(audio)

    if audio.ndim != 1:
        audio = audio.reshape(-1)

    if sr != 16000:
        n_samples = int(len(audio) * 16000 / sr)
        try:
            import torchaudio

            audio = torchaudio.functional.resample(
                torch.from_numpy(audio),
                orig_freq=sr,
                new_freq=16000,
            ).numpy()
        except Exception:
            from scipy.signal import resample

            audio = resample(audio, n_samples)
        logger.info("Resampled from %s to 16000 Hz: %s samples", sr, n_samples)

    # Remove DC offset, trim leading/trailing near-silence, then normalize.
    audio = np.nan_to_num(audio.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    if audio.size == 0:
        return audio

    audio = audio - float(audio.mean())
    abs_audio = np.abs(audio)
    threshold = max(float(abs_audio.max()) * 0.015, 1e-4)
    voiced = np.flatnonzero(abs_audio > threshold)
    if voiced.size > 0:
        start = max(int(voiced[0]) - 1600, 0)
        end = min(int(voiced[-1]) + 1600, len(audio))
        audio = audio[start:end]

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio / peak

    return audio.astype(np.float32)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def merge_transcript_segments(existing: str, new_segment: str) -> str:
    existing = existing.strip()
    new_segment = new_segment.strip()

    if not existing:
        return new_segment
    if not new_segment:
        return existing

    existing_words = existing.split()
    new_words = new_segment.split()
    max_overlap = min(len(existing_words), len(new_words), 12)

    for overlap in range(max_overlap, 0, -1):
        if _normalize_text(" ".join(existing_words[-overlap:])) == _normalize_text(" ".join(new_words[:overlap])):
            return f"{existing} {' '.join(new_words[overlap:])}".strip()

    return f"{existing} {new_segment}".strip()


def transcribe_chunk(audio_chunk: np.ndarray) -> tuple[str, float]:
    inputs = wav2vec2_processor(
        audio_chunk,
        sampling_rate=16000,
        return_tensors="pt",
        padding=True,
    )
    model_inputs = {"input_values": inputs.input_values.to(device)}
    if getattr(inputs, "attention_mask", None) is not None:
        model_inputs["attention_mask"] = inputs.attention_mask.to(device)

    with torch.no_grad():
        logits = wav2vec2_model(**model_inputs).logits

    probs = torch.nn.functional.softmax(logits, dim=-1)
    confidence = probs.max(dim=-1).values.mean().item()
    predicted_ids = torch.argmax(logits, dim=-1)
    transcript = wav2vec2_processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

    return transcript.strip(), confidence


def transcribe_audio_wav2vec2(audio: np.ndarray) -> tuple[str, float]:
    """Run Wav2Vec2 inference and return (transcript, confidence)."""
    if audio.size == 0:
        return "", 0.0

    chunk_samples = max(int(settings.WAV2VEC2_CHUNK_SECONDS * 16000), 16000)
    overlap_samples = max(int(settings.WAV2VEC2_CHUNK_OVERLAP_SECONDS * 16000), 0)
    step_samples = max(chunk_samples - overlap_samples, 16000)

    if audio.shape[0] <= chunk_samples:
        return transcribe_chunk(audio)

    transcripts: list[str] = []
    confidences: list[float] = []

    for start in range(0, len(audio), step_samples):
        end = min(start + chunk_samples, len(audio))
        chunk = audio[start:end]
        if chunk.size < 4000:
            continue

        transcript, confidence = transcribe_chunk(chunk)
        if transcript:
            transcripts.append(transcript)
            confidences.append(confidence)

        if end >= len(audio):
            break

    merged = ""
    for transcript in transcripts:
        merged = merge_transcript_segments(merged, transcript)

    average_confidence = float(np.mean(confidences)) if confidences else 0.0
    return merged.strip(), average_confidence


def transcribe_audio_whisper(audio: np.ndarray) -> tuple[str, float]:
    """Run Faster-Whisper inference and return (transcript, confidence)."""
    if audio.size == 0:
        return "", 0.0

    segments, _info = whisper_model.transcribe(
        audio,
        language="en",
        task="transcribe",
        beam_size=settings.FASTER_WHISPER_BEAM_SIZE,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
        condition_on_previous_text=True,
        temperature=0.0,
    )

    transcripts: list[str] = []
    confidences: list[float] = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        transcripts.append(text)
        avg_logprob = float(getattr(segment, "avg_logprob", -1.0))
        confidences.append(float(np.clip(np.exp(avg_logprob), 0.0, 1.0)))

    transcript = " ".join(transcripts).strip()
    confidence = float(np.mean(confidences)) if confidences else 0.0
    return transcript, confidence


def is_asr_loaded() -> bool:
    return whisper_model is not None or wav2vec2_model is not None


def transcribe_audio(audio: np.ndarray) -> tuple[str, float]:
    if asr_backend == "faster-whisper" and whisper_model is not None:
        return transcribe_audio_whisper(audio)
    if wav2vec2_model is not None and wav2vec2_processor is not None:
        return transcribe_audio_wav2vec2(audio)
    return "", 0.0


@app.get("/", response_model=HealthResponse)
async def root():
    return HealthResponse(
        status="ok",
        model_loaded=is_asr_loaded(),
        device=str(device),
        model_name=asr_model_name or "unavailable",
        llm_mode=ollama_corrector._mode if ollama_corrector else "unavailable",
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model_loaded=is_asr_loaded(),
        device=str(device),
        model_name=asr_model_name or "unavailable",
        llm_mode=ollama_corrector._mode if ollama_corrector else "unavailable",
    )


async def extract_audio(request: Request, audio: Optional[UploadFile] = File(None)) -> bytes:
    if audio and audio.filename:
        data = await audio.read()
        if data:
            if len(data) > MAX_UPLOAD_SIZE:
                raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
            return data

    form = await request.form()
    for key in ("audio", "file"):
        field = form.get(key)
        if field and hasattr(field, "read"):
            data = await field.read()
            if data:
                if len(data) > MAX_UPLOAD_SIZE:
                    raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
                return data

    body = await request.body()
    if body:
        if len(body) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
        return body

    raise HTTPException(status_code=400, detail="No audio data received")


@app.post("/v1/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: Optional[UploadFile] = File(None),
    apply_medical_correction: bool = Form(True),
):
    if not is_asr_loaded():
        raise HTTPException(status_code=503, detail="ASR model not loaded. Use /v1/correct for transcript formatting.")

    start = time.time()
    audio_bytes = await extract_audio(request, audio)

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail=f"Audio file too small ({len(audio_bytes)} bytes)")

    try:
        decoded = decode_audio(audio_bytes)
    except Exception as e:
        logger.error("Audio decode failed: %s", e)
        raise HTTPException(status_code=400, detail="Failed to decode audio")

    raw_text, confidence = transcribe_audio(decoded)
    elapsed = (time.time() - start) * 1000

    return TranscribeResponse(
        raw_transcript=raw_text,
        corrected_transcript=raw_text,
        confidence=confidence,
        processing_time_ms=round(elapsed, 1),
        model_used=asr_model_name or settings.WAV2VEC2_MODEL,
    )


@app.post("/v1/transcribe/radiology", response_model=TranscribeResponse)
async def transcribe_radiology(request: Request, audio: Optional[UploadFile] = File(None)):
    if not is_asr_loaded():
        raise HTTPException(status_code=503, detail="ASR model not loaded. Use /v1/correct for transcript formatting.")

    start = time.time()
    audio_bytes = await extract_audio(request, audio)

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail=f"Audio file too small ({len(audio_bytes)} bytes)")

    try:
        decoded = decode_audio(audio_bytes)
    except Exception as e:
        logger.error("Audio decode failed: %s", e)
        raise HTTPException(status_code=400, detail="Failed to decode audio")

    raw_text, confidence = transcribe_audio(decoded)

    report = None
    if ollama_corrector and raw_text:
        try:
            report = await ollama_corrector.correct_and_format(raw_text)
        except Exception as e:
            logger.warning("Ollama correction failed: %s", e)

    elapsed = (time.time() - start) * 1000

    return TranscribeResponse(
        raw_transcript=raw_text,
        corrected_transcript=raw_text,
        report=report,
        confidence=confidence,
        processing_time_ms=round(elapsed, 1),
        model_used=asr_model_name or settings.WAV2VEC2_MODEL,
    )


@app.post("/v1/correct")
async def correct_transcript(transcript: str = Form(...)):
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty")

    if ollama_corrector:
        try:
            report = await ollama_corrector.correct_and_format(transcript)
            return report.model_dump()
        except Exception as e:
            logger.warning("Ollama correction failed: %s", e)

    return {
        "findings": transcript,
        "impression": "Clinical correlation recommended.",
        "corrections_applied": ["Ollama unavailable — raw transcript used"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
