"""
MONAI Label active learning configuration.

Strategies:
  - epistemic:     MC-Dropout uncertainty sampling (dropout at inference)
  - random:        baseline diversity sampling
  - tta_epistemic: test-time augmentation uncertainty

Deployment:
  monailabel start_server --app radiology --studies orthanc://host:8042

Auto-trigger retraining when new_labels >= threshold per organ class.
Track inter-annotator agreement via Fleiss' Kappa.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from config import (
    MONAI_LABEL_URL,
    MONAI_LABEL_RETRAIN_THRESHOLD,
    MONAI_LABEL_STRATEGIES,
    ORTHANC_URL,
)

logger = logging.getLogger("monai-server.active_learning")


@dataclass
class LabelStats:
    label: str
    total_annotations: int = 0
    new_since_last_train: int = 0
    annotator_ids: list[str] = field(default_factory=list)
    fleiss_kappa: Optional[float] = None


class ActiveLearningManager:
    """Manage MONAI Label active learning loop."""

    def __init__(self):
        self.label_stats: dict[str, LabelStats] = {}
        self.strategies = MONAI_LABEL_STRATEGIES
        self.current_strategy_idx = 0

    def get_monailabel_server_config(self) -> dict:
        """Configuration for monailabel start_server command."""
        return {
            "command": "monailabel start_server",
            "args": {
                "--app": "radiology",
                "--studies": f"orthanc://{ORTHANC_URL.replace('http://', '')}",
                "--conf": "models deepedit",
                "--host": "0.0.0.0",
                "--port": "8000",
            },
            "strategies": self.strategies,
            "active_strategy": self.strategies[self.current_strategy_idx],
        }

    def get_next_sample(self, strategy: Optional[str] = None) -> dict:
        """Select the next sample for annotation using the active strategy."""
        strategy = strategy or self.strategies[self.current_strategy_idx]

        if strategy == "epistemic":
            return self._epistemic_sampling()
        elif strategy == "tta_epistemic":
            return self._tta_epistemic_sampling()
        else:
            return self._random_sampling()

    def record_annotation(
        self,
        label: str,
        annotator_id: str,
        study_uid: str,
    ) -> dict:
        """Record a new annotation and check if retraining should trigger."""
        stats = self.label_stats.setdefault(label, LabelStats(label=label))
        stats.total_annotations += 1
        stats.new_since_last_train += 1
        if annotator_id not in stats.annotator_ids:
            stats.annotator_ids.append(annotator_id)

        should_retrain = stats.new_since_last_train >= MONAI_LABEL_RETRAIN_THRESHOLD

        return {
            "label": label,
            "total_annotations": stats.total_annotations,
            "new_since_last_train": stats.new_since_last_train,
            "threshold": MONAI_LABEL_RETRAIN_THRESHOLD,
            "should_retrain": should_retrain,
        }

    def compute_fleiss_kappa(
        self,
        label: str,
        annotation_matrix: np.ndarray,
    ) -> float:
        """Compute Fleiss' Kappa for inter-annotator agreement.

        Args:
            label: organ/finding class name
            annotation_matrix: shape (n_subjects, n_categories)
                Each row sums to the number of raters.
        """
        n_subjects, n_categories = annotation_matrix.shape
        n_raters = annotation_matrix[0].sum()

        if n_raters <= 1 or n_subjects == 0:
            return 0.0

        p_j = annotation_matrix.sum(axis=0) / (n_subjects * n_raters)
        P_e = (p_j ** 2).sum()

        P_i = (annotation_matrix ** 2).sum(axis=1) - n_raters
        P_i = P_i / (n_raters * (n_raters - 1))
        P_bar = P_i.mean()

        if abs(1 - P_e) < 1e-10:
            kappa = 1.0
        else:
            kappa = (P_bar - P_e) / (1 - P_e)

        stats = self.label_stats.setdefault(label, LabelStats(label=label))
        stats.fleiss_kappa = float(kappa)

        return float(kappa)

    def rotate_strategy(self) -> str:
        """Cycle to the next active learning strategy."""
        self.current_strategy_idx = (self.current_strategy_idx + 1) % len(self.strategies)
        strategy = self.strategies[self.current_strategy_idx]
        logger.info("Rotated to strategy: %s", strategy)
        return strategy

    def reset_label_count(self, label: str) -> None:
        if label in self.label_stats:
            self.label_stats[label].new_since_last_train = 0

    def get_all_stats(self) -> dict:
        return {
            label: {
                "total": s.total_annotations,
                "new": s.new_since_last_train,
                "annotators": len(s.annotator_ids),
                "fleiss_kappa": s.fleiss_kappa,
            }
            for label, s in self.label_stats.items()
        }

    # ── Sampling strategies ──────────────────────────────────────────

    def _epistemic_sampling(self) -> dict:
        """MC-Dropout: run inference N times with dropout enabled,
        select the sample with highest prediction variance."""
        return {
            "strategy": "epistemic",
            "method": "mc_dropout",
            "num_forward_passes": 20,
            "dropout_rate": 0.2,
            "selection": "max_variance",
            "description": (
                "Enable dropout at inference, run 20 forward passes, "
                "select the study with highest variance in predictions."
            ),
        }

    def _tta_epistemic_sampling(self) -> dict:
        """Test-Time Augmentation: apply random transforms at inference,
        measure prediction variance across augmented versions."""
        return {
            "strategy": "tta_epistemic",
            "method": "test_time_augmentation",
            "num_augmentations": 10,
            "augmentations": [
                "RandFlip", "RandRotate90", "RandGaussianNoise", "RandZoom"
            ],
            "selection": "max_variance",
            "description": (
                "Apply 10 random augmentations at inference, "
                "measure variance, select highest uncertainty."
            ),
        }

    def _random_sampling(self) -> dict:
        return {
            "strategy": "random",
            "method": "uniform_random",
            "description": "Uniformly random sample for baseline diversity.",
        }
