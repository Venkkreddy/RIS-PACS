"""
MONAI Production Inference Server for TD|ai
=============================================

FastAPI server that provides clinical-grade AI inference across all
imaging modalities (CT, MRI, CXR, Ultrasound).

Architecture:
  - Modular model registry (models/)
  - Per-modality transform pipelines (transforms/)
  - Sliding window + MONAI Deploy operator graph (inference/)
  - DICOM SEG, SR TID 1500, PR output (outputs/)
  - GradCAM explainability + metrics tracking (metrics/)
  - MONAI Label active learning integration (label/)
  - Celery + Redis async job queue
  - Triton Inference Server integration

Backward-compatible with existing /v1/infer, /v1/models, /v1/analyze-dicom
endpoints from the previous single-model server.
"""

from __future__ import annotations

import io
import os
import sys
import time
import base64
import logging
import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Ensure the package root is on sys.path for absolute imports
_pkg_root = str(Path(__file__).resolve().parent)
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)


def _load_env() -> None:
    _resolved = Path(__file__).resolve()
    _parents = list(_resolved.parents)
    _candidates = []
    if len(_parents) > 2:
        _candidates.append(_parents[2] / ".env")
    _candidates.append(_resolved.parent / ".env")
    _seen: set[Path] = set()
    for _env_path in _candidates:
        if _env_path in _seen:
            continue
        _seen.add(_env_path)
        if _env_path.exists():
            with _env_path.open() as _f:
                for _line in _f:
                    _line = _line.strip()
                    if _line and not _line.startswith("#") and "=" in _line:
                        _k, _, _v = _line.partition("=")
                        os.environ.setdefault(_k.strip(), _v.strip())
            break


_load_env()

import numpy as np
import torch
import pydicom
from PIL import Image
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel

import monai

from config import (
    DEVICE, NUM_GPUS, MODELS_DIR,
    GCP_PROJECT_ID, GCP_LOCATION, GEMINI_API_KEY, GEMINI_MODEL,
    MEDGEMMA_ENDPOINT, MEDGEMMA_MODEL, VERTEX_AI_ENABLED,
    LLM_PROVIDER, OLLAMA_URL, OLLAMA_MODEL,
    ORTHANC_URL, route_by_dicom_tags,
)
from models.registry import (
    MODEL_REGISTRY, load_model, get_model_config,
    get_all_model_configs, get_loaded_model_names, unload_model,
)
from models.model_zoo import download_bundle_weights, BUNDLE_MAP, ensure_critical_weights
from transforms import get_inference_transforms, TRANSFORM_MAP
from transforms.postprocessing import (
    segmentation_postprocess, detection_postprocess, classification_postprocess,
)
from inference.engine import run_inference, run_sliding_window_inference
from inference.operators import MonaiDeployPipeline
from inference.job_queue import enqueue_inference_job, get_job_status, InferenceJob, CELERY_AVAILABLE
from inference.triton_client import TritonModelClient
from outputs.dicom_seg import create_dicom_seg
from outputs.dicom_sr import create_dicom_sr_tid1500
from outputs.dicom_pr import create_dicom_pr
from outputs.schemas import InferenceResult, Finding, Measurement, ClinicalScore
from metrics.tracking import MetricsTracker
from metrics.explainability import GradCAMGenerator
from label.active_learning import ActiveLearningManager
from label.deepedit_config import get_deepedit_app_config
from label.retraining import RetrainingPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("monai-server")

# ── Global singletons ────────────────────────────────────────────────

metrics_tracker = MetricsTracker()
active_learning = ActiveLearningManager()
retraining_pipeline = RetrainingPipeline()
deploy_pipeline = MonaiDeployPipeline()
triton_client = TritonModelClient()

# MedGemma state (backward compat)
medgemma_model = None
medgemma_mode = "disabled"

# Legacy labels
CHEST_XRAY_LABELS = [
    "Atelectasis", "Cardiomegaly", "Effusion", "Infiltration", "Mass",
    "Nodule", "Pneumonia", "Pneumothorax", "Consolidation", "Edema",
    "Emphysema", "Fibrosis", "Pleural Thickening", "Hernia",
]


# ── Pixel Data Extraction ────────────────────────────────────────────

def extract_pixel_array(ds: pydicom.Dataset) -> np.ndarray:
    """Extract a 2D/3D grayscale float32 array from a DICOM dataset."""
    if not hasattr(ds, "PixelData"):
        raise ValueError("DICOM dataset has no PixelData element")

    tsuid = getattr(ds.file_meta, "TransferSyntaxUID", None) if hasattr(ds, "file_meta") else None
    compressed = {
        "1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51",
        "1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70",
        "1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.81",
        "1.2.840.10008.1.2.4.90", "1.2.840.10008.1.2.4.91",
        "1.2.840.10008.1.2.5",
    }

    if tsuid and str(tsuid) in compressed:
        try:
            ds.decompress()
        except Exception as e:
            logger.warning("decompress() failed for TS %s: %s", tsuid, e)

    try:
        arr = ds.pixel_array.astype(np.float32)
    except Exception:
        if tsuid:
            try:
                raw = ds.PixelData
                preamble_len = 12 if raw[:4] == b"\xfe\xff\x00\xe0" else 0
                img = Image.open(io.BytesIO(raw[preamble_len:]))
                arr = np.array(img, dtype=np.float32)
                if arr.ndim == 3:
                    arr = arr.mean(axis=-1)
            except Exception:
                raise ValueError(
                    f"Cannot decode pixel data (TS: {tsuid}). "
                    "Ensure pylibjpeg + pylibjpeg-libjpeg + pylibjpeg-openjpeg are installed."
                )
        else:
            raise

    if arr.ndim == 3:
        arr = arr.mean(axis=-1) if arr.shape[-1] <= 4 else arr[arr.shape[0] // 2]
    if hasattr(ds, "RescaleSlope") and hasattr(ds, "RescaleIntercept"):
        arr = arr * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
    return arr


def normalize_to_uint8(arr: np.ndarray) -> np.ndarray:
    mn, mx = arr.min(), arr.max()
    if mx - mn < 1e-8:
        return np.zeros(arr.shape, dtype=np.uint8)
    return ((arr - mn) / (mx - mn) * 255).astype(np.uint8)


# ── MedGemma / LLM Integration (preserved from v3) ──────────────────

MEDGEMMA_BASE_PROMPT = """You are an expert radiologist. Analyze this medical image and provide a structured radiology report.

Instructions:
- Describe all observable findings systematically
- Note normal structures explicitly when no abnormality is seen
- Provide differential diagnoses where appropriate
- Only report what you can observe in the image

Respond with valid JSON:
{
  "findings": "Detailed findings paragraph(s)",
  "impression": "Concise clinical impression",
  "narrative": "Complete narrative radiology report",
  "detected_conditions": [
    {"label": "condition name", "confidence": 0.85, "description": "brief description"}
  ]
}"""


def _build_medgemma_prompt(monai_context: list[dict] | None = None) -> str:
    prompt = MEDGEMMA_BASE_PROMPT
    if monai_context:
        lines = [f"  - {f['label']}: {f['confidence']*100:.0f}%" for f in monai_context[:8]]
        prompt += (
            "\n\nMONAI AI findings:\n" + "\n".join(lines)
            + "\n\nIncorporate these into your analysis."
        )
    return prompt


def init_medgemma():
    global medgemma_model, medgemma_mode

    if LLM_PROVIDER == "off":
        logger.info("LLM_PROVIDER=off — narrative reports disabled")
        return

    if LLM_PROVIDER == "ollama":
        try:
            import httpx
            resp = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
            if resp.status_code == 200:
                medgemma_model = True
                medgemma_mode = "ollama"
                logger.info("LLM initialized via Ollama (%s)", OLLAMA_MODEL)
                return
        except Exception as e:
            logger.warning("Ollama not reachable: %s", e)

    if VERTEX_AI_ENABLED and GCP_PROJECT_ID:
        try:
            import vertexai
            from vertexai.generative_models import GenerativeModel
            vertexai.init(project=GCP_PROJECT_ID, location=GCP_LOCATION)
            model_name = MEDGEMMA_ENDPOINT or GEMINI_MODEL
            medgemma_model = GenerativeModel(model_name)
            medgemma_mode = "vertex_ai"
            logger.info("LLM via Vertex AI (%s)", model_name)
            return
        except Exception as e:
            logger.warning("Vertex AI init failed: %s", e)

    if GEMINI_API_KEY:
        medgemma_model = True
        medgemma_mode = "gemini_api"
        logger.info("LLM via Gemini API (%s)", GEMINI_MODEL)
        return

    logger.info("No LLM backend configured")


async def run_medgemma_analysis(
    pixel_array: np.ndarray,
    monai_findings: list[dict] | None = None,
    llm_provider_override: str | None = None,
) -> dict:
    """Run MedGemma/Gemini/Ollama for narrative report (preserved API)."""
    effective_mode = medgemma_mode
    if llm_provider_override:
        if llm_provider_override == "off":
            return {"narrative": "LLM disabled", "findings": "", "impression": "", "detected_conditions": []}
        if llm_provider_override == "gemini" and GEMINI_API_KEY:
            effective_mode = "gemini_api"
        elif llm_provider_override == "ollama":
            effective_mode = "ollama"

    if medgemma_model is None and effective_mode == medgemma_mode:
        return {"narrative": "LLM not configured", "findings": "", "impression": "", "detected_conditions": []}

    import json as json_module, re as re_module

    png_bytes = _dicom_to_png(pixel_array)
    prompt = _build_medgemma_prompt(monai_findings)

    if effective_mode == "gemini_api":
        return await _gemini_api_call(png_bytes, prompt, json_module, re_module)
    elif effective_mode == "vertex_ai":
        return await _vertex_ai_call(png_bytes, prompt, json_module, re_module)
    elif effective_mode == "ollama":
        return await _ollama_call(png_bytes, prompt, json_module, re_module)

    return {"narrative": "", "findings": "", "impression": "", "detected_conditions": []}


def _dicom_to_png(pixel_array: np.ndarray) -> bytes:
    uint8 = normalize_to_uint8(pixel_array)
    img = Image.fromarray(uint8, mode="L").resize((896, 896), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _parse_llm_json(raw: str, json_module, re_module) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re_module.sub(r"^```\w*\n?", "", raw)
        raw = re_module.sub(r"\n?```$", "", raw)
        raw = raw.strip()
    try:
        return json_module.loads(raw)
    except json_module.JSONDecodeError:
        pass
    m = re_module.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            return json_module.loads(m.group())
        except json_module.JSONDecodeError:
            pass
    return {"findings": "", "impression": "", "narrative": raw, "detected_conditions": []}


async def _gemini_api_call(png_bytes, prompt, json_module, re_module) -> dict:
    import httpx
    try:
        b64 = base64.b64encode(png_bytes).decode("ascii")
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                params={"key": GEMINI_API_KEY},
                json={"contents": [{"parts": [
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                    {"text": prompt},
                ]}], "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096, "responseMimeType": "application/json"}},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        parsed = _parse_llm_json(text, json_module, re_module)
        return {k: parsed.get(k, "") for k in ("narrative", "findings", "impression", "detected_conditions")}
    except Exception as e:
        logger.error("Gemini API failed: %s", e)
        return {"narrative": f"Gemini API failed: {e}", "findings": "", "impression": "", "detected_conditions": []}


async def _vertex_ai_call(png_bytes, prompt, json_module, re_module) -> dict:
    import asyncio
    try:
        from vertexai.generative_models import Part
        image_part = Part.from_data(png_bytes, mime_type="image/png")
        resp = await asyncio.to_thread(
            lambda: medgemma_model.generate_content(
                [image_part, prompt],
                generation_config={"temperature": 0.1, "max_output_tokens": 4096, "response_mime_type": "application/json"},
            )
        )
        parsed = _parse_llm_json(resp.text.strip(), json_module, re_module)
        return {k: parsed.get(k, "") for k in ("narrative", "findings", "impression", "detected_conditions")}
    except Exception as e:
        logger.error("Vertex AI failed: %s", e)
        return {"narrative": f"MedGemma failed: {e}", "findings": "", "impression": "", "detected_conditions": []}


async def _ollama_call(png_bytes, prompt, json_module, re_module) -> dict:
    import httpx
    try:
        b64 = base64.b64encode(png_bytes).decode("ascii")
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "images": [b64], "stream": False, "format": "json"},
            )
            resp.raise_for_status()
            text = resp.json().get("response", "").strip()
        parsed = _parse_llm_json(text, json_module, re_module)
        return {k: parsed.get(k, "") for k in ("narrative", "findings", "impression", "detected_conditions")}
    except Exception as e:
        logger.error("Ollama failed: %s", e)
        return {"narrative": f"Ollama failed: {e}", "findings": "", "impression": "", "detected_conditions": []}


# ── FastAPI Application ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        "MONAI %s | PyTorch %s | Device: %s | GPUs: %d",
        monai.__version__, torch.__version__, DEVICE, NUM_GPUS,
    )
    logger.info(
        "Models registered: %d | Transform pipelines: %d",
        len(MODEL_REGISTRY), len(TRANSFORM_MAP),
    )

    # Download pre-trained weights for critical models before first use.
    # This fetches from MONAI Model Zoo and TorchXRayVision (all free).
    logger.info("Downloading pre-trained model weights (first run may take a few minutes)…")
    downloaded = ensure_critical_weights()
    for name, wpath in downloaded.items():
        logger.info("  ✓ %s → %s (exists=%s)", name, wpath, wpath.exists())

    # Pre-load CXR model for fast first inference
    try:
        load_model("cxr_14class")
    except Exception as e:
        logger.warning("Could not pre-load cxr_14class: %s", e)

    init_medgemma()
    triton_client.connect()

    logger.info(
        "MONAI production server ready | MedGemma: %s | Celery: %s | Triton: %s | Weights: %d/%d",
        medgemma_mode,
        "enabled" if CELERY_AVAILABLE else "disabled",
        "connected" if triton_client._connected else "disabled",
        sum(1 for p in downloaded.values() if p.exists()),
        len(downloaded),
    )
    yield
    logger.info("MONAI server shutting down")


app = FastAPI(
    title="TD|ai MONAI Production Inference Server",
    version="4.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:8081").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


# ── Request/Response Models ──────────────────────────────────────────

class InferRequest(BaseModel):
    model: str = "cxr_14class"
    studies: list[str]
    series: Optional[list[str]] = None
    input: Optional[dict] = None


class DicomSRRequest(BaseModel):
    study_instance_uid: str
    series_instance_uid: Optional[str] = None
    patient_name: str = "Unknown"
    patient_id: str = "0000"
    model: str = "cxr_14class"
    findings: list[dict]
    summary: str = ""


# ══════════════════════════════════════════════════════════════════════
# CORE API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {
        "service": "TD|ai MONAI Production Inference Server",
        "version": "4.0.0",
        "monai_version": monai.__version__,
        "device": str(DEVICE),
        "gpu_count": NUM_GPUS,
        "models_registered": len(MODEL_REGISTRY),
        "models_loaded": get_loaded_model_names(),
        "medgemma_mode": medgemma_mode,
        "celery_enabled": CELERY_AVAILABLE,
        "triton_connected": triton_client._connected,
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "device": str(DEVICE),
        "models_loaded": len(get_loaded_model_names()),
        "medgemma_mode": medgemma_mode,
        "llm_provider": LLM_PROVIDER,
    }


# ── Model Registry ──────────────────────────────────────────────────

@app.get("/v1/models")
async def list_models():
    """List all registered models with their configurations."""
    configs = get_all_model_configs()
    return {
        "models": [
            {
                "name": c.name,
                "displayName": c.display_name,
                "description": c.description,
                "type": c.model_type.value,
                "architecture": c.architecture,
                "bodyParts": c.body_parts,
                "modalities": c.modalities,
                "labels": c.labels,
                "version": c.version,
                "slidingWindow": {
                    "roiSize": list(c.sliding_window.roi_size),
                    "swBatchSize": c.sliding_window.sw_batch_size,
                    "overlap": c.sliding_window.overlap,
                } if c.sliding_window else None,
                "loaded": c.name in get_loaded_model_names(),
            }
            for c in configs
        ],
        "total": len(configs),
    }


@app.post("/v1/models/{model_name}/load")
async def load_model_endpoint(model_name: str):
    """Explicitly load a model into memory."""
    try:
        load_model(model_name)
        return {"status": "loaded", "model": model_name, "device": str(DEVICE)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/v1/models/{model_name}/unload")
async def unload_model_endpoint(model_name: str):
    unload_model(model_name)
    return {"status": "unloaded", "model": model_name}


@app.get("/v1/models/{model_name}/metrics")
async def model_metrics(model_name: str):
    """Get performance metrics for a model."""
    return metrics_tracker.get_summary(model_name)


# ── DICOM Tag Routing ────────────────────────────────────────────────

@app.get("/v1/route")
async def route_models(modality: str = "", body_part: str = ""):
    """Preview which models would be selected for given DICOM tags."""
    models = route_by_dicom_tags(modality, body_part)
    return {
        "modality": modality,
        "body_part": body_part,
        "selected_models": models,
    }


# ══════════════════════════════════════════════════════════════════════
# PRODUCTION INFERENCE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════

@app.post("/v1/analyze-dicom")
async def analyze_dicom(
    file: UploadFile = File(...),
    model_name: str = Form("cxr_14class"),
    study_uid: str = Form(""),
):
    """Full DICOM analysis: inference + GradCAM + DICOM SEG/SR/PR output.

    This is the primary production endpoint. It:
    1. Reads the DICOM file
    2. Routes to the correct model (or uses the specified one)
    3. Runs inference with sliding window where applicable
    4. Generates GradCAM heatmaps
    5. Creates DICOM SEG, SR (TID 1500), and PR objects
    6. Returns structured JSON with all findings + base64 DICOM objects
    """
    start = time.time()

    dicom_bytes = await file.read()
    try:
        original_ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file")

    if not study_uid:
        study_uid = str(getattr(original_ds, "StudyInstanceUID", pydicom.uid.generate_uid()))

    try:
        pixel_array = extract_pixel_array(original_ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot extract pixel data")

    is_2d_image = pixel_array.ndim == 2 or (pixel_array.ndim == 3 and pixel_array.shape[-1] <= 4)
    config = get_model_config(model_name)

    if config is not None and config.spatial_dims == 3 and is_2d_image:
        modality = str(getattr(original_ds, "Modality", "")).strip().upper()
        body_part = str(getattr(original_ds, "BodyPartExamined", "")).strip().upper()
        candidates = route_by_dicom_tags(modality, body_part)
        rerouted = None
        for c in candidates:
            c_cfg = get_model_config(c)
            if c_cfg and c_cfg.spatial_dims == 2:
                rerouted = c
                break
        if rerouted is None:
            for fallback in ("cxr_14class", "cxr_tb_covid", "cxr_fracture_detection"):
                fb_cfg = get_model_config(fallback)
                if fb_cfg and fb_cfg.spatial_dims == 2:
                    rerouted = fallback
                    break
        if rerouted:
            logger.info(
                "Auto-rerouting 2D image from 3D model %s → %s (Modality=%s)",
                model_name, rerouted, modality,
            )
            model_name = rerouted
            config = get_model_config(model_name)

    if config is None:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}. Available: {list(MODEL_REGISTRY.keys())}")

    # Get spacing
    ps = getattr(original_ds, "PixelSpacing", [1.0, 1.0])
    st = float(getattr(original_ds, "SliceThickness", 1.0))
    spacing = (float(ps[0]), float(ps[1]), st)

    # Run inference
    model = load_model(model_name)
    tensor = _prepare_tensor(pixel_array, config)
    result = run_inference(model_name, tensor, spacing=spacing)

    # Record timing
    metrics_tracker.record_inference_time(model_name, result.get("processing_time_ms", 0))

    # Collect findings
    findings = result.get("findings", [])
    if not findings and result.get("type") == "segmentation":
        for label, conf in result.get("confidence_scores", {}).items():
            findings.append({"label": label, "confidence": conf, "description": f"Segmented {label}"})

    # Heatmap generation:
    # - segmentation models: probability-map overlay from softmax/sigmoid
    # - other models: GradCAM overlay
    heatmap_png_b64 = None
    if result.get("type") == "segmentation" and result.get("_probability_maps"):
        try:
            resized_prob_maps = _resize_probability_maps_to_original(
                result["_probability_maps"],
                pixel_array.shape,
            )
            heatmap_png = _create_probability_overlay_png(
                resized_prob_maps,
                pixel_array,
                alpha=0.4,
                smooth_sigma=1.0,
            )
            if heatmap_png:
                heatmap_png_b64 = base64.b64encode(heatmap_png).decode("ascii")
        except Exception as e:
            logger.warning("Segmentation probability heatmap failed for %s: %s", model_name, e)
    else:
        try:
            gradcam = GradCAMGenerator(model)
            cam_tensor = tensor.unsqueeze(0) if tensor.dim() == config.spatial_dims + 1 else tensor
            cam_tensor = cam_tensor.unsqueeze(0) if cam_tensor.dim() == config.spatial_dims + 1 else cam_tensor
            cam_array = gradcam.generate(cam_tensor.to(DEVICE))
            heatmap_png = gradcam.generate_heatmap_png(cam_array, pixel_array)
            heatmap_png_b64 = base64.b64encode(heatmap_png).decode("ascii")
        except Exception as e:
            logger.warning("GradCAM failed for %s: %s", model_name, e)

    # Generate DICOM outputs
    dicom_outputs = {}

    # DICOM SEG (for segmentation results)
    masks = result.get("_masks", {})
    if masks:
        try:
            original_shape = pixel_array.shape
            resized_masks = _resize_masks_to_original(masks, original_shape)
            _log_mask_diagnostics(resized_masks, original_shape)

            seg_bytes = create_dicom_seg(original_ds, resized_masks, config, study_uid)
            if seg_bytes:
                dicom_outputs["dicom_seg_base64"] = base64.b64encode(seg_bytes).decode("ascii")
                dicom_outputs["dicom_seg_size_bytes"] = len(seg_bytes)

                _push_seg_to_orthanc(seg_bytes)
            else:
                logger.warning("DICOM SEG creation returned empty bytes — all masks may be empty")
        except Exception as e:
            logger.error("DICOM SEG failed: %s", e)

    # DICOM SR TID 1500
    measurements = []
    for label, vol in result.get("volumes_ml", {}).items():
        measurements.append({"label": label, "value": vol, "unit": "ml"})

    summary = _build_summary(model_name, findings)
    try:
        sr_bytes = create_dicom_sr_tid1500(
            source_ds=original_ds,
            findings=findings,
            measurements=measurements,
            study_uid=study_uid,
            model_name=model_name,
            model_version=config.version,
            summary=summary,
        )
        dicom_outputs["dicom_sr_base64"] = base64.b64encode(sr_bytes).decode("ascii")
        dicom_outputs["dicom_sr_size_bytes"] = len(sr_bytes)
    except Exception as e:
        logger.error("DICOM SR failed: %s", e)

    # DICOM PR (bounding boxes / GradCAM overlay)
    try:
        pr_bytes = create_dicom_pr(
            source_ds=original_ds,
            findings=findings,
            study_uid=study_uid,
            model_name=model_name,
        )
        dicom_outputs["dicom_pr_base64"] = base64.b64encode(pr_bytes).decode("ascii")
        dicom_outputs["dicom_pr_size_bytes"] = len(pr_bytes)
    except Exception as e:
        logger.error("DICOM PR failed: %s", e)

    elapsed_ms = (time.time() - start) * 1000

    response = {
        "study_id": study_uid,
        "model": model_name,
        "model_type": config.model_type.value,
        "architecture": config.architecture,
        "status": "completed",
        "findings": findings,
        "summary": summary,
        "processing_time_ms": round(elapsed_ms, 2),
        "device": str(DEVICE),
        **dicom_outputs,
    }

    if result.get("volumes_ml"):
        response["volumes_ml"] = result["volumes_ml"]
    if result.get("bounding_boxes"):
        response["bounding_boxes"] = result["bounding_boxes"]
    if heatmap_png_b64:
        response["heatmap_png_base64"] = heatmap_png_b64

    # For segmentation, DICOM SEG is the production output. Avoid storing
    # burned-in heatmap as SC by default for those studies.
    if (
        heatmap_png_b64
        and result.get("type") != "segmentation"
        and "dicom_sc_base64" not in dicom_outputs
    ):
        try:
            sc_bytes = _create_secondary_capture(
                original_ds, base64.b64decode(heatmap_png_b64), study_uid, model_name,
            )
            if sc_bytes:
                response["dicom_sc_base64"] = base64.b64encode(sc_bytes).decode("ascii")
                response["dicom_sc_size_bytes"] = len(sc_bytes)
                _push_seg_to_orthanc(sc_bytes)
        except Exception as e:
            logger.warning("DICOM SC creation failed: %s", e)

    logger.info(
        "Analysis complete: model=%s type=%s findings=%d time=%.0fms",
        model_name, config.model_type.value, len(findings), elapsed_ms,
    )
    return response


@app.post("/v1/analyze-auto")
async def analyze_auto(
    file: UploadFile = File(...),
    study_uid: str = Form(""),
    push_to_orthanc: bool = Form(False),
):
    """Auto-route analysis — reads DICOM tags, selects appropriate models,
    runs all applicable models, and returns aggregated results including
    GradCAM heatmaps for classification models.

    Returns base64-encoded DICOM objects (SR, SEG) and heatmap PNG so
    the caller can save them into Dicoogle storage for viewer retrieval.
    """
    start = time.time()

    dicom_bytes = await file.read()
    try:
        ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file")

    if not study_uid:
        study_uid = str(getattr(ds, "StudyInstanceUID", pydicom.uid.generate_uid()))

    modality = str(getattr(ds, "Modality", "")).strip().upper()
    body_part = str(getattr(ds, "BodyPartExamined", "")).strip().upper()
    if not body_part:
        description_blob = " ".join(
            str(getattr(ds, field, "")).strip().upper()
            for field in (
                "StudyDescription",
                "SeriesDescription",
                "ProtocolName",
                "PerformedProcedureStepDescription",
            )
            if getattr(ds, field, None)
        )
        if description_blob:
            body_part_hints = [
                ("KNEE", ("KNEE", "MENISC", "ACL", "PCL", "PATELLA")),
                ("BRAIN", ("BRAIN", "HEAD", "CRANI", "NEURO")),
                ("PROSTATE", ("PROSTATE", "PIRADS")),
                ("HEART", ("CARDIAC", "HEART", "VENTRICLE", "MYOCARD")),
                ("SPINE", ("SPINE", "C-SPINE", "T-SPINE", "L-SPINE", "VERTEBRA", "CERVICAL", "THORACIC", "LUMBAR")),
                ("CHEST", ("CHEST", "THORAX", "LUNG", "PULMONARY")),
                ("ABDOMEN", ("ABDOMEN", "ABDOM", "LIVER", "PANCREAS")),
                ("NECK", ("NECK", "THYROID")),
            ]
            for candidate, tokens in body_part_hints:
                if any(token in description_blob for token in tokens):
                    body_part = candidate
                    logger.info("Auto-route inferred body part from descriptions: %s", body_part)
                    break
    model_names = route_by_dicom_tags(modality, body_part)
    try:
        number_of_frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    except Exception:
        number_of_frames = 1
    if modality == "MR" and number_of_frames <= 1:
        model_names = ["mri_cardiac_seg"]
        logger.info(
            "Auto-route switched to MR single-frame fallback model: %s",
            model_names,
        )

    if not model_names:
        logger.warning(
            "No models configured for Modality=%s, BodyPart=%s",
            modality, body_part,
        )
        elapsed_ms = (time.time() - start) * 1000
        return {
            "study_uid": study_uid,
            "modality": modality,
            "body_part": body_part,
            "models_run": [],
            "results": {},
            "findings": [],
            "summary": "No applicable MONAI model for this study's modality/body part.",
            "dicom_outputs_count": 0,
            "errors": [
                f"No models configured for modality={modality or 'unknown'} "
                f"and body_part={body_part or 'unknown'}"
            ],
            "processing_time_ms": round(elapsed_ms, 2),
        }

    ctx = deploy_pipeline.run(
        dicom_bytes,
        model_override=model_names,
        push_to_orthanc=push_to_orthanc,
    )

    # Generate heatmap:
    # - prefer segmentation probability heatmap when available
    # - otherwise generate GradCAM for the first classification model
    heatmap_png_b64 = None
    try:
        pixel_array = extract_pixel_array(ds)
        generated = False
        for model_name in model_names:
            seg_result = ctx.inference_results.get(model_name, {})
            if seg_result.get("type") == "segmentation" and seg_result.get("_probability_maps"):
                resized_prob_maps = _resize_probability_maps_to_original(
                    seg_result["_probability_maps"],
                    pixel_array.shape,
                )
                heatmap_png = _create_probability_overlay_png(
                    resized_prob_maps,
                    pixel_array,
                    alpha=0.4,
                    smooth_sigma=1.0,
                )
                if heatmap_png:
                    heatmap_png_b64 = base64.b64encode(heatmap_png).decode("ascii")
                    generated = True
                    break

        if not generated:
            for model_name in model_names:
                cfg = get_model_config(model_name)
                if cfg and cfg.model_type.value == "classification":
                    model = load_model(model_name)
                    tensor = _prepare_tensor(pixel_array, cfg)
                    gradcam = GradCAMGenerator(model)
                    cam_tensor = tensor.unsqueeze(0) if tensor.dim() == cfg.spatial_dims + 1 else tensor
                    cam_tensor = cam_tensor.unsqueeze(0) if cam_tensor.dim() == cfg.spatial_dims + 1 else cam_tensor
                    cam_array = gradcam.generate(cam_tensor.to(DEVICE))
                    heatmap_png = gradcam.generate_heatmap_png(cam_array, pixel_array)
                    heatmap_png_b64 = base64.b64encode(heatmap_png).decode("ascii")
                    generated = True
                    break
        if not generated:
            # Guarantee one viewable AI artifact even when model outputs are empty
            # (e.g. unsupported single-slice studies).
            base_plane = pixel_array
            if base_plane.ndim == 3:
                base_plane = base_plane[base_plane.shape[0] // 2]
            base_plane = np.asarray(base_plane, dtype=np.float32)
            gy, gx = np.gradient(base_plane)
            edge_map = np.sqrt(gx * gx + gy * gy)
            edge_max = float(edge_map.max())
            if edge_max > 1e-8:
                edge_map = edge_map / edge_max
            heatmap_png = _create_probability_overlay_png(
                {"fallback_edges": edge_map},
                pixel_array,
                alpha=0.35,
                smooth_sigma=0.8,
                activation_threshold=0.18,
                activation_percentile=70.0,
            )
            if heatmap_png:
                heatmap_png_b64 = base64.b64encode(heatmap_png).decode("ascii")
                generated = True
    except Exception as e:
        logger.warning("Auto-route heatmap generation failed: %s", e)

    elapsed_ms = (time.time() - start) * 1000

    dicom_outputs_b64: dict = {}
    for i, dcm_bytes in enumerate(ctx.dicom_outputs):
        try:
            out_ds = pydicom.dcmread(io.BytesIO(dcm_bytes))
            sop_class = str(getattr(out_ds, "SOPClassUID", ""))
            b64 = base64.b64encode(dcm_bytes).decode("ascii")

            if "1.2.840.10008.5.1.4.1.1.88" in sop_class:
                dicom_outputs_b64["dicom_sr_base64"] = b64
                dicom_outputs_b64["dicom_sr_size_bytes"] = len(dcm_bytes)
            elif "1.2.840.10008.5.1.4.1.1.66.4" in sop_class:
                dicom_outputs_b64["dicom_seg_base64"] = b64
                dicom_outputs_b64["dicom_seg_size_bytes"] = len(dcm_bytes)
            elif not dicom_outputs_b64.get("dicom_sc_base64"):
                dicom_outputs_b64["dicom_sc_base64"] = b64
                dicom_outputs_b64["dicom_sc_size_bytes"] = len(dcm_bytes)
        except Exception as e:
            logger.warning("Could not classify DICOM output %d: %s", i, e)

    # Collect all findings across models
    all_findings = []
    for model_name, result in ctx.inference_results.items():
        for f in result.get("findings", []):
            if "model" not in f:
                f["model"] = model_name
            all_findings.append(f)

    models_run = list(ctx.inference_results.keys())
    summary = _build_summary(", ".join(models_run) or "auto", all_findings)

    response = {
        "study_uid": ctx.study_uid or study_uid,
        "modality": modality,
        "body_part": body_part,
        "models_run": models_run,
        "results": {
            k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
            for k, v in ctx.inference_results.items()
        },
        "findings": all_findings,
        "summary": summary,
        "dicom_outputs_count": len(ctx.dicom_outputs),
        **dicom_outputs_b64,
        "errors": ctx.errors,
        "processing_time_ms": round(elapsed_ms, 2),
    }

    if heatmap_png_b64:
        response["heatmap_png_base64"] = heatmap_png_b64

    primary_model_name = models_run[0] if models_run else (model_names[0] if model_names else "auto")
    primary_result_type = None
    if primary_model_name and ctx.inference_results.get(primary_model_name):
        primary_result_type = ctx.inference_results[primary_model_name].get("type")

    if (
        heatmap_png_b64
        and "dicom_sc_base64" not in response
        and (
            primary_result_type != "segmentation"
            or int(response.get("dicom_outputs_count", 0)) == 0
        )
    ):
        try:
            sc_bytes = _create_secondary_capture(
                ds,
                base64.b64decode(heatmap_png_b64),
                response.get("study_uid", study_uid),
                primary_model_name,
            )
            if sc_bytes:
                response["dicom_sc_base64"] = base64.b64encode(sc_bytes).decode("ascii")
                response["dicom_sc_size_bytes"] = len(sc_bytes)
                response["dicom_outputs_count"] = int(response.get("dicom_outputs_count", 0)) + 1
                if push_to_orthanc:
                    _push_seg_to_orthanc(sc_bytes)
        except Exception as e:
            logger.warning("Auto-route DICOM SC creation failed: %s", e)

    logger.info(
        "Auto-route complete: modality=%s models=%s findings=%d heatmap=%s time=%.0fms",
        modality, models_run, len(all_findings), bool(heatmap_png_b64), elapsed_ms,
    )
    return response


# ── Async Job Queue ──────────────────────────────────────────────────

@app.post("/v1/jobs/submit")
async def submit_job(
    file: UploadFile = File(...),
    model_names: Optional[str] = Form(None),
    priority: str = Form("routine"),
    push_to_orthanc: bool = Form(True),
):
    """Submit an async inference job to the Celery queue."""
    from config import Priority

    priority_map = {"stat": Priority.STAT, "routine": Priority.ROUTINE, "batch": Priority.BATCH}
    prio = priority_map.get(priority, Priority.ROUTINE)

    dicom_bytes = await file.read()
    models = model_names.split(",") if model_names else None

    job = enqueue_inference_job(dicom_bytes, models, prio, push_to_orthanc)

    return {
        "job_id": job.job_id,
        "priority": priority,
        "models": job.model_names,
        "status": job.status,
        "result": job.result,
    }


@app.get("/v1/jobs/{job_id}/status")
async def job_status(job_id: str):
    return get_job_status(job_id)


# ── MedGemma Narrative Endpoint (backward compat) ────────────────────

@app.post("/v1/analyze-medgemma")
async def analyze_with_medgemma(
    file: UploadFile = File(...),
    study_uid: str = Form(""),
    include_monai: bool = Form(True),
    monai_model: str = Form("cxr_14class"),
    llm_provider: Optional[str] = Form(None),
):
    """Combined MONAI + MedGemma analysis (backward compatible)."""
    start = time.time()

    dicom_bytes = await file.read()
    try:
        original_ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file")

    if not study_uid:
        study_uid = str(getattr(original_ds, "StudyInstanceUID", pydicom.uid.generate_uid()))

    try:
        pixel_array = extract_pixel_array(original_ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot extract pixel data")

    monai_findings = []
    if include_monai and monai_model in MODEL_REGISTRY:
        config = get_model_config(monai_model)
        model = load_model(monai_model)
        tensor = _prepare_tensor(pixel_array, config)
        result = run_inference(monai_model, tensor)
        monai_findings = result.get("findings", [])

    medgemma_result = await run_medgemma_analysis(pixel_array, monai_findings or None, llm_provider)

    elapsed_ms = (time.time() - start) * 1000
    return {
        "study_id": study_uid,
        "model": "medgemma_report",
        "status": "completed",
        "medgemma_narrative": medgemma_result.get("narrative", ""),
        "medgemma_findings": medgemma_result.get("findings", ""),
        "medgemma_impression": medgemma_result.get("impression", ""),
        "medgemma_conditions": medgemma_result.get("detected_conditions", []),
        "monai_findings": monai_findings,
        "findings": monai_findings,
        "summary": medgemma_result.get("narrative", ""),
        "processing_time_ms": round(elapsed_ms, 2),
    }


# ── MONAI Label Endpoints ───────────────────────────────────────────

@app.get("/v1/label/config")
async def label_config():
    """Get MONAI Label server configuration."""
    return {
        "server_config": active_learning.get_monailabel_server_config(),
        "deepedit_config": get_deepedit_app_config(),
    }


@app.get("/v1/label/next-sample")
async def label_next_sample(strategy: Optional[str] = None):
    return active_learning.get_next_sample(strategy)


@app.post("/v1/label/annotate")
async def label_annotate(
    label: str = Form(...),
    annotator_id: str = Form(...),
    study_uid: str = Form(...),
):
    result = active_learning.record_annotation(label, annotator_id, study_uid)
    if result["should_retrain"]:
        logger.info("Retraining threshold reached for %s", label)
    return result


@app.get("/v1/label/stats")
async def label_stats():
    return active_learning.get_all_stats()


@app.post("/v1/label/retrain")
async def trigger_retrain(
    model_name: str = Form(...),
    trigger: str = Form("manual"),
):
    run = retraining_pipeline.start_retraining(model_name, trigger)
    return {"run_id": int(run.started_at), "model": model_name, "status": run.status}


@app.get("/v1/label/retrain/history")
async def retrain_history(model_name: Optional[str] = None):
    return {"history": retraining_pipeline.get_history(model_name)}


# ── Model Zoo Downloads ──────────────────────────────────────────────

@app.post("/v1/zoo/download/{model_name}")
async def download_zoo_model(model_name: str):
    bundle = BUNDLE_MAP.get(model_name)
    if not bundle:
        raise HTTPException(status_code=404, detail=f"No bundle mapped for {model_name}")

    path = download_bundle_weights(bundle, model_name)
    return {"model": model_name, "bundle": bundle, "path": str(path), "exists": path.exists()}


# ── Triton Status ────────────────────────────────────────────────────

@app.get("/v1/triton/status")
async def triton_status():
    return {
        "connected": triton_client._connected,
        "url": triton_client.url,
        "models": triton_client.list_models(),
    }


# ── LLM Reconfiguration (backward compat) ───────────────────────────

@app.post("/v1/configure")
async def configure_llm(request: Request, llm_provider: str = Form(...)):
    if INTERNAL_SECRET:
        if request.headers.get("x-internal-secret", "") != INTERNAL_SECRET:
            raise HTTPException(status_code=403, detail="Forbidden")

    global LLM_PROVIDER, medgemma_model, medgemma_mode
    allowed = ("gemini", "ollama", "off")
    if llm_provider not in allowed:
        raise HTTPException(status_code=400, detail=f"Must be one of {allowed}")

    old = LLM_PROVIDER
    LLM_PROVIDER = llm_provider
    medgemma_model = None
    medgemma_mode = "disabled"
    init_medgemma()
    return {"previous": old, "current": LLM_PROVIDER, "mode": medgemma_mode}


# ── Legacy Endpoints (backward compat with v3) ──────────────────────

@app.post("/v1/infer")
async def run_inference_legacy(request: InferRequest):
    """Legacy inference endpoint — backward compatible."""
    model_name = request.model

    # Map old model names to new ones
    name_map = {
        "monai_chest_xray": "cxr_14class",
        "monai_lung_nodule": "ct_lung_nodule",
        "monai_brain_mri": "mri_brain_tumor",
        "monai_ct_segmentation": "ct_multi_organ_seg",
        "monai_cardiac": "mri_cardiac_seg",
    }
    model_name = name_map.get(model_name, model_name)

    if model_name not in MODEL_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}")
    if not request.studies:
        raise HTTPException(status_code=400, detail="No studies provided")

    start = time.time()
    study_id = request.studies[0]
    config = get_model_config(model_name)

    model = load_model(model_name)
    dummy = np.random.randn(*config.input_size).astype(np.float32)
    result = run_inference(model_name, dummy)

    elapsed_ms = (time.time() - start) * 1000
    return {
        "study_id": study_id,
        "model": model_name,
        "status": "completed",
        "findings": result.get("findings", []),
        "processing_time_ms": round(elapsed_ms, 2),
    }


@app.post("/v1/infer-with-sr")
async def infer_with_sr_legacy(request: InferRequest):
    """Legacy infer + SR endpoint."""
    model_name = request.model
    name_map = {
        "monai_chest_xray": "cxr_14class",
        "monai_lung_nodule": "ct_lung_nodule",
        "monai_brain_mri": "mri_brain_tumor",
        "monai_ct_segmentation": "ct_multi_organ_seg",
        "monai_cardiac": "mri_cardiac_seg",
    }
    model_name = name_map.get(model_name, model_name)

    if model_name not in MODEL_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}")
    if not request.studies:
        raise HTTPException(status_code=400, detail="No studies provided")

    start = time.time()
    study_id = request.studies[0]
    config = get_model_config(model_name)
    model = load_model(model_name)

    dummy = np.random.randn(*config.input_size).astype(np.float32)
    result = run_inference(model_name, dummy)
    findings = result.get("findings", [])

    summary = _build_summary(model_name, findings)
    sr_bytes = create_dicom_sr_tid1500(
        source_ds=None,
        findings=findings,
        study_uid=study_id,
        model_name=model_name,
        model_version=config.version,
        summary=summary,
    )

    elapsed_ms = (time.time() - start) * 1000
    return {
        "study_id": study_id,
        "model": model_name,
        "status": "completed",
        "findings": findings,
        "summary": summary,
        "processing_time_ms": round(elapsed_ms, 2),
        "dicom_sr_base64": base64.b64encode(sr_bytes).decode("ascii"),
        "dicom_sr_size_bytes": len(sr_bytes),
    }


@app.get("/v1/infer/{job_id}/status")
async def inference_status_legacy(job_id: str):
    """Legacy status endpoint."""
    status = get_job_status(job_id)
    if status["status"] == "unknown":
        return {"status": "completed", "progress": 100}
    return status


# ── Helpers ──────────────────────────────────────────────────────────

def _prepare_tensor(pixel_array: np.ndarray, config) -> torch.Tensor:
    """Convert a pixel array to a tensor suitable for the model."""
    from monai.transforms import Compose, EnsureChannelFirst, Resize, ScaleIntensity, EnsureType

    arr = pixel_array
    if arr.ndim == 3 and arr.shape[-1] <= 4:
        arr = arr.mean(axis=-1)

    if config.spatial_dims == 2:
        spatial_size = list(config.input_size[:2])
    else:
        if arr.ndim == 2:
            depth = config.input_size[2] if len(config.input_size) >= 3 else config.input_size[0]
            arr = np.stack([arr] * depth, axis=-1)
        spatial_size = list(config.input_size[:3])

    transform = Compose([
        EnsureChannelFirst(channel_dim="no_channel"),
        Resize(spatial_size=spatial_size),
        ScaleIntensity(),
        EnsureType(dtype="float32"),
    ])
    return transform(arr)


def _resize_masks_to_original(
    masks: dict[str, np.ndarray],
    original_shape: tuple[int, ...],
) -> dict[str, np.ndarray]:
    """Resize binary masks to source DICOM size using nearest interpolation."""
    resized: dict[str, np.ndarray] = {}
    for label, mask in masks.items():
        target_shape = _target_shape_for_output(mask.shape, original_shape)
        resized_mask = _resample_array(mask.astype(np.float32), target_shape, order=0)
        resized[label] = (resized_mask > 0.5).astype(np.uint8)
        logger.info("Resized mask '%s': %s → %s", label, mask.shape, resized[label].shape)
    return resized


def _resize_probability_maps_to_original(
    probability_maps: dict[str, np.ndarray],
    original_shape: tuple[int, ...],
) -> dict[str, np.ndarray]:
    """Resize class probability maps with bilinear interpolation for smooth heatmaps."""
    resized: dict[str, np.ndarray] = {}
    for label, prob_map in probability_maps.items():
        target_shape = _target_shape_for_output(prob_map.shape, original_shape)
        resized_map = _resample_array(prob_map.astype(np.float32), target_shape, order=1)
        resized[label] = np.clip(resized_map, 0.0, 1.0).astype(np.float32)
        logger.info(
            "Resized probability map '%s': %s → %s",
            label,
            prob_map.shape,
            resized[label].shape,
        )
    return resized


def _target_shape_for_output(
    source_shape: tuple[int, ...],
    original_shape: tuple[int, ...],
) -> tuple[int, ...]:
    if len(source_shape) == 2 and len(original_shape) >= 2:
        return (int(original_shape[-2]), int(original_shape[-1]))
    if len(source_shape) == 3:
        if len(original_shape) >= 3:
            return tuple(int(v) for v in original_shape[:3])
        if len(original_shape) == 2:
            return (int(source_shape[0]), int(original_shape[0]), int(original_shape[1]))
    return tuple(int(v) for v in source_shape)


def _resample_array(
    array: np.ndarray,
    target_shape: tuple[int, ...],
    order: int,
) -> np.ndarray:
    from scipy.ndimage import zoom

    if array.shape == target_shape:
        return array

    zoom_factors = tuple(target_shape[i] / array.shape[i] for i in range(array.ndim))
    resized = zoom(
        array,
        zoom_factors,
        order=order,
        mode="nearest",
        prefilter=order > 1,
    ).astype(np.float32)
    return _match_shape(resized, target_shape)


def _match_shape(array: np.ndarray, target_shape: tuple[int, ...]) -> np.ndarray:
    """Center-crop/pad after interpolation to guarantee exact target shape."""
    adjusted = array
    for axis, target in enumerate(target_shape):
        current = adjusted.shape[axis]
        if current == target:
            continue

        if current > target:
            start = (current - target) // 2
            end = start + target
            slicer = [slice(None)] * adjusted.ndim
            slicer[axis] = slice(start, end)
            adjusted = adjusted[tuple(slicer)]
        else:
            pad_before = (target - current) // 2
            pad_after = target - current - pad_before
            pad_width = [(0, 0)] * adjusted.ndim
            pad_width[axis] = (pad_before, pad_after)
            adjusted = np.pad(adjusted, pad_width, mode="edge")
    return adjusted


def _create_probability_overlay_png(
    probability_maps: dict[str, np.ndarray],
    pixel_array: np.ndarray,
    alpha: float = 0.4,
    smooth_sigma: float = 1.0,
    activation_threshold: float = 0.30,
    activation_percentile: float = 82.0,
) -> bytes | None:
    """Create a quality-preserving heatmap overlay from segmentation probabilities."""
    from scipy.ndimage import gaussian_filter

    if not probability_maps:
        return None

    planes: list[np.ndarray] = []
    for prob in probability_maps.values():
        if prob.ndim == 3:
            prob = prob[prob.shape[0] // 2]
        planes.append(prob.astype(np.float32))
    if not planes:
        return None

    heat = np.maximum.reduce(planes)
    heat = np.clip(heat, 0.0, 1.0)
    if smooth_sigma > 0:
        heat = gaussian_filter(heat, sigma=float(smooth_sigma))
        heat = np.clip(heat, 0.0, 1.0)

    heat_min = float(heat.min())
    heat_max = float(heat.max())
    if heat_max - heat_min > 1e-8:
        heat = (heat - heat_min) / (heat_max - heat_min)

    percentile_threshold = float(np.percentile(heat, activation_percentile))
    floor_threshold = float(max(0.0, min(1.0, activation_threshold)))
    effective_threshold = min(0.95, max(floor_threshold, percentile_threshold))
    if effective_threshold > 0.0:
        denom = max(1e-6, 1.0 - effective_threshold)
        heat = np.where(heat >= effective_threshold, (heat - effective_threshold) / denom, 0.0)
        heat = np.clip(heat, 0.0, 1.0)

    base = pixel_array
    if base.ndim == 3:
        base = base[base.shape[0] // 2]
    base_uint8 = normalize_to_uint8(base)
    if heat.shape != base_uint8.shape:
        heat = _resample_array(heat, base_uint8.shape, order=1)
        heat = np.clip(heat, 0.0, 1.0)

    heat_uint8 = (heat * 255.0).astype(np.uint8)
    heat_rgb = _apply_jet_colormap(heat_uint8)

    base_rgb = np.stack([base_uint8] * 3, axis=-1).astype(np.float32)
    alpha_map = np.clip(heat[..., np.newaxis] * float(alpha), 0.0, 1.0)
    blended = (
        base_rgb * (1.0 - alpha_map) + heat_rgb.astype(np.float32) * alpha_map
    ).clip(0, 255).astype(np.uint8)

    buf = io.BytesIO()
    Image.fromarray(blended, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def _apply_jet_colormap(gray: np.ndarray) -> np.ndarray:
    try:
        import cv2

        bgr = cv2.applyColorMap(gray.astype(np.uint8), cv2.COLORMAP_JET)
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    except Exception:
        lut = np.array(
            [
                [0, 0, 128], [0, 0, 255], [0, 128, 255], [0, 255, 255],
                [0, 255, 128], [0, 255, 0], [128, 255, 0], [255, 255, 0],
                [255, 128, 0], [255, 0, 0],
            ],
            dtype=np.float32,
        )
        idx = gray.astype(np.float32) / 255.0 * (len(lut) - 1)
        lo = np.floor(idx).astype(np.int32)
        hi = np.clip(lo + 1, 0, len(lut) - 1)
        w = (idx - lo)[..., np.newaxis]
        return (lut[lo] * (1.0 - w) + lut[hi] * w).astype(np.uint8)


def _log_mask_diagnostics(
    masks: dict[str, np.ndarray],
    original_shape: tuple[int, ...],
) -> None:
    """Log mask statistics for debugging overlay visibility issues."""
    for label, mask in masks.items():
        nonzero = int(mask.sum())
        total = int(np.prod(mask.shape))
        logger.info(
            "Mask diagnostics [%s]: min=%s max=%s nonzero=%d/%d (%.2f%%) shape=%s original_shape=%s",
            label,
            mask.min(),
            mask.max(),
            nonzero,
            total,
            (nonzero / total * 100) if total > 0 else 0,
            mask.shape,
            original_shape,
        )
        if nonzero == 0:
            logger.warning("Mask '%s' is EMPTY — no overlay will be visible", label)
        if mask.shape[:2] != original_shape[:2]:
            logger.warning(
                "Mask '%s' spatial dims %s do NOT match original %s — overlay will be misaligned",
                label, mask.shape, original_shape,
            )


def _push_seg_to_orthanc(seg_bytes: bytes) -> None:
    """Push the DICOM SEG instance to Orthanc so OHIF can display it."""
    try:
        from inference.operators import _stow_to_orthanc
        _stow_to_orthanc(seg_bytes)
        logger.info("DICOM SEG pushed to Orthanc (%d bytes)", len(seg_bytes))
    except Exception as e:
        logger.error("Failed to push DICOM SEG to Orthanc: %s", e)


def _create_secondary_capture(
    source_ds: pydicom.Dataset,
    png_bytes: bytes,
    study_uid: str,
    model_name: str,
) -> bytes | None:
    """Wrap a heatmap PNG as a DICOM Secondary Capture for PACS display."""
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        pixel_data = np.array(img)

        sc = pydicom.Dataset()
        sc.file_meta = pydicom.Dataset()
        sc.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
        sc.file_meta.MediaStorageSOPInstanceUID = pydicom.uid.generate_uid()
        sc.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian

        sc.SOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
        sc.SOPInstanceUID = sc.file_meta.MediaStorageSOPInstanceUID
        sc.StudyInstanceUID = study_uid
        sc.SeriesInstanceUID = pydicom.uid.generate_uid()
        sc.Modality = "OT"
        sc.Manufacturer = "TD|ai MONAI"
        sc.SeriesDescription = f"AI Heatmap ({model_name})"

        sc.PatientName = getattr(source_ds, "PatientName", "Unknown")
        sc.PatientID = getattr(source_ds, "PatientID", "0000")
        sc.StudyDate = getattr(source_ds, "StudyDate", datetime.datetime.now().strftime("%Y%m%d"))

        sc.Rows = pixel_data.shape[0]
        sc.Columns = pixel_data.shape[1]
        sc.SamplesPerPixel = 3
        sc.PhotometricInterpretation = "RGB"
        sc.BitsAllocated = 8
        sc.BitsStored = 8
        sc.HighBit = 7
        sc.PixelRepresentation = 0
        sc.PlanarConfiguration = 0
        sc.PixelData = pixel_data.tobytes()

        sc.is_little_endian = True
        sc.is_implicit_VR = False

        buf = io.BytesIO()
        pydicom.dcmwrite(buf, sc, write_like_original=False)
        return buf.getvalue()
    except Exception as e:
        logger.error("Secondary Capture creation failed: %s", e)
        return None


def _build_summary(model_name: str, findings: list[dict]) -> str:
    significant = [f for f in findings if f.get("confidence", 0) >= 0.5]
    if significant:
        parts = ", ".join(
            f"{f['label']} ({f['confidence']*100:.0f}%)" for f in significant[:5]
        )
        return f"AI analysis ({model_name}): {len(significant)} significant finding(s) — {parts}"
    return f"AI analysis ({model_name}): No findings above 50% confidence."


# ── Entry Point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="info")
