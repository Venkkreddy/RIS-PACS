"""
MONAI Deploy App SDK–style operator graph.

This module defines the operator pipeline that mirrors the MONAI Deploy
Application architecture:

  DICOMDataLoaderOperator
    → DICOMSeriesSelectorOperator  (filter by Modality tag)
    → DICOMSeriesToVolumeOperator
    → [ModelInferenceOperator — one per applicable model]
    → PostProcessOperator
    → DICOMSegmentationWriterOperator  (output DICOM SEG)
    → DICOMSRWriterOperator            (output structured report)
    → STOWRSOperator                   (push back to Orthanc)

Each operator is a plain class with an `execute()` method for clarity
and testability. We do not require the full monai-deploy-app-sdk package
at runtime; this is a self-contained implementation.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pydicom
import requests

from config import ORTHANC_URL, ORTHANC_USER, ORTHANC_PASS, route_by_dicom_tags

logger = logging.getLogger("monai-server.operators")

_BODY_PART_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("KNEE", ("KNEE", "MENISC", "ACL", "PCL", "PATELLA")),
    ("BRAIN", ("BRAIN", "HEAD", "CRANI", "NEURO")),
    ("PROSTATE", ("PROSTATE", "PIRADS")),
    ("HEART", ("CARDIAC", "HEART", "VENTRICLE", "MYOCARD")),
    ("SPINE", ("SPINE", "C-SPINE", "T-SPINE", "L-SPINE", "VERTEBRA", "CERVICAL", "THORACIC", "LUMBAR")),
    ("CHEST", ("CHEST", "THORAX", "LUNG", "PULMONARY")),
    ("ABDOMEN", ("ABDOMEN", "ABDOM", "LIVER", "PANCREAS")),
    ("NECK", ("NECK", "THYROID")),
]


def _infer_body_part_from_descriptions(ds: pydicom.Dataset) -> str:
    fields = (
        "StudyDescription",
        "SeriesDescription",
        "ProtocolName",
        "PerformedProcedureStepDescription",
    )
    search_space = " ".join(
        str(getattr(ds, field, "")).strip().upper()
        for field in fields
        if getattr(ds, field, None)
    )
    if not search_space:
        return ""

    for body_part, keywords in _BODY_PART_HINTS:
        if any(keyword in search_space for keyword in keywords):
            return body_part
    return ""


@dataclass
class OperatorContext:
    """Shared data flowing through the operator graph."""
    dicom_bytes: bytes = b""
    dicom_dataset: Optional[pydicom.Dataset] = None
    volume: Optional[np.ndarray] = None
    spacing: tuple[float, ...] = (1.0, 1.0, 1.0)
    modality: str = ""
    body_part: str = ""
    study_uid: str = ""
    series_uid: str = ""
    patient_name: str = ""
    patient_id: str = ""
    model_names: list[str] = field(default_factory=list)
    inference_results: dict = field(default_factory=dict)
    dicom_outputs: list[bytes] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class DICOMDataLoaderOperator:
    """Load raw DICOM bytes into a pydicom Dataset."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        try:
            ds = pydicom.dcmread(io.BytesIO(ctx.dicom_bytes))
            ctx.dicom_dataset = ds
            ctx.study_uid = str(getattr(ds, "StudyInstanceUID", ""))
            ctx.series_uid = str(getattr(ds, "SeriesInstanceUID", ""))
            ctx.patient_name = str(getattr(ds, "PatientName", ""))
            ctx.patient_id = str(getattr(ds, "PatientID", ""))
            logger.info("DICOM loaded: study=%s", ctx.study_uid)
        except Exception as e:
            ctx.errors.append(f"DICOM load failed: {e}")
        return ctx


class DICOMSeriesSelectorOperator:
    """Extract Modality and BodyPartExamined, then determine which models to run."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        ds = ctx.dicom_dataset
        if ds is None:
            ctx.errors.append("No DICOM dataset available for series selection")
            return ctx

        ctx.modality = str(getattr(ds, "Modality", "")).strip().upper()
        ctx.body_part = str(getattr(ds, "BodyPartExamined", "")).strip().upper()
        if not ctx.body_part:
            inferred = _infer_body_part_from_descriptions(ds)
            if inferred:
                ctx.body_part = inferred
                logger.info("Series selector inferred body part from descriptions: %s", inferred)
        ctx.model_names = route_by_dicom_tags(ctx.modality, ctx.body_part)

        logger.info(
            "Series selector: modality=%s  body_part=%s  → models=%s",
            ctx.modality, ctx.body_part, ctx.model_names,
        )
        return ctx


class DICOMSeriesToVolumeOperator:
    """Convert DICOM pixel data to a NumPy volume array."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        ds = ctx.dicom_dataset
        if ds is None or not hasattr(ds, "PixelData"):
            ctx.errors.append("No pixel data available")
            return ctx

        try:
            arr = self._extract_pixel_array(ds)

            if hasattr(ds, "RescaleSlope") and hasattr(ds, "RescaleIntercept"):
                arr = arr * float(ds.RescaleSlope) + float(ds.RescaleIntercept)

            if arr.ndim == 3 and arr.shape[-1] <= 4:
                arr = arr.mean(axis=-1)

            ctx.volume = arr

            ps = getattr(ds, "PixelSpacing", [1.0, 1.0])
            st = float(getattr(ds, "SliceThickness", 1.0))
            ctx.spacing = (float(ps[0]), float(ps[1]), st)

            logger.info("Volume extracted: shape=%s spacing=%s", arr.shape, ctx.spacing)
        except Exception as e:
            ctx.errors.append(f"Pixel data extraction failed: {e}")

        return ctx

    @staticmethod
    def _extract_pixel_array(ds: pydicom.Dataset) -> np.ndarray:
        """Robust pixel array extraction with compressed transfer syntax support."""
        import io as _io
        from PIL import Image as _Img

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
                raw = ds.PixelData
                preamble_len = 12 if raw[:4] == b"\xfe\xff\x00\xe0" else 0
                img = _Img.open(_io.BytesIO(raw[preamble_len:]))
                arr = np.array(img, dtype=np.float32)
                if arr.ndim == 3:
                    arr = arr.mean(axis=-1)
            else:
                raise

        if arr.ndim == 3:
            arr = arr.mean(axis=-1) if arr.shape[-1] <= 4 else arr[arr.shape[0] // 2]
        return arr


class ModelInferenceOperator:
    """Run inference using the engine for a specific model."""

    def __init__(self, model_name: str):
        self.model_name = model_name

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        if ctx.volume is None:
            ctx.errors.append(f"No volume data for model {self.model_name}")
            return ctx

        from models.registry import get_model_config

        config = get_model_config(self.model_name)
        if config and config.spatial_dims >= 3 and ctx.volume.ndim < 3:
            logger.info(
                "Skipping model %s: requires %dD input but received volume with shape=%s",
                self.model_name,
                config.spatial_dims,
                tuple(ctx.volume.shape),
            )
            ctx.errors.append(
                f"Skipped {self.model_name}: model expects volumetric input, but study is single-slice/non-volumetric",
            )
            return ctx

        try:
            from inference.engine import run_inference
            result = run_inference(
                self.model_name,
                ctx.volume,
                spacing=ctx.spacing,
            )
            ctx.inference_results[self.model_name] = result
        except Exception as e:
            logger.error("Inference failed for %s: %s", self.model_name, e)
            ctx.errors.append(f"Inference failed for {self.model_name}: {e}")

        return ctx


class PostProcessOperator:
    """Aggregate results from all models into a unified finding set."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        return ctx


class DICOMSegmentationWriterOperator:
    """Generate DICOM SEG objects for any segmentation results."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        from outputs.dicom_seg import create_dicom_seg
        from scipy.ndimage import zoom

        for model_name, result in ctx.inference_results.items():
            masks = result.get("_masks", {})
            if not masks:
                logger.info("No masks in result for model %s — skipping SEG", model_name)
                continue

            try:
                # Resize masks back to original DICOM spatial dimensions
                if ctx.volume is not None and ctx.dicom_dataset is not None:
                    src_rows = int(getattr(ctx.dicom_dataset, "Rows", 0))
                    src_cols = int(getattr(ctx.dicom_dataset, "Columns", 0))
                    if src_rows and src_cols:
                        resized_masks = {}
                        for label, mask in masks.items():
                            if mask.ndim == 2 and mask.shape != (src_rows, src_cols):
                                factors = (src_rows / mask.shape[0], src_cols / mask.shape[1])
                                resized = zoom(mask.astype(np.float32), factors, order=0)
                                resized_masks[label] = (resized > 0.5).astype(np.uint8)
                                logger.info(
                                    "Operator resized mask '%s': %s → %s",
                                    label, mask.shape, resized_masks[label].shape,
                                )
                            elif mask.ndim == 3 and mask.shape[1:] != (src_rows, src_cols):
                                factors = (1, src_rows / mask.shape[1], src_cols / mask.shape[2])
                                resized = zoom(mask.astype(np.float32), factors, order=0)
                                resized_masks[label] = (resized > 0.5).astype(np.uint8)
                                logger.info(
                                    "Operator resized 3D mask '%s': %s → %s",
                                    label, mask.shape, resized_masks[label].shape,
                                )
                            else:
                                resized_masks[label] = mask
                        masks = resized_masks

                for label, mask in masks.items():
                    nonzero = int((mask > 0).sum())
                    logger.info(
                        "Operator mask [%s]: shape=%s nonzero=%d/%d",
                        label, mask.shape, nonzero, int(np.prod(mask.shape)),
                    )

                from models.registry import get_model_config
                config = get_model_config(model_name)
                seg_bytes = create_dicom_seg(
                    source_ds=ctx.dicom_dataset,
                    masks=masks,
                    model_config=config,
                    study_uid=ctx.study_uid,
                )
                if seg_bytes:
                    ctx.dicom_outputs.append(seg_bytes)
                    logger.info("DICOM SEG created for %s (%d bytes)", model_name, len(seg_bytes))
                else:
                    logger.warning("DICOM SEG empty for %s — masks may all be zero", model_name)
            except Exception as e:
                logger.error("DICOM SEG creation failed for %s: %s", model_name, e)
                ctx.errors.append(f"SEG creation failed: {e}")

        return ctx


class DICOMSRWriterOperator:
    """Generate DICOM SR (TID 1500) from inference results."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        from outputs.dicom_sr import create_dicom_sr_tid1500

        all_findings = []
        all_measurements = []

        for model_name, result in ctx.inference_results.items():
            for f in result.get("findings", []):
                f["model"] = model_name
                all_findings.append(f)
            for label, vol in result.get("volumes_ml", {}).items():
                all_measurements.append({
                    "label": label, "value": vol, "unit": "ml",
                    "model": model_name,
                })

        if all_findings or all_measurements:
            try:
                sr_bytes = create_dicom_sr_tid1500(
                    source_ds=ctx.dicom_dataset,
                    findings=all_findings,
                    measurements=all_measurements,
                    study_uid=ctx.study_uid,
                )
                ctx.dicom_outputs.append(sr_bytes)
                logger.info("DICOM SR created (%d bytes)", len(sr_bytes))
            except Exception as e:
                logger.error("DICOM SR creation failed: %s", e)

        return ctx


class STOWRSOperator:
    """Push DICOM objects back to Orthanc via STOW-RS (DICOMweb)."""

    def execute(self, ctx: OperatorContext) -> OperatorContext:
        if not ctx.dicom_outputs:
            logger.warning("No DICOM outputs to push to Orthanc")
            return ctx

        logger.info("Pushing %d DICOM object(s) to Orthanc at %s", len(ctx.dicom_outputs), ORTHANC_URL)
        for i, dcm_bytes in enumerate(ctx.dicom_outputs):
            try:
                _stow_to_orthanc(dcm_bytes)
                logger.info("STOW-RS: pushed object %d/%d (%d bytes)", i + 1, len(ctx.dicom_outputs), len(dcm_bytes))
            except Exception as e:
                logger.error("STOW-RS push failed for object %d: %s", i + 1, e)
                ctx.errors.append(f"STOW-RS failed: {e}")

        return ctx


def _stow_to_orthanc(dicom_bytes: bytes) -> None:
    """Push a single DICOM instance to Orthanc via its REST API."""
    if not dicom_bytes:
        logger.warning("Skipping empty DICOM bytes in STOW-RS push")
        return

    url = f"{ORTHANC_URL}/instances"
    auth = (ORTHANC_USER, ORTHANC_PASS) if ORTHANC_USER else None
    resp = requests.post(
        url,
        data=dicom_bytes,
        headers={"Content-Type": "application/dicom"},
        auth=auth,
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    logger.info(
        "STOW-RS: pushed instance to Orthanc (status=%d, orthanc_id=%s)",
        resp.status_code,
        result.get("ID", "unknown"),
    )


class MonaiDeployPipeline:
    """Execute the full MONAI Deploy–style operator graph."""

    def __init__(self):
        self.loader = DICOMDataLoaderOperator()
        self.selector = DICOMSeriesSelectorOperator()
        self.volume_converter = DICOMSeriesToVolumeOperator()
        self.postprocessor = PostProcessOperator()
        self.seg_writer = DICOMSegmentationWriterOperator()
        self.sr_writer = DICOMSRWriterOperator()
        self.stow = STOWRSOperator()

    def run(
        self,
        dicom_bytes: bytes,
        model_override: Optional[list[str]] = None,
        push_to_orthanc: bool = True,
    ) -> OperatorContext:
        ctx = OperatorContext(dicom_bytes=dicom_bytes)

        ctx = self.loader.execute(ctx)
        if ctx.errors:
            return ctx

        ctx = self.selector.execute(ctx)
        if model_override:
            ctx.model_names = model_override

        ctx = self.volume_converter.execute(ctx)
        # Continue even if volume extraction had issues — inference operators
        # gracefully skip when ctx.volume is None, and SR/SEG writers still
        # check whether any findings were produced.
        if ctx.volume is None and ctx.errors:
            logger.warning(
                "Volume extraction failed (%s) — pipeline will attempt to continue",
                "; ".join(ctx.errors),
            )

        for model_name in ctx.model_names:
            op = ModelInferenceOperator(model_name)
            ctx = op.execute(ctx)

        ctx = self.postprocessor.execute(ctx)
        ctx = self.seg_writer.execute(ctx)
        ctx = self.sr_writer.execute(ctx)

        if push_to_orthanc:
            ctx = self.stow.execute(ctx)

        return ctx
