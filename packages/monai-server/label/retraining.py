"""
Auto-retraining pipeline for MONAI Label.

Triggers:
  - new_labels >= 50 per organ class
  - Manual trigger via API

Promotion:
  - Retrained model auto-promoted if Dice improves > 0.02
    on held-out validation set
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import numpy as np

from config import (
    MODELS_DIR,
    METRICS_DIR,
    MONAI_LABEL_DICE_IMPROVEMENT_THRESHOLD,
)

logger = logging.getLogger("monai-server.retraining")


@dataclass
class RetrainingRun:
    model_name: str
    trigger: str  # "auto" | "manual"
    started_at: float = 0.0
    completed_at: float = 0.0
    status: str = "pending"  # pending | training | validating | promoted | rejected
    baseline_dice: float = 0.0
    new_dice: float = 0.0
    dice_improvement: float = 0.0
    promoted: bool = False
    num_training_samples: int = 0
    num_validation_samples: int = 0
    epochs_completed: int = 0


class RetrainingPipeline:
    """Manage model retraining and promotion."""

    def __init__(self):
        self.history: list[RetrainingRun] = []
        self.active_run: Optional[RetrainingRun] = None

    def should_retrain(
        self,
        model_name: str,
        new_label_count: int,
        threshold: int = 50,
    ) -> bool:
        """Check if retraining should be triggered."""
        if self.active_run and self.active_run.status in ("training", "validating"):
            logger.info("Retraining already in progress for %s", self.active_run.model_name)
            return False
        return new_label_count >= threshold

    def start_retraining(
        self,
        model_name: str,
        trigger: str = "auto",
        training_data_dir: Optional[str] = None,
        validation_data_dir: Optional[str] = None,
    ) -> RetrainingRun:
        """Start a retraining run."""
        run = RetrainingRun(
            model_name=model_name,
            trigger=trigger,
            started_at=time.time(),
            status="training",
        )
        self.active_run = run

        logger.info(
            "Retraining started: model=%s trigger=%s",
            model_name, trigger,
        )

        return run

    def validate_and_promote(
        self,
        run: RetrainingRun,
        new_dice: float,
        baseline_dice: float,
    ) -> RetrainingRun:
        """Validate the retrained model and decide on promotion.

        Promotes if Dice improves by > MONAI_LABEL_DICE_IMPROVEMENT_THRESHOLD.
        """
        run.status = "validating"
        run.baseline_dice = baseline_dice
        run.new_dice = new_dice
        run.dice_improvement = new_dice - baseline_dice

        threshold = MONAI_LABEL_DICE_IMPROVEMENT_THRESHOLD

        if run.dice_improvement >= threshold:
            run.promoted = True
            run.status = "promoted"
            self._promote_model(run)
            logger.info(
                "Model PROMOTED: %s  dice %.4f → %.4f  (Δ=%.4f ≥ %.4f)",
                run.model_name, baseline_dice, new_dice,
                run.dice_improvement, threshold,
            )
        else:
            run.promoted = False
            run.status = "rejected"
            logger.info(
                "Model REJECTED: %s  dice %.4f → %.4f  (Δ=%.4f < %.4f)",
                run.model_name, baseline_dice, new_dice,
                run.dice_improvement, threshold,
            )

        run.completed_at = time.time()
        self.history.append(run)
        self.active_run = None

        self._save_run(run)
        return run

    def _promote_model(self, run: RetrainingRun) -> None:
        """Swap the production model weights with the retrained ones."""
        new_weights = MODELS_DIR / f"{run.model_name}_retrained.pt"
        prod_weights = MODELS_DIR / f"{run.model_name}.pt"
        backup = MODELS_DIR / f"{run.model_name}_backup_{int(run.started_at)}.pt"

        if prod_weights.exists():
            import shutil
            shutil.copy2(prod_weights, backup)
            logger.info("Backed up production weights → %s", backup)

        if new_weights.exists():
            import shutil
            shutil.copy2(new_weights, prod_weights)
            logger.info("Promoted retrained weights → %s", prod_weights)

            from models.registry import load_model
            load_model(run.model_name, force_reload=True)

    def _save_run(self, run: RetrainingRun) -> None:
        path = METRICS_DIR / f"retrain_{run.model_name}_{int(run.started_at)}.json"
        with open(path, "w") as f:
            json.dump(asdict(run), f, indent=2)

    def get_history(self, model_name: Optional[str] = None) -> list[dict]:
        runs = self.history
        if model_name:
            runs = [r for r in runs if r.model_name == model_name]
        return [asdict(r) for r in runs]
