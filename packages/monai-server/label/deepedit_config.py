"""
DeepEdit configuration for MONAI Label.

DeepEdit allows radiologists to perform click-based interactive
correction of AI segmentation directly inside OHIF viewer.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DeepEditConfig:
    """Configuration for the DeepEdit interactive segmentation model."""

    app_name: str = "radiology"
    model_name: str = "deepedit"
    network: str = "dynunet"

    spatial_dims: int = 3
    in_channels: int = 3  # image + positive_clicks + negative_clicks
    out_channels: int = 7

    target_spacing: tuple[float, float, float] = (1.5, 1.5, 2.0)
    spatial_size: tuple[int, int, int] = (128, 128, 64)

    labels: dict[str, int] = field(default_factory=lambda: {
        "background": 0,
        "liver": 1,
        "spleen": 2,
        "kidney_left": 3,
        "kidney_right": 4,
        "pancreas": 5,
        "aorta": 6,
    })

    max_interactions: int = 20
    click_radius_px: int = 3
    positive_click_channel: int = 1
    negative_click_channel: int = 2

    train_batch_size: int = 2
    val_batch_size: int = 1
    max_epochs: int = 100
    learning_rate: float = 1e-4
    early_stopping_patience: int = 10

    ohif_extension_config: dict = field(default_factory=lambda: {
        "tool_name": "MONAI DeepEdit",
        "interaction_type": "click",
        "positive_click_action": "left_click",
        "negative_click_action": "right_click",
        "submit_correction_action": "enter",
        "auto_segment_on_load": True,
        "show_uncertainty_overlay": True,
    })


def get_deepedit_app_config() -> dict:
    """Return the MONAI Label app configuration for DeepEdit."""
    cfg = DeepEditConfig()

    return {
        "name": cfg.app_name,
        "models": {
            cfg.model_name: {
                "type": "deepedit",
                "network": cfg.network,
                "spatial_dims": cfg.spatial_dims,
                "in_channels": cfg.in_channels,
                "out_channels": cfg.out_channels,
                "labels": cfg.labels,
                "target_spacing": cfg.target_spacing,
                "spatial_size": cfg.spatial_size,
            },
        },
        "strategies": {
            "epistemic": {
                "type": "Epistemic",
                "params": {
                    "num_samples": 20,
                    "dropout": 0.2,
                },
            },
            "random": {
                "type": "Random",
            },
            "tta_epistemic": {
                "type": "TTA",
                "params": {
                    "num_samples": 10,
                },
            },
        },
        "train": {
            "batch_size": cfg.train_batch_size,
            "val_batch_size": cfg.val_batch_size,
            "max_epochs": cfg.max_epochs,
            "lr": cfg.learning_rate,
            "early_stopping_patience": cfg.early_stopping_patience,
        },
        "datastore": {
            "type": "orthanc",
            "url": "orthanc://",
        },
        "ohif_integration": cfg.ohif_extension_config,
    }
