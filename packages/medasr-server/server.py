"""
TD|ai MedASR Transcription Server

FastAPI server for medical-grade speech-to-text:
  1. MedASR (Google Health) for radiology-optimized transcription
  2. MedicalDictionary for modality-specific term correction
  3. ReportStructurer (rule_based / Kompact AI) for report formatting

Voice Pipeline:
  audio → MedASR → MedicalDictionary → ReportStructurer → structured report
"""

import io
import os
import time
import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from llm_correction import MedGemmaCorrector, RadiologyReport
from medical_dictionary import MedicalDictionary
from report_structurer import ReportStructurer
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("medasr-server")

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

medasr_model = None
medasr_processor = None
device: Optional[torch.device] = None
medgemma_corrector: Optional[MedGemmaCorrector] = None

# Pipeline components (initialized at startup)
_medical_dict: Optional[MedicalDictionary] = None
_report_structurer: Optional[ReportStructurer] = None


class TranscribeResponse(BaseModel):
    """Full pipeline response for /v1/transcribe."""
    raw_transcript: str
    corrected_transcript: Optional[str] = None
    structured_report: Optional[dict[str, Any]] = None
    report: Optional[RadiologyReport] = None          # legacy MedGemma field
    modality: Optional[str] = None
    corrections_made: list[str] = []
    structuring_engine: Optional[str] = None
    confidence: float
    processing_time_ms: float
    model_used: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str
    model_name: str
    llm_mode: str
    pipeline_ready: bool
    structuring_engine: str


def load_model():
    global medasr_model, medasr_processor, device

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(dev)

    model_name = settings.MEDASR_MODEL_NAME
    logger.info("Loading MedASR model: %s on %s", model_name, dev)

    try:
        from transformers import AutoModelForCTC, AutoProcessor

        medasr_processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
        medasr_model = AutoModelForCTC.from_pretrained(model_name, trust_remote_code=True).to(device)
        medasr_model.eval()

        logger.info("MedASR model loaded successfully on %s", dev)
    except Exception as e:
        logger.warning("Failed to load MedASR model via transformers: %s", e)
        try:
            from medasr import MedASR
            medasr_model = MedASR.from_pretrained(model_name)
            medasr_processor = "medasr_native"
            logger.info("MedASR loaded via medasr package on %s", dev)
        except Exception:
            logger.warning(
                "ASR model unavailable (gated repo or missing package). "
                "Server will run in correction-only mode — /v1/correct still works."
            )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Initializing TD|ai MedASR Transcription Server...")
    load_model()

    global medgemma_corrector, _medical_dict, _report_structurer
    medgemma_corrector = MedGemmaCorrector()

    # Initialize pipeline components
    _medical_dict = MedicalDictionary()
    _report_structurer = ReportStructurer()  # defaults to rule_based engine

    logger.info(
        "Server ready | ASR: %s | LLM: %s | Dictionary: %s modalities | Structurer: %s",
        settings.MEDASR_MODEL_NAME,
        medgemma_corrector._mode,
        ", ".join(_medical_dict.get_supported_modalities()),
        _report_structurer.engine,
    )
    yield
    logger.info("Shutting down...")


app = FastAPI(
    title="TD|ai MedASR Transcription Server",
    description="Medical-grade speech-to-text with MedASR + MedGemma for radiology",
    version="4.0.0",
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

    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    if sr != 16000:
        from scipy.signal import resample
        n_samples = int(len(audio) * 16000 / sr)
        audio = resample(audio, n_samples)
        logger.info("Resampled from %s to 16000 Hz: %s samples", sr, n_samples)

    return audio.astype(np.float32)


def transcribe_audio(audio: np.ndarray) -> tuple[str, float]:
    """Run MedASR inference and return (transcript, confidence)."""
    if medasr_processor == "medasr_native":
        result = medasr_model.transcribe(audio, sample_rate=16000)
        transcript = result.get("text", "") if isinstance(result, dict) else str(result)
        confidence = result.get("confidence", 0.95) if isinstance(result, dict) else 0.95
        return transcript.strip(), confidence

    inputs = medasr_processor(audio, sampling_rate=16000, return_tensors="pt", padding=True)

    # Support both Wav2Vec2-style (input_values) and Whisper-style (input_features) processors
    inputs_dict = dict(inputs) if hasattr(inputs, "keys") else vars(inputs)
    if "input_values" in inputs_dict:
        model_input = inputs_dict["input_values"].to(device)
    elif "input_features" in inputs_dict:
        model_input = inputs_dict["input_features"].to(device)
    elif hasattr(inputs, "input_values"):
        model_input = inputs.input_values.to(device)
    elif hasattr(inputs, "input_features"):
        model_input = inputs.input_features.to(device)
    else:
        # Last resort: use the first tensor value found
        for key, val in inputs_dict.items():
            if hasattr(val, "to"):
                model_input = val.to(device)
                break
        else:
            raise ValueError(f"Cannot find model input tensor in processor output. Keys: {list(inputs_dict.keys())}")

    with torch.no_grad():
        logits = medasr_model(model_input).logits

    probs = torch.nn.functional.softmax(logits, dim=-1)
    confidence = probs.max(dim=-1).values.mean().item()

    predicted_ids = torch.argmax(logits, dim=-1)
    transcript = medasr_processor.batch_decode(predicted_ids)[0]

    return transcript.strip(), confidence


@app.get("/", response_model=HealthResponse)
async def root():
    return HealthResponse(
        status="ok",
        model_loaded=medasr_model is not None,
        device=str(device),
        model_name=settings.MEDASR_MODEL_NAME,
        llm_mode=medgemma_corrector._mode if medgemma_corrector else "unavailable",
        pipeline_ready=_medical_dict is not None and _report_structurer is not None,
        structuring_engine=_report_structurer.engine if _report_structurer else "unavailable",
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model_loaded=medasr_model is not None,
        device=str(device),
        model_name=settings.MEDASR_MODEL_NAME,
        llm_mode=medgemma_corrector._mode if medgemma_corrector else "unavailable",
        pipeline_ready=_medical_dict is not None and _report_structurer is not None,
        structuring_engine=_report_structurer.engine if _report_structurer else "unavailable",
    )


async def extract_audio(request: Request, audio: Optional[UploadFile] = File(None)) -> bytes:
    """Extract audio bytes from either multipart file or raw request body."""
    audio_bytes: Optional[bytes] = None

    if audio and audio.filename:
        data = await audio.read()
        if data:
            logger.info("Received audio via multipart: %d bytes, name=%s", len(data), audio.filename)
            audio_bytes = data

    if audio_bytes is None:
        form = await request.form()
        for key in ("audio", "file"):
            field = form.get(key)
            if field and hasattr(field, "read"):
                data = await field.read()
                if data:
                    logger.info("Received audio via form field '%s': %d bytes", key, len(data))
                    audio_bytes = data
                    break

    if audio_bytes is None:
        body = await request.body()
        if body:
            logger.info("Received audio via raw body: %d bytes", len(body))
            audio_bytes = body

    if audio_bytes is None:
        raise HTTPException(status_code=400, detail="No audio data received")

    if len(audio_bytes) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    return audio_bytes


@app.post("/v1/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: Optional[UploadFile] = File(None),
    modality: str = Form("CR"),
    apply_medical_correction: bool = Form(True),
    apply_structuring: bool = Form(True),
):
    """
    Full voice pipeline: MedASR → MedicalDictionary → ReportStructurer

    Pipeline:
      1. Decode audio (WAV / WebM / MP3 via soundfile / torchaudio / ffmpeg)
      2. Transcribe with google/medasr
      3. Correct medical terminology via MedicalDictionary (modality-specific)
      4. Structure report via ReportStructurer (rule_based or kompact_ai)

    Form params:
      - audio:                   audio file (multipart)
      - modality:                DICOM modality code (CR, DX, MG, RF, FL, XA)
      - apply_medical_correction: apply MedicalDictionary correction (default: true)
      - apply_structuring:       apply ReportStructurer (default: true)
    """
    if medasr_model is None:
        raise HTTPException(
            status_code=503,
            detail="ASR model not loaded. Use /v1/correct for transcript formatting.",
        )

    start = time.time()
    audio_bytes = await extract_audio(request, audio)

    if len(audio_bytes) < 100:
        raise HTTPException(
            status_code=400,
            detail=f"Audio file too small ({len(audio_bytes)} bytes)",
        )

    try:
        decoded = decode_audio(audio_bytes)
    except Exception as e:
        logger.error("Audio decode failed: %s", e)
        raise HTTPException(status_code=400, detail="Failed to decode audio")

    # Step 1: ASR transcription
    raw_text, confidence = transcribe_audio(decoded)
    logger.info("ASR transcript: %s", raw_text[:120])

    # Step 2: Medical dictionary correction
    corrections_made: list[str] = []
    corrected_text = raw_text
    if apply_medical_correction and _medical_dict is not None:
        corrected_text, corrections_made = _medical_dict.correct(
            raw_text, modality=modality
        )

    # Step 3: Report structuring
    structured_report: Optional[dict] = None
    structuring_engine: Optional[str] = None
    if apply_structuring and _report_structurer is not None:
        try:
            structured_report = _report_structurer.structure(
                corrected_text, modality=modality
            )
            structuring_engine = structured_report.get("structuring_engine")
        except Exception as e:
            logger.warning("Report structuring failed: %s", e)

    elapsed = (time.time() - start) * 1000
    logger.info(
        "Pipeline complete in %.1fms | corrections=%d | modality=%s | engine=%s",
        elapsed, len(corrections_made), modality, structuring_engine,
    )

    return TranscribeResponse(
        raw_transcript=raw_text,
        corrected_transcript=corrected_text,
        structured_report=structured_report,
        modality=modality.upper(),
        corrections_made=corrections_made,
        structuring_engine=structuring_engine,
        confidence=confidence,
        processing_time_ms=round(elapsed, 1),
        model_used=settings.MEDASR_MODEL_NAME,
    )


@app.post("/v1/transcribe/radiology", response_model=TranscribeResponse)
async def transcribe_radiology(request: Request, audio: Optional[UploadFile] = File(None)):
    """Transcribe audio and format as a radiology report using MedASR + MedGemma."""
    if medasr_model is None:
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
    if medgemma_corrector and raw_text:
        try:
            report = await medgemma_corrector.correct_and_format(raw_text)
        except Exception as e:
            logger.warning("MedGemma correction failed: %s", e)

    elapsed = (time.time() - start) * 1000

    return TranscribeResponse(
        raw_transcript=raw_text,
        corrected_transcript=raw_text,
        report=report,
        confidence=confidence,
        processing_time_ms=round(elapsed, 1),
        model_used=settings.MEDASR_MODEL_NAME,
    )


@app.post("/v1/correct")
async def correct_transcript(transcript: str = Form(...)):
    """Apply MedGemma medical correction to an existing transcript."""
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty")

    if medgemma_corrector:
        try:
            report = await medgemma_corrector.correct_and_format(transcript)
            return report.model_dump()
        except Exception as e:
            logger.warning("MedGemma correction failed: %s", e)

    return {
        "findings": transcript,
        "impression": "Clinical correlation recommended.",
        "corrections_applied": ["MedGemma unavailable — raw transcript used"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
