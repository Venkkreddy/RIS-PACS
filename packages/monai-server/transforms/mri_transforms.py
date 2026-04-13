"""
MRI preprocessing and augmentation transform chains.

MRI normalisation uses NormalizeIntensityd (z-score, nonzero, channel-wise)
instead of HU windowing because MRI signal intensity is not calibrated.
"""

from __future__ import annotations

from monai.transforms import (
    Compose,
    LoadImaged,
    EnsureChannelFirstd,
    Orientationd,
    Spacingd,
    NormalizeIntensityd,
    CropForegroundd,
    SpatialPadd,
    Resized,
    EnsureTyped,
    # Augmentation
    RandFlipd,
    RandRotate90d,
    RandShiftIntensityd,
    RandGaussianNoised,
    RandZoomd,
    RandAffined,
    RandGaussianSmoothd,
)


# ── BraTS Brain Tumor (4-channel: T1, T1ce, T2, FLAIR) ──────────────

def mri_brain_tumor_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode="bilinear"),
        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),
        CropForegroundd(keys=["image"], source_key="image", margin=10),
        SpatialPadd(keys=["image"], spatial_size=(128, 128, 128)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── Prostate Zone Segmentation (3-channel: T2W, ADC, DWI) ───────────

def mri_prostate_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(0.5, 0.5, 3.0), mode="bilinear"),
        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),
        CropForegroundd(keys=["image"], source_key="image", margin=5),
        SpatialPadd(keys=["image"], spatial_size=(128, 128, 64)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── Cardiac LV/RV Segmentation (2D short-axis slices) ───────────────

def mri_cardiac_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),
        Resized(keys=["image"], spatial_size=(256, 256)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── Knee Cartilage & Meniscus ────────────────────────────────────────

def mri_knee_transforms() -> Compose:
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Orientationd(keys=["image"], axcodes="RAS"),
        Spacingd(keys=["image"], pixdim=(0.4, 0.4, 0.7), mode="bilinear"),
        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),
        CropForegroundd(keys=["image"], source_key="image", margin=5),
        SpatialPadd(keys=["image"], spatial_size=(160, 160, 64)),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


# ── MRI Training Augmentation ────────────────────────────────────────

def mri_train_augmentation() -> Compose:
    """Conservative augmentation for MRI — lower probabilities to avoid
    introducing artifacts into signal-intensity-dependent sequences."""
    return Compose([
        RandFlipd(keys=["image", "label"], prob=0.2, spatial_axis=0),
        RandFlipd(keys=["image", "label"], prob=0.2, spatial_axis=1),
        RandRotate90d(keys=["image", "label"], prob=0.2, max_k=3),
        RandShiftIntensityd(keys=["image"], offsets=0.05, prob=0.25),
        RandGaussianNoised(keys=["image"], prob=0.1, mean=0.0, std=0.01),
        RandGaussianSmoothd(keys=["image"], prob=0.1, sigma_x=(0.5, 1.0)),
        RandZoomd(
            keys=["image", "label"],
            min_zoom=0.9, max_zoom=1.1,
            prob=0.15,
            mode=["bilinear", "nearest"],
        ),
        RandAffined(
            keys=["image", "label"],
            prob=0.15,
            rotate_range=(0.05, 0.05, 0.05),
            translate_range=(3, 3, 3),
            mode=["bilinear", "nearest"],
        ),
    ])
