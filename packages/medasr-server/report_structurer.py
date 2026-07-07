"""
Report Structurer — Kompact AI Abstraction Layer
=================================================

This is the SINGLE FILE that needs to change when Kompact AI SDK arrives.

Current default engine: "rule_based"
  → Uses template_formatter.ReportFormatter (fully functional today)

Future engine: "kompact_ai"
  → Will call KompactAIClient from the Ziroh Labs SDK
  → No other file in the pipeline needs modification

To swap in Kompact AI:
  1. Install the Kompact AI SDK (e.g. pip install kompact-ai)
  2. Implement the "kompact_ai" branch below
  3. Change DEFAULT_ENGINE to "kompact_ai"
  4. Done — server.py, medical_dictionary.py, template_formatter.py unchanged

Author: TD|ai MedASR Team
Kompact AI integration: PENDING SDK from Ziroh Labs
"""

import logging
import os
from typing import Optional

logger = logging.getLogger("medasr-server.structurer")

# ---------------------------------------------------------------------------
# Engine selection
# ---------------------------------------------------------------------------
# Change this to "kompact_ai" once the SDK is integrated.
DEFAULT_ENGINE = os.getenv("REPORT_STRUCTURER_ENGINE", "rule_based")


class ReportStructurer:
    """
    Abstraction layer for report structuring engines.

    Supported engines:
      - "rule_based" : template_formatter.ReportFormatter (default, ships today)
      - "kompact_ai" : Ziroh Labs Kompact AI SDK (pending SDK access)

    Usage:
        structurer = ReportStructurer()                    # rule_based
        structurer = ReportStructurer(engine="kompact_ai") # kompact_ai (future)

        result = structurer.structure(
            text="No pleural effusion seen...",
            modality="CR"
        )
    """

    def __init__(self, engine: Optional[str] = None) -> None:
        self.engine = engine or DEFAULT_ENGINE
        logger.info("ReportStructurer initialized with engine='%s'", self.engine)

    def structure(self, text: str, modality: Optional[str] = None) -> dict:
        """
        Structure a corrected transcript into a formatted radiology report.

        Args:
            text:     Corrected transcript text.
            modality: DICOM modality code (CR, DX, MG, RF, FL, XA, XR).

        Returns:
            dict containing the structured report sections.
            Always includes key "structuring_engine" indicating which
            engine produced the output.

        Raises:
            NotImplementedError: If engine is "kompact_ai" and SDK is
                                  not yet implemented.
            ValueError:          If an unknown engine name is specified.
        """
        if self.engine == "rule_based":
            return self._rule_based(text, modality)

        elif self.engine == "kompact_ai":
            # ----------------------------------------------------------------
            # TODO: Implement when Kompact AI SDK is received from Ziroh Labs
            #
            # Example (SDK interface TBD):
            #   from kompact_ai import KompactAIClient
            #   client = KompactAIClient(api_key=os.getenv("KOMPACT_AI_KEY"))
            #   result = client.structure(text, modality=modality)
            #   return {**result, "structuring_engine": "kompact_ai"}
            # ----------------------------------------------------------------
            raise NotImplementedError(
                "Kompact AI integration is pending SDK access from Ziroh Labs. "
                "Use engine='rule_based' until the SDK is available. "
                "See: https://zirohlabs.com/kompact-ai"
            )

        else:
            raise ValueError(
                f"Unknown structuring engine: '{self.engine}'. "
                f"Supported: 'rule_based', 'kompact_ai'."
            )

    # ------------------------------------------------------------------
    # Private engine implementations
    # ------------------------------------------------------------------

    def _rule_based(self, text: str, modality: Optional[str]) -> dict:
        """Delegate to template_formatter.ReportFormatter."""
        from template_formatter import ReportFormatter
        result = ReportFormatter().format(text, modality)
        result["structuring_engine"] = "rule_based"
        return result

    @property
    def engine_info(self) -> dict:
        """Return metadata about the active engine."""
        descriptions = {
            "rule_based": {
                "engine": "rule_based",
                "description": "Rule-based formatter (FINDINGS/IMPRESSION/RECOMMENDATION) — ships today",
                "status": "active",
                "provider": "TD|ai internal",
            },
            "kompact_ai": {
                "engine": "kompact_ai",
                "description": "Kompact AI structured report generation",
                "status": "pending_sdk",
                "provider": "Ziroh Labs",
            },
        }
        return descriptions.get(
            self.engine,
            {"engine": self.engine, "description": "Unknown engine", "status": "unknown"},
        )
