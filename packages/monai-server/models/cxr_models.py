"""
CXR (X-Ray) model definitions — architectures, configs, and factory functions.

Models:
  - DenseNet121   → 14-class CheXNet (pneumonia, effusion, cardiomegaly, etc.)
  - ResNet50      → TB / COVID probability score
  - YOLOv8-style  → bone fracture detection on CXR and extremity X-rays
"""

from __future__ import annotations

import torch
import torch.nn as nn
from monai.networks.nets import DenseNet121, SEResNet50

from config import ModelConfig, ModelType, PostProcessConfig


# ── 14-Class CheXNet (DenseNet121) ───────────────────────────────────

CHEST_XRAY_LABELS = [
    "Atelectasis", "Cardiomegaly", "Effusion", "Infiltration", "Mass",
    "Nodule", "Pneumonia", "Pneumothorax", "Consolidation", "Edema",
    "Emphysema", "Fibrosis", "Pleural_Thickening", "Hernia",
]

CXR_14CLASS_CONFIG = ModelConfig(
    name="cxr_14class",
    display_name="CheXNet 14-Class Classification",
    description="DenseNet121 CheXNet for 14 thoracic pathology classification",
    model_type=ModelType.CLASSIFICATION,
    architecture="DenseNet121",
    modalities=["CR", "DX"],
    body_parts=["CHEST"],
    labels=CHEST_XRAY_LABELS,
    in_channels=1,
    out_channels=14,
    spatial_dims=2,
    input_size=(224, 224),
    snomed_codes={
        "Atelectasis": "46621007",
        "Cardiomegaly": "8186001",
        "Effusion": "60046008",
        "Infiltration": "47693006",
        "Mass": "4147007",
        "Nodule": "427359005",
        "Pneumonia": "233604007",
        "Pneumothorax": "36118008",
        "Consolidation": "95436003",
        "Edema": "423341008",
        "Emphysema": "87433001",
        "Fibrosis": "51615001",
        "Pleural_Thickening": "4468000",
        "Hernia": "414403008",
    },
    triton_model_name="cxr_14class",
    triton_format="torchscript",
    confidence_threshold=0.3,
)


def build_cxr_14class() -> nn.Module:
    return DenseNet121(spatial_dims=2, in_channels=1, out_channels=14)


# ── TB / COVID Classification (ResNet50) ────────────────────────────

CXR_TB_COVID_CONFIG = ModelConfig(
    name="cxr_tb_covid",
    display_name="TB / COVID Probability Score",
    description="ResNet50-based TB and COVID-19 probability scoring from CXR",
    model_type=ModelType.CLASSIFICATION,
    architecture="SEResNet50",
    modalities=["CR", "DX"],
    body_parts=["CHEST"],
    labels=["TB_Positive", "COVID_Positive", "Normal"],
    in_channels=1,
    out_channels=3,
    spatial_dims=2,
    input_size=(224, 224),
    snomed_codes={
        "TB_Positive": "56717001",
        "COVID_Positive": "840539006",
        "Normal": "17621005",
    },
    triton_model_name="cxr_tb_covid",
    confidence_threshold=0.5,
)


def build_tb_covid_classifier() -> nn.Module:
    return SEResNet50(spatial_dims=2, in_channels=1, num_classes=3)


# ── Fracture Detection (YOLO-style Anchor-Free Detector) ────────────
# We implement a lightweight anchor-free detection head on top of
# a DenseNet backbone since MONAI does not have a native YOLO module.
# For production, swap with ultralytics YOLOv8 or a MONAI RetinaNet.

CXR_FRACTURE_CONFIG = ModelConfig(
    name="cxr_fracture_detection",
    display_name="Bone Fracture Detection (X-Ray)",
    description="YOLO-style anchor-free fracture detection on CXR and extremity X-rays",
    model_type=ModelType.DETECTION,
    architecture="DenseNet121+DetHead",
    modalities=["CR", "DX"],
    body_parts=["CHEST", "HAND", "WRIST", "ELBOW", "SHOULDER", "ANKLE", "FOOT"],
    labels=["Fracture"],
    in_channels=1,
    out_channels=1,
    spatial_dims=2,
    input_size=(512, 512),
    postprocess=PostProcessConfig(
        keep_largest_cc=False, fill_holes=False, morphological_cleanup=False,
    ),
    snomed_codes={"Fracture": "125605004"},
    triton_model_name="cxr_fracture",
    confidence_threshold=0.4,
)


class FractureDetectionNet(nn.Module):
    """DenseNet121 backbone + anchor-free detection head for fracture detection.
    Outputs per-pixel heatmap + bounding-box regression.
    """

    def __init__(self):
        super().__init__()
        backbone = DenseNet121(spatial_dims=2, in_channels=1, out_channels=256)
        self.features = backbone.features
        self.heatmap_head = nn.Sequential(
            nn.Conv2d(1024, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.Conv2d(256, 64, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 1, 1),
            nn.Sigmoid(),
        )
        self.bbox_head = nn.Sequential(
            nn.Conv2d(1024, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.Conv2d(256, 4, 1),
        )

    def forward(self, x: torch.Tensor):
        features = self.features(x)
        heatmap = self.heatmap_head(features)
        bbox = self.bbox_head(features)
        return heatmap, bbox


def build_fracture_detector() -> nn.Module:
    return FractureDetectionNet()


def extract_fracture_boxes(
    heatmap: torch.Tensor,
    bbox_reg: torch.Tensor,
    threshold: float = 0.4,
    original_size: tuple[int, int] = (512, 512),
) -> list[dict]:
    """Extract bounding boxes from the detection head output."""
    import numpy as np

    hm = heatmap.squeeze().detach().cpu().numpy()
    bx = bbox_reg.squeeze().detach().cpu().numpy()

    h, w = hm.shape
    scale_y = original_size[0] / h
    scale_x = original_size[1] / w

    boxes = []
    coords = np.argwhere(hm > threshold)
    for (y, x) in coords:
        conf = float(hm[y, x])
        dx, dy, dw, dh = bx[:, y, x]
        cx = (x + dx) * scale_x
        cy = (y + dy) * scale_y
        bw = abs(dw) * scale_x * 4
        bh = abs(dh) * scale_y * 4

        boxes.append({
            "label": "Fracture",
            "confidence": round(conf, 4),
            "bbox": {
                "x1": round(max(0, cx - bw / 2), 1),
                "y1": round(max(0, cy - bh / 2), 1),
                "x2": round(min(original_size[1], cx + bw / 2), 1),
                "y2": round(min(original_size[0], cy + bh / 2), 1),
            },
        })

    boxes.sort(key=lambda b: b["confidence"], reverse=True)
    return boxes[:20]


# ── Factory map ──────────────────────────────────────────────────────

CXR_MODELS = {
    "cxr_14class": (CXR_14CLASS_CONFIG, build_cxr_14class),
    "cxr_tb_covid": (CXR_TB_COVID_CONFIG, build_tb_covid_classifier),
    "cxr_fracture_detection": (CXR_FRACTURE_CONFIG, build_fracture_detector),
}
