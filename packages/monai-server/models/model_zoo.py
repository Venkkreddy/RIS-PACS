"""
MONAI Model Zoo integration — download pre-trained bundles and convert
weights into the format expected by our model factories.

Also provides TorchXRayVision-based weight loading for CXR models when
the MONAI Model Zoo does not carry a suitable bundle.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

from config import MODELS_DIR

logger = logging.getLogger("monai-server.model_zoo")

_TORCHVISION_NMS_SHIM_LIB = None

_XRV_LABELS = [
    "Atelectasis",
    "Consolidation",
    "Infiltration",
    "Pneumothorax",
    "Edema",
    "Emphysema",
    "Fibrosis",
    "Effusion",
    "Pneumonia",
    "Pleural_Thickening",
    "Cardiomegaly",
    "Nodule",
    "Mass",
    "Hernia",
    "Lung Lesion",
    "Fracture",
    "Lung Opacity",
    "Enlarged Cardiomediastinum",
]

_CXR_14CLASS_TARGET_LABELS = [
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

_CXR_14CLASS_TARGET_INDICES = [
    _XRV_LABELS.index(label) for label in _CXR_14CLASS_TARGET_LABELS
]


def _ensure_torchvision_nms_stub() -> None:
    """Work around torchvision nms registration failures in CPU-only containers."""
    import torch

    global _TORCHVISION_NMS_SHIM_LIB
    if _TORCHVISION_NMS_SHIM_LIB is not None:
        return

    try:
        lib = torch.library.Library("torchvision", "DEF")
        lib.define("nms(Tensor dets, Tensor scores, float iou_threshold) -> Tensor")
        _TORCHVISION_NMS_SHIM_LIB = lib
        logger.warning("Applied torchvision::nms operator shim for compatibility")
    except Exception:
        # Operator may already exist or torchvision may already be healthy.
        pass


def _remap_densenet_feature_key(key: str) -> str:
    return re.sub(
        r"(features\.denseblock\d+\.denselayer\d+)\.",
        r"\1.layers.",
        key,
    )


def _convert_xrv_to_monai_cxr14_state_dict(state: dict) -> dict:
    """Convert TorchXRayVision DenseNet weights to MONAI DenseNet121 format."""
    import torch

    converted: dict[str, torch.Tensor] = {}
    class_index = torch.tensor(_CXR_14CLASS_TARGET_INDICES, dtype=torch.long)

    for key, value in state.items():
        if key == "op_threshs":
            continue

        mapped_key = _remap_densenet_feature_key(key)
        if key == "classifier.weight":
            mapped_key = "class_layers.out.weight"
            value = value.index_select(0, class_index)
        elif key == "classifier.bias":
            mapped_key = "class_layers.out.bias"
            value = value.index_select(0, class_index)

        converted[mapped_key] = value

    return converted


def _convert_torchvision_to_monai_densenet_state_dict(state: dict) -> dict:
    """Convert torchvision DenseNet backbone keys to MONAI DenseNet121 format."""
    import torch

    converted: dict[str, torch.Tensor] = {}
    for key, value in state.items():
        if key.startswith("classifier."):
            continue
        converted[_remap_densenet_feature_key(key)] = value
    return converted


def download_bundle_weights(
    bundle_name: str,
    target_model_name: str,
    version: str | None = None,
    source: str = "github",
) -> Path:
    """Download a MONAI Model Zoo bundle and extract the model weights.

    Uses monai.bundle.download to fetch from the official Model Zoo.
    Returns the path to the downloaded .pt file.
    """
    from monai.bundle import download

    bundle_dir = MODELS_DIR / "bundles" / bundle_name
    weight_path = MODELS_DIR / f"{target_model_name}.pt"

    if weight_path.exists():
        logger.info("Weights already present: %s", weight_path)
        return weight_path

    resolved_version = None if version in (None, "", "latest") else version
    logger.info(
        "Downloading MONAI bundle: %s (version=%s)",
        bundle_name,
        resolved_version or "auto",
    )

    try:
        download(
            name=bundle_name,
            version=resolved_version,
            bundle_dir=str(bundle_dir.parent),
            source=source,
        )

        candidate_paths = [
            bundle_dir / "models" / "model.pt",
            bundle_dir / "models" / "model_weights.pt",
            bundle_dir / "models" / "best_model.pt",
            bundle_dir / "model.pt",
        ]

        for p in candidate_paths:
            if p.exists():
                shutil.copy2(p, weight_path)
                logger.info("Extracted weights → %s", weight_path)
                return weight_path

        logger.warning(
            "Bundle downloaded but no standard weight file found in %s. "
            "Searched: %s",
            bundle_dir,
            [str(p) for p in candidate_paths],
        )

    except Exception as e:
        logger.error("Failed to download bundle '%s': %s", bundle_name, e)

    return weight_path


def download_torchxrayvision_weights(target_model_name: str) -> Path:
    """Download DenseNet121 CheXNet weights from TorchXRayVision (free, MIT).

    TorchXRayVision provides pre-trained DenseNet models on the
    NIH ChestX-ray14 dataset — the standard CheXNet weights.
    """
    import torch

    weight_path = MODELS_DIR / f"{target_model_name}.pt"
    if weight_path.exists():
        logger.info("CXR weights already present: %s", weight_path)
        return weight_path

    if target_model_name != "cxr_14class":
        logger.info(
            "No direct TorchXRayVision checkpoint mapping for %s; "
            "skipping pretrained bootstrap",
            target_model_name,
        )
        return weight_path

    logger.info("Downloading TorchXRayVision DenseNet121 weights for %s …", target_model_name)
    try:
        _ensure_torchvision_nms_stub()
        import torchxrayvision as xrv
        xrv_model = xrv.models.DenseNet(weights="densenet121-res224-nih")
        converted_state = _convert_xrv_to_monai_cxr14_state_dict(xrv_model.state_dict())
        torch.save(converted_state, weight_path)
        logger.info("TorchXRayVision CXR14 weights converted and saved → %s", weight_path)
        return weight_path
    except Exception as e:
        logger.warning(
            "TorchXRayVision weights unavailable (%s) — "
            "falling back to ImageNet DenseNet121 backbone",
            e,
        )

    try:
        _ensure_torchvision_nms_stub()
        from torchvision.models import densenet121, DenseNet121_Weights
        tv_model = densenet121(weights=DenseNet121_Weights.IMAGENET1K_V1)
        converted_backbone = _convert_torchvision_to_monai_densenet_state_dict(
            tv_model.state_dict()
        )
        torch.save(converted_backbone, weight_path)
        logger.info("ImageNet DenseNet121 backbone saved → %s", weight_path)
    except Exception as e:
        logger.error("Failed to download any CXR weights: %s", e)

    return weight_path


BUNDLE_MAP: dict[str, str] = {
    "ct_lung_nodule": "lung_nodule_ct_detection",
    "ct_multi_organ_seg": "wholeBody_ct_segmentation",
    "ct_brain_hemorrhage": "wholeBrainSeg_Large_UNEST_segmentation",
    "ct_vertebral_fracture": "vertebra_localization_ct",
    "mri_brain_tumor": "brats_mri_segmentation",
    "mri_prostate_seg": "prostate_mri_anatomy",
}

CXR_WEIGHT_MODELS = ["cxr_14class"]


def download_all_bundles() -> dict[str, Path]:
    """Download all mapped bundles + CXR weights. Returns {model_name: weight_path}."""
    results: dict[str, Path] = {}

    for model_name in CXR_WEIGHT_MODELS:
        try:
            p = download_torchxrayvision_weights(model_name)
            results[model_name] = p
        except Exception as e:
            logger.error("CXR weight download failed for %s: %s", model_name, e)

    for model_name, bundle_name in BUNDLE_MAP.items():
        try:
            p = download_bundle_weights(bundle_name, model_name)
            results[model_name] = p
        except Exception as e:
            logger.error("Bundle download failed for %s: %s", model_name, e)

    return results


def ensure_critical_weights() -> dict[str, Path]:
    """Download only the most-used models (fast startup). Called at boot."""
    results: dict[str, Path] = {}
    critical = ["cxr_14class", "ct_multi_organ_seg", "mri_brain_tumor"]

    for name in critical:
        weight_path = MODELS_DIR / f"{name}.pt"
        if weight_path.exists():
            results[name] = weight_path
            continue
        if name in CXR_WEIGHT_MODELS:
            try:
                results[name] = download_torchxrayvision_weights(name)
            except Exception as e:
                logger.error("Critical CXR weight download failed for %s: %s", name, e)
        elif name in BUNDLE_MAP:
            try:
                results[name] = download_bundle_weights(BUNDLE_MAP[name], name)
            except Exception as e:
                logger.error("Critical bundle download failed for %s: %s", name, e)

    return results
