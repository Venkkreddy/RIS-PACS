"""
Unified model registry — single source of truth for all MONAI models.
Handles lazy loading, weight management, and DICOM-tag–based routing.
"""

from __future__ import annotations

import logging
from typing import Optional

import torch
import torch.nn as nn

from config import DEVICE, MODELS_DIR, ModelConfig

from .ct_models import CT_MODELS
from .mri_models import MRI_MODELS
from .cxr_models import CXR_MODELS
from .ultrasound_models import US_MODELS

logger = logging.getLogger("monai-server.registry")

# Merge all per-modality maps into a single registry
MODEL_REGISTRY: dict[str, tuple[ModelConfig, callable]] = {
    **CT_MODELS,
    **MRI_MODELS,
    **CXR_MODELS,
    **US_MODELS,
}

_loaded_models: dict[str, nn.Module] = {}


def _normalize_state_dict_keys(state: dict) -> dict:
    if not state:
        return {}

    if "state_dict" in state and isinstance(state["state_dict"], dict):
        state = state["state_dict"]

    if all(isinstance(key, str) and key.startswith("module.") for key in state.keys()):
        return {key[len("module."):]: value for key, value in state.items()}

    return state


def _load_compatible_weights(model: nn.Module, raw_state: dict, model_name: str) -> None:
    state = _normalize_state_dict_keys(raw_state)
    if not state:
        logger.warning("Weight file for %s is empty or invalid; using random init", model_name)
        return

    model_state = model.state_dict()
    compatible_state: dict[str, torch.Tensor] = {}
    skipped_shape_mismatches: list[tuple[str, tuple[int, ...], tuple[int, ...]]] = []

    for key, value in state.items():
        if not isinstance(key, str):
            continue
        target_tensor = model_state.get(key)
        if target_tensor is None:
            continue
        if tuple(value.shape) != tuple(target_tensor.shape):
            skipped_shape_mismatches.append((key, tuple(value.shape), tuple(target_tensor.shape)))
            continue
        compatible_state[key] = value

    if skipped_shape_mismatches:
        preview = ", ".join(
            f"{key} ({src_shape} -> {dst_shape})"
            for key, src_shape, dst_shape in skipped_shape_mismatches[:5]
        )
        logger.warning(
            "Skipping %d incompatible weight tensors for %s: %s%s",
            len(skipped_shape_mismatches),
            model_name,
            preview,
            " ..." if len(skipped_shape_mismatches) > 5 else "",
        )

    if not compatible_state:
        logger.warning("No compatible tensors found in checkpoint for %s; using random init", model_name)
        return

    load_result = model.load_state_dict(compatible_state, strict=False)
    if load_result.missing_keys:
        logger.info(
            "Loaded partial weights for %s; %d tensors left at init",
            model_name,
            len(load_result.missing_keys),
        )


def get_model_config(name: str) -> Optional[ModelConfig]:
    entry = MODEL_REGISTRY.get(name)
    return entry[0] if entry else None


def get_all_model_configs() -> list[ModelConfig]:
    return [cfg for cfg, _ in MODEL_REGISTRY.values()]


def load_model(name: str, force_reload: bool = False) -> nn.Module:
    """Load a model by name — from cache, from saved weights, or freshly built."""
    if name in _loaded_models and not force_reload:
        return _loaded_models[name]

    entry = MODEL_REGISTRY.get(name)
    if entry is None:
        raise ValueError(f"Unknown model: {name}. Available: {list(MODEL_REGISTRY.keys())}")

    config, factory_fn = entry
    model = factory_fn()

    weight_path = MODELS_DIR / f"{name}.pt"
    if weight_path.exists():
        logger.info("Loading saved weights: %s", weight_path)
        state = torch.load(weight_path, map_location=DEVICE, weights_only=True)
        _load_compatible_weights(model, state, name)
    else:
        logger.info("No pre-trained weights for %s — initializing from scratch", name)

    model.to(DEVICE)
    model.eval()
    _loaded_models[name] = model
    logger.info(
        "Model '%s' (%s) ready  |  out=%d  device=%s",
        name, config.architecture, config.out_channels, DEVICE,
    )
    return model


def unload_model(name: str) -> None:
    model = _loaded_models.pop(name, None)
    if model is not None:
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Unloaded model: %s", name)


def get_loaded_model_names() -> list[str]:
    return list(_loaded_models.keys())
