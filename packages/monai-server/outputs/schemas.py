"""
Output JSON schemas — Pydantic models for structured inference results.

Every model output is serialised to one of these schemas before being
returned via the API or written into DICOM SR.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x1: float = 0
    y1: float = 0
    x2: float = 0
    y2: float = 0
    z1: Optional[float] = None
    z2: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    depth_mm: Optional[float] = None


class Finding(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    description: str = ""
    location: Optional[str] = None
    snomed_code: Optional[str] = None
    bbox: Optional[BoundingBox] = None
    model_name: Optional[str] = None
    model_version: Optional[str] = None


class Measurement(BaseModel):
    label: str
    value: float
    unit: str = "ml"
    snomed_code: Optional[str] = None
    location: Optional[str] = None


class SegmentationOutput(BaseModel):
    labels: list[str] = []
    volumes_ml: dict[str, float] = {}
    bounding_boxes: dict[str, dict] = {}
    confidence_scores: dict[str, float] = {}


class ClinicalScore(BaseModel):
    """Structured clinical scoring (Lung-RADS, PI-RADS, TI-RADS, etc.)"""
    score_name: str
    score_value: str
    category: str = ""
    management: str = ""
    details: dict = {}


class InferenceResult(BaseModel):
    study_uid: str
    model_name: str
    model_version: str = "1.0.0"
    model_type: str  # classification | segmentation | detection | hybrid
    status: str = "completed"
    processing_time_ms: float = 0

    findings: list[Finding] = []
    measurements: list[Measurement] = []
    segmentation: Optional[SegmentationOutput] = None
    clinical_scores: list[ClinicalScore] = []
    summary: str = ""

    dicom_seg_base64: Optional[str] = None
    dicom_sr_base64: Optional[str] = None
    dicom_pr_base64: Optional[str] = None
    dicom_sc_base64: Optional[str] = None

    heatmap_png_base64: Optional[str] = None
    errors: list[str] = []
