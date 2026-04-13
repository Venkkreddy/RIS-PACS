"""
CT model definitions — architectures, configs, and factory functions.

Models:
  - DynUNet       → lung nodule detection + Lung-RADS scoring
  - SegResNet     → multi-organ segmentation (liver, spleen, kidney, pancreas, aorta)
  - SwinUNETR     → brain hemorrhage + midline shift detection
  - DenseNet121   → pulmonary embolism (PE) classification
  - DynUNet       → vertebral fracture detection + HU bone density
"""

from __future__ import annotations

import torch.nn as nn
from monai.networks.nets import DynUNet, SegResNet, SwinUNETR, DenseNet121

from config import ModelConfig, ModelType, SlidingWindowConfig, PostProcessConfig


# ── Lung Nodule Detection (DynUNet) ───────────────────────────────────

CT_LUNG_NODULE_CONFIG = ModelConfig(
    name="ct_lung_nodule",
    display_name="CT Lung Nodule Detection",
    description="DynUNet-based lung nodule detection with Lung-RADS scoring",
    model_type=ModelType.DETECTION,
    architecture="DynUNet",
    modalities=["CT"],
    body_parts=["CHEST", "LUNG"],
    labels=["Nodule"],
    in_channels=1,
    out_channels=2,
    spatial_dims=3,
    input_size=(192, 192, 192),
    sliding_window=SlidingWindowConfig(
        roi_size=(192, 192, 192), sw_batch_size=2, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=False,
        fill_holes=True,
        morphological_cleanup=True,
        min_component_size=27,
        closing_radius=1,
    ),
    zoo_bundle="lung_nodule_ct_detection",
    snomed_codes={"Nodule": "427359005"},
    triton_model_name="lung_nodule",
    triton_format="tensorrt",
    confidence_threshold=0.5,
    priority_queue="stat",
)


def build_lung_nodule_net() -> nn.Module:
    kernels = [[3, 3, 3]] * 6
    strides = [[1, 1, 1]] + [[2, 2, 2]] * 5
    return DynUNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=2,
        kernel_size=kernels,
        strides=strides,
        upsample_kernel_size=strides[1:],
        norm_name="instance",
        deep_supervision=True,
        deep_supr_num=3,
    )


# ── Lung-RADS scoring helper ─────────────────────────────────────────

def compute_lung_rads(nodule_diameter_mm: float, nodule_type: str = "solid") -> dict:
    """Compute Lung-RADS category from nodule diameter and type."""
    if nodule_type == "ground_glass":
        if nodule_diameter_mm < 30:
            cat, management = "2", "12-month LDCT"
        elif nodule_diameter_mm < 30:
            cat, management = "3", "6-month LDCT"
        else:
            cat, management = "4A", "3-month LDCT or PET/CT"
    elif nodule_type == "part_solid":
        if nodule_diameter_mm < 6:
            cat, management = "2", "12-month LDCT"
        elif nodule_diameter_mm < 8:
            cat, management = "3", "6-month LDCT"
        else:
            cat, management = "4A", "3-month LDCT, PET/CT or tissue sampling"
    else:  # solid
        if nodule_diameter_mm < 6:
            cat, management = "1", "Continue annual LDCT"
        elif nodule_diameter_mm < 8:
            cat, management = "2", "12-month LDCT"
        elif nodule_diameter_mm < 15:
            cat, management = "3", "6-month LDCT"
        elif nodule_diameter_mm < 30:
            cat, management = "4A", "3-month LDCT or PET/CT"
        else:
            cat, management = "4B", "Tissue sampling, PET/CT or both"

    return {
        "lung_rads_category": cat,
        "management": management,
        "nodule_type": nodule_type,
        "diameter_mm": round(nodule_diameter_mm, 1),
    }


# ── Multi-Organ Segmentation (SegResNet) ─────────────────────────────

CT_MULTI_ORGAN_CONFIG = ModelConfig(
    name="ct_multi_organ_seg",
    display_name="CT Multi-Organ Segmentation",
    description="SegResNet multi-organ segmentation (liver, spleen, kidney, pancreas, aorta)",
    model_type=ModelType.SEGMENTATION,
    architecture="SegResNet",
    modalities=["CT"],
    body_parts=["ABDOMEN", "CHEST"],
    labels=["Liver", "Spleen", "Kidney_L", "Kidney_R", "Pancreas", "Aorta"],
    in_channels=1,
    out_channels=7,
    spatial_dims=3,
    input_size=(96, 96, 96),
    sliding_window=SlidingWindowConfig(
        roi_size=(96, 96, 96), sw_batch_size=4, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
        min_component_size=100, closing_radius=2,
    ),
    zoo_bundle="wholeBody_ct_segmentation",
    snomed_codes={
        "Liver": "10200004", "Spleen": "78961009",
        "Kidney_L": "64033007", "Kidney_R": "64033007",
        "Pancreas": "15776009", "Aorta": "15825003",
    },
    triton_model_name="multi_organ_seg",
    triton_format="onnx",
    confidence_threshold=0.5,
)


def build_multi_organ_seg() -> nn.Module:
    return SegResNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=7,
        init_filters=32,
        blocks_down=(1, 2, 2, 4),
        blocks_up=(1, 1, 1),
        dropout_prob=0.2,
    )


# ── Brain Hemorrhage + Midline Shift (SwinUNETR) ─────────────────────

CT_BRAIN_HEMORRHAGE_CONFIG = ModelConfig(
    name="ct_brain_hemorrhage",
    display_name="CT Brain Hemorrhage Detection",
    description="SwinUNETR brain hemorrhage classification + midline shift detection",
    model_type=ModelType.HYBRID,
    architecture="SwinUNETR",
    modalities=["CT"],
    body_parts=["HEAD", "BRAIN"],
    labels=["Epidural", "Subdural", "Subarachnoid", "Intraparenchymal", "Intraventricular", "Midline_Shift"],
    in_channels=1,
    out_channels=6,
    spatial_dims=3,
    input_size=(96, 96, 96),
    sliding_window=SlidingWindowConfig(
        roi_size=(96, 96, 96), sw_batch_size=2, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=True, fill_holes=True, morphological_cleanup=True,
    ),
    zoo_bundle="wholeBrainSeg_Large_UNEST_segmentation",
    snomed_codes={"Hemorrhage": "50960005", "Midline_Shift": "373945007"},
    triton_model_name="brain_hemorrhage",
    confidence_threshold=0.3,
    priority_queue="stat",
)


def build_brain_hemorrhage_net() -> nn.Module:
    return SwinUNETR(
        in_channels=1,
        out_channels=6,
        feature_size=48,
        use_checkpoint=True,
        spatial_dims=3,
    )


# ── Pulmonary Embolism Classification (DenseNet121) ──────────────────

CT_PE_CONFIG = ModelConfig(
    name="ct_pe_classification",
    display_name="CT PE Classification",
    description="DenseNet121-based pulmonary embolism classification",
    model_type=ModelType.CLASSIFICATION,
    architecture="DenseNet121",
    modalities=["CT"],
    body_parts=["CHEST"],
    labels=["PE_Positive", "PE_Negative"],
    in_channels=1,
    out_channels=2,
    spatial_dims=3,
    input_size=(128, 128, 64),
    sliding_window=SlidingWindowConfig(
        roi_size=(128, 128, 64), sw_batch_size=2, overlap=0.25
    ),
    snomed_codes={"PE_Positive": "59282003"},
    triton_model_name="pe_classification",
    confidence_threshold=0.5,
    priority_queue="stat",
)


def build_pe_classifier() -> nn.Module:
    return DenseNet121(spatial_dims=3, in_channels=1, out_channels=2)


# ── Vertebral Fracture + HU Bone Density (DynUNet) ──────────────────

CT_VERTEBRAL_FRACTURE_CONFIG = ModelConfig(
    name="ct_vertebral_fracture",
    display_name="CT Vertebral Fracture Detection",
    description="DynUNet vertebral fracture detection + automatic HU bone density",
    model_type=ModelType.HYBRID,
    architecture="DynUNet",
    modalities=["CT"],
    body_parts=["SPINE", "CSPINE", "TSPINE", "LSPINE"],
    labels=["Vertebral_Fracture"],
    in_channels=1,
    out_channels=2,
    spatial_dims=3,
    input_size=(96, 96, 96),
    sliding_window=SlidingWindowConfig(
        roi_size=(96, 96, 96), sw_batch_size=4, overlap=0.5
    ),
    postprocess=PostProcessConfig(
        keep_largest_cc=False, fill_holes=True, morphological_cleanup=True,
    ),
    zoo_bundle="vertebra_localization_ct",
    snomed_codes={"Vertebral_Fracture": "125605004"},
    triton_model_name="vertebral_fracture",
)


def build_vertebral_fracture_net() -> nn.Module:
    kernels = [[3, 3, 3]] * 5
    strides = [[1, 1, 1]] + [[2, 2, 2]] * 4
    return DynUNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=2,
        kernel_size=kernels,
        strides=strides,
        upsample_kernel_size=strides[1:],
        norm_name="instance",
    )


def compute_hu_bone_density(vertebral_mask, ct_volume) -> dict:
    """Compute mean Hounsfield Unit within a vertebral body mask for bone density."""
    import numpy as np
    if vertebral_mask.sum() == 0:
        return {"mean_hu": 0.0, "classification": "Unknown", "t_score_estimate": None}

    mean_hu = float(ct_volume[vertebral_mask > 0].mean())

    if mean_hu > 160:
        classification = "Normal"
        t_score_est = 0.0
    elif mean_hu > 110:
        classification = "Osteopenia"
        t_score_est = -1.5
    else:
        classification = "Osteoporosis"
        t_score_est = -3.0

    return {
        "mean_hu": round(mean_hu, 1),
        "classification": classification,
        "t_score_estimate": t_score_est,
    }


# ── Factory map ──────────────────────────────────────────────────────

CT_MODELS = {
    "ct_lung_nodule": (CT_LUNG_NODULE_CONFIG, build_lung_nodule_net),
    "ct_multi_organ_seg": (CT_MULTI_ORGAN_CONFIG, build_multi_organ_seg),
    "ct_brain_hemorrhage": (CT_BRAIN_HEMORRHAGE_CONFIG, build_brain_hemorrhage_net),
    "ct_pe_classification": (CT_PE_CONFIG, build_pe_classifier),
    "ct_vertebral_fracture": (CT_VERTEBRAL_FRACTURE_CONFIG, build_vertebral_fracture_net),
}
