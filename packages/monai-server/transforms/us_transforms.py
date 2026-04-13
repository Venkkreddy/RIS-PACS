"""
Ultrasound preprocessing transform chains.
"""

from __future__ import annotations

from monai.transforms import (
    Compose,
    LoadImaged,
    EnsureChannelFirstd,
    Resized,
    ScaleIntensityd,
    NormalizeIntensityd,
    EnsureTyped,
)


def us_tirads_transforms() -> Compose:
    """TI-RADS thyroid classification — 224×224, [0,1] normalised."""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Resized(keys=["image"], spatial_size=(224, 224)),
        ScaleIntensityd(keys=["image"], minv=0.0, maxv=1.0),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])


def us_fast_transforms() -> Compose:
    """FAST exam free fluid segmentation — 256×256, intensity-normalised."""
    return Compose([
        LoadImaged(keys=["image"]),
        EnsureChannelFirstd(keys=["image"]),
        Resized(keys=["image"], spatial_size=(256, 256)),
        NormalizeIntensityd(keys=["image"], nonzero=True),
        EnsureTyped(keys=["image"], dtype="float32"),
    ])
