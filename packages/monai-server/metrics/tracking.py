"""
Performance metrics tracking per model.

Computes and persists:
  - Dice coefficient
  - Hausdorff Distance 95th percentile (HD95)
  - AUC (Area Under ROC Curve)
  - Sensitivity (recall) and Specificity
  - Per-class and aggregate metrics
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import numpy as np

from config import METRICS_DIR

logger = logging.getLogger("monai-server.metrics")


@dataclass
class ModelMetrics:
    model_name: str
    timestamp: float = 0.0
    num_evaluations: int = 0
    dice_scores: dict[str, list[float]] = field(default_factory=dict)
    hd95_scores: dict[str, list[float]] = field(default_factory=dict)
    auc_scores: dict[str, float] = field(default_factory=dict)
    sensitivities: dict[str, float] = field(default_factory=dict)
    specificities: dict[str, float] = field(default_factory=dict)
    mean_inference_time_ms: float = 0.0
    inference_times: list[float] = field(default_factory=list)


class MetricsTracker:
    """Track and persist model performance metrics."""

    def __init__(self, storage_dir: Path = METRICS_DIR):
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._metrics: dict[str, ModelMetrics] = {}

    def record_inference_time(self, model_name: str, time_ms: float) -> None:
        m = self._get_or_create(model_name)
        m.inference_times.append(time_ms)
        if len(m.inference_times) > 1000:
            m.inference_times = m.inference_times[-500:]
        m.mean_inference_time_ms = float(np.mean(m.inference_times))

    def compute_dice(
        self,
        model_name: str,
        prediction: np.ndarray,
        ground_truth: np.ndarray,
        label: str = "aggregate",
    ) -> float:
        """Compute Dice coefficient between prediction and ground truth masks."""
        pred_flat = prediction.flatten().astype(bool)
        gt_flat = ground_truth.flatten().astype(bool)

        intersection = np.logical_and(pred_flat, gt_flat).sum()
        total = pred_flat.sum() + gt_flat.sum()

        if total == 0:
            dice = 1.0
        else:
            dice = 2.0 * intersection / total

        m = self._get_or_create(model_name)
        m.dice_scores.setdefault(label, []).append(float(dice))
        m.num_evaluations += 1
        return float(dice)

    def compute_hd95(
        self,
        model_name: str,
        prediction: np.ndarray,
        ground_truth: np.ndarray,
        spacing: tuple[float, ...] = (1.0, 1.0, 1.0),
        label: str = "aggregate",
    ) -> float:
        """Compute 95th percentile Hausdorff Distance."""
        from scipy.ndimage import distance_transform_edt

        pred_border = _get_surface_points(prediction)
        gt_border = _get_surface_points(ground_truth)

        if pred_border.sum() == 0 or gt_border.sum() == 0:
            return float("inf")

        dt_pred = distance_transform_edt(~pred_border, sampling=spacing)
        dt_gt = distance_transform_edt(~gt_border, sampling=spacing)

        d_pred_to_gt = dt_gt[pred_border]
        d_gt_to_pred = dt_pred[gt_border]

        all_distances = np.concatenate([d_pred_to_gt, d_gt_to_pred])
        hd95 = float(np.percentile(all_distances, 95))

        m = self._get_or_create(model_name)
        m.hd95_scores.setdefault(label, []).append(hd95)
        return hd95

    def compute_classification_metrics(
        self,
        model_name: str,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_prob: Optional[np.ndarray] = None,
        label: str = "aggregate",
    ) -> dict:
        """Compute AUC, sensitivity, specificity for classification."""
        tp = np.logical_and(y_true == 1, y_pred == 1).sum()
        tn = np.logical_and(y_true == 0, y_pred == 0).sum()
        fp = np.logical_and(y_true == 0, y_pred == 1).sum()
        fn = np.logical_and(y_true == 1, y_pred == 0).sum()

        sensitivity = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        specificity = float(tn / (tn + fp)) if (tn + fp) > 0 else 0.0

        auc = 0.0
        if y_prob is not None:
            try:
                from sklearn.metrics import roc_auc_score
                auc = float(roc_auc_score(y_true, y_prob))
            except Exception:
                auc = _manual_auc(y_true, y_prob)

        m = self._get_or_create(model_name)
        m.sensitivities[label] = sensitivity
        m.specificities[label] = specificity
        m.auc_scores[label] = auc

        return {
            "sensitivity": round(sensitivity, 4),
            "specificity": round(specificity, 4),
            "auc": round(auc, 4),
            "tp": int(tp), "tn": int(tn),
            "fp": int(fp), "fn": int(fn),
        }

    def get_summary(self, model_name: str) -> dict:
        m = self._metrics.get(model_name)
        if m is None:
            return {"model_name": model_name, "status": "no_data"}

        summary = {
            "model_name": model_name,
            "num_evaluations": m.num_evaluations,
            "mean_inference_time_ms": round(m.mean_inference_time_ms, 2),
        }

        for label, scores in m.dice_scores.items():
            summary[f"dice_{label}"] = round(float(np.mean(scores[-100:])), 4)
        for label, scores in m.hd95_scores.items():
            summary[f"hd95_{label}"] = round(float(np.mean(scores[-100:])), 2)
        for label, val in m.auc_scores.items():
            summary[f"auc_{label}"] = round(val, 4)
        for label, val in m.sensitivities.items():
            summary[f"sensitivity_{label}"] = round(val, 4)
        for label, val in m.specificities.items():
            summary[f"specificity_{label}"] = round(val, 4)

        return summary

    def save(self, model_name: str) -> None:
        m = self._metrics.get(model_name)
        if m is None:
            return
        path = self.storage_dir / f"{model_name}_metrics.json"
        with open(path, "w") as f:
            json.dump(asdict(m), f, indent=2, default=str)

    def load(self, model_name: str) -> Optional[ModelMetrics]:
        path = self.storage_dir / f"{model_name}_metrics.json"
        if not path.exists():
            return None
        with open(path) as f:
            data = json.load(f)
        m = ModelMetrics(**data)
        self._metrics[model_name] = m
        return m

    def _get_or_create(self, model_name: str) -> ModelMetrics:
        if model_name not in self._metrics:
            self._metrics[model_name] = ModelMetrics(
                model_name=model_name, timestamp=time.time()
            )
        return self._metrics[model_name]


def _get_surface_points(mask: np.ndarray) -> np.ndarray:
    from scipy.ndimage import binary_erosion
    eroded = binary_erosion(mask)
    return np.logical_xor(mask, eroded)


def _manual_auc(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Simple trapezoidal AUC when sklearn is not available."""
    sorted_indices = np.argsort(-y_prob)
    y_sorted = y_true[sorted_indices]
    n_pos = y_true.sum()
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return 0.0
    tpr_prev, fpr_prev = 0.0, 0.0
    auc = 0.0
    tp, fp = 0, 0
    for label in y_sorted:
        if label == 1:
            tp += 1
        else:
            fp += 1
        tpr = tp / n_pos
        fpr = fp / n_neg
        auc += (fpr - fpr_prev) * (tpr + tpr_prev) / 2
        tpr_prev, fpr_prev = tpr, fpr
    return float(auc)
