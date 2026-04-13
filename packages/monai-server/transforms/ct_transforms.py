"""
CT preprocessing and augmentation transform chains.

Each function returns a monai.transforms.Compose pipeline ready to use.
Key conventions:
  - Orientation: RAS
  - Spacing: model-specific but typically 1.5×1.5×2.0 mm
  - Windowing: ScaleIntensityRanged with clinically appropriate HU ranges
  - All chains end with EnsureTyped for Tensor conversion
"""

from __future__ import annotations

from monai.transforms import (
    Compose,
    LoadImaged,
    EnsureChannelFirstd,
    Orientationd,
    Spacingd,
    ScaleIntensityRanged,
    CropForegroundd,
    Resized,
    SpatialPadd,
    EnsureTyped,
    # Augmentation
    RandFlipd,
    RandRotate90d,
    RandShiftIntensityd,
    RandGaussianNoised,
    RandZoomd,
    RandAffined,
)


# ── CT Lung Nodule Detection ─────────────────────────────────────────

def ct_lung_nodule_transforms() -> Compose:
    """Lung window: [-1024, 400] HU → [0, 1]"""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(0.7, 0.7, 1.25), mode="bilinear"),
        ScaleIntensityRanged(
            keys=["image"],
            a_min=-1024, a_max=400,
            b_min=0.0, b_max=1.0,
            clip=True,
        ),
        CropForegroundd(keys=["image"], source_key="image", margin=10),
        SpatialPadd(keys=["image"], spatial_size=(192, 192, 192)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CT Multi-Organ Segmentation ──────────────────────────────────────

def ct_multi_organ_transforms() -> Compose:
    """Soft-tissue window: [-57, 164] HU → [0, 1]"""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(1.5, 1.5, 2.0), mode="bilinear"),
        ScaleIntensityRanged(
            keys=["image"],
            a_min=-57, a_max=164,
            b_min=0.0, b_max=1.0,
            clip=True,
        ),
        CropForegroundd(keys=["image"], source_key="image", margin=10),
        SpatialPadd(keys=["image"], spatial_size=(96, 96, 96)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CT Brain Hemorrhage / Midline Shift ──────────────────────────────

def ct_brain_transforms() -> Compose:
    """Brain window: [0, 80] HU → [0, 1]  (subdural: [-20, 180])"""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(0.5, 0.5, 5.0), mode="bilinear"),
        ScaleIntensityRanged(
            keys=["image"],
            a_min=0, a_max=80,
            b_min=0.0, b_max=1.0,
            clip=True,
        ),
        CropForegroundd(keys=["image"], source_key="image", margin=5),
        SpatialPadd(keys=["image"], spatial_size=(96, 96, 96)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CT Pulmonary Embolism ────────────────────────────────────────────

def ct_pe_transforms() -> Compose:
    """PE (CTA mediastinal window): [100, 700] HU → [0, 1]"""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(0.8, 0.8, 1.5), mode="bilinear"),
        ScaleIntensityRanged(
            keys=["image"],
            a_min=100, a_max=700,
            b_min=0.0, b_max=1.0,
            clip=True,
        ),
        CropForegroundd(keys=["image"], source_key="image", margin=10),
        SpatialPadd(keys=["image"], spatial_size=(128, 128, 64)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CT Vertebral Fracture ────────────────────────────────────────────

def ct_vertebral_transforms() -> Compose:
    """Bone window: [-200, 1500] HU → [0, 1]"""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode="bilinear"),
        ScaleIntensityRanged(
            keys=["image"],
            a_min=-200, a_max=1500,
            b_min=0.0, b_max=1.0,
            clip=True,
        ),
        CropForegroundd(keys=["image"], source_key="image", margin=10),
        SpatialPadd(keys=["image"], spatial_size=(96, 96, 96)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CT Training Augmentation ─────────────────────────────────────────

def ct_train_augmentation() -> Compose:
    """Data augmentation for CT training — conservative probabilities
    appropriate for clinical imaging data."""
    return Compose([
        RandFlipd(keys=["image", "label"], prob=0.2, spatial_axis=0),
        RandFlipd(keys=["image", "label"], prob=0.2, spatial_axis=1),
        RandFlipd(keys=["image", "label"], prob=0.2, spatial_axis=2),
        RandRotate90d(keys=["image", "label"], prob=0.2, max_k=3),
        RandShiftIntensityd(keys=["image"], offsets=0.1, prob=0.3),
        RandGaussianNoised(keys=["image"], prob=0.15, mean=0.0, std=0.02),
        RandZoomd(
            keys=["image", "label"],
            min_zoom=0.9, max_zoom=1.1,
            prob=0.2,
            mode=["bilinear", "nearest"],
        ),
        RandAffined(
            keys=["image", "label"],
            prob=0.2,
            rotate_range=(0.05, 0.05, 0.05),
            shear_range=(0.02, 0.02, 0.02),
            translate_range=(5, 5, 5),
            mode=["bilinear", "nearest"],
        ),
    ])
