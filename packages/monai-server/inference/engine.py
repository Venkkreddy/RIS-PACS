"""
Core inference engine — handles single-image, sliding-window, and
batched inference across all model types.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import numpy as np
import torch

from monai.inferers import SlidingWindowInferer

from config import DEVICE, ModelConfig, ModelType
from models.registry import load_model, get_model_config
from transforms import get_inference_transforms
from transforms.postprocessing import (
    segmentation_postprocess,
    detection_postprocess,
    classification_postprocess,
)

logger = logging.getLogger("monai-server.engine")


def _prepare_model_input(
    tensor: torch.Tensor,
    config: ModelConfig,
) -> torch.Tensor:
    """Normalize tensor rank/channel layout to match the model contract."""
    if config.spatial_dims == 3 and tensor.ndim == 2:
        # Single-slice studies can arrive as HxW; promote to HxWx1 volume.
        tensor = tensor.unsqueeze(-1)

    if tensor.ndim == config.spatial_dims:
        tensor = tensor.unsqueeze(0)
    if tensor.ndim == config.spatial_dims + 1:
        tensor = tensor.unsqueeze(0)

    expected_rank = config.spatial_dims + 2
    if tensor.ndim != expected_rank:
        raise ValueError(
            f"Unsupported input rank for {config.name}: got ndim={tensor.ndim}, "
            f"expected {expected_rank}"
        )

    current_channels = int(tensor.shape[1])
    target_channels = int(config.in_channels)
    if current_channels != target_channels:
        if current_channels == 1 and target_channels > 1:
            repeat = [1] * tensor.ndim
            repeat[1] = target_channels
            tensor = tensor.repeat(*repeat)
            logger.warning(
                "Expanded channel dimension for %s: 1 -> %d",
                config.name,
                target_channels,
            )
        elif current_channels > target_channels:
            tensor = tensor[:, :target_channels, ...]
            logger.warning(
                "Truncated channel dimension for %s: %d -> %d",
                config.name,
                current_channels,
                target_channels,
            )
        else:
            repeat_factor = (target_channels + current_channels - 1) // current_channels
            repeat = [1] * tensor.ndim
            repeat[1] = repeat_factor
            tensor = tensor.repeat(*repeat)[:, :target_channels, ...]
            logger.warning(
                "Tiled channel dimension for %s: %d -> %d",
                config.name,
                current_channels,
                target_channels,
            )

    return tensor


def run_inference(
    model_name: str,
    image_data: np.ndarray | torch.Tensor,
    spacing: tuple[float, ...] = (1.0, 1.0, 1.0),
    extra_context: Optional[dict] = None,
) -> dict:
    """Unified inference entry point — routes to the right strategy
    based on model type and configuration.

    Args:
        model_name: registered model name
        image_data: preprocessed image array/tensor
        spacing: voxel spacing for volume calculations
        extra_context: any extra info (DICOM tags, patient data)

    Returns:
        Structured result dict with findings, masks, measurements, etc.
    """
    start = time.time()
    config = get_model_config(model_name)
    if config is None:
        raise ValueError(f"Unknown model: {model_name}")

    model = load_model(model_name)

    if isinstance(image_data, np.ndarray):
        tensor = torch.from_numpy(image_data).float()
    else:
        tensor = image_data.float()

    tensor = _prepare_model_input(tensor, config)

    tensor = tensor.to(DEVICE)

    if config.model_type == ModelType.SEGMENTATION and config.sliding_window:
        prediction = run_sliding_window_inference(model, tensor, config)
    else:
        with torch.no_grad():
            prediction = model(tensor)

    result = _dispatch_postprocess(prediction, config, spacing)

    elapsed = time.time() - start
    result["model_name"] = model_name
    result["processing_time_ms"] = round(elapsed * 1000, 2)
    result["device"] = str(DEVICE)

    logger.info(
        "Inference complete: model=%s  type=%s  time=%.0fms",
        model_name, config.model_type.value, elapsed * 1000,
    )
    return result


def run_sliding_window_inference(
    model: torch.nn.Module,
    tensor: torch.Tensor,
    config: ModelConfig,
) -> torch.Tensor:
    """Sliding window inference with configurable ROI, batch size, and overlap."""
    sw = config.sliding_window
    inferer = SlidingWindowInferer(
        roi_size=sw.roi_size,
        sw_batch_size=sw.sw_batch_size,
        overlap=sw.overlap,
        mode=sw.mode,
        progress=False,
    )

    with torch.no_grad():
        prediction = inferer(tensor, model)

    return prediction


def _dispatch_postprocess(
    prediction: torch.Tensor,
    config: ModelConfig,
    spacing: tuple[float, ...],
) -> dict:
    """Route output through the appropriate post-processing pipeline."""
    if config.model_type == ModelType.SEGMENTATION:
        pp = segmentation_postprocess(prediction.squeeze(0), config, spacing)
        return {
            "type": "segmentation",
            "labels": list(pp["masks"].keys()),
            "volumes_ml": pp["volumes_ml"],
            "bounding_boxes": pp["bounding_boxes"],
            "confidence_scores": pp["confidence_scores"],
            "_masks": pp["masks"],
            "_probability_maps": pp.get("probability_maps", {}),
        }

    elif config.model_type == ModelType.DETECTION:
        findings = detection_postprocess(prediction, config)
        return {
            "type": "detection",
            "findings": findings,
            "num_findings": len(findings),
        }

    elif config.model_type == ModelType.CLASSIFICATION:
        findings = classification_postprocess(prediction, config)
        return {
            "type": "classification",
            "findings": findings,
            "top_finding": findings[0] if findings else None,
        }

    elif config.model_type == ModelType.HYBRID:
        seg_result = segmentation_postprocess(prediction.squeeze(0), config, spacing)
        cls_findings = classification_postprocess(prediction, config)
        return {
            "type": "hybrid",
            "segmentation": {
                "labels": list(seg_result["masks"].keys()),
                "volumes_ml": seg_result["volumes_ml"],
                "bounding_boxes": seg_result["bounding_boxes"],
            },
            "classification": {
                "findings": cls_findings,
            },
            "_masks": seg_result["masks"],
            "_probability_maps": seg_result.get("probability_maps", {}),
        }

    return {"type": "unknown", "raw_shape": list(prediction.shape)}
