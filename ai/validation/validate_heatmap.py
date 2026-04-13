"""Quality assurance checks for MONAI AI heatmap outputs."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pydicom

PM_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.30"
ACTIVATION_THRESHOLD = 0.25


def _default_logger() -> logging.Logger:
    """Return module logger."""
    return logging.getLogger("ai.validation")


def _load_source_dcm(
    source_dcm: pydicom.Dataset | None,
    source_dcm_path: str | None,
) -> pydicom.Dataset:
    """Load source DICOM dataset from object or file path."""
    if source_dcm is not None:
        return source_dcm
    if not source_dcm_path:
        raise ValueError("source_dcm or source_dcm_path is required for check 6.")
    return pydicom.dcmread(source_dcm_path)


def _check_value_range(cam: np.ndarray) -> tuple[bool, str]:
    """Check that CAM values are normalized to [0, 1]."""
    cam_min = float(np.min(cam))
    cam_max = float(np.max(cam))
    passed = cam_min >= 0.0 and cam_max <= 1.0
    if passed:
        return True, f"cam.min={cam_min:.6f}, cam.max={cam_max:.6f}"
    return (
        False,
        (
            f"cam.min={cam_min:.6f}, cam.max={cam_max:.6f}. "
            "Likely cause: CAM normalization is incorrect or post-processing wrote raw values."
        ),
    )


def _check_activation_focus(cam: np.ndarray, threshold: float) -> tuple[bool, str]:
    """Check that activation coverage is focused and not diffuse."""
    coverage = float(np.mean(cam > threshold))
    passed = coverage < 0.40
    if passed:
        return True, f"coverage_above_{threshold:.2f}={coverage * 100.0:.2f}%"
    return (
        False,
        (
            f"coverage_above_{threshold:.2f}={coverage * 100.0:.2f}% (>= 40%). "
            "Likely cause: wrong GradCAM layer, missing thresholding, or smoothing too aggressive."
        ),
    )


def _check_peak_activation(cam: np.ndarray) -> tuple[bool, str]:
    """Check that CAM has sufficiently strong activation peaks."""
    max_value = float(np.max(cam))
    passed = max_value >= 0.70
    if passed:
        return True, f"cam.max={max_value:.6f}"
    return (
        False,
        (
            f"cam.max={max_value:.6f} (< 0.70). "
            "Likely cause: weak model confidence or incorrect GradCAM target layer."
        ),
    )


def _check_spatial_distribution(cam: np.ndarray) -> tuple[bool, str]:
    """Check activation center-of-mass is not concentrated in corners."""
    h, w = cam.shape
    total_activation = float(np.sum(cam))
    if total_activation <= 1e-8:
        return (
            False,
            "Total activation is near zero. Likely cause: over-thresholding or failed CAM generation.",
        )

    yy, xx = np.indices(cam.shape)
    com_y = float(np.sum(yy * cam) / total_activation)
    com_x = float(np.sum(xx * cam) / total_activation)

    y_low, y_high = 0.15 * h, 0.85 * h
    x_low, x_high = 0.15 * w, 0.85 * w
    passed = (y_low <= com_y <= y_high) and (x_low <= com_x <= x_high)
    if passed:
        return True, f"center_of_mass=(y={com_y:.2f}, x={com_x:.2f})"
    return (
        False,
        (
            f"center_of_mass=(y={com_y:.2f}, x={com_x:.2f}) outside center 70% bounds. "
            "Likely cause: bad resize/alignment or model focusing on image borders."
        ),
    )


def _check_finite_values(cam: np.ndarray) -> tuple[bool, str]:
    """Check CAM contains no NaN or Inf values."""
    finite = bool(np.isfinite(cam).all())
    if finite:
        return True, "All CAM values are finite."
    return (
        False,
        "CAM contains NaN/Inf. Likely cause: divide-by-zero or unstable normalization.",
    )


def _check_pm_tags(pm_path: str, source_ds: pydicom.Dataset) -> tuple[bool, str]:
    """Check required PM DICOM tags and linkage to source image."""
    pm_ds = pydicom.dcmread(pm_path)
    errors: list[str] = []

    sop_uid = str(getattr(pm_ds, "SOPClassUID", ""))
    if sop_uid != PM_SOP_CLASS_UID:
        errors.append(f"SOPClassUID={sop_uid} (expected {PM_SOP_CLASS_UID})")

    pm_study_uid = str(getattr(pm_ds, "StudyInstanceUID", ""))
    src_study_uid = str(getattr(source_ds, "StudyInstanceUID", ""))
    if pm_study_uid != src_study_uid:
        errors.append(f"StudyInstanceUID mismatch (pm={pm_study_uid}, source={src_study_uid})")

    pm_for_uid = str(getattr(pm_ds, "FrameOfReferenceUID", ""))
    src_for_uid = str(getattr(source_ds, "FrameOfReferenceUID", ""))
    if pm_for_uid != src_for_uid:
        errors.append(f"FrameOfReferenceUID mismatch (pm={pm_for_uid}, source={src_for_uid})")

    pm_series_number = int(getattr(pm_ds, "SeriesNumber", -1))
    if pm_series_number != 900:
        errors.append(f"SeriesNumber={pm_series_number} (expected 900)")

    if pm_ds.get((0x0099, 0x1001)) is None:
        errors.append("Missing private tag (0099,1001) model name")

    if errors:
        return (
            False,
            " | ".join(errors)
            + ". Likely cause: PM export is not copying linkage metadata or private tags correctly.",
        )
    return True, "PM SOPClassUID/linkage tags/private tags validated."


def validate_heatmap_outputs(
    cam_path: str,
    pm_path: str,
    source_dcm_path: str | None = None,
    source_dcm: pydicom.Dataset | None = None,
    threshold: float = ACTIVATION_THRESHOLD,
    emit_console: bool = False,
    log: logging.Logger | None = None,
) -> tuple[bool, list[dict[str, Any]]]:
    """Run all QA checks and return pass/fail plus detailed results."""
    logger = log or _default_logger()
    cam = np.load(cam_path).astype(np.float32)
    if cam.ndim != 2:
        raise AssertionError(f"Expected 2D CAM array, got shape {cam.shape}.")

    source_ds = _load_source_dcm(source_dcm=source_dcm, source_dcm_path=source_dcm_path)

    checks: list[tuple[str, str, tuple[bool, str]]] = [
        ("CHECK 1", "Value range", _check_value_range(cam)),
        (
            "CHECK 2",
            "Activation focus (heatmap not covering whole image)",
            _check_activation_focus(cam, threshold),
        ),
        ("CHECK 3", "Peak activation strength", _check_peak_activation(cam)),
        ("CHECK 4", "Spatial distribution", _check_spatial_distribution(cam)),
        ("CHECK 5", "No NaN or Inf values", _check_finite_values(cam)),
        ("CHECK 6", "Output DICOM tags", _check_pm_tags(pm_path, source_ds)),
    ]

    results: list[dict[str, Any]] = []
    for check_id, name, (passed, detail) in checks:
        status = "PASS" if passed else "FAIL"
        logger.info("%s — %s: %s (%s)", check_id, name, status, detail)
        result = {
            "check_id": check_id,
            "name": name,
            "passed": passed,
            "detail": detail,
        }
        results.append(result)

        if emit_console:
            print(f"{check_id} — {name}")
            print(f"  {status}: {detail}")

    all_passed = all(item["passed"] for item in results)
    return all_passed, results


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build CLI argument parser for QA script."""
    parser = argparse.ArgumentParser(description="Validate AI heatmap output quality.")
    parser.add_argument("--cam", default="./output/cam_raw.npy", help="Path to cam_raw.npy")
    parser.add_argument("--pm", default="./output/ai_heatmap_pm.dcm", help="Path to PM DICOM")
    parser.add_argument("--source", required=True, help="Path to source DICOM")
    parser.add_argument(
        "--threshold",
        type=float,
        default=ACTIVATION_THRESHOLD,
        help="Activation threshold for focus check",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level",
    )
    return parser


def main() -> int:
    """CLI entry point."""
    args = _build_arg_parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    passed, _ = validate_heatmap_outputs(
        cam_path=args.cam,
        pm_path=args.pm,
        source_dcm_path=args.source,
        threshold=args.threshold,
        emit_console=True,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
