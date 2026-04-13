"""
DICOM Presentation State (PR) — bounding box overlays for nodules/lesions.

Creates Grayscale Softcopy Presentation State objects with:
  - Graphic annotation layers for bounding boxes and ellipses
  - Text annotations with finding labels and confidence
  - Proper Referenced Image Sequence linking
"""

from __future__ import annotations

import io
import datetime
import logging
import math
from typing import Optional

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.sequence import Sequence as DicomSequence
from pydicom.uid import generate_uid, ExplicitVRLittleEndian

logger = logging.getLogger("monai-server.dicom_pr")


def create_dicom_pr(
    source_ds: pydicom.Dataset,
    findings: list[dict],
    study_uid: str = "",
    model_name: str = "monai_model",
    cam_regions: list[tuple[int, int, int, int]] | None = None,
) -> bytes:
    """Create a DICOM GSPS with bounding box overlays for findings.

    Args:
        source_ds: original DICOM dataset
        findings: list of {"label", "confidence", "bbox": {x1,y1,x2,y2}}
        study_uid: study UID
        model_name: AI model name for series description
        cam_regions: optional GradCAM regions as (cx, cy, rx, ry)
    """
    now = datetime.datetime.now()
    sop_uid = generate_uid()
    series_uid = generate_uid()
    orig_rows = int(getattr(source_ds, "Rows", 512))
    orig_cols = int(getattr(source_ds, "Columns", 512))

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.11.1"
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("pr.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.11.1"
    ds.SOPInstanceUID = sop_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.Modality = "PR"
    ds.Manufacturer = "TD|ai MONAI"
    ds.InstitutionName = "TD|ai Radiology Platform"
    ds.SeriesDescription = f"AI Annotations - {model_name}"
    ds.ContentLabel = "AI_ANNOTATIONS"
    ds.ContentDescription = f"MONAI AI annotations for {model_name}"
    ds.PresentationCreationDate = now.strftime("%Y%m%d")
    ds.PresentationCreationTime = now.strftime("%H%M%S")

    ds.PatientName = getattr(source_ds, "PatientName", "")
    ds.PatientID = getattr(source_ds, "PatientID", "")
    ds.PatientBirthDate = getattr(source_ds, "PatientBirthDate", "")
    ds.PatientSex = getattr(source_ds, "PatientSex", "")

    uid = study_uid or getattr(source_ds, "StudyInstanceUID", generate_uid())
    ds.StudyInstanceUID = uid
    ds.SeriesInstanceUID = series_uid
    ds.SeriesNumber = 997
    ds.InstanceNumber = 1

    # Referenced Image
    ref_image = Dataset()
    ref_image.ReferencedSOPClassUID = getattr(
        source_ds, "SOPClassUID", "1.2.840.10008.5.1.4.1.1.7"
    )
    ref_image.ReferencedSOPInstanceUID = getattr(source_ds, "SOPInstanceUID", "")

    ref_series = Dataset()
    ref_series.SeriesInstanceUID = getattr(source_ds, "SeriesInstanceUID", "")
    ref_series.ReferencedImageSequence = DicomSequence([ref_image])
    ds.ReferencedSeriesSequence = DicomSequence([ref_series])

    graphic_objects = []
    text_objects = []

    # Bounding boxes from findings
    for f in findings[:20]:
        bbox = f.get("bbox", {})
        label = f.get("label", "Finding")
        conf = f.get("confidence", 0)

        if bbox:
            x1 = float(bbox.get("x1", 0))
            y1 = float(bbox.get("y1", 0))
            x2 = float(bbox.get("x2", orig_cols))
            y2 = float(bbox.get("y2", orig_rows))

            rect_points = [x1, y1, x2, y1, x2, y2, x1, y2, x1, y1]
            graphic = Dataset()
            graphic.GraphicAnnotationUnits = "PIXEL"
            graphic.GraphicDimensions = 2
            graphic.NumberOfGraphicPoints = 5
            graphic.GraphicData = rect_points
            graphic.GraphicType = "POLYLINE"
            graphic.GraphicFilled = "N"
            graphic_objects.append(graphic)

            text = Dataset()
            text.UnformattedTextValue = f"{label} ({conf*100:.0f}%)"
            text.BoundingBoxTopLeftHandCorner = [x1, max(0, y1 - 20)]
            text.BoundingBoxBottomRightHandCorner = [x2, y1]
            text.BoundingBoxAnnotationUnits = "PIXEL"
            text_objects.append(text)

    # Ellipses from GradCAM regions
    if cam_regions:
        significant = [f for f in findings if f.get("confidence", 0) >= 0.3]
        for i, (cx, cy, rx, ry) in enumerate(cam_regions[:len(significant)]):
            ellipse_pts = _ellipse_points(cx, cy, rx, ry, 36)
            graphic = Dataset()
            graphic.GraphicAnnotationUnits = "PIXEL"
            graphic.GraphicDimensions = 2
            graphic.NumberOfGraphicPoints = len(ellipse_pts) // 2
            graphic.GraphicData = ellipse_pts
            graphic.GraphicType = "POLYLINE"
            graphic.GraphicFilled = "N"
            graphic_objects.append(graphic)

            if i < len(significant):
                f = significant[i]
                text = Dataset()
                text.UnformattedTextValue = f"{f['label']} ({f['confidence']*100:.0f}%)"
                text.BoundingBoxTopLeftHandCorner = [float(max(0, cx - rx)), float(max(0, cy - ry - 20))]
                text.BoundingBoxBottomRightHandCorner = [float(min(orig_cols, cx + rx)), float(max(0, cy - ry))]
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
    layer_def.GraphicLayerDescription = f"MONAI AI Findings ({model_name})"
    ds.GraphicLayerSequence = DicomSequence([layer_def])

    buf = io.BytesIO()
    ds.save_as(buf)
    return buf.getvalue()


def _ellipse_points(cx: int, cy: int, rx: int, ry: int, n: int = 36) -> list[float]:
    points = []
    for i in range(n + 1):
        angle = 2 * math.pi * i / n
        x = cx + rx * math.cos(angle)
        y = cy + ry * math.sin(angle)
        points.extend([float(x), float(y)])
    return points
