"""Export GradCAM maps as DICOM Parametric Map and Secondary Capture."""

from __future__ import annotations

import datetime as dt
import io
import logging
from pathlib import Path
from typing import Any

import matplotlib.cm as mpl_cm
import numpy as np
import pydicom
from PIL import Image
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

LOGGER = logging.getLogger("ai.export_parametric_map")
PM_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.30"
SC_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7"
SERIES_DESCRIPTION = "AI Heatmap - cxr_14class"


def _normalize_to_unit_range(image: np.ndarray) -> np.ndarray:
    """Normalize a single image to [0, 1] with min-max scaling."""
    image = image.astype(np.float32, copy=False)
    min_value = float(np.min(image))
    max_value = float(np.max(image))
    if max_value - min_value < 1e-8:
        return np.zeros_like(image, dtype=np.float32)
    return ((image - min_value) / (max_value - min_value)).astype(np.float32)


def _extract_grayscale_from_dicom(source_dcm: pydicom.Dataset) -> np.ndarray:
    """Extract a 2D grayscale float32 image from source DICOM."""
    if not hasattr(source_dcm, "PixelData"):
        raise ValueError("Source DICOM dataset does not contain PixelData.")

    transfer_syntax_uid = (
        str(getattr(getattr(source_dcm, "file_meta", None), "TransferSyntaxUID", ""))
        if hasattr(source_dcm, "file_meta")
        else ""
    )
    compressed_transfer_syntaxes = {
        "1.2.840.10008.1.2.4.50",
        "1.2.840.10008.1.2.4.51",
        "1.2.840.10008.1.2.4.57",
        "1.2.840.10008.1.2.4.70",
        "1.2.840.10008.1.2.4.80",
        "1.2.840.10008.1.2.4.81",
        "1.2.840.10008.1.2.4.90",
        "1.2.840.10008.1.2.4.91",
    }

    if transfer_syntax_uid in compressed_transfer_syntaxes:
        try:
            source_dcm.decompress()
        except Exception as exc:  # pragma: no cover - codec runtime dependent
            LOGGER.warning("Source DICOM decompress() failed: %s", exc)

    try:
        image = source_dcm.pixel_array.astype(np.float32)
    except Exception as exc:
        raise RuntimeError("Failed to decode source DICOM pixel data.") from exc

    if image.ndim == 3:
        if image.shape[-1] <= 4:
            image = image.mean(axis=-1)
        else:
            image = image[image.shape[0] // 2]

    if image.ndim != 2:
        raise AssertionError(f"Expected 2D source image, got shape {image.shape}.")

    if hasattr(source_dcm, "RescaleSlope") and hasattr(source_dcm, "RescaleIntercept"):
        image = image * float(getattr(source_dcm, "RescaleSlope", 1.0)) + float(
            getattr(source_dcm, "RescaleIntercept", 0.0)
        )

    return image.astype(np.float32)


def _resize_cam_if_needed(
    cam_normalized: np.ndarray,
    source_dcm: pydicom.Dataset,
) -> np.ndarray:
    """Resize CAM to source rows/columns if needed."""
    cam = np.asarray(cam_normalized, dtype=np.float32)
    if cam.ndim != 2:
        raise AssertionError(f"CAM must be 2D, got shape {cam.shape}.")

    source_rows = int(getattr(source_dcm, "Rows", cam.shape[0]))
    source_cols = int(getattr(source_dcm, "Columns", cam.shape[1]))
    target_size = (source_cols, source_rows)

    if cam.shape == (source_rows, source_cols):
        return np.clip(cam, 0.0, 1.0).astype(np.float32)

    LOGGER.warning(
        "CAM shape %s does not match source (%d, %d); resizing with bilinear interpolation.",
        cam.shape,
        source_rows,
        source_cols,
    )
    resized = Image.fromarray((np.clip(cam, 0.0, 1.0) * 255.0).astype(np.uint8)).resize(
        target_size,
        resample=Image.BILINEAR,
    )
    resized_cam = np.asarray(resized, dtype=np.float32) / 255.0
    return np.clip(resized_cam, 0.0, 1.0).astype(np.float32)


def _copy_patient_study_tags(target_ds: Dataset, source_ds: pydicom.Dataset) -> None:
    """Copy required patient/study identifiers from source DICOM."""
    required_fields = [
        "PatientID",
        "PatientName",
        "PatientBirthDate",
        "PatientSex",
        "StudyInstanceUID",
        "StudyDate",
        "StudyTime",
        "AccessionNumber",
        "FrameOfReferenceUID",
    ]
    for field_name in required_fields:
        if hasattr(source_ds, field_name):
            setattr(target_ds, field_name, getattr(source_ds, field_name))


def _ensure_required_linkage_tags(pm_ds: Dataset, source_ds: pydicom.Dataset) -> None:
    """Ensure PM dataset is linked to source study and frame of reference."""
    source_study_uid = str(getattr(source_ds, "StudyInstanceUID", "")).strip()
    source_for_uid = str(getattr(source_ds, "FrameOfReferenceUID", "")).strip()

    if not source_study_uid:
        raise ValueError("Source DICOM missing StudyInstanceUID; PM export cannot continue.")
    if not source_for_uid:
        raise ValueError("Source DICOM missing FrameOfReferenceUID; PM export cannot continue.")

    pm_ds.StudyInstanceUID = source_study_uid
    pm_ds.FrameOfReferenceUID = source_for_uid
    pm_ds.SeriesNumber = 900
    pm_ds.SeriesDescription = SERIES_DESCRIPTION
    pm_ds.InstanceNumber = 1
    pm_ds.Rows = int(getattr(source_ds, "Rows", pm_ds.Rows))
    pm_ds.Columns = int(getattr(source_ds, "Columns", pm_ds.Columns))


def _add_ai_private_tags(
    target_ds: Dataset,
    top_class_idx: int,
    confidence: float,
) -> None:
    """Add MONAI private tags for AI metadata."""
    try:
        target_ds.add_new((0x0099, 0x0010), "LO", "MONAI_AI")
        target_ds.add_new((0x0099, 0x1001), "LO", "cxr_14class")
        target_ds.add_new((0x0099, 0x1002), "LO", str(top_class_idx))
        target_ds.add_new((0x0099, 0x1003), "LO", f"{confidence:.4f}")

        try:
            import monai

            monai_version = monai.__version__
        except Exception:
            monai_version = "unknown"
        target_ds.add_new((0x0099, 0x1004), "LO", monai_version)
    except Exception as exc:
        LOGGER.warning("Failed to add one or more AI private tags: %s", exc)


def _build_pm_dataset_with_highdicom(
    cam_normalized: np.ndarray,
    source_dcm: pydicom.Dataset,
) -> Dataset:
    """Create Parametric Map dataset with highdicom."""
    try:
        import highdicom as hd
        from highdicom.pm import ParametricMap, RealWorldValueMapping
        from highdicom.sr.coding import CodedConcept
    except Exception as exc:
        raise RuntimeError(
            "highdicom is required for Parametric Map export. Install dependencies from ai/requirements.txt."
        ) from exc

    pixel_data = np.expand_dims(cam_normalized.astype(np.float32), axis=0)  # (1, H, W)
    if pixel_data.ndim != 3:
        raise AssertionError(f"Expected PM pixel data shape (1, H, W), got {pixel_data.shape}.")

    rwvm = RealWorldValueMapping(
        lut_label="Activation Score",
        lut_explanation="GradCAM class activation map, normalized 0.0-1.0",
        unit=CodedConcept(value="1", scheme_designator="UCUM", meaning="no units"),
        value_range=(0.0, 1.0),
        slope=1.0,
        intercept=0.0,
    )

    try:
        import monai

        monai_version = monai.__version__
    except Exception:
        monai_version = "unknown"

    pm = ParametricMap(
        source_images=[source_dcm],
        pixel_array=pixel_data,
        series_instance_uid=str(generate_uid()),
        series_number=900,
        sop_instance_uid=str(generate_uid()),
        instance_number=1,
        manufacturer="MONAI",
        manufacturer_model_name="cxr_14class",
        software_versions=monai_version,
        device_serial_number="MONAI-AI-001",
        contains_recognizable_visual_features=False,
        real_world_value_mappings=[rwvm],
        window_center=0.5,
        window_width=1.0,
        content_description="GradCAM class activation map, normalized 0.0-1.0",
        content_creator_name="MONAI AI Pipeline",
        content_label="AI_HEATMAP",
    )

    _copy_patient_study_tags(pm, source_dcm)
    _ensure_required_linkage_tags(pm, source_dcm)
    return pm


def _load_or_create_preview_image(
    output_dir: Path,
    source_dcm: pydicom.Dataset,
    cam_normalized: np.ndarray,
) -> np.ndarray:
    """Load existing preview PNG, or generate one from source image and CAM."""
    preview_path = output_dir / "heatmap_preview.png"
    if preview_path.exists():
        return np.asarray(Image.open(preview_path).convert("RGB"), dtype=np.uint8)

    source_gray = _extract_grayscale_from_dicom(source_dcm)
    source_unit = _normalize_to_unit_range(source_gray)
    base = (source_unit * 255.0).astype(np.uint8)
    base_rgb = np.stack([base, base, base], axis=-1).astype(np.float32)
    heat_rgb = (mpl_cm.jet(np.clip(cam_normalized, 0.0, 1.0))[..., :3] * 255.0).astype(np.float32)

    activation_mask = cam_normalized > 0.25
    blended = base_rgb.copy()
    overlay = np.clip(0.55 * base_rgb + 0.45 * heat_rgb, 0, 255)
    blended[activation_mask] = overlay[activation_mask]
    blended_uint8 = blended.astype(np.uint8)
    Image.fromarray(blended_uint8, mode="RGB").save(preview_path)
    LOGGER.info("Generated fallback heatmap preview at %s", preview_path.resolve())
    return blended_uint8


def _create_secondary_capture(
    source_dcm: pydicom.Dataset,
    preview_rgb: np.ndarray,
    output_path: Path,
) -> str:
    """Create Secondary Capture DICOM from blended preview RGB image."""
    now = dt.datetime.now()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SC_SOP_CLASS_UID
    file_meta.MediaStorageSOPInstanceUID = str(generate_uid())
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.8.498.999"

    sc = FileDataset(str(output_path), {}, file_meta=file_meta, preamble=b"\x00" * 128)
    sc.SOPClassUID = SC_SOP_CLASS_UID
    sc.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    sc.Modality = "OT"
    sc.SeriesInstanceUID = str(generate_uid())
    sc.SeriesNumber = 901
    sc.InstanceNumber = 1
    sc.SeriesDescription = f"{SERIES_DESCRIPTION} (SC)"
    sc.Manufacturer = "MONAI"
    sc.ContentDate = now.strftime("%Y%m%d")
    sc.ContentTime = now.strftime("%H%M%S")

    _copy_patient_study_tags(sc, source_dcm)
    sc.StudyInstanceUID = str(getattr(source_dcm, "StudyInstanceUID", generate_uid()))
    if hasattr(source_dcm, "FrameOfReferenceUID"):
        sc.FrameOfReferenceUID = source_dcm.FrameOfReferenceUID

    sc.Rows, sc.Columns = int(preview_rgb.shape[0]), int(preview_rgb.shape[1])
    sc.SamplesPerPixel = 3
    sc.PhotometricInterpretation = "RGB"
    sc.PlanarConfiguration = 0
    sc.BitsAllocated = 8
    sc.BitsStored = 8
    sc.HighBit = 7
    sc.PixelRepresentation = 0
    sc.PixelData = preview_rgb.astype(np.uint8).tobytes()
    sc.is_little_endian = True
    sc.is_implicit_VR = False

    pydicom.dcmwrite(str(output_path), sc, write_like_original=False)
    LOGGER.info("Saved Secondary Capture DICOM to %s", output_path.resolve())
    return str(output_path)


def export_parametric_map(
    cam_normalized: np.ndarray,
    top_class_idx: int,
    confidence: float,
    source_dcm: pydicom.Dataset,
    output_dir: str,
) -> tuple[str, str]:
    """Export CAM as DICOM Parametric Map and SC fallback.

    Returns:
        (pm_path, sc_path)
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    resized_cam = _resize_cam_if_needed(cam_normalized=cam_normalized, source_dcm=source_dcm)
    resized_cam = np.clip(resized_cam.astype(np.float32), 0.0, 1.0)
    LOGGER.info(
        "CAM for PM export: shape=%s dtype=%s min=%.6f max=%.6f",
        resized_cam.shape,
        resized_cam.dtype,
        float(np.min(resized_cam)),
        float(np.max(resized_cam)),
    )

    pm_ds = _build_pm_dataset_with_highdicom(resized_cam, source_dcm)
    _add_ai_private_tags(pm_ds, top_class_idx=top_class_idx, confidence=confidence)

    if str(getattr(pm_ds, "SOPClassUID", "")).strip() != PM_SOP_CLASS_UID:
        raise AssertionError(
            f"Unexpected PM SOPClassUID: {getattr(pm_ds, 'SOPClassUID', '')}; expected {PM_SOP_CLASS_UID}"
        )

    pm_path = output_path / "ai_heatmap_pm.dcm"
    pm_ds.save_as(str(pm_path), write_like_original=False)
    LOGGER.info("Saved Parametric Map DICOM to %s", pm_path.resolve())

    preview_rgb = _load_or_create_preview_image(output_path, source_dcm, resized_cam)
    sc_path = output_path / "ai_heatmap_sc.dcm"
    sc_path_str = _create_secondary_capture(source_dcm, preview_rgb, sc_path)

    return str(pm_path), sc_path_str


def _read_cam_from_npy(path: str) -> np.ndarray:
    """Read a CAM array from a .npy file for quick standalone exports."""
    with Path(path).open("rb") as handle:
        cam = np.load(handle).astype(np.float32)
    return cam


def _read_dcm(path: str) -> pydicom.Dataset:
    """Read a DICOM file as a pydicom dataset."""
    with Path(path).open("rb") as handle:
        return pydicom.dcmread(io.BytesIO(handle.read()))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export AI heatmap as DICOM PM and SC.")
    parser.add_argument("--cam", required=True, help="Path to CAM .npy file.")
    parser.add_argument("--source", required=True, help="Path to source DICOM file.")
    parser.add_argument("--output", default="./output", help="Output directory.")
    parser.add_argument("--class-idx", type=int, default=0, help="Top predicted class index.")
    parser.add_argument("--confidence", type=float, default=0.0, help="Top class confidence.")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    cli_args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, cli_args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    cam_array = _read_cam_from_npy(cli_args.cam)
    source_dataset = _read_dcm(cli_args.source)
    pm_file, sc_file = export_parametric_map(
        cam_normalized=cam_array,
        top_class_idx=cli_args.class_idx,
        confidence=cli_args.confidence,
        source_dcm=source_dataset,
        output_dir=cli_args.output,
    )
    LOGGER.info("Export complete: pm=%s sc=%s", pm_file, sc_file)
