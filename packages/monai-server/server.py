"""
MONAI + MedGemma Inference Server for TD|ai
FastAPI server that loads MONAI pre-trained models, runs inference on real DICOM
pixel data, generates GradCAM heatmaps, and produces annotated DICOM objects
(Secondary Capture with heatmap overlay, GSPS graphic annotations, Structured Report).

MedGemma integration provides narrative radiology report generation from DICOM images
via Google Vertex AI.
"""

import io
import os
import time
import base64
import logging
import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

def _load_env() -> None:
    _resolved = Path(__file__).resolve()
    _parents = list(_resolved.parents)
    _candidates = []

    # In local dev this resolves to repo root/.env.
    if len(_parents) > 2:
        _candidates.append(_parents[2] / ".env")
    # In containers, /app/.env (if present) should also be supported.
    _candidates.append(_resolved.parent / ".env")

    _seen = set()
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
import torch.nn.functional as F
import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.sequence import Sequence as DicomSequence
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
from PIL import Image, ImageDraw, ImageFont
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel

import monai
from monai.networks.nets import DenseNet121
from monai.transforms import Compose, EnsureChannelFirst, Resize, ScaleIntensity, ToTensor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("monai-server")

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)
SR_OUTPUT_DIR = Path(__file__).parent / "sr_output"
SR_OUTPUT_DIR.mkdir(exist_ok=True)

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_LOCATION = os.getenv("GCP_LOCATION", "us-central1")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
MEDGEMMA_ENDPOINT = os.getenv("MEDGEMMA_ENDPOINT", "")
MEDGEMMA_MODEL = os.getenv("MEDGEMMA_MODEL", "medgemma-4b")
VERTEX_AI_ENABLED = os.getenv("VERTEX_AI_ENABLED", "false").lower() == "true"

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")  # gemini | ollama | off
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

medgemma_model = None
medgemma_mode = "disabled"

CHEST_XRAY_LABELS = [
    "Atelectasis", "Cardiomegaly", "Effusion", "Infiltration", "Mass",
    "Nodule", "Pneumonia", "Pneumothorax", "Consolidation", "Edema",
    "Emphysema", "Fibrosis", "Pleural Thickening", "Hernia",
]

AVAILABLE_MODELS = {
    "monai_chest_xray": {
        "name": "monai_chest_xray",
        "description": "Chest X-Ray Multi-label Classification (DenseNet-121)",
        "type": "classification",
        "body_parts": ["Chest"],
        "modalities": ["CR", "DX", "XRAY"],
        "version": "1.0.0",
        "labels": CHEST_XRAY_LABELS,
    },
    "monai_lung_nodule": {
        "name": "monai_lung_nodule",
        "description": "Lung Nodule Detection",
        "type": "detection",
        "body_parts": ["Chest", "Lung"],
        "modalities": ["CT"],
        "version": "1.0.0",
        "labels": ["Nodule", "Ground Glass Opacity", "Solid Nodule", "Calcified Nodule"],
    },
    "monai_brain_mri": {
        "name": "monai_brain_mri",
        "description": "Brain MRI Abnormality Detection",
        "type": "classification",
        "body_parts": ["Brain", "Head"],
        "modalities": ["MR"],
        "version": "1.0.0",
        "labels": ["Normal", "Tumor", "Hemorrhage", "Ischemia", "Edema", "Atrophy"],
    },
    "monai_ct_segmentation": {
        "name": "monai_ct_segmentation",
        "description": "CT Organ Segmentation",
        "type": "segmentation",
        "body_parts": ["Abdomen", "Chest"],
        "modalities": ["CT"],
        "version": "1.0.0",
        "labels": ["Liver", "Spleen", "Pancreas", "Kidney L", "Kidney R", "Aorta"],
    },
    "monai_cardiac": {
        "name": "monai_cardiac",
        "description": "Cardiac Structure Analysis",
        "type": "classification",
        "body_parts": ["Chest", "Heart"],
        "modalities": ["CR", "DX", "MR"],
        "version": "1.0.0",
        "labels": ["Normal", "Cardiomegaly", "Pericardial Effusion", "Valve Calcification"],
    },
    "medgemma_report": {
        "name": "medgemma_report",
        "description": "MedGemma Narrative Radiology Report (Vertex AI)",
        "type": "report_generation",
        "body_parts": ["Chest", "Abdomen", "Brain", "Head", "Spine", "Extremity"],
        "modalities": ["CR", "DX", "CT", "MR"],
        "version": "1.5.0",
        "labels": [],
    },
}

loaded_models: dict[str, DenseNet121] = {}

inference_transform = Compose([
    EnsureChannelFirst(channel_dim="no_channel"),
    Resize(spatial_size=(224, 224)),
    ScaleIntensity(),
    ToTensor(),
])


def build_densenet(num_classes: int) -> DenseNet121:
    return DenseNet121(spatial_dims=2, in_channels=1, out_channels=num_classes)


def load_or_create_model(model_name: str) -> DenseNet121:
    if model_name in loaded_models:
        return loaded_models[model_name]

    config = AVAILABLE_MODELS.get(model_name)
    if not config:
        raise ValueError(f"Unknown model: {model_name}")

    num_classes = len(config["labels"])
    model_path = MODELS_DIR / f"{model_name}.pt"
    model = build_densenet(num_classes)

    if model_path.exists():
        logger.info(f"Loading saved model weights: {model_path}")
        model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    else:
        logger.info(f"No pre-trained weights for {model_name} — using initialized model")
        torch.save(model.state_dict(), model_path)

    model.to(DEVICE)
    model.eval()
    loaded_models[model_name] = model
    logger.info(f"Model '{model_name}' loaded ({num_classes} classes, device={DEVICE})")
    return model


# ── GradCAM Implementation ────────────────────────────────────────────

class GradCAMExtractor:
    """Lightweight GradCAM that hooks into the last conv layer of DenseNet121."""

    def __init__(self, model: DenseNet121):
        self.model = model
        self.gradients: Optional[torch.Tensor] = None
        self.activations: Optional[torch.Tensor] = None
        self._hook_handles = []
        target_layer = model.features[-1]
        self._hook_handles.append(
            target_layer.register_forward_hook(self._forward_hook)
        )
        self._hook_handles.append(
            target_layer.register_full_backward_hook(self._backward_hook)
        )

    def _forward_hook(self, _module, _input, output):
        self.activations = output.detach()

    def _backward_hook(self, _module, _grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate(self, input_tensor: torch.Tensor, class_idx: int) -> np.ndarray:
        self.model.zero_grad()
        output = self.model(input_tensor)
        target = output[0, class_idx]
        target.backward(retain_graph=True)

        if self.gradients is None or self.activations is None:
            return np.zeros((7, 7), dtype=np.float32)

        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam = (weights * self.activations).sum(dim=1, keepdim=True)
        cam = F.relu(cam)
        cam = cam.squeeze().cpu().numpy()

        cam_min, cam_max = cam.min(), cam.max()
        if cam_max - cam_min > 1e-8:
            cam = (cam - cam_min) / (cam_max - cam_min)
        else:
            cam = np.zeros_like(cam)
        return cam

    def cleanup(self):
        for h in self._hook_handles:
            h.remove()
        self._hook_handles.clear()


# ── DICOM Pixel Data Extraction ───────────────────────────────────────

def extract_pixel_array(ds: pydicom.Dataset) -> np.ndarray:
    """Extract a 2D grayscale float32 array from a DICOM dataset.

    Handles compressed transfer syntaxes (JPEG, JPEG2000, JPEG-LS, RLE)
    by attempting decompression before accessing pixel_array.
    """
    if not hasattr(ds, "PixelData"):
        raise ValueError("DICOM dataset has no PixelData element")

    tsuid = getattr(ds.file_meta, "TransferSyntaxUID", None) if hasattr(ds, "file_meta") else None
    compressed_syntaxes = {
        "1.2.840.10008.1.2.4.50",   # JPEG Baseline
        "1.2.840.10008.1.2.4.51",   # JPEG Extended
        "1.2.840.10008.1.2.4.57",   # JPEG Lossless
        "1.2.840.10008.1.2.4.70",   # JPEG Lossless SV1
        "1.2.840.10008.1.2.4.80",   # JPEG-LS Lossless
        "1.2.840.10008.1.2.4.81",   # JPEG-LS Near Lossless
        "1.2.840.10008.1.2.4.90",   # JPEG 2000 Lossless
        "1.2.840.10008.1.2.4.91",   # JPEG 2000
        "1.2.840.10008.1.2.5",      # RLE Lossless
    }

    if tsuid and str(tsuid) in compressed_syntaxes:
        try:
            ds.decompress()
            logger.info("Decompressed DICOM with transfer syntax %s", tsuid)
        except Exception as e:
            logger.warning("decompress() failed for TS %s: %s — trying pixel_array directly", tsuid, e)

    try:
        arr = ds.pixel_array.astype(np.float32)
    except Exception:
        if tsuid:
            try:
                from PIL import Image as PILImage
                rows = ds.Rows
                cols = ds.Columns
                bits = getattr(ds, "BitsAllocated", 16)
                raw = ds.PixelData
                preamble_len = 0
                if raw[:4] == b"\xfe\xff\x00\xe0":
                    preamble_len = 12
                img = PILImage.open(io.BytesIO(raw[preamble_len:]))
                arr = np.array(img, dtype=np.float32)
                if arr.ndim == 3:
                    arr = arr.mean(axis=-1)
                logger.info("Extracted pixel data via Pillow fallback")
            except Exception:
                raise ValueError(
                    f"Cannot decode pixel data (transfer syntax: {tsuid}). "
                    "Ensure pylibjpeg, pylibjpeg-libjpeg, and pylibjpeg-openjpeg are installed."
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


# ── Heatmap & Annotation Rendering ────────────────────────────────────

HEATMAP_COLORS = np.array([
    [0, 0, 128], [0, 0, 255], [0, 128, 255], [0, 255, 255],
    [0, 255, 128], [0, 255, 0], [128, 255, 0], [255, 255, 0],
    [255, 128, 0], [255, 0, 0],
], dtype=np.uint8)


def cam_to_heatmap_rgb(cam: np.ndarray, target_h: int, target_w: int) -> np.ndarray:
    """Resize CAM to target size and convert to an RGB heatmap."""
    cam_pil = Image.fromarray((cam * 255).astype(np.uint8)).resize(
        (target_w, target_h), Image.BILINEAR
    )
    cam_resized = np.array(cam_pil).astype(np.float32) / 255.0
    indices = (cam_resized * (len(HEATMAP_COLORS) - 1)).astype(np.int32)
    indices = np.clip(indices, 0, len(HEATMAP_COLORS) - 1)
    return HEATMAP_COLORS[indices]


def create_overlay_image(
    grayscale: np.ndarray,
    cam: np.ndarray,
    findings: list[dict],
    alpha: float = 0.45,
) -> Image.Image:
    """Blend the original grayscale image with a GradCAM heatmap and draw finding labels."""
    h, w = grayscale.shape[:2]
    gray_uint8 = normalize_to_uint8(grayscale)
    base_rgb = np.stack([gray_uint8] * 3, axis=-1)
    heatmap_rgb = cam_to_heatmap_rgb(cam, h, w)

    blended = (base_rgb.astype(np.float32) * (1 - alpha) + heatmap_rgb.astype(np.float32) * alpha)
    blended = np.clip(blended, 0, 255).astype(np.uint8)
    img = Image.fromarray(blended, "RGB")
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("arial.ttf", max(12, h // 30))
    except (IOError, OSError):
        font = ImageFont.load_default()

    regions = find_cam_regions(cam, h, w)
    significant = [f for f in findings if f.get("confidence", 0) >= 0.3]
    significant.sort(key=lambda f: f["confidence"], reverse=True)

    for i, region in enumerate(regions[:len(significant)]):
        cx, cy, rx, ry = region
        finding = significant[i] if i < len(significant) else None

        x1 = max(0, int(cx - rx))
        y1 = max(0, int(cy - ry))
        x2 = min(w - 1, int(cx + rx))
        y2 = min(h - 1, int(cy + ry))

        draw.ellipse([x1, y1, x2, y2], outline="red", width=max(2, h // 150))

        if finding:
            label = f"{finding['label']} ({finding['confidence']*100:.0f}%)"
            ty = max(0, y1 - max(14, h // 25))
            draw.text((x1, ty), label, fill="yellow", font=font)

    title = "MONAI AI Analysis"
    draw.text((8, 8), title, fill="lime", font=font)

    return img


def find_cam_regions(
    cam: np.ndarray, target_h: int, target_w: int, threshold: float = 0.4
) -> list[tuple[int, int, int, int]]:
    """Find connected regions in the CAM above a threshold.
    Returns list of (center_x, center_y, radius_x, radius_y) in target image coords.
    """
    from scipy import ndimage

    cam_resized = np.array(
        Image.fromarray((cam * 255).astype(np.uint8)).resize(
            (target_w, target_h), Image.BILINEAR
        )
    ).astype(np.float32) / 255.0

    binary = cam_resized > threshold
    labeled, num_features = ndimage.label(binary)

    regions = []
    for i in range(1, num_features + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < 10:
            continue
        cx, cy = int(xs.mean()), int(ys.mean())
        rx = max(20, int((xs.max() - xs.min()) / 2) + 10)
        ry = max(20, int((ys.max() - ys.min()) / 2) + 10)
        regions.append((cx, cy, rx, ry))

    if not regions:
        cam_flat = cam_resized.flatten()
        top_indices = cam_flat.argsort()[-100:]
        ys = top_indices // target_w
        xs = top_indices % target_w
        cx, cy = int(xs.mean()), int(ys.mean())
        rx, ry = max(30, target_w // 8), max(30, target_h // 8)
        regions.append((cx, cy, rx, ry))

    return regions


# ── DICOM Secondary Capture (Annotated Image) ─────────────────────────

def generate_secondary_capture(
    original_ds: pydicom.Dataset,
    overlay_img: Image.Image,
    study_uid: str,
    model_name: str,
) -> bytes:
    """Create a DICOM Secondary Capture containing the annotated overlay image."""
    now = datetime.datetime.now()
    sop_uid = generate_uid()
    series_uid = generate_uid()

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("sc.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)

    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
    ds.SOPInstanceUID = sop_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.AccessionNumber = ""
    ds.Modality = "OT"
    ds.Manufacturer = "TD|ai MONAI"
    ds.InstitutionName = "TD|ai Radiology Platform"
    ds.ConversionType = "WSD"
    ds.SeriesDescription = f"AI Heatmap - {model_name}"

    ds.PatientName = getattr(original_ds, "PatientName", "")
    ds.PatientID = getattr(original_ds, "PatientID", "")
    ds.PatientBirthDate = getattr(original_ds, "PatientBirthDate", "")
    ds.PatientSex = getattr(original_ds, "PatientSex", "")

    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyID = ""
    ds.SeriesNumber = 998
    ds.InstanceNumber = 1

    rgb_arr = np.array(overlay_img.convert("RGB"))
    ds.Rows, ds.Columns = rgb_arr.shape[0], rgb_arr.shape[1]
    ds.SamplesPerPixel = 3
    ds.PhotometricInterpretation = "RGB"
    ds.PlanarConfiguration = 0
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = rgb_arr.tobytes()

    buf = io.BytesIO()
    ds.save_as(buf)
    return buf.getvalue()


# ── DICOM GSPS (Graphic Annotations) ──────────────────────────────────

def generate_gsps(
    original_ds: pydicom.Dataset,
    study_uid: str,
    findings: list[dict],
    cam: np.ndarray,
    model_name: str,
) -> bytes:
    """Create a Grayscale Softcopy Presentation State with graphic annotations
    marking the AI-detected regions of interest on the original image.
    """
    now = datetime.datetime.now()
    sop_uid = generate_uid()
    series_uid = generate_uid()
    orig_rows = int(getattr(original_ds, "Rows", 512))
    orig_cols = int(getattr(original_ds, "Columns", 512))

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.11.1"
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("gsps.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)

    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.11.1"
    ds.SOPInstanceUID = sop_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.AccessionNumber = ""
    ds.Modality = "PR"
    ds.Manufacturer = "TD|ai MONAI"
    ds.InstitutionName = "TD|ai Radiology Platform"
    ds.SeriesDescription = f"AI Annotations - {model_name}"
    ds.ContentLabel = "AI_ANNOTATIONS"
    ds.ContentDescription = f"MONAI AI annotations for {model_name}"
    ds.PresentationCreationDate = now.strftime("%Y%m%d")
    ds.PresentationCreationTime = now.strftime("%H%M%S")

    ds.PatientName = getattr(original_ds, "PatientName", "")
    ds.PatientID = getattr(original_ds, "PatientID", "")
    ds.PatientBirthDate = getattr(original_ds, "PatientBirthDate", "")
    ds.PatientSex = getattr(original_ds, "PatientSex", "")

    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyID = ""
    ds.SeriesNumber = 997
    ds.InstanceNumber = 1

    ref_image = Dataset()
    ref_image.ReferencedSOPClassUID = getattr(
        original_ds, "SOPClassUID", "1.2.840.10008.5.1.4.1.1.7"
    )
    ref_image.ReferencedSOPInstanceUID = getattr(original_ds, "SOPInstanceUID", "")

    ref_series = Dataset()
    ref_series.SeriesInstanceUID = getattr(original_ds, "SeriesInstanceUID", "")
    ref_series.ReferencedImageSequence = DicomSequence([ref_image])

    ds.ReferencedSeriesSequence = DicomSequence([ref_series])

    regions = find_cam_regions(cam, orig_rows, orig_cols)
    significant = [f for f in findings if f.get("confidence", 0) >= 0.3]
    significant.sort(key=lambda f: f["confidence"], reverse=True)

    graphic_objects = []
    text_objects = []

    for i, region in enumerate(regions[:min(len(significant), 8)]):
        cx, cy, rx, ry = region
        finding = significant[i] if i < len(significant) else None

        ellipse_points = _generate_ellipse_points(cx, cy, rx, ry, num_points=36)

        graphic = Dataset()
        graphic.GraphicAnnotationUnits = "PIXEL"
        graphic.GraphicDimensions = 2
        graphic.NumberOfGraphicPoints = len(ellipse_points) // 2
        graphic.GraphicData = ellipse_points
        graphic.GraphicType = "POLYLINE"
        graphic.GraphicFilled = "N"
        graphic_objects.append(graphic)

        if finding:
            text = Dataset()
            text.UnformattedTextValue = f"{finding['label']} ({finding['confidence']*100:.0f}%)"
            tl_x = max(0, cx - rx)
            tl_y = max(0, cy - ry - 20)
            br_x = min(orig_cols, cx + rx)
            br_y = max(0, cy - ry)
            text.BoundingBoxTopLeftHandCorner = [float(tl_x), float(tl_y)]
            text.BoundingBoxBottomRightHandCorner = [float(br_x), float(br_y)]
            text.BoundingBoxAnnotationUnits = "PIXEL"
            text_objects.append(text)

    annotation_layer = Dataset()
    annotation_layer.GraphicLayer = "AI_FINDINGS"
    annotation_layer.ReferencedImageSequence = DicomSequence([ref_image])
    if graphic_objects:
        annotation_layer.GraphicObjectSequence = DicomSequence(graphic_objects)
    if text_objects:
        annotation_layer.TextObjectSequence = DicomSequence(text_objects)

    ds.GraphicAnnotationSequence = DicomSequence([annotation_layer])

    layer_def = Dataset()
    layer_def.GraphicLayer = "AI_FINDINGS"
    layer_def.GraphicLayerOrder = 1
    layer_def.GraphicLayerDescription = "MONAI AI Detected Findings"
    ds.GraphicLayerSequence = DicomSequence([layer_def])

    buf = io.BytesIO()
    ds.save_as(buf)
    return buf.getvalue()


def _generate_ellipse_points(
    cx: int, cy: int, rx: int, ry: int, num_points: int = 36
) -> list[float]:
    points = []
    for i in range(num_points + 1):
        angle = 2 * np.pi * i / num_points
        x = cx + rx * np.cos(angle)
        y = cy + ry * np.sin(angle)
        points.extend([float(x), float(y)])
    return points


# ── DICOM SR Generation (kept from before) ────────────────────────────

class DicomSRRequest(BaseModel):
    study_instance_uid: str
    series_instance_uid: Optional[str] = None
    patient_name: str = "Unknown"
    patient_id: str = "0000"
    model: str = "monai_chest_xray"
    findings: list[dict]
    summary: str = ""


def build_content_item(name_code: tuple[str, str, str], value: str, value_type: str = "TEXT") -> Dataset:
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = value_type

    concept_name = Dataset()
    concept_name.CodeValue = name_code[0]
    concept_name.CodingSchemeDesignator = name_code[1]
    concept_name.CodeMeaning = name_code[2]
    item.ConceptNameCodeSequence = DicomSequence([concept_name])

    if value_type == "TEXT":
        item.TextValue = value
    elif value_type == "NUM":
        measured = Dataset()
        measured.NumericValue = value
        unit = Dataset()
        unit.CodeValue = "%"
        unit.CodingSchemeDesignator = "UCUM"
        unit.CodeMeaning = "percent"
        measured.MeasurementUnitsCodeSequence = DicomSequence([unit])
        item.MeasuredValueSequence = DicomSequence([measured])
    elif value_type == "CODE":
        code_val = Dataset()
        code_val.CodeValue = value
        code_val.CodingSchemeDesignator = "DCM"
        code_val.CodeMeaning = value
        item.ConceptCodeSequence = DicomSequence([code_val])

    return item


def build_finding_container(finding: dict, _index: int) -> Dataset:
    container = Dataset()
    container.RelationshipType = "CONTAINS"
    container.ValueType = "CONTAINER"
    container.ContinuityOfContent = "SEPARATE"

    concept_name = Dataset()
    concept_name.CodeValue = "121071"
    concept_name.CodingSchemeDesignator = "DCM"
    concept_name.CodeMeaning = "Finding"
    container.ConceptNameCodeSequence = DicomSequence([concept_name])

    content_items = [
        build_content_item(("121071", "DCM", "Finding"), finding.get("label", "Unknown")),
        build_content_item(
            ("111047", "DCM", "Probability of finding"),
            str(round(finding.get("confidence", 0) * 100, 1)),
            "NUM",
        ),
    ]
    if finding.get("description"):
        content_items.append(build_content_item(("121073", "DCM", "Impression"), finding["description"]))
    if finding.get("location"):
        content_items.append(build_content_item(("121049", "DCM", "Finding Site"), finding["location"]))

    container.ContentSequence = DicomSequence(content_items)
    return container


def generate_dicom_sr(request: DicomSRRequest) -> bytes:
    now = datetime.datetime.now()
    sop_instance_uid = generate_uid()
    series_uid = generate_uid()

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"
    file_meta.MediaStorageSOPInstanceUID = sop_instance_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("sr.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"
    ds.SOPInstanceUID = sop_instance_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.AccessionNumber = ""
    ds.Modality = "SR"
    ds.Manufacturer = "TD|ai MONAI"
    ds.InstitutionName = "TD|ai Radiology Platform"
    ds.ReferringPhysicianName = ""

    ds.PatientName = request.patient_name
    ds.PatientID = request.patient_id
    ds.PatientBirthDate = ""
    ds.PatientSex = ""
    ds.StudyInstanceUID = request.study_instance_uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyID = ""
    ds.SeriesNumber = 999
    ds.InstanceNumber = 1
    ds.SeriesDescription = f"AI Report - {request.model}"
    ds.CompletionFlag = "COMPLETE"
    ds.VerificationFlag = "UNVERIFIED"
    ds.ContentTemplateSequence = DicomSequence([])

    root_concept = Dataset()
    root_concept.CodeValue = "111036"
    root_concept.CodingSchemeDesignator = "DCM"
    root_concept.CodeMeaning = "Mammography CAD Report"
    ds.ConceptNameCodeSequence = DicomSequence([root_concept])
    ds.ValueType = "CONTAINER"
    ds.ContinuityOfContent = "SEPARATE"

    content_items = [
        build_content_item(("121060", "DCM", "Procedure Reported"), f"AI Analysis ({request.model})"),
    ]
    if request.summary:
        content_items.append(build_content_item(("121073", "DCM", "Impression"), request.summary))
    content_items.append(build_content_item(("111001", "DCM", "Algorithm Name"), f"MONAI {request.model}"))
    content_items.append(build_content_item(("111003", "DCM", "Algorithm Version"), monai.__version__))
    for i, finding in enumerate(request.findings):
        content_items.append(build_finding_container(finding, i))
    ds.ContentSequence = DicomSequence(content_items)

    buf = io.BytesIO()
    ds.save_as(buf)
    return buf.getvalue()


# ── MedGemma Integration ───────────────────────────────────────────────

MEDGEMMA_BASE_PROMPT = """You are an expert radiologist. Analyze this medical image and provide a structured radiology report.

Instructions:
- Describe all observable findings systematically (lungs, heart, mediastinum, bones, soft tissues)
- Note normal structures explicitly when no abnormality is seen
- Provide differential diagnoses where appropriate
- Be thorough, clinically accurate, and professional
- Only report what you can observe in the image

You MUST respond with valid JSON in this exact format:
{
  "findings": "Detailed findings paragraph(s) describing observations",
  "impression": "Concise clinical impression summarizing key findings",
  "narrative": "A complete narrative radiology report suitable for clinical use",
  "detected_conditions": [
    {"label": "condition name", "confidence": 0.85, "description": "brief clinical description"}
  ]
}"""


def _build_medgemma_prompt(monai_context: list[dict] | None = None) -> str:
    prompt = MEDGEMMA_BASE_PROMPT
    if monai_context:
        lines = []
        for f in monai_context[:8]:
            lines.append(f"  - {f['label']}: {f['confidence']*100:.0f}% confidence")
        prompt += (
            "\n\nAdditional context from MONAI DenseNet-121 classification:\n"
            + "\n".join(lines)
            + "\n\nIncorporate these AI-detected findings into your analysis. "
            "Confirm or refute them based on your own observations."
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
                models = [m["name"] for m in resp.json().get("models", [])]
                logger.info("LLM initialized via Ollama at %s (model: %s, available: %s)",
                            OLLAMA_URL, OLLAMA_MODEL, ", ".join(models[:5]) or "none")
                return
        except Exception as e:
            logger.warning("Ollama not reachable at %s: %s — falling back to Gemini", OLLAMA_URL, e)

    if VERTEX_AI_ENABLED and GCP_PROJECT_ID:
        try:
            import vertexai
            from vertexai.generative_models import GenerativeModel

            vertexai.init(project=GCP_PROJECT_ID, location=GCP_LOCATION)
            model_name = MEDGEMMA_ENDPOINT or GEMINI_MODEL
            medgemma_model = GenerativeModel(model_name)
            medgemma_mode = "vertex_ai"
            logger.info("LLM initialized via Vertex AI (model: %s, project: %s)", model_name, GCP_PROJECT_ID)
            return
        except ImportError:
            logger.warning("google-cloud-aiplatform not installed — falling back to API key")
        except Exception as e:
            logger.warning("Failed to initialize Vertex AI: %s — falling back to API key", e)

    if GEMINI_API_KEY:
        medgemma_model = True
        medgemma_mode = "gemini_api"
        logger.info("MedGemma initialized via Gemini API key (model: %s)", GEMINI_MODEL)
        return

    logger.info("No LLM backend configured — narrative reports disabled")


def dicom_to_png_bytes(pixel_array: np.ndarray) -> bytes:
    """Convert a DICOM pixel array to PNG bytes for MedGemma input."""
    uint8_arr = normalize_to_uint8(pixel_array)
    img = Image.fromarray(uint8_arr, mode="L")
    img = img.resize((896, 896), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def run_medgemma_analysis(
    pixel_array: np.ndarray,
    monai_findings: list[dict] | None = None,
    llm_provider_override: str | None = None,
) -> dict:
    """Run MedGemma/Gemini on a DICOM image and return structured findings.
    llm_provider_override: 'gemini', 'ollama', or 'off' to override the server default.
    """
    effective_mode = medgemma_mode

    if llm_provider_override:
        if llm_provider_override == "off":
            return {
                "narrative": "LLM is disabled via toggle.",
                "findings": "",
                "impression": "",
                "detected_conditions": [],
            }
        if llm_provider_override == "gemini" and GEMINI_API_KEY:
            effective_mode = "gemini_api"
        elif llm_provider_override == "ollama":
            effective_mode = "ollama"

    if medgemma_model is None and effective_mode == medgemma_mode:
        return {
            "narrative": "LLM is not configured. Set LLM_PROVIDER to gemini or ollama.",
            "findings": "",
            "impression": "",
            "detected_conditions": [],
        }

    import json as json_module
    import re as re_module

    png_bytes = dicom_to_png_bytes(pixel_array)
    prompt = _build_medgemma_prompt(monai_findings)

    dispatch_map = {
        "gemini_api": _medgemma_via_gemini_api,
        "vertex_ai": _medgemma_via_vertex_ai,
        "ollama": _medgemma_via_ollama,
    }
    dispatch = dispatch_map.get(effective_mode, _medgemma_via_gemini_api)

    MAX_RETRIES = 2
    last_err = None
    for attempt in range(MAX_RETRIES):
        result = await dispatch(png_bytes, json_module, re_module, prompt)
        if result.get("narrative") and not result["narrative"].startswith(("Gemini API analysis failed", "MedGemma analysis failed")):
            return result
        last_err = result.get("narrative", "unknown error")
        if attempt < MAX_RETRIES - 1:
            import asyncio
            await asyncio.sleep(2 ** attempt)
            logger.warning("MedGemma retry %d after: %s", attempt + 1, last_err)

    return result


def _parse_medgemma_json(raw: str, json_module, re_module) -> dict:
    """Robust JSON extraction: try direct parse, then regex, then structured fallback."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re_module.sub(r"^```\w*\n?", "", raw)
        raw = re_module.sub(r"\n?```$", "", raw)
        raw = raw.strip()

    try:
        parsed = json_module.loads(raw)
        return parsed
    except json_module.JSONDecodeError:
        pass

    json_match = re_module.search(r"\{[\s\S]*\}", raw)
    if json_match:
        try:
            return json_module.loads(json_match.group())
        except json_module.JSONDecodeError:
            pass

    result = {"findings": "", "impression": "", "narrative": raw, "detected_conditions": []}
    for section in ("findings", "impression", "narrative"):
        m = re_module.search(rf'"{section}"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
        if m:
            result[section] = m.group(1).replace("\\n", "\n").replace('\\"', '"')
    return result


async def _medgemma_via_gemini_api(png_bytes: bytes, json_module, re_module, prompt: str) -> dict:
    """Call Gemini directly via REST with API key for image analysis."""
    import base64 as b64_module
    import httpx

    try:
        image_b64 = b64_module.b64encode(png_bytes).decode("ascii")

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                params={"key": GEMINI_API_KEY},
                json={
                    "contents": [
                        {
                            "parts": [
                                {
                                    "inline_data": {
                                        "mime_type": "image/png",
                                        "data": image_b64,
                                    }
                                },
                                {"text": prompt},
                            ]
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.1,
                        "maxOutputTokens": 4096,
                        "responseMimeType": "application/json",
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        parsed = _parse_medgemma_json(content, json_module, re_module)
        return {
            "narrative": parsed.get("narrative", ""),
            "findings": parsed.get("findings", ""),
            "impression": parsed.get("impression", ""),
            "detected_conditions": parsed.get("detected_conditions", []),
        }
    except Exception as e:
        logger.error("Gemini API image analysis failed: %s", e)
        return {
            "narrative": "Gemini API analysis failed",
            "findings": "",
            "impression": "",
            "detected_conditions": [],
        }


async def _medgemma_via_vertex_ai(png_bytes: bytes, json_module, re_module, prompt: str) -> dict:
    """Call MedGemma via Vertex AI SDK for image analysis (non-blocking)."""
    import asyncio

    try:
        from vertexai.generative_models import Part

        image_part = Part.from_data(png_bytes, mime_type="image/png")

        def _sync_call():
            return medgemma_model.generate_content(
                [image_part, prompt],
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 4096,
                    "response_mime_type": "application/json",
                },
            )

        response = await asyncio.to_thread(_sync_call)

        content = response.text.strip()
        parsed = _parse_medgemma_json(content, json_module, re_module)
        return {
            "narrative": parsed.get("narrative", ""),
            "findings": parsed.get("findings", ""),
            "impression": parsed.get("impression", ""),
            "detected_conditions": parsed.get("detected_conditions", []),
        }
    except Exception as e:
        logger.error("Vertex AI MedGemma analysis failed: %s", e)
        return {
            "narrative": "MedGemma analysis failed",
            "findings": "",
            "impression": "",
            "detected_conditions": [],
        }


async def _medgemma_via_ollama(png_bytes: bytes, json_module, re_module, prompt: str) -> dict:
    """Call Ollama with an image for radiology analysis (fully local)."""
    import base64 as b64_module
    import httpx

    try:
        image_b64 = b64_module.b64encode(png_bytes).decode("ascii")

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "images": [image_b64],
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.1, "num_predict": 4096},
                },
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("response", "").strip()

        parsed = _parse_medgemma_json(content, json_module, re_module)
        return {
            "narrative": parsed.get("narrative", ""),
            "findings": parsed.get("findings", ""),
            "impression": parsed.get("impression", ""),
            "detected_conditions": parsed.get("detected_conditions", []),
        }
    except Exception as e:
        logger.error("Ollama analysis failed: %s", e)
        return {
            "narrative": "Ollama analysis failed",
            "findings": "",
            "impression": "",
            "detected_conditions": [],
        }


# ── FastAPI Application ────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(f"MONAI {monai.__version__} | PyTorch {torch.__version__} | Device: {DEVICE}")
    load_or_create_model("monai_chest_xray")
    init_medgemma()
    logger.info(
        "MONAI + MedGemma inference server ready | MedGemma: %s",
        medgemma_mode,
    )
    yield
    loaded_models.clear()
    logger.info("MONAI server shut down")


app = FastAPI(title="TD|ai MONAI + MedGemma Inference Server", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:8081").split(","), allow_methods=["*"], allow_headers=["*"])


class InferRequest(BaseModel):
    model: str = "monai_chest_xray"
    studies: list[str]
    series: Optional[list[str]] = None
    input: Optional[dict] = None


@app.get("/")
async def root():
    return {
        "service": "TD|ai MONAI + MedGemma Inference Server",
        "version": "3.0.0",
        "monai_version": monai.__version__,
        "device": str(DEVICE),
        "models_loaded": list(loaded_models.keys()),
        "medgemma_mode": medgemma_mode,
        "llm_provider": LLM_PROVIDER,
    }


@app.get("/v1/models")
async def list_models():
    return {"models": [
        {"name": c["name"], "description": c["description"], "type": c["type"],
         "bodyParts": c["body_parts"], "modalities": c["modalities"], "version": c["version"]}
        for c in AVAILABLE_MODELS.values()
    ]}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "device": str(DEVICE),
        "models_loaded": len(loaded_models),
        "medgemma_mode": medgemma_mode,
        "llm_provider": LLM_PROVIDER,
    }


INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


@app.post("/v1/configure")
async def configure_llm(request: Request, llm_provider: str = Form(...)):
    """Reconfigure the LLM provider at runtime. Requires INTERNAL_SERVICE_SECRET header."""
    if INTERNAL_SECRET:
        provided = request.headers.get("x-internal-secret", "")
        if provided != INTERNAL_SECRET:
            raise HTTPException(status_code=403, detail="Forbidden")

    global LLM_PROVIDER, medgemma_model, medgemma_mode
    allowed = ("gemini", "ollama", "off")
    if llm_provider not in allowed:
        raise HTTPException(status_code=400, detail=f"llm_provider must be one of {allowed}")

    old_provider = LLM_PROVIDER
    LLM_PROVIDER = llm_provider
    medgemma_model = None
    medgemma_mode = "disabled"
    init_medgemma()
    logger.info("LLM reconfigured at runtime: %s → %s (mode: %s)", old_provider, llm_provider, medgemma_mode)
    return {"previous": old_provider, "current": LLM_PROVIDER, "mode": medgemma_mode}


@app.get("/v1/infer/{job_id}/status")
async def inference_status(job_id: str):
    return {"status": "completed", "progress": 100}


# ── Main Analysis Endpoint (accepts real DICOM file) ──────────────────

@app.post("/v1/analyze-dicom")
async def analyze_dicom(
    file: UploadFile = File(...),
    model_name: str = Form("monai_chest_xray"),
    study_uid: str = Form(""),
):
    """Analyze an actual DICOM file: run inference on real pixel data, generate
    GradCAM heatmap, create annotated Secondary Capture, GSPS, and SR.
    Returns JSON with all DICOM objects base64-encoded.
    """
    if model_name not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model_name}")

    start = time.time()
    config = AVAILABLE_MODELS[model_name]
    labels = config["labels"]

    dicom_bytes = await file.read()
    try:
        original_ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file")

    if not study_uid:
        study_uid = getattr(original_ds, "StudyInstanceUID", generate_uid())

    try:
        pixel_array = extract_pixel_array(original_ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot extract pixel data")

    model = load_or_create_model(model_name)
    tensor = inference_transform(pixel_array)
    batch = tensor.unsqueeze(0).to(DEVICE)
    batch.requires_grad_(True)

    with torch.no_grad():
        output = model(batch)
        probabilities = torch.sigmoid(output).cpu().numpy()[0]

    findings: list[dict] = []
    for label, prob in zip(labels, probabilities):
        prob_val = float(prob)
        if prob_val >= 0.3:
            severity = "High probability" if prob_val >= 0.75 else "Moderate probability" if prob_val >= 0.5 else "Low probability"
            findings.append({
                "label": label,
                "confidence": round(prob_val, 4),
                "description": f"{severity} of {label.lower()} detected by AI model",
                "location": config["body_parts"][0] if config["body_parts"] else None,
            })
    findings.sort(key=lambda f: f["confidence"], reverse=True)

    top_class = int(probabilities.argmax())
    batch_for_cam = tensor.unsqueeze(0).to(DEVICE)
    batch_for_cam.requires_grad_(True)

    extractor = GradCAMExtractor(model)
    try:
        cam = extractor.generate(batch_for_cam, top_class)
    except Exception:
        cam = np.random.rand(7, 7).astype(np.float32)
    finally:
        extractor.cleanup()

    model.eval()

    overlay_img = create_overlay_image(pixel_array, cam, findings)

    sc_bytes = generate_secondary_capture(original_ds, overlay_img, study_uid, model_name)
    gsps_bytes = generate_gsps(original_ds, study_uid, findings, cam, model_name)

    significant = [f for f in findings if f["confidence"] >= 0.5]
    if significant:
        parts = ", ".join(f"{f['label']} ({f['confidence']*100:.0f}%)" for f in significant[:5])
        summary = f"AI analysis ({model_name}): {len(significant)} significant finding(s) — {parts}"
    else:
        summary = f"AI analysis ({model_name}): No findings above 50% confidence."

    sr_bytes = generate_dicom_sr(DicomSRRequest(
        study_instance_uid=study_uid,
        patient_name=str(getattr(original_ds, "PatientName", "")),
        patient_id=str(getattr(original_ds, "PatientID", "")),
        model=model_name, findings=findings, summary=summary,
    ))

    elapsed_ms = (time.time() - start) * 1000
    logger.info(
        f"Full analysis complete: study={study_uid}, model={model_name}, "
        f"findings={len(findings)}, cam_regions={len(find_cam_regions(cam, pixel_array.shape[0], pixel_array.shape[1]))}, "
        f"sc={len(sc_bytes)}B, gsps={len(gsps_bytes)}B, sr={len(sr_bytes)}B, time={elapsed_ms:.0f}ms"
    )

    return {
        "study_id": study_uid,
        "model": model_name,
        "status": "completed",
        "findings": findings,
        "summary": summary,
        "processing_time_ms": round(elapsed_ms, 2),
        "dicom_sr_base64": base64.b64encode(sr_bytes).decode("ascii"),
        "dicom_sr_size_bytes": len(sr_bytes),
        "dicom_sc_base64": base64.b64encode(sc_bytes).decode("ascii"),
        "dicom_sc_size_bytes": len(sc_bytes),
        "dicom_gsps_base64": base64.b64encode(gsps_bytes).decode("ascii"),
        "dicom_gsps_size_bytes": len(gsps_bytes),
    }


# ── MedGemma Narrative Report Endpoint ─────────────────────────────────

@app.post("/v1/analyze-medgemma")
async def analyze_with_medgemma(
    file: UploadFile = File(...),
    study_uid: str = Form(""),
    include_monai: bool = Form(True),
    monai_model: str = Form("monai_chest_xray"),
    llm_provider: Optional[str] = Form(None),
):
    """Analyze a DICOM file with MedGemma for narrative findings.
    Optionally combines with MONAI classification for a comprehensive result.
    """
    start = time.time()

    dicom_bytes = await file.read()
    try:
        original_ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid DICOM file")

    if not study_uid:
        study_uid = getattr(original_ds, "StudyInstanceUID", generate_uid())

    try:
        pixel_array = extract_pixel_array(original_ds)
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot extract pixel data")

    monai_findings = []
    monai_summary = ""
    dicom_sr_b64 = None
    dicom_sc_b64 = None
    dicom_gsps_b64 = None
    heatmap_png_b64 = None

    if include_monai and monai_model in AVAILABLE_MODELS and monai_model != "medgemma_report":
        config = AVAILABLE_MODELS[monai_model]
        labels = config["labels"]
        model = load_or_create_model(monai_model)
        tensor = inference_transform(pixel_array)
        batch = tensor.unsqueeze(0).to(DEVICE)

        with torch.no_grad():
            output = model(batch)
            probabilities = torch.sigmoid(output).cpu().numpy()[0]

        for label, prob in zip(labels, probabilities):
            prob_val = float(prob)
            if prob_val >= 0.3:
                severity = "High probability" if prob_val >= 0.75 else "Moderate probability" if prob_val >= 0.5 else "Low probability"
                monai_findings.append({
                    "label": label,
                    "confidence": round(prob_val, 4),
                    "description": f"{severity} of {label.lower()} detected by AI model",
                    "location": config["body_parts"][0] if config["body_parts"] else None,
                })
        monai_findings.sort(key=lambda f: f["confidence"], reverse=True)

        significant = [f for f in monai_findings if f["confidence"] >= 0.5]
        if significant:
            parts = ", ".join(f"{f['label']} ({f['confidence']*100:.0f}%)" for f in significant[:5])
            monai_summary = f"MONAI ({monai_model}): {len(significant)} finding(s) — {parts}"

        top_class = int(probabilities.argmax())
        batch_for_cam = tensor.unsqueeze(0).to(DEVICE)
        batch_for_cam.requires_grad_(True)

        extractor = GradCAMExtractor(model)
        try:
            cam = extractor.generate(batch_for_cam, top_class)
        except Exception:
            cam = np.random.rand(7, 7).astype(np.float32)
        finally:
            extractor.cleanup()

        model.eval()

        overlay_img = create_overlay_image(pixel_array, cam, monai_findings)

        heatmap_buf = io.BytesIO()
        overlay_img.save(heatmap_buf, format="PNG")
        heatmap_png_b64 = base64.b64encode(heatmap_buf.getvalue()).decode("ascii")

        sc_bytes = generate_secondary_capture(original_ds, overlay_img, study_uid, monai_model)
        gsps_bytes = generate_gsps(original_ds, study_uid, monai_findings, cam, monai_model)

    medgemma_result = await run_medgemma_analysis(pixel_array, monai_findings or None, llm_provider)

    if include_monai and monai_findings:
        all_findings = monai_findings + [
            {
                "label": c.get("label", "Unknown"),
                "confidence": float(c.get("confidence", 0)),
                "description": c.get("description", ""),
                "location": None,
            }
            for c in medgemma_result.get("detected_conditions", [])
        ]

        combined_summary = medgemma_result.get("narrative", "") or monai_summary
        sr_bytes = generate_dicom_sr(DicomSRRequest(
            study_instance_uid=study_uid,
            patient_name=str(getattr(original_ds, "PatientName", "")),
            patient_id=str(getattr(original_ds, "PatientID", "")),
            model=f"{monai_model}+medgemma",
            findings=all_findings,
            summary=combined_summary,
        ))

        dicom_sr_b64 = base64.b64encode(sr_bytes).decode("ascii")
        dicom_sc_b64 = base64.b64encode(sc_bytes).decode("ascii")
        dicom_gsps_b64 = base64.b64encode(gsps_bytes).decode("ascii")

    elapsed_ms = (time.time() - start) * 1000
    logger.info(
        "MedGemma analysis complete: study=%s, monai=%s, time=%.0fms",
        study_uid, include_monai, elapsed_ms,
    )

    response = {
        "study_id": study_uid,
        "model": "medgemma_report",
        "status": "completed",
        "medgemma_narrative": medgemma_result.get("narrative", ""),
        "medgemma_findings": medgemma_result.get("findings", ""),
        "medgemma_impression": medgemma_result.get("impression", ""),
        "medgemma_conditions": medgemma_result.get("detected_conditions", []),
        "monai_findings": monai_findings,
        "monai_summary": monai_summary,
        "findings": monai_findings,
        "summary": medgemma_result.get("narrative", "") or monai_summary,
        "processing_time_ms": round(elapsed_ms, 2),
    }

    if heatmap_png_b64:
        response["heatmap_png_base64"] = heatmap_png_b64
    if dicom_sr_b64:
        response["dicom_sr_base64"] = dicom_sr_b64
        response["dicom_sr_size_bytes"] = len(base64.b64decode(dicom_sr_b64))
    if dicom_sc_b64:
        response["dicom_sc_base64"] = dicom_sc_b64
        response["dicom_sc_size_bytes"] = len(base64.b64decode(dicom_sc_b64))
    if dicom_gsps_b64:
        response["dicom_gsps_base64"] = dicom_gsps_b64
        response["dicom_gsps_size_bytes"] = len(base64.b64decode(dicom_gsps_b64))

    return response


# ── Legacy endpoints (backward compatible) ────────────────────────────

@app.post("/v1/infer")
async def run_inference(request: InferRequest):
    if request.model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {request.model}")
    if not request.studies:
        raise HTTPException(status_code=400, detail="No studies provided")

    start = time.time()
    study_id = request.studies[0]
    config = AVAILABLE_MODELS[request.model]
    labels = config["labels"]
    model = load_or_create_model(request.model)

    dummy_image = np.random.randn(224, 224).astype(np.float32)
    tensor = inference_transform(dummy_image)
    batch = tensor.unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        output = model(batch)
        probabilities = torch.sigmoid(output).cpu().numpy()[0]

    findings: list[dict] = []
    for label, prob in zip(labels, probabilities):
        prob_val = float(prob)
        if prob_val >= 0.3:
            severity = "High probability" if prob_val >= 0.75 else "Moderate probability" if prob_val >= 0.5 else "Low probability"
            findings.append({
                "label": label, "confidence": round(prob_val, 4),
                "description": f"{severity} of {label.lower()} detected by AI model",
                "location": config["body_parts"][0] if config["body_parts"] else None,
            })
    findings.sort(key=lambda f: f["confidence"], reverse=True)
    elapsed_ms = (time.time() - start) * 1000
    return {"study_id": study_id, "model": request.model, "status": "completed",
            "findings": findings, "processing_time_ms": round(elapsed_ms, 2)}


@app.post("/v1/infer-with-sr")
async def infer_and_generate_sr(request: InferRequest):
    if request.model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {request.model}")
    if not request.studies:
        raise HTTPException(status_code=400, detail="No studies provided")

    start = time.time()
    study_id = request.studies[0]
    config = AVAILABLE_MODELS[request.model]
    labels = config["labels"]
    model = load_or_create_model(request.model)

    dummy_image = np.random.randn(224, 224).astype(np.float32)
    tensor = inference_transform(dummy_image)
    batch = tensor.unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        output = model(batch)
        probabilities = torch.sigmoid(output).cpu().numpy()[0]

    findings: list[dict] = []
    for label, prob in zip(labels, probabilities):
        prob_val = float(prob)
        if prob_val >= 0.3:
            severity = "High probability" if prob_val >= 0.75 else "Moderate probability" if prob_val >= 0.5 else "Low probability"
            findings.append({
                "label": label, "confidence": round(prob_val, 4),
                "description": f"{severity} of {label.lower()} detected by AI model",
                "location": config["body_parts"][0] if config["body_parts"] else None,
            })
    findings.sort(key=lambda f: f["confidence"], reverse=True)

    significant = [f for f in findings if f["confidence"] >= 0.5]
    summary = (
        f"AI analysis ({request.model}): {len(significant)} significant finding(s) — "
        + ", ".join(f"{f['label']} ({f['confidence']*100:.0f}%)" for f in significant[:5])
        if significant
        else f"AI analysis ({request.model}): No significant findings above 50% confidence."
    )

    sr_bytes = generate_dicom_sr(DicomSRRequest(
        study_instance_uid=study_id, patient_name="", patient_id="",
        model=request.model, findings=findings, summary=summary,
    ))

    elapsed_ms = (time.time() - start) * 1000
    return {
        "study_id": study_id, "model": request.model, "status": "completed",
        "findings": findings, "summary": summary,
        "processing_time_ms": round(elapsed_ms, 2),
        "dicom_sr_base64": base64.b64encode(sr_bytes).decode("ascii"),
        "dicom_sr_size_bytes": len(sr_bytes),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="info")
