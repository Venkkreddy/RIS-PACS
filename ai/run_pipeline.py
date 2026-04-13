"""Run end-to-end MONAI heatmap generation, export, upload, and validation."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pydicom

from export.export_parametric_map import export_parametric_map
from inference.generate_heatmap import generate_heatmap, infer_top_class_confidence
from orthanc.upload_to_orthanc import upload_to_orthanc
from validation.validate_heatmap import validate_heatmap_outputs

LOGGER = logging.getLogger("ai.run_pipeline")
ACTIVATION_THRESHOLD = 0.25

CHEST_XRAY_LABELS = [
    "Atelectasis",
    "Cardiomegaly",
    "Effusion",
    "Infiltration",
    "Mass",
    "Nodule",
    "Pneumonia",
    "Pneumothorax",
    "Consolidation",
    "Edema",
    "Emphysema",
    "Fibrosis",
    "Pleural_Thickening",
    "Hernia",
]


def _resolve_class_name(class_idx: int) -> str:
    """Map class index to a human-readable class label."""
    if 0 <= class_idx < len(CHEST_XRAY_LABELS):
        return CHEST_XRAY_LABELS[class_idx]
    return f"Class_{class_idx}"


def _read_confidence_from_metadata(output_dir: Path) -> float | None:
    """Read confidence from Task 1 metadata if available."""
    metadata_path = output_dir / "heatmap_metadata.json"
    if not metadata_path.exists():
        return None
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        confidence = payload.get("confidence")
        if isinstance(confidence, (float, int)):
            return float(confidence)
    except Exception as exc:
        LOGGER.warning("Failed to parse heatmap metadata: %s", exc)
    return None


def _read_sop_instance_uid(dicom_path: str) -> str:
    """Read SOPInstanceUID from a DICOM file."""
    dataset = pydicom.dcmread(dicom_path)
    return str(getattr(dataset, "SOPInstanceUID", ""))


def _compute_cam_coverage(cam: np.ndarray, threshold: float = ACTIVATION_THRESHOLD) -> float:
    """Compute percentage of pixels above activation threshold."""
    active_pixels = float(np.sum(cam > threshold))
    total_pixels = float(cam.size)
    if total_pixels <= 0:
        return 0.0
    return (active_pixels / total_pixels) * 100.0


def run_pipeline(
    dicom_path: str,
    model_path: str,
    orthanc_url: str,
    output_dir: str,
    validate: bool,
) -> int:
    """Run all AI heatmap pipeline steps in sequence.

    Returns:
        Process-style exit code (0 on success, 1 on validation failure).
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    LOGGER.info("Pipeline output directory: %s", output_path.resolve())

    # Step 1: Heatmap generation
    cam_normalized, top_class_idx, source_dcm = generate_heatmap(
        dicom_path=dicom_path,
        model_path=model_path,
        output_dir=str(output_path),
    )
    class_name = _resolve_class_name(top_class_idx)
    confidence = _read_confidence_from_metadata(output_path)
    if confidence is None:
        inferred_idx, inferred_conf = infer_top_class_confidence(source_dcm, model_path=model_path)
        confidence = inferred_conf
        if inferred_idx != top_class_idx:
            LOGGER.warning(
                "Top-class mismatch between metadata and fallback inference: task1=%d fallback=%d",
                top_class_idx,
                inferred_idx,
            )

    # Step 2: DICOM export
    pm_path, sc_path = export_parametric_map(
        cam_normalized=cam_normalized,
        top_class_idx=top_class_idx,
        confidence=confidence,
        source_dcm=source_dcm,
        output_dir=str(output_path),
    )

    pm_sop_uid = _read_sop_instance_uid(pm_path)
    sc_sop_uid = _read_sop_instance_uid(sc_path)

    # Step 3: Orthanc upload
    orthanc_ids = upload_to_orthanc(
        pm_path=pm_path,
        sc_path=sc_path,
        source_dcm=source_dcm,
        orthanc_url=orthanc_url,
    )

    # Step 4: Optional QA validation
    qa_passed = True
    qa_report: list[dict[str, Any]] = []
    if validate:
        qa_passed, qa_report = validate_heatmap_outputs(
            cam_path=str(output_path / "cam_raw.npy"),
            pm_path=pm_path,
            source_dcm_path=dicom_path,
            source_dcm=source_dcm,
            log=LOGGER,
        )
        if not qa_passed:
            LOGGER.error("QA checks failed. Details: %s", qa_report)

    coverage = _compute_cam_coverage(cam_normalized, threshold=ACTIVATION_THRESHOLD)
    cam_shape = tuple(int(v) for v in cam_normalized.shape)
    cam_max = float(np.max(cam_normalized))

    print(
        f"✅ Inference     | Top class: {class_name} (idx {top_class_idx}) | Confidence: {confidence:.4f}"
    )
    print(
        f"✅ CAM generated | Shape: {cam_shape} | Max act: {cam_max:.2f} | Coverage: {coverage:.1f}%"
    )
    print(f"✅ PM exported   | SOPInstanceUID: {pm_sop_uid}")
    print(f"✅ SC exported   | SOPInstanceUID: {sc_sop_uid}")
    print(f"✅ Orthanc PM    | Instance ID: {orthanc_ids['orthanc_pm_id']}")
    print(f"✅ Orthanc SC    | Instance ID: {orthanc_ids['orthanc_sc_id']}")
    if validate:
        qa_status = "All checks green" if qa_passed else "One or more checks failed"
        qa_icon = "✅" if qa_passed else "❌"
        print(f"{qa_icon} QA passed     | {qa_status}")

    return 0 if (not validate or qa_passed) else 1


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build argparse parser for pipeline CLI."""
    parser = argparse.ArgumentParser(description="Run end-to-end AI heatmap pipeline.")
    parser.add_argument("--dicom", required=True, help="Source DICOM path.")
    parser.add_argument("--model", required=True, help="Model weights path.")
    parser.add_argument("--orthanc-url", default="http://localhost:8042", help="Orthanc base URL.")
    parser.add_argument("--output", default="./output", help="Output directory.")
    parser.add_argument("--validate", action="store_true", help="Run QA validation checks.")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level.",
    )
    return parser


def main() -> int:
    """CLI entry point."""
    parser = _build_arg_parser()
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    return run_pipeline(
        dicom_path=args.dicom,
        model_path=args.model,
        orthanc_url=args.orthanc_url,
        output_dir=args.output,
        validate=args.validate,
    )


if __name__ == "__main__":
    raise SystemExit(main())
