"""
DICOM SEG creation using highdicom (primary) or pydicom (fallback).

Each organ/lesion gets its own segment with proper SNOMED-RT coding.
Output is a conformant DICOM Segmentation object (binary) that OHIF
Viewer can display as an overlay.

Critical requirements for OHIF SEG rendering:
  - StudyInstanceUID must match the source study
  - ReferencedSeriesSequence must reference the source series/SOP
  - SharedFunctionalGroupsSequence with PlaneOrientationSequence
  - PerFrameFunctionalGroupsSequence with derivation + position info
  - Mask dimensions (Rows/Columns) must match the source image exactly
"""

from __future__ import annotations

import io
import datetime
import logging
from typing import Optional

import numpy as np
import pydicom
import requests

from config import (
    ModelConfig,
    SNOMED_CODES,
    ORTHANC_URL,
    ORTHANC_USER,
    ORTHANC_PASS,
)

logger = logging.getLogger("monai-server.dicom_seg")

try:
    import highdicom as hd
    from highdicom.seg import (
        Segmentation,
        SegmentDescription,
        SegmentAlgorithmTypeValues,
        SegmentationTypeValues,
    )
    from highdicom.sr.coding import CodedConcept
    from highdicom.content import AlgorithmIdentificationSequence
    HIGHDICOM_AVAILABLE = True
except ImportError:
    HIGHDICOM_AVAILABLE = False
    logger.warning("highdicom not installed — DICOM SEG via fallback pydicom method")


def create_dicom_seg(
    source_ds: pydicom.Dataset,
    masks: dict[str, np.ndarray],
    model_config: Optional[ModelConfig] = None,
    study_uid: str = "",
) -> bytes:
    """Create a DICOM SEG from a dict of {label: mask_array}.

    Uses highdicom when available; otherwise falls back to a
    standards-compliant pydicom-based implementation.
    """
    masks = _validate_and_clean_masks(masks, source_ds)
    if not masks:
        logger.warning("All masks empty after validation — no DICOM SEG created")
        return b""

    if HIGHDICOM_AVAILABLE:
        return _create_seg_highdicom(source_ds, masks, model_config, study_uid)
    return _create_seg_fallback(source_ds, masks, model_config, study_uid)


def _validate_and_clean_masks(
    masks: dict[str, np.ndarray],
    source_ds: pydicom.Dataset,
) -> dict[str, np.ndarray]:
    """Validate masks, log diagnostics, and drop empty ones."""
    source_rows = int(getattr(source_ds, "Rows", 0))
    source_cols = int(getattr(source_ds, "Columns", 0))
    cleaned: dict[str, np.ndarray] = {}

    for label, mask in masks.items():
        binary = (mask > 0).astype(np.uint8)
        nonzero = int(binary.sum())

        logger.info(
            "SEG mask [%s]: shape=%s dtype=%s min=%s max=%s nonzero=%d",
            label, binary.shape, binary.dtype, binary.min(), binary.max(), nonzero,
        )

        if nonzero == 0:
            logger.warning("Skipping empty mask '%s'", label)
            continue

        if source_rows and source_cols:
            if binary.ndim == 2:
                if binary.shape != (source_rows, source_cols):
                    logger.error(
                        "Mask '%s' shape %s does not match DICOM (%d, %d) — "
                        "spatial mismatch will cause overlay misalignment",
                        label, binary.shape, source_rows, source_cols,
                    )
            elif binary.ndim == 3:
                if binary.shape[1:] != (source_rows, source_cols):
                    logger.error(
                        "Mask '%s' spatial dims %s do not match DICOM (%d, %d)",
                        label, binary.shape[1:], source_rows, source_cols,
                    )

        cleaned[label] = binary
    return cleaned


def _estimate_required_source_frames(masks: dict[str, np.ndarray]) -> int:
    """Estimate how many source frames are needed from mask depth."""
    required = 1
    for mask in masks.values():
        if mask.ndim == 3:
            required = max(required, int(mask.shape[0]))
    return required


def _sort_source_images(images: list[pydicom.Dataset]) -> list[pydicom.Dataset]:
    """Sort source images by geometry/instance ordering for stable references."""
    def _sort_key(ds: pydicom.Dataset) -> tuple[float, float]:
        ipp = getattr(ds, "ImagePositionPatient", None)
        if ipp is not None and len(ipp) == 3:
            try:
                return (0.0, float(ipp[2]))
            except Exception:
                pass
        try:
            return (1.0, float(getattr(ds, "InstanceNumber", 0)))
        except Exception:
            return (2.0, 0.0)

    return sorted(images, key=_sort_key)


def _fetch_series_images_from_orthanc(source_ds: pydicom.Dataset) -> list[pydicom.Dataset]:
    """Fetch all source instances in the same study/series from Orthanc."""
    study_uid = str(getattr(source_ds, "StudyInstanceUID", "")).strip()
    series_uid = str(getattr(source_ds, "SeriesInstanceUID", "")).strip()
    if not study_uid or not series_uid:
        return []

    orthanc_base = ORTHANC_URL.rstrip("/")
    if not orthanc_base:
        return []

    auth = (ORTHANC_USER, ORTHANC_PASS) if ORTHANC_USER else None
    find_payload = {
        "Level": "Instance",
        "Query": {
            "StudyInstanceUID": study_uid,
            "SeriesInstanceUID": series_uid,
        },
        "Expand": False,
    }

    try:
        find_resp = requests.post(
            f"{orthanc_base}/tools/find",
            json=find_payload,
            auth=auth,
            timeout=10,
        )
        find_resp.raise_for_status()
        orthanc_ids = find_resp.json()
    except Exception as e:
        logger.warning("Orthanc series lookup failed for SEG references: %s", e)
        return []

    if not isinstance(orthanc_ids, list) or not orthanc_ids:
        return []

    source_images: list[pydicom.Dataset] = []
    seen_sops: set[str] = set()
    for oid in orthanc_ids:
        if not isinstance(oid, str) or not oid:
            continue
        try:
            file_resp = requests.get(
                f"{orthanc_base}/instances/{oid}/file",
                auth=auth,
                timeout=20,
            )
            file_resp.raise_for_status()
            ds = pydicom.dcmread(io.BytesIO(file_resp.content))
        except Exception:
            continue

        sop_uid = str(getattr(ds, "SOPInstanceUID", "")).strip()
        if not sop_uid or sop_uid in seen_sops:
            continue
        if str(getattr(ds, "StudyInstanceUID", "")).strip() != study_uid:
            continue
        if str(getattr(ds, "SeriesInstanceUID", "")).strip() != series_uid:
            continue

        seen_sops.add(sop_uid)
        source_images.append(ds)

    return _sort_source_images(source_images)


def _resolve_source_images(
    source_ds: pydicom.Dataset,
    required_frames: int,
) -> list[pydicom.Dataset]:
    """Resolve best available source image list for SEG references."""
    num_frames = int(getattr(source_ds, "NumberOfFrames", 1) or 1)
    if required_frames <= 1:
        return [source_ds]

    # Multi-frame source can reference all frames using one SOP.
    if num_frames >= required_frames:
        return [source_ds]

    orthanc_series = _fetch_series_images_from_orthanc(source_ds)
    if orthanc_series:
        logger.info(
            "Resolved %d source SOPs from Orthanc for SEG linkage",
            len(orthanc_series),
        )
        return orthanc_series

    logger.warning(
        "SEG has %d frames but only 1 source SOP available; "
        "falling back to single-image reference",
        required_frames,
    )
    return [source_ds]


def _create_seg_highdicom(
    source_ds: pydicom.Dataset,
    masks: dict[str, np.ndarray],
    model_config: Optional[ModelConfig],
    study_uid: str,
) -> bytes:
    """Create DICOM SEG using highdicom library with proper SNOMED coding."""

    segment_descriptions = []
    mask_arrays = []

    model_name = model_config.name if model_config else "monai_model"
    model_version = model_config.version if model_config else "1.0.0"

    algorithm_id = AlgorithmIdentificationSequence(
        name=f"MONAI {model_name}",
        version=model_version,
        family=CodedConcept(
            value="123109",
            meaning="Algorithm Family",
            scheme_designator="DCM",
        ),
    )

    for idx, (label, mask) in enumerate(masks.items(), start=1):
        snomed_code = SNOMED_CODES.get(label, "123037004")
        snomed_meaning = label.replace("_", " ")

        segment_desc = SegmentDescription(
            segment_number=idx,
            segment_label=label,
            segmented_property_category=CodedConcept(
                value="49755003",
                meaning="Morphologically Abnormal Structure",
                scheme_designator="SCT",
            ),
            segmented_property_type=CodedConcept(
                value=snomed_code,
                meaning=snomed_meaning,
                scheme_designator="SCT",
            ),
            algorithm_type=SegmentAlgorithmTypeValues.AUTOMATIC,
            algorithm_identification=algorithm_id,
        )
        segment_descriptions.append(segment_desc)

        binary_mask = (mask > 0).astype(np.uint8)
        if binary_mask.ndim == 2:
            binary_mask = binary_mask[np.newaxis, ...]
        mask_arrays.append(binary_mask)

    if not mask_arrays:
        return b""

    # highdicom expects pixel_array shape: (frames, rows, cols, segments)
    combined_mask = np.stack(mask_arrays, axis=-1)
    if combined_mask.ndim == 3:
        combined_mask = combined_mask[np.newaxis, ...]

    required_frames = int(combined_mask.shape[0])
    source_images = _resolve_source_images(source_ds, required_frames)
    if len(source_images) > 1 and len(source_images) != required_frames:
        logger.warning(
            "Source SOP count (%d) does not match SEG frames (%d); "
            "using first %d source SOPs for deterministic linkage",
            len(source_images),
            required_frames,
            required_frames,
        )
        source_images = source_images[:required_frames]
    if not source_images:
        source_images = [source_ds]

    logger.info(
        "highdicom SEG: combined_mask shape=%s, segments=%d, source SOPs=%d",
        combined_mask.shape,
        len(segment_descriptions),
        len(source_images),
    )

    try:
        seg = Segmentation(
            source_images=source_images,
            pixel_array=combined_mask,
            segmentation_type=SegmentationTypeValues.BINARY,
            segment_descriptions=segment_descriptions,
            series_instance_uid=hd.UID(),
            series_number=900,
            sop_instance_uid=hd.UID(),
            instance_number=1,
            manufacturer="TD|ai MONAI",
            manufacturer_model_name=model_name,
            software_versions=model_version,
            device_serial_number="TDAI-001",
            content_description=f"AI Segmentation - {model_name}",
            content_creator_name="TD|ai AI Platform",
        )

        if study_uid:
            seg.StudyInstanceUID = study_uid

        buf = io.BytesIO()
        seg.save_as(buf)
        seg_bytes = buf.getvalue()
        logger.info("highdicom SEG created successfully (%d bytes)", len(seg_bytes))
        return seg_bytes

    except Exception as e:
        logger.error("highdicom SEG creation failed: %s — using fallback", e)
        return _create_seg_fallback(source_ds, masks, model_config, study_uid)


def _create_seg_fallback(
    source_ds: pydicom.Dataset,
    masks: dict[str, np.ndarray],
    model_config: Optional[ModelConfig],
    study_uid: str,
) -> bytes:
    """Standards-compliant DICOM SEG using pydicom when highdicom isn't available.

    Includes all attributes required by OHIF Viewer:
    - ReferencedSeriesSequence (links SEG to source series)
    - SharedFunctionalGroupsSequence (plane orientation, pixel measures)
    - PerFrameFunctionalGroupsSequence (per-frame derivation & position)
    - FrameOfReferenceUID (spatial registration)
    """
    from pydicom.dataset import Dataset, FileDataset
    from pydicom.sequence import Sequence as DicomSequence
    from pydicom.uid import generate_uid, ExplicitVRLittleEndian

    now = datetime.datetime.now()
    sop_uid = generate_uid()
    series_uid = generate_uid()

    file_meta = pydicom.dataset.FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.66.4"
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.1"

    ds = FileDataset("seg.dcm", {}, file_meta=file_meta, preamble=b"\x00" * 128)
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.66.4"
    ds.SOPInstanceUID = sop_uid
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.ContentTime = now.strftime("%H%M%S")
    ds.Modality = "SEG"
    ds.Manufacturer = "TD|ai MONAI"
    model_name = model_config.name if model_config else "monai"
    ds.SeriesDescription = f"AI Segmentation - {model_name}"
    ds.ManufacturerModelName = model_name

    # Patient & study identifiers (must match source)
    ds.PatientName = getattr(source_ds, "PatientName", "")
    ds.PatientID = getattr(source_ds, "PatientID", "")
    ds.StudyInstanceUID = study_uid or getattr(source_ds, "StudyInstanceUID", generate_uid())
    ds.SeriesInstanceUID = series_uid
    ds.SeriesNumber = 900
    ds.InstanceNumber = 1
    ds.ContentLabel = "AI_SEGMENTATION"
    ds.ContentCreatorName = "TD|ai AI Platform"

    # Spatial reference (required for OHIF overlay alignment)
    ds.FrameOfReferenceUID = getattr(
        source_ds, "FrameOfReferenceUID", generate_uid()
    )

    ds.SegmentationType = "BINARY"

    required_frames = _estimate_required_source_frames(masks)
    source_images = _resolve_source_images(source_ds, required_frames)
    if not source_images:
        source_images = [source_ds]
    if len(source_images) > 1 and len(source_images) < required_frames:
        logger.warning(
            "Only %d source SOPs available for %d SEG frames; "
            "later frames will reference the final source SOP",
            len(source_images),
            required_frames,
        )

    # ── Referenced Series Sequence (CRITICAL for OHIF) ───────────────
    # OHIF uses this to link the SEG back to the source series/SOP
    source_series_uid = str(
        getattr(source_images[0], "SeriesInstanceUID", getattr(source_ds, "SeriesInstanceUID", ""))
    )
    source_sop_uid_default = str(getattr(source_ds, "SOPInstanceUID", ""))
    source_sop_class_default = str(getattr(source_ds, "SOPClassUID", ""))

    ref_series_item = Dataset()
    ref_series_item.SeriesInstanceUID = source_series_uid

    ref_instance_sequence = DicomSequence()
    seen_ref_sops: set[str] = set()
    for ref_ds in source_images:
        ref_sop_uid = str(getattr(ref_ds, "SOPInstanceUID", "")).strip()
        if not ref_sop_uid or ref_sop_uid in seen_ref_sops:
            continue
        ref_sop_item = Dataset()
        ref_sop_item.ReferencedSOPClassUID = str(
            getattr(ref_ds, "SOPClassUID", source_sop_class_default)
        )
        ref_sop_item.ReferencedSOPInstanceUID = ref_sop_uid
        ref_instance_sequence.append(ref_sop_item)
        seen_ref_sops.add(ref_sop_uid)

    if not ref_instance_sequence:
        ref_sop_item = Dataset()
        ref_sop_item.ReferencedSOPClassUID = source_sop_class_default
        ref_sop_item.ReferencedSOPInstanceUID = source_sop_uid_default
        ref_instance_sequence = DicomSequence([ref_sop_item])

    ref_series_item.ReferencedInstanceSequence = ref_instance_sequence
    ds.ReferencedSeriesSequence = DicomSequence([ref_series_item])

    # ── Pixel measures from source ───────────────────────────────────
    geometry_ds = source_images[0] if source_images else source_ds
    pixel_spacing = list(getattr(geometry_ds, "PixelSpacing", [1.0, 1.0]))
    slice_thickness = float(getattr(geometry_ds, "SliceThickness", 1.0))
    image_orientation = list(getattr(
        geometry_ds, "ImageOrientationPatient", [1, 0, 0, 0, 1, 0]
    ))
    image_position = list(getattr(
        geometry_ds, "ImagePositionPatient", [0.0, 0.0, 0.0]
    ))

    # ── Shared Functional Groups Sequence ────────────────────────────
    shared_fg = Dataset()

    pixel_measures = Dataset()
    pixel_measures.PixelSpacing = pixel_spacing
    pixel_measures.SliceThickness = slice_thickness
    pixel_measures.SpacingBetweenSlices = slice_thickness
    shared_fg.PixelMeasuresSequence = DicomSequence([pixel_measures])

    plane_orient = Dataset()
    plane_orient.ImageOrientationPatient = image_orientation
    shared_fg.PlaneOrientationSequence = DicomSequence([plane_orient])

    ds.SharedFunctionalGroupsSequence = DicomSequence([shared_fg])

    # ── Segment Sequence ─────────────────────────────────────────────
    segments = DicomSequence()
    all_frames = []
    frame_segment_numbers = []
    frame_source_refs: list[tuple[pydicom.Dataset, Optional[int]]] = []

    for idx, (label, mask) in enumerate(masks.items(), start=1):
        seg_item = Dataset()
        seg_item.SegmentNumber = idx
        seg_item.SegmentLabel = label
        seg_item.SegmentAlgorithmType = "AUTOMATIC"
        seg_item.SegmentAlgorithmName = f"MONAI {model_name}"

        snomed_code = SNOMED_CODES.get(label, "123037004")
        prop_type = Dataset()
        prop_type.CodeValue = snomed_code
        prop_type.CodingSchemeDesignator = "SCT"
        prop_type.CodeMeaning = label.replace("_", " ")
        seg_item.SegmentedPropertyTypeCodeSequence = DicomSequence([prop_type])

        prop_cat = Dataset()
        prop_cat.CodeValue = "49755003"
        prop_cat.CodingSchemeDesignator = "SCT"
        prop_cat.CodeMeaning = "Morphologically Abnormal Structure"
        seg_item.SegmentedPropertyCategoryCodeSequence = DicomSequence([prop_cat])

        # Recommended color for the overlay
        seg_item.RecommendedDisplayCIELabValue = _label_color(idx)

        segments.append(seg_item)

        binary = (mask > 0).astype(np.uint8)
        if binary.ndim == 2:
            binary = binary[np.newaxis, ...]
        single_multiframe_source = (
            len(source_images) == 1
            and int(getattr(source_images[0], "NumberOfFrames", 1) or 1) > 1
        )
        for frame_idx, frame in enumerate(binary):
            all_frames.append(frame)
            frame_segment_numbers.append(idx)
            if len(source_images) == 1:
                frame_number = (frame_idx + 1) if single_multiframe_source else None
                frame_source_refs.append((source_images[0], frame_number))
            else:
                src_idx = min(frame_idx, len(source_images) - 1)
                frame_source_refs.append((source_images[src_idx], None))

    ds.SegmentSequence = segments

    # ── Per-Frame Functional Groups Sequence ─────────────────────────
    pffg_sequence = DicomSequence()
    for frame_i, (_frame, seg_num, source_ref) in enumerate(
        zip(all_frames, frame_segment_numbers, frame_source_refs)
    ):
        ref_ds, ref_frame_number = source_ref
        pffg_item = Dataset()

        # Derivation image
        deriv = Dataset()
        deriv_src = Dataset()
        deriv_src.ReferencedSOPClassUID = str(
            getattr(ref_ds, "SOPClassUID", source_sop_class_default)
        )
        deriv_src.ReferencedSOPInstanceUID = str(
            getattr(ref_ds, "SOPInstanceUID", source_sop_uid_default)
        )
        if ref_frame_number is not None:
            deriv_src.ReferencedFrameNumber = ref_frame_number
        purpose = Dataset()
        purpose.CodeValue = "121322"
        purpose.CodingSchemeDesignator = "DCM"
        purpose.CodeMeaning = "Source image for image processing operation"
        deriv_src.PurposeOfReferenceCodeSequence = DicomSequence([purpose])
        deriv.SourceImageSequence = DicomSequence([deriv_src])
        deriv_code = Dataset()
        deriv_code.CodeValue = "113076"
        deriv_code.CodingSchemeDesignator = "DCM"
        deriv_code.CodeMeaning = "Segmentation"
        deriv.DerivationCodeSequence = DicomSequence([deriv_code])
        pffg_item.DerivationImageSequence = DicomSequence([deriv])

        # Frame content
        fc = Dataset()
        fc.DimensionIndexValues = [seg_num, frame_i + 1]
        pffg_item.FrameContentSequence = DicomSequence([fc])

        # Segment identification
        seg_id = Dataset()
        seg_id.ReferencedSegmentNumber = seg_num
        pffg_item.SegmentIdentificationSequence = DicomSequence([seg_id])

        # Plane position
        pos = Dataset()
        frame_position = getattr(ref_ds, "ImagePositionPatient", None)
        if frame_position is not None and len(frame_position) == 3:
            pos.ImagePositionPatient = [
                float(frame_position[0]),
                float(frame_position[1]),
                float(frame_position[2]),
            ]
        else:
            frame_offset = float(frame_i) * slice_thickness
            pos.ImagePositionPatient = [
                image_position[0],
                image_position[1],
                image_position[2] + frame_offset,
            ]
        pffg_item.PlanePositionSequence = DicomSequence([pos])

        pffg_sequence.append(pffg_item)

    ds.PerFrameFunctionalGroupsSequence = pffg_sequence

    # ── Pixel Data ───────────────────────────────────────────────────
    if all_frames:
        stacked = np.stack(all_frames)
        ds.NumberOfFrames = len(all_frames)
        first = all_frames[0]
        ds.Rows = first.shape[0]
        ds.Columns = first.shape[1]
        ds.BitsAllocated = 1
        ds.BitsStored = 1
        ds.HighBit = 0
        ds.PixelRepresentation = 0
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.LossyImageCompression = "00"
        ds.PixelData = np.packbits(stacked.flatten()).tobytes()

    buf = io.BytesIO()
    ds.save_as(buf)
    seg_bytes = buf.getvalue()

    logger.info(
        "Fallback DICOM SEG created: %d bytes, %d frames, %d segments, "
        "StudyUID=%s, RefSeriesUID=%s, RefSOPs=%d",
        len(seg_bytes),
        len(all_frames),
        len(list(masks.keys())),
        ds.StudyInstanceUID,
        source_series_uid,
        len(ref_instance_sequence),
    )
    return seg_bytes


def _label_color(idx: int) -> list[int]:
    """Return a CIELab color for segment overlay. Cycles through distinct colors."""
    palette = [
        [62662, 51677, 22795],   # red
        [36036, 51677, 41943],   # green
        [24903, 36036, 62662],   # blue
        [57054, 62662, 24903],   # yellow
        [40863, 24903, 62662],   # purple
        [62662, 40863, 24903],   # orange
    ]
    return palette[(idx - 1) % len(palette)]
