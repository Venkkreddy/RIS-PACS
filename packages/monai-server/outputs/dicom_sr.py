"""
DICOM Structured Report — TID 1500 (Measurement Report).

Generates conformant SR documents with:
  - Finding site → SNOMED code
  - Measurement → numeric value + unit (mm, cm³, HU)
  - AI confidence → probability value
  - Model version → observer context sequence
"""

from __future__ import annotations

import io
import datetime
import logging
from typing import Optional

import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.sequence import Sequence as DicomSequence
from pydicom.uid import generate_uid, ExplicitVRLittleEndian

import monai

from config import SNOMED_CODES

logger = logging.getLogger("monai-server.dicom_sr")


def create_dicom_sr_tid1500(
    source_ds: Optional[pydicom.Dataset],
    findings: list[dict],
    measurements: list[dict] | None = None,
    study_uid: str = "",
    model_name: str = "monai_model",
    model_version: str = "1.0.0",
    summary: str = "",
) -> bytes:
    """Create a DICOM SR (TID 1500 Measurement Report).

    Args:
        source_ds: original DICOM dataset for patient/study context
        findings: list of {"label", "confidence", "description", "location", "model"}
        measurements: list of {"label", "value", "unit", "model"}
        study_uid: override study UID
        model_name: algorithm name
        model_version: algorithm version
        summary: impression text
    """
    now = datetime.datetime.now()
    sop_uid = generate_uid()
    series_uid = generate_uid()

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("sr.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"
    ds.SOPInstanceUID = sop_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.AccessionNumber = ""
    ds.Modality = "SR"
    ds.Manufacturer = "TD|ai MONAI"
    ds.InstitutionName = "TD|ai Radiology Platform"

    if source_ds:
        ds.PatientName = getattr(source_ds, "PatientName", "")
        ds.PatientID = getattr(source_ds, "PatientID", "")
        ds.PatientBirthDate = getattr(source_ds, "PatientBirthDate", "")
        ds.PatientSex = getattr(source_ds, "PatientSex", "")
    else:
        ds.PatientName = ""
        ds.PatientID = ""

    uid = study_uid or (getattr(source_ds, "StudyInstanceUID", "") if source_ds else generate_uid())
    ds.StudyInstanceUID = uid
    ds.SeriesInstanceUID = series_uid
    ds.StudyID = ""
    ds.SeriesNumber = 999
    ds.InstanceNumber = 1
    ds.SeriesDescription = f"AI Report (TID 1500) - {model_name}"
    ds.CompletionFlag = "COMPLETE"
    ds.VerificationFlag = "UNVERIFIED"

    # TID 1500 root: Measurement Report
    root_concept = Dataset()
    root_concept.CodeValue = "126000"
    root_concept.CodingSchemeDesignator = "DCM"
    root_concept.CodeMeaning = "Imaging Measurement Report"
    ds.ConceptNameCodeSequence = DicomSequence([root_concept])
    ds.ValueType = "CONTAINER"
    ds.ContinuityOfContent = "SEPARATE"

    content_items = []

    # Language of Content Item
    content_items.append(_make_code_item(
        ("121049", "DCM", "Language of Content Item and Descendants"),
        ("en", "RFC5646", "English"),
    ))

    # Observer Context — Algorithm
    observer = _make_container("121005", "DCM", "Observer Type", items=[
        _make_code_item(
            ("121005", "DCM", "Observer Type"),
            ("121023", "DCM", "Device"),
        ),
        _make_text_item(("121012", "DCM", "Device Observer Name"), f"MONAI {model_name}"),
        _make_text_item(("111003", "DCM", "Algorithm Version"), model_version),
        _make_text_item(("111001", "DCM", "Algorithm Name"), f"MONAI {model_name}"),
    ])
    content_items.append(observer)

    # Procedure Reported
    content_items.append(
        _make_text_item(("121060", "DCM", "Procedure Reported"), f"AI Analysis ({model_name})")
    )

    # Impression / Summary
    if summary:
        content_items.append(
            _make_text_item(("121073", "DCM", "Impression"), summary)
        )

    # Findings
    for f in findings:
        finding_container = _build_finding_tid1500(f)
        content_items.append(finding_container)

    # Measurements (volumes, distances, etc.)
    for m in (measurements or []):
        meas_item = _build_measurement_tid1500(m)
        content_items.append(meas_item)

    ds.ContentSequence = DicomSequence(content_items)

    buf = io.BytesIO()
    ds.save_as(buf)
    return buf.getvalue()


def _build_finding_tid1500(finding: dict) -> Dataset:
    """Build a TID 1500 finding container with SNOMED coding."""
    label = finding.get("label", "Unknown")
    confidence = finding.get("confidence", 0)
    description = finding.get("description", "")
    location = finding.get("location", "")

    items = []

    # Finding
    items.append(_make_text_item(("121071", "DCM", "Finding"), label))

    # Finding Site (SNOMED coded)
    snomed = SNOMED_CODES.get(label, "")
    if snomed:
        items.append(_make_code_item(
            ("121049", "DCM", "Finding Site"),
            (snomed, "SCT", label.replace("_", " ")),
        ))
    elif location:
        items.append(_make_text_item(("121049", "DCM", "Finding Site"), location))

    # Probability
    items.append(_make_num_item(
        ("111047", "DCM", "Probability of finding"),
        str(round(confidence * 100, 1)),
        ("%", "UCUM", "percent"),
    ))

    # Confidence level category
    if confidence >= 0.75:
        conf_text = "High confidence"
    elif confidence >= 0.5:
        conf_text = "Moderate confidence"
    else:
        conf_text = "Low confidence"
    items.append(_make_text_item(("111052", "DCM", "Confidence"), conf_text))

    if description:
        items.append(_make_text_item(("121073", "DCM", "Impression"), description))

    return _make_container("121071", "DCM", "Finding", items=items)


def _build_measurement_tid1500(measurement: dict) -> Dataset:
    """Build a TID 1500 measurement item."""
    label = measurement.get("label", "Measurement")
    value = measurement.get("value", 0)
    unit = measurement.get("unit", "ml")

    unit_map = {
        "ml": ("ml", "UCUM", "milliliter"),
        "mm": ("mm", "UCUM", "millimeter"),
        "cm3": ("cm3", "UCUM", "cubic centimeter"),
        "HU": ("[hnsf'U]", "UCUM", "Hounsfield unit"),
        "%": ("%", "UCUM", "percent"),
    }
    unit_code = unit_map.get(unit, (unit, "UCUM", unit))

    snomed = SNOMED_CODES.get(label, "")
    items = []

    if snomed:
        items.append(_make_code_item(
            ("121049", "DCM", "Finding Site"),
            (snomed, "SCT", label.replace("_", " ")),
        ))

    items.append(_make_num_item(
        ("121211", "DCM", "Measurement"),
        str(round(value, 2)),
        unit_code,
    ))

    return _make_container("125007", "DCM", "Measurement Group", items=items)


# ── SR building blocks ───────────────────────────────────────────────

def _make_text_item(name_code: tuple, value: str) -> Dataset:
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = "TEXT"
    cn = Dataset()
    cn.CodeValue, cn.CodingSchemeDesignator, cn.CodeMeaning = name_code
    item.ConceptNameCodeSequence = DicomSequence([cn])
    item.TextValue = value
    return item


def _make_code_item(name_code: tuple, value_code: tuple) -> Dataset:
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = "CODE"
    cn = Dataset()
    cn.CodeValue, cn.CodingSchemeDesignator, cn.CodeMeaning = name_code
    item.ConceptNameCodeSequence = DicomSequence([cn])
    cv = Dataset()
    cv.CodeValue, cv.CodingSchemeDesignator, cv.CodeMeaning = value_code
    item.ConceptCodeSequence = DicomSequence([cv])
    return item


def _make_num_item(name_code: tuple, value: str, unit_code: tuple) -> Dataset:
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = "NUM"
    cn = Dataset()
    cn.CodeValue, cn.CodingSchemeDesignator, cn.CodeMeaning = name_code
    item.ConceptNameCodeSequence = DicomSequence([cn])
    measured = Dataset()
    measured.NumericValue = value
    unit = Dataset()
    unit.CodeValue, unit.CodingSchemeDesignator, unit.CodeMeaning = unit_code
    measured.MeasurementUnitsCodeSequence = DicomSequence([unit])
    item.MeasuredValueSequence = DicomSequence([measured])
    return item


def _make_container(code_value: str, scheme: str, meaning: str, items: list[Dataset] | None = None) -> Dataset:
    container = Dataset()
    container.RelationshipType = "CONTAINS"
    container.ValueType = "CONTAINER"
    container.ContinuityOfContent = "SEPARATE"
    cn = Dataset()
    cn.CodeValue = code_value
    cn.CodingSchemeDesignator = scheme
    cn.CodeMeaning = meaning
    container.ConceptNameCodeSequence = DicomSequence([cn])
    if items:
        container.ContentSequence = DicomSequence(items)
    return container
