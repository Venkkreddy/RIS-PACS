"""
Post-processing pipelines: connected component analysis, hole filling,
morphological cleanup, and output formatting for segmentation, detection,
and classification models.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import torch

from config import ModelConfig, ModelType, PostProcessConfig

logger = logging.getLogger("monai-server.postprocess")


def segmentation_postprocess(
    prediction: torch.Tensor | np.ndarray,
    config: ModelConfig,
    spacing: tuple[float, ...] = (1.0, 1.0, 1.0),
) -> dict:
    """Full post-processing for segmentation outputs.

    Returns:
        {
            "masks": {label: np.ndarray},
            "volumes_ml": {label: float},
            "bounding_boxes": {label: {x1,y1,z1,x2,y2,z2}},
            "confidence_scores": {label: float},
        }
    """
    from scipy import ndimage

    if isinstance(prediction, torch.Tensor):
        prediction = prediction.detach().cpu().numpy()

    pred = prediction.astype(np.float32)
    class_probs: np.ndarray | None = None

    # Supports both 2D ([C,H,W]) and 3D ([C,D,H,W]) segmentation logits.
    if pred.ndim >= 3 and pred.shape[0] > 1:
        class_probs = _softmax_channels(pred)
        seg = class_probs.argmax(axis=0).astype(np.int32)
    elif pred.ndim >= 3 and pred.shape[0] == 1:
        fg = pred[0]
        # Handle either logits or probabilities from the model head.
        if fg.min() < 0.0 or fg.max() > 1.0:
            fg = _sigmoid(fg)
        class_probs = np.stack([1.0 - fg, fg], axis=0)
        seg = (fg >= 0.5).astype(np.int32)
    else:
        seg = pred.astype(np.int32)

    pp = config.postprocess or PostProcessConfig()
    results = {
        "masks": {},
        "volumes_ml": {},
        "bounding_boxes": {},
        "confidence_scores": {},
        "probability_maps": {},
    }

    voxel_vol_ml = float(np.prod(spacing)) / 1000.0

    for idx, label in enumerate(config.labels, start=1):
        mask = (seg == idx).astype(np.uint8)

        if mask.sum() == 0:
            continue

        if pp.keep_largest_cc:
            mask = _keep_largest_cc(mask)

        if pp.fill_holes and mask.ndim == 3:
            mask = ndimage.binary_fill_holes(mask).astype(np.uint8)

        if pp.morphological_cleanup:
            mask = _morphological_cleanup(mask, pp.closing_radius)

        if mask.sum() < pp.min_component_size:
            continue

        results["masks"][label] = mask
        results["volumes_ml"][label] = round(float(mask.sum()) * voxel_vol_ml, 2)
        results["bounding_boxes"][label] = _compute_bbox(mask, spacing)

        if class_probs is not None and idx < class_probs.shape[0]:
            prob_map = np.clip(class_probs[idx].astype(np.float32), 0.0, 1.0)
            results["probability_maps"][label] = prob_map
            region_probs = prob_map[mask > 0]
            results["confidence_scores"][label] = round(float(region_probs.mean()), 4)
        else:
            results["confidence_scores"][label] = 1.0

    return results


def detection_postprocess(
    prediction: torch.Tensor | np.ndarray,
    config: ModelConfig,
    threshold: float | None = None,
) -> list[dict]:
    """Post-processing for detection outputs — NMS and confidence filtering."""
    if isinstance(prediction, torch.Tensor):
        prediction = prediction.detach().cpu().numpy()

    thresh = threshold or config.confidence_threshold

    if prediction.ndim >= 3:
        heatmap = prediction[0] if prediction.ndim == 3 else prediction
        coords = np.argwhere(heatmap > thresh)
        findings = []
        for coord in coords:
            conf = float(heatmap[tuple(coord)])
            findings.append({
                "label": config.labels[0] if config.labels else "Finding",
                "confidence": round(conf, 4),
                "location_voxel": coord.tolist(),
            })
        findings.sort(key=lambda f: f["confidence"], reverse=True)
        return findings[:50]

    return []


def classification_postprocess(
    logits: torch.Tensor | np.ndarray,
    config: ModelConfig,
    threshold: float | None = None,
) -> list[dict]:
    """Post-processing for classification outputs — sigmoid/softmax and thresholding."""
    if isinstance(logits, torch.Tensor):
        logits = logits.detach().cpu().numpy()

    logits = logits.squeeze()

    if config.model_type == ModelType.CLASSIFICATION and len(config.labels) > 2:
        probs = _sigmoid(logits)
    else:
        probs = _softmax_1d(logits)

    thresh = threshold or config.confidence_threshold
    findings = []
    for i, (label, prob) in enumerate(zip(config.labels, probs)):
        prob_val = float(prob)
        if prob_val >= thresh:
            findings.append({
                "label": label,
                "confidence": round(prob_val, 4),
                "description": _severity_text(prob_val, label),
            })

    findings.sort(key=lambda f: f["confidence"], reverse=True)
    return findings


# ── Internal helpers ─────────────────────────────────────────────────

def _softmax_channels(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=0, keepdims=True))
    denom = e.sum(axis=0, keepdims=True)
    denom = np.where(denom == 0, 1.0, denom)
    return e / denom


def _softmax_1d(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def _sigmoid(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, -60.0, 60.0)
    return 1.0 / (1.0 + np.exp(-x))


def _keep_largest_cc(mask: np.ndarray) -> np.ndarray:
    from scipy import ndimage
    labeled, num = ndimage.label(mask)
    if num <= 1:
        return mask
    sizes = ndimage.sum(mask, labeled, range(1, num + 1))
    largest = int(np.argmax(sizes)) + 1
    return (labeled == largest).astype(np.uint8)


def _morphological_cleanup(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    from scipy import ndimage
    struct = ndimage.generate_binary_structure(mask.ndim, 1)
    closed = ndimage.binary_closing(mask, structure=struct, iterations=radius)
    opened = ndimage.binary_opening(closed, structure=struct, iterations=1)
    return opened.astype(np.uint8)


def _compute_bbox(
    mask: np.ndarray, spacing: tuple[float, ...] = (1.0, 1.0, 1.0)
) -> dict:
    coords = np.argwhere(mask > 0)
    if len(coords) == 0:
        return {}
    mins = coords.min(axis=0)
    maxs = coords.max(axis=0)

    if mask.ndim == 3:
        return {
            "x1": int(mins[2]), "y1": int(mins[1]), "z1": int(mins[0]),
            "x2": int(maxs[2]), "y2": int(maxs[1]), "z2": int(maxs[0]),
            "width_mm": round(float(maxs[2] - mins[2]) * spacing[2], 1),
            "height_mm": round(float(maxs[1] - mins[1]) * spacing[1], 1),
            "depth_mm": round(float(maxs[0] - mins[0]) * spacing[0], 1),
        }
    else:
        return {
            "x1": int(mins[1]), "y1": int(mins[0]),
            "x2": int(maxs[1]), "y2": int(maxs[0]),
            "width_mm": round(float(maxs[1] - mins[1]) * spacing[-1], 1),
            "height_mm": round(float(maxs[0] - mins[0]) * spacing[-2], 1),
        }


def _severity_text(prob: float, label: str) -> str:
    if prob >= 0.75:
        return f"High probability of {label.lower().replace('_', ' ')}"
    elif prob >= 0.5:
        return f"Moderate probability of {label.lower().replace('_', ' ')}"
    else:
        return f"Low probability of {label.lower().replace('_', ' ')}"
