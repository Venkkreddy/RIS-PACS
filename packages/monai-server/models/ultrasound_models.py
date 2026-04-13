"""
Ultrasound model definitions — architectures, configs, and factory functions.

Models:
  - DenseNet121   → TI-RADS thyroid nodule classification (1–5)
  - UNet          → FAST exam free fluid detection
"""

from __future__ import annotations

import torch.nn as nn
from monai.networks.nets import DenseNet121, UNet

from config import ModelConfig, ModelType, PostProcessConfig


# ── TI-RADS Thyroid Nodule Classification ────────────────────────────

US_TIRADS_CONFIG = ModelConfig(
    name="us_tirads",
    display_name="TI-RADS Thyroid Nodule Classification",
    description="DenseNet121 TI-RADS thyroid nodule classification (scores 1-5)",
    model_type=ModelType.CLASSIFICATION,
    architecture="DenseNet121",
    modalities=["US"],
    body_parts=["THYROID", "NECK"],
    labels=["TR1_Benign", "TR2_Not_Suspicious", "TR3_Mildly_Suspicious",
            "TR4_Moderately_Suspicious", "TR5_Highly_Suspicious"],
    in_channels=1,
    out_channels=5,
    spatial_dims=2,
    input_size=(224, 224),
    snomed_codes={
        "TR1_Benign": "110396000",
        "TR5_Highly_Suspicious": "363346000",
    },
    triton_model_name="us_tirads",
    confidence_threshold=0.3,
)


def build_tirads_classifier() -> nn.Module:
    return DenseNet121(spatial_dims=2, in_channels=1, out_channels=5)


def compute_tirads_score(class_probabilities: list[float]) -> dict:
    """Compute ACR TI-RADS score from classification probabilities."""
    import numpy as np
    probs = np.array(class_probabilities)
    tirads_class = int(probs.argmax()) + 1

    tirads_descriptions = {
        1: "Benign — no FNA needed",
        2: "Not Suspicious — no FNA needed",
        3: "Mildly Suspicious — FNA if ≥ 2.5 cm, follow-up if ≥ 1.5 cm",
        4: "Moderately Suspicious — FNA if ≥ 1.5 cm, follow-up if ≥ 1.0 cm",
        5: "Highly Suspicious — FNA if ≥ 1.0 cm, follow-up if ≥ 0.5 cm",
    }

    tirads_features = {
        "composition": "Solid" if tirads_class >= 3 else "Cystic/Spongiform",
        "echogenicity": "Hypoechoic" if tirads_class >= 4 else "Iso/Hyperechoic",
        "shape": "Taller-than-wide" if tirads_class >= 4 else "Wider-than-tall",
        "margin": "Irregular/Lobulated" if tirads_class >= 4 else "Smooth",
        "echogenic_foci": "Punctate" if tirads_class >= 5 else "None/Comet-tail",
    }

    return {
        "tirads_score": tirads_class,
        "description": tirads_descriptions[tirads_class],
        "management": tirads_descriptions[tirads_class].split("—")[-1].strip(),
        "class_probabilities": {
            f"TR{i+1}": round(float(p), 4) for i, p in enumerate(probs)
        },
        "features": tirads_features,
    }


# ── FAST Exam Free Fluid Detection ──────────────────────────────────

US_FAST_CONFIG = ModelConfig(
    name="us_fast_exam",
    display_name="FAST Exam Free Fluid Detection",
    description="UNet-based FAST exam for intra-abdominal free fluid detection",
    model_type=ModelType.SEGMENTATION,
    architecture="UNet",
    modalities=["US"],
    body_parts=["ABDOMEN"],
    labels=["Free_Fluid"],
    in_channels=1,
    out_channels=2,
    spatial_dims=2,
    input_size=(256, 256),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
        min_component_size=50,
    ),
    snomed_codes={"Free_Fluid": "389026000"},
    triton_model_name="us_fast",
    confidence_threshold=0.5,
    priority_queue="stat",
)


def build_fast_detector() -> nn.Module:
    return UNet(
        spatial_dims=2,
        in_channels=1,
        out_channels=2,
        channels=(32, 64, 128, 256),
        strides=(2, 2, 2),
        num_res_units=2,
        norm="instance",
    )


def quantify_free_fluid(mask, pixel_spacing_mm: tuple[float, float] = (0.5, 0.5)) -> dict:
    """Estimate free fluid area from segmentation mask."""
    import numpy as np
    pixel_area_mm2 = pixel_spacing_mm[0] * pixel_spacing_mm[1]
    fluid_pixels = int((mask > 0).sum())
    area_mm2 = fluid_pixels * pixel_area_mm2
    area_cm2 = area_mm2 / 100.0

    if area_cm2 < 1.0:
        severity = "Trace"
    elif area_cm2 < 5.0:
        severity = "Small"
    elif area_cm2 < 15.0:
        severity = "Moderate"
    else:
        severity = "Large"

    return {
        "fluid_area_cm2": round(area_cm2, 2),
        "fluid_pixels": fluid_pixels,
        "severity": severity,
        "fast_positive": area_cm2 > 1.0,
    }


# ── Factory map ──────────────────────────────────────────────────────

US_MODELS = {
    "us_tirads": (US_TIRADS_CONFIG, build_tirads_classifier),
    "us_fast_exam": (US_FAST_CONFIG, build_fast_detector),
}
