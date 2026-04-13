"""
CXR (Chest X-Ray / extremity X-ray) preprocessing and augmentation.

2D pipelines that resize to network input size and normalize to [0, 1].
"""

from __future__ import annotations

from monai.transforms import (
    Compose,
    LoadImaged,
    EnsureChannelFirstd,
    Resized,
    ScaleIntensityd,
    EnsureTyped,
    # Augmentation
    RandFlipd,
    RandRotated,
    RandShiftIntensityd,
    RandGaussianNoised,
    RandZoomd,
    RandAffined,
    RandAdjustContrastd,
)


# ── CheXNet 14-Class (224×224) ───────────────────────────────────────

def cxr_14class_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Resized(keys=["image"], spatial_size=(224, 224)),
        ScaleIntensityd(keys=["image"], minv=0.0, maxv=1.0),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── TB / COVID (224×224) ─────────────────────────────────────────────

def cxr_tb_covid_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Resized(keys=["image"], spatial_size=(224, 224)),
        ScaleIntensityd(keys=["image"], minv=0.0, maxv=1.0),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── Fracture Detection (512×512) ────────────────────────────────────

def cxr_fracture_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Resized(keys=["image"], spatial_size=(512, 512)),
        ScaleIntensityd(keys=["image"], minv=0.0, maxv=1.0),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── CXR Training Augmentation ───────────────────────────────────────

def cxr_train_augmentation() -> Compose:
    """Augmentation for 2D X-ray — includes contrast jitter and
    small rotations that mimic real patient positioning variability."""
    return Compose([
        RandFlipd(keys=["image"], prob=0.0),  # NO horizontal flip for CXR (laterality matters)
        RandRotated(keys=["image"], range_x=0.1, prob=0.3, mode="bilinear"),
        RandShiftIntensityd(keys=["image"], offsets=0.08, prob=0.3),
        RandGaussianNoised(keys=["image"], prob=0.15, mean=0.0, std=0.02),
        RandAdjustContrastd(keys=["image"], prob=0.2, gamma=(0.8, 1.2)),
        RandZoomd(keys=["image"], min_zoom=0.9, max_zoom=1.1, prob=0.2),
        RandAffined(
            keys=["image"],
            prob=0.2,
            rotate_range=(0.08,),
            translate_range=(10, 10),
            scale_range=(0.05, 0.05),
            mode="bilinear",
        ),
    ])
