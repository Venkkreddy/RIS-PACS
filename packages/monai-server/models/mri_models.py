"""
MRI model definitions — architectures, configs, and factory functions.

Models:
  - SwinUNETR     → BraTS 2023 brain tumor (ET/WT/TC segmentation)
  - UNet          → prostate zone segmentation + PI-RADS feature extraction
  - EfficientNet  → cardiac LV/RV segmentation → auto EF calculation
  - UNet          → knee cartilage + meniscus tear probability
"""

from __future__ import annotations

import torch.nn as nn
from monai.networks.nets import SwinUNETR, UNet, EfficientNetBN

from config import ModelConfig, ModelType, SlidingWindowConfig, PostProcessConfig


# ── BraTS Brain Tumor Segmentation (SwinUNETR) ───────────────────────

MRI_BRAIN_TUMOR_CONFIG = ModelConfig(
    name="mri_brain_tumor",
    display_name="MRI Brain Tumor Segmentation (BraTS 2023)",
    description="SwinUNETR for ET/WT/TC segmentation based on BraTS 2023 challenge",
    model_type=ModelType.SEGMENTATION,
    architecture="SwinUNETR",
    modalities=["MR"],
    body_parts=["BRAIN", "HEAD"],
    labels=["Enhancing_Tumor", "Whole_Tumor", "Tumor_Core"],
    in_channels=4,  # T1, T1ce, T2, FLAIR
    out_channels=3,
    spatial_dims=3,
    input_size=(128, 128, 128),
    sliding_window=SlidingWindowConfig(
        roi_size=(128, 128, 128), sw_batch_size=2, overlap=0.5, mode="gaussian"
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
        min_component_size=50, closing_radius=2,
    ),
    zoo_bundle="brats_mri_segmentation",
    snomed_codes={
        "Enhancing_Tumor": "108369006",
        "Whole_Tumor": "108369006",
        "Tumor_Core": "108369006",
    },
    triton_model_name="brain_tumor_seg",
    triton_format="onnx",
    priority_queue="stat",
)


def build_brain_tumor_net() -> nn.Module:
    return SwinUNETR(
        in_channels=4,
        out_channels=3,
        feature_size=48,
        use_checkpoint=True,
        spatial_dims=3,
    )


# ── Prostate Zone Segmentation (UNet) + PI-RADS ─────────────────────

MRI_PROSTATE_CONFIG = ModelConfig(
    name="mri_prostate_seg",
    display_name="MRI Prostate Zone Segmentation",
    description="UNet prostate zone segmentation with PI-RADS feature extraction",
    model_type=ModelType.SEGMENTATION,
    architecture="UNet",
    modalities=["MR"],
    body_parts=["PROSTATE"],
    labels=["Prostate_PZ", "Prostate_TZ", "Prostate_CZ"],
    in_channels=3,  # T2W, ADC, DWI
    out_channels=4,
    spatial_dims=3,
    input_size=(128, 128, 64),
    sliding_window=SlidingWindowConfig(
        roi_size=(128, 128, 64), sw_batch_size=4, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
    ),
    zoo_bundle="prostate_mri_anatomy",
    snomed_codes={
        "Prostate_PZ": "41216001",
        "Prostate_TZ": "41216001",
        "Prostate_CZ": "41216001",
    },
    triton_model_name="prostate_seg",
)


def build_prostate_seg() -> nn.Module:
    return UNet(
        spatial_dims=3,
        in_channels=3,
        out_channels=4,
        channels=(32, 64, 128, 256, 512),
        strides=(2, 2, 2, 2),
        num_res_units=2,
        norm="instance",
        dropout=0.2,
    )


def compute_pirads_score(zone_volumes: dict, lesion_features: dict) -> dict:
    """Compute PI-RADS v2.1 scoring from segmentation + lesion features.
    This is a simplified heuristic — real PI-RADS requires DWI signal,
    ADC values, T2 signal, and DCE characteristics.
    """
    score = 1
    adc_value = lesion_features.get("mean_adc", 1500)
    dwi_signal = lesion_features.get("dwi_signal_ratio", 1.0)
    lesion_size_mm = lesion_features.get("diameter_mm", 0)
    zone = lesion_features.get("dominant_zone", "PZ")

    if zone == "PZ":
        if dwi_signal > 2.0 and adc_value < 750:
            score = 5
        elif dwi_signal > 1.5 and adc_value < 900:
            score = 4
        elif adc_value < 1000:
            score = 3
        elif adc_value < 1200:
            score = 2
    else:  # TZ
        if lesion_size_mm > 15 and adc_value < 750:
            score = 5
        elif lesion_size_mm > 15 or adc_value < 900:
            score = 4
        elif adc_value < 1100:
            score = 3
        elif adc_value < 1300:
            score = 2

    risk_map = {1: "Very Low", 2: "Low", 3: "Intermediate", 4: "High", 5: "Very High"}

    return {
        "pirads_score": score,
        "risk_category": risk_map[score],
        "dominant_zone": zone,
        "adc_value": adc_value,
        "lesion_diameter_mm": lesion_size_mm,
    }


# ── Cardiac LV/RV Segmentation (EfficientNet) ───────────────────────

MRI_CARDIAC_CONFIG = ModelConfig(
    name="mri_cardiac_seg",
    display_name="MRI Cardiac LV/RV Segmentation",
    description="EfficientNet-based cardiac segmentation with auto EF calculation",
    model_type=ModelType.SEGMENTATION,
    architecture="EfficientNetBN",
    modalities=["MR"],
    body_parts=["HEART"],
    labels=["LV", "RV", "LV_Myo"],
    in_channels=1,
    out_channels=4,
    spatial_dims=2,
    input_size=(256, 256),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
    ),
    snomed_codes={"LV": "87878005", "RV": "53085002", "LV_Myo": "74281007"},
    triton_model_name="cardiac_seg",
)


def build_cardiac_seg() -> nn.Module:
    return EfficientNetBN(
        model_name="efficientnet-b4",
        pretrained=False,
        spatial_dims=2,
        in_channels=1,
        num_classes=4,
    )


def compute_ejection_fraction(
    lv_edv_ml: float, lv_esv_ml: float
) -> dict:
    """Compute left ventricular ejection fraction.
    EDV = end-diastolic volume, ESV = end-systolic volume.
    """
    if lv_edv_ml <= 0:
        return {"ef_percent": 0.0, "classification": "Unknown"}

    ef = ((lv_edv_ml - lv_esv_ml) / lv_edv_ml) * 100.0

    if ef >= 55:
        classification = "Normal"
    elif ef >= 40:
        classification = "Mildly Reduced (HFmrEF)"
    elif ef >= 30:
        classification = "Moderately Reduced"
    else:
        classification = "Severely Reduced (HFrEF)"

    return {
        "ef_percent": round(ef, 1),
        "lv_edv_ml": round(lv_edv_ml, 1),
        "lv_esv_ml": round(lv_esv_ml, 1),
        "stroke_volume_ml": round(lv_edv_ml - lv_esv_ml, 1),
        "classification": classification,
    }


# ── Knee Cartilage + Meniscus (UNet) ────────────────────────────────

MRI_KNEE_CARTILAGE_CONFIG = ModelConfig(
    name="mri_knee_cartilage",
    display_name="MRI Knee Cartilage & Meniscus",
    description="UNet knee cartilage segmentation + meniscus tear probability",
    model_type=ModelType.HYBRID,
    architecture="UNet",
    modalities=["MR"],
    body_parts=["KNEE"],
    labels=["Femoral_Cartilage", "Tibial_Cartilage", "Meniscus_Medial", "Meniscus_Lateral"],
    in_channels=1,
    out_channels=5,
    spatial_dims=3,
    input_size=(160, 160, 64),
    sliding_window=SlidingWindowConfig(
        roi_size=(160, 160, 64), sw_batch_size=4, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
    ),
    snomed_codes={
        "Femoral_Cartilage": "61496007",
        "Tibial_Cartilage": "61496007",
        "Meniscus_Medial": "72405004",
        "Meniscus_Lateral": "72405004",
    },
    triton_model_name="knee_cartilage",
)


def build_knee_cartilage_net() -> nn.Module:
    return UNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=5,
        channels=(32, 64, 128, 256),
        strides=(2, 2, 2),
        num_res_units=2,
        norm="instance",
        dropout=0.2,
    )


def compute_meniscus_tear_probability(meniscus_mask, mri_volume) -> dict:
    """Estimate meniscus tear probability from signal intensity + morphology."""
    import numpy as np

    if meniscus_mask.sum() == 0:
        return {"tear_probability": 0.0, "grade": "Normal", "signal_ratio": 0.0}

    meniscus_signal = float(mri_volume[meniscus_mask > 0].mean())
    background_signal = float(mri_volume[meniscus_mask == 0].mean()) + 1e-8
    signal_ratio = meniscus_signal / background_signal

    if signal_ratio > 2.5:
        probability = min(0.95, 0.5 + (signal_ratio - 2.5) * 0.3)
        grade = "Grade 3 (surface tear)"
    elif signal_ratio > 1.8:
        probability = 0.3 + (signal_ratio - 1.8) * 0.3
        grade = "Grade 2 (linear signal)"
    else:
        probability = signal_ratio * 0.15
        grade = "Grade 1 (globular signal)" if signal_ratio > 1.2 else "Normal"

    return {
        "tear_probability": round(probability, 3),
        "grade": grade,
        "signal_ratio": round(signal_ratio, 2),
    }


# ── Factory map ──────────────────────────────────────────────────────

MRI_MODELS = {
    "mri_brain_tumor": (MRI_BRAIN_TUMOR_CONFIG, build_brain_tumor_net),
    "mri_prostate_seg": (MRI_PROSTATE_CONFIG, build_prostate_seg),
    "mri_cardiac_seg": (MRI_CARDIAC_CONFIG, build_cardiac_seg),
    "mri_knee_cartilage": (MRI_KNEE_CARTILAGE_CONFIG, build_knee_cartilage_net),
}
