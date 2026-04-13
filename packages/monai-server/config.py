"""
Central configuration for the MONAI production inference server.
All model hyperparameters, DICOM routing rules, and infrastructure
settings live here so the rest of the codebase stays declarative.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


# ── Paths ──────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(os.getenv("MONAI_MODELS_DIR", str(BASE_DIR / "models" / "weights")))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SR_OUTPUT_DIR = BASE_DIR / "sr_output"
SR_OUTPUT_DIR.mkdir(exist_ok=True)
METRICS_DIR = BASE_DIR / "metrics_store"
METRICS_DIR.mkdir(exist_ok=True)
TRITON_MODEL_REPO = Path(os.getenv("TRITON_MODEL_REPOSITORY", str(BASE_DIR / "model_repository")))

# ── Device ─────────────────────────────────────────────────────────────

import torch

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
NUM_GPUS = torch.cuda.device_count() if torch.cuda.is_available() else 0

# ── Infrastructure ─────────────────────────────────────────────────────

ORTHANC_URL = os.getenv("ORTHANC_URL", "http://orthanc:8042")
ORTHANC_USER = os.getenv("ORTHANC_USER", "")
ORTHANC_PASS = os.getenv("ORTHANC_PASS", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
TRITON_URL = os.getenv("TRITON_URL", "localhost:8001")
MONAI_LABEL_URL = os.getenv("MONAI_LABEL_URL", "http://monailabel:8000")

# ── LLM / MedGemma ────────────────────────────────────────────────────

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_LOCATION = os.getenv("GCP_LOCATION", "us-central1")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
MEDGEMMA_ENDPOINT = os.getenv("MEDGEMMA_ENDPOINT", "")
MEDGEMMA_MODEL = os.getenv("MEDGEMMA_MODEL", "medgemma-4b")
VERTEX_AI_ENABLED = os.getenv("VERTEX_AI_ENABLED", "false").lower() == "true"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")


# ── Enums ──────────────────────────────────────────────────────────────

class Modality(str, Enum):
    CT = "CT"
    MR = "MR"
    CR = "CR"
    DX = "DX"
    US = "US"
    MG = "MG"


class ModelType(str, Enum):
    CLASSIFICATION = "classification"
    SEGMENTATION = "segmentation"
    DETECTION = "detection"
    HYBRID = "hybrid"


class Priority(str, Enum):
    STAT = "stat"
    ROUTINE = "routine"
    BATCH = "batch"


# ── Model Configuration Dataclass ─────────────────────────────────────

@dataclass
class SlidingWindowConfig:
    roi_size: tuple[int, ...] = (96, 96, 96)
    sw_batch_size: int = 4
    overlap: float = 0.5
    mode: str = "gaussian"


@dataclass
class PostProcessConfig:
    keep_largest_cc: bool = True
    fill_holes: bool = True
    morphological_cleanup: bool = True
    min_component_size: int = 100
    closing_radius: int = 2


@dataclass
class ModelConfig:
    name: str
    display_name: str
    description: str
    model_type: ModelType
    architecture: str
    modalities: list[str]
    body_parts: list[str]
    labels: list[str]
    version: str = "1.0.0"
    in_channels: int = 1
    out_channels: int = 1
    spatial_dims: int = 3
    input_size: tuple[int, ...] = (96, 96, 96)
    sliding_window: Optional[SlidingWindowConfig] = None
    postprocess: Optional[PostProcessConfig] = None
    zoo_bundle: Optional[str] = None
    snomed_codes: dict[str, str] = field(default_factory=dict)
    triton_model_name: Optional[str] = None
    triton_format: str = "torchscript"
    confidence_threshold: float = 0.5
    priority_queue: str = "routine"


# ── DICOM Tag Routing Rules ───────────────────────────────────────────
# Maps (Modality, BodyPartExamined) → list of model names to run

DICOM_ROUTING_RULES: dict[tuple[str, str], list[str]] = {
    # CT
    ("CT", "CHEST"): ["ct_lung_nodule", "ct_pe_classification"],
    ("CT", "LUNG"): ["ct_lung_nodule"],
    ("CT", "ABDOMEN"): ["ct_multi_organ_seg"],
    ("CT", "LIVER"): ["ct_multi_organ_seg"],
    ("CT", "HEAD"): ["ct_brain_hemorrhage"],
    ("CT", "BRAIN"): ["ct_brain_hemorrhage"],
    ("CT", "SPINE"): ["ct_vertebral_fracture"],
    ("CT", "CSPINE"): ["ct_vertebral_fracture"],
    ("CT", "TSPINE"): ["ct_vertebral_fracture"],
    ("CT", "LSPINE"): ["ct_vertebral_fracture"],
    # MRI
    ("MR", "BRAIN"): ["mri_brain_tumor"],
    ("MR", "HEAD"): ["mri_brain_tumor"],
    ("MR", "PROSTATE"): ["mri_prostate_seg"],
    ("MR", "HEART"): ["mri_cardiac_seg"],
    ("MR", "KNEE"): ["mri_knee_cartilage"],
    # CXR
    ("CR", "CHEST"): ["cxr_14class"],
    ("DX", "CHEST"): ["cxr_14class"],
    ("CR", ""): ["cxr_14class"],
    ("DX", ""): ["cxr_14class"],
    ("CR", "HAND"): ["cxr_fracture_detection"],
    ("DX", "HAND"): ["cxr_fracture_detection"],
    ("CR", "WRIST"): ["cxr_fracture_detection"],
    ("DX", "WRIST"): ["cxr_fracture_detection"],
    ("CR", "ELBOW"): ["cxr_fracture_detection"],
    ("DX", "ELBOW"): ["cxr_fracture_detection"],
    ("CR", "ANKLE"): ["cxr_fracture_detection"],
    ("DX", "ANKLE"): ["cxr_fracture_detection"],
    ("CR", "FOOT"): ["cxr_fracture_detection"],
    ("DX", "FOOT"): ["cxr_fracture_detection"],
    # Ultrasound
    ("US", "THYROID"): ["us_tirads"],
    ("US", "NECK"): ["us_tirads"],
    ("US", "ABDOMEN"): ["us_fast_exam"],
}

# Fallback: if BodyPartExamined is empty, route by Modality alone
DICOM_MODALITY_FALLBACK: dict[str, list[str]] = {
    "CT": ["ct_multi_organ_seg"],
    "MR": ["mri_brain_tumor"],
    "CR": ["cxr_14class"],
    "DX": ["cxr_14class"],
    "US": ["us_fast_exam"],
}


def route_by_dicom_tags(modality: str, body_part: str) -> list[str]:
    """Given DICOM Modality (0008,0060) and BodyPartExamined (0018,0015),
    return the list of model names that should be run."""
    body_part = (body_part or "").strip().upper()
    modality = (modality or "").strip().upper()

    models = DICOM_ROUTING_RULES.get((modality, body_part))
    if models:
        return models

    if body_part:
        generic = DICOM_ROUTING_RULES.get((modality, ""))
        if generic:
            return generic

    return DICOM_MODALITY_FALLBACK.get(modality, [])


# ── SNOMED-RT Codes for Segmentation Labels ───────────────────────────

SNOMED_CODES = {
    "Liver": "10200004",
    "Spleen": "78961009",
    "Kidney_L": "64033007",
    "Kidney_R": "64033007",
    "Pancreas": "15776009",
    "Aorta": "15825003",
    "Lung_L": "44029006",
    "Lung_R": "44029006",
    "Heart": "80891009",
    "Stomach": "69695003",
    "Gallbladder": "28231008",
    "Esophagus": "32849002",
    "Brain": "12738006",
    "Enhancing_Tumor": "108369006",
    "Whole_Tumor": "108369006",
    "Tumor_Core": "108369006",
    "Prostate_PZ": "41216001",
    "Prostate_TZ": "41216001",
    "Prostate_CZ": "41216001",
    "LV": "87878005",
    "RV": "53085002",
    "LV_Myo": "74281007",
    "Femoral_Cartilage": "61496007",
    "Tibial_Cartilage": "61496007",
    "Meniscus_Medial": "72405004",
    "Meniscus_Lateral": "72405004",
    "Nodule": "427359005",
    "Hemorrhage": "50960005",
}

# ── Celery Queue Config ───────────────────────────────────────────────

CELERY_QUEUES = {
    Priority.STAT: {"queue": "stat_gpu", "routing_key": "stat.gpu"},
    Priority.ROUTINE: {"queue": "routine_gpu", "routing_key": "routine.gpu"},
    Priority.BATCH: {"queue": "batch_overnight", "routing_key": "batch.cpu"},
}

# ── MONAI Label Config ────────────────────────────────────────────────

MONAI_LABEL_RETRAIN_THRESHOLD = int(os.getenv("MONAI_LABEL_RETRAIN_THRESHOLD", "50"))
MONAI_LABEL_DICE_IMPROVEMENT_THRESHOLD = float(os.getenv("MONAI_LABEL_DICE_THRESHOLD", "0.02"))
MONAI_LABEL_STRATEGIES = ["epistemic", "random", "tta_epistemic"]
