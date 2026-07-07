"""
Rule-Based Radiology Report Formatter
======================================

Structures a corrected transcript into a formal radiology report
with FINDINGS / IMPRESSION / RECOMMENDATION sections.

Sections generated depend on the modality:
  - X-Ray (CR/DX): Findings + Impression
  - Mammogram (MG): Findings + Impression + BI-RADS Category + Recommendation
  - C-Arm / Fluoro (RF/FL/XA): Procedure Note + Findings + Impression

This module acts as the placeholder for Kompact AI structured reporting.
When the Kompact AI SDK arrives, this file is replaced and report_structurer.py
updated — nothing else in the pipeline changes.

Author: TD|ai MedASR Team
Kompact AI integration: PENDING — see report_structurer.py
"""

import re
import logging
from typing import Optional

logger = logging.getLogger("medasr-server.formatter")


# ---------------------------------------------------------------------------
# Modality metadata
# ---------------------------------------------------------------------------

MODALITY_META: dict[str, dict] = {
    "CR": {
        "name": "Chest / Skeletal X-Ray",
        "sections": ["findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": False,
    },
    "DX": {
        "name": "Digital X-Ray",
        "sections": ["findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": False,
    },
    "XR": {
        "name": "Plain X-Ray",
        "sections": ["findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": False,
    },
    "MG": {
        "name": "Mammography",
        "sections": ["findings", "impression", "birads", "recommendation"],
        "has_recommendation": True,
        "has_birads": True,
        "has_procedure_note": False,
    },
    "RF": {
        "name": "Fluoroscopy / C-Arm",
        "sections": ["procedure_note", "findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": True,
    },
    "FL": {
        "name": "Fluoroscopy",
        "sections": ["procedure_note", "findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": True,
    },
    "XA": {
        "name": "X-Ray Angiography / C-Arm",
        "sections": ["procedure_note", "findings", "impression"],
        "has_recommendation": False,
        "has_birads": False,
        "has_procedure_note": True,
    },
}

# BI-RADS category descriptions for mammography
BIRADS_DESCRIPTIONS: dict[int, str] = {
    0: "Incomplete — Additional imaging evaluation and/or prior mammograms for comparison needed.",
    1: "Negative — Continue routine annual screening mammography.",
    2: "Benign — Continue routine annual screening mammography.",
    3: "Probably Benign — Short-interval (6-month) follow-up or continued surveillance mammography.",
    4: "Suspicious — Tissue sampling is recommended.",
    5: "Highly Suggestive of Malignancy — Tissue sampling is recommended.",
    6: "Known Biopsy-Proven Malignancy — Used for imaging findings in patients whose biopsies have already shown malignancy.",
}

# Sentence splitter
_SENT_RE = re.compile(r"(?<=[.!?])\s+")

# Section header patterns to split an existing dictated report
_SECTION_PATTERNS = {
    "findings": re.compile(
        r"\b(findings|finding)\s*[:—\-]?\s*", re.IGNORECASE
    ),
    "impression": re.compile(
        r"\b(impression|conclusion|summary|assessment)\s*[:—\-]?\s*",
        re.IGNORECASE,
    ),
    "recommendation": re.compile(
        r"\b(recommendation|recommend|follow.?up)\s*[:—\-]?\s*", re.IGNORECASE
    ),
    "procedure_note": re.compile(
        r"\b(procedure|technique|clinical indication|indication)\s*[:—\-]?\s*",
        re.IGNORECASE,
    ),
}


def _split_sentences(text: str) -> list[str]:
    parts = _SENT_RE.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def _capitalize(text: str) -> str:
    if not text:
        return text
    return text[0].upper() + text[1:]


def _ensure_period(text: str) -> str:
    text = text.strip()
    if text and not text[-1] in ".!?":
        text += "."
    return text


def _extract_sections(text: str) -> dict[str, str]:
    """
    Try to split a dictated text that already contains section markers.
    Returns a dict with whatever was found; missing keys = empty string.
    """
    lower = text.lower()
    positions: list[tuple[int, str]] = []

    for section_name, pat in _SECTION_PATTERNS.items():
        m = pat.search(lower)
        if m:
            positions.append((m.start(), section_name))

    if not positions:
        return {"raw": text}

    positions.sort()
    sections: dict[str, str] = {}
    for i, (start, name) in enumerate(positions):
        # Content starts after the matched header
        header_end = _SECTION_PATTERNS[name].search(lower, start).end()
        content_end = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        sections[name] = text[header_end:content_end].strip()

    # Text before the first header = prefix (often just intro)
    first_start = positions[0][0]
    prefix = text[:first_start].strip()
    if prefix:
        sections.setdefault("findings", prefix)

    return sections


# ---------------------------------------------------------------------------
# Per-modality formatters
# ---------------------------------------------------------------------------

class _XRayFormatter:
    """
    Structures a corrected transcript into an X-Ray radiology report.

    Output sections: FINDINGS · IMPRESSION
    """

    def format(self, text: str) -> dict:
        sections = _extract_sections(text)

        if "findings" in sections and "impression" in sections:
            findings = _ensure_period(_capitalize(sections["findings"]))
            impression = _ensure_period(_capitalize(sections["impression"]))
        else:
            # Heuristic: last sentence(s) become the impression
            sentences = _split_sentences(sections.get("raw", text))
            if len(sentences) <= 1:
                findings = _ensure_period(_capitalize(text))
                impression = "Clinical correlation recommended."
            elif len(sentences) == 2:
                findings = _ensure_period(_capitalize(sentences[0]))
                impression = _ensure_period(_capitalize(sentences[1]))
            else:
                # Last sentence as impression, rest as findings
                impression = _ensure_period(_capitalize(sentences[-1]))
                findings = _ensure_period(
                    _capitalize(" ".join(sentences[:-1]))
                )

        return {
            "findings": findings,
            "impression": impression,
        }


class _MammogramFormatter:
    """
    Structures a corrected transcript into a Mammography report.

    Output sections: FINDINGS · IMPRESSION · BI-RADS CATEGORY · RECOMMENDATION
    """

    _BIRADS_RE = re.compile(
        r"BI-?RADS\s*(?:category\s*)?(\d)", re.IGNORECASE
    )
    _BIRADS_WORD_RE = re.compile(
        r"\bcategory\s+(one|two|three|four|five|six|zero)\b", re.IGNORECASE
    )
    _WORD_TO_NUM = {
        "zero": 0, "one": 1, "two": 2, "three": 3,
        "four": 4, "five": 5, "six": 6,
    }

    def _extract_birads(self, text: str) -> Optional[int]:
        m = self._BIRADS_RE.search(text)
        if m:
            return int(m.group(1))
        m = self._BIRADS_WORD_RE.search(text)
        if m:
            return self._WORD_TO_NUM.get(m.group(1).lower())
        return None

    def format(self, text: str) -> dict:
        sections = _extract_sections(text)
        raw = sections.get("raw", text)

        birads_num = self._extract_birads(text)

        if "findings" in sections and "impression" in sections:
            findings = _ensure_period(_capitalize(sections["findings"]))
            impression = _ensure_period(_capitalize(sections["impression"]))
        else:
            sentences = _split_sentences(raw)
            if len(sentences) <= 1:
                findings = _ensure_period(_capitalize(raw))
                impression = (
                    "No evidence of malignancy. Clinical correlation recommended."
                )
            elif len(sentences) == 2:
                findings = _ensure_period(_capitalize(sentences[0]))
                impression = _ensure_period(_capitalize(sentences[1]))
            else:
                impression = _ensure_period(_capitalize(sentences[-1]))
                findings = _ensure_period(
                    _capitalize(" ".join(sentences[:-1]))
                )

        # BI-RADS
        if birads_num is not None and birads_num in BIRADS_DESCRIPTIONS:
            birads_str = f"BI-RADS {birads_num}"
            recommendation = BIRADS_DESCRIPTIONS[birads_num]
        else:
            birads_str = None
            recommendation = sections.get(
                "recommendation",
                "Clinical correlation and follow-up as clinically indicated.",
            )

        result: dict = {
            "findings": findings,
            "impression": impression,
            "recommendation": _ensure_period(recommendation),
        }
        if birads_str:
            result["birads_category"] = birads_str

        return result


class _CArmFormatter:
    """
    Structures a corrected transcript into a C-Arm / Fluoroscopy procedure note.

    Output sections: PROCEDURE NOTE · FINDINGS · IMPRESSION
    """

    def format(self, text: str) -> dict:
        sections = _extract_sections(text)

        if "procedure_note" in sections:
            procedure_note = _ensure_period(
                _capitalize(sections["procedure_note"])
            )
        else:
            procedure_note = "Fluoroscopic guidance was used throughout the procedure."

        if "findings" in sections and "impression" in sections:
            findings = _ensure_period(_capitalize(sections["findings"]))
            impression = _ensure_period(_capitalize(sections["impression"]))
        else:
            raw = sections.get("raw", text)
            sentences = _split_sentences(raw)
            if len(sentences) <= 1:
                findings = _ensure_period(_capitalize(raw))
                impression = "Procedure completed successfully. Clinical correlation recommended."
            elif len(sentences) == 2:
                findings = _ensure_period(_capitalize(sentences[0]))
                impression = _ensure_period(_capitalize(sentences[1]))
            else:
                impression = _ensure_period(_capitalize(sentences[-1]))
                findings = _ensure_period(
                    _capitalize(" ".join(sentences[:-1]))
                )

        return {
            "procedure_note": procedure_note,
            "findings": findings,
            "impression": impression,
        }


# ---------------------------------------------------------------------------
# Public facade
# ---------------------------------------------------------------------------

_XRAY_FORMATTER = _XRayFormatter()
_MAMMO_FORMATTER = _MammogramFormatter()
_CARM_FORMATTER = _CArmFormatter()

_FORMATTER_MAP: dict[str, object] = {
    "CR": _XRAY_FORMATTER,
    "DX": _XRAY_FORMATTER,
    "XR": _XRAY_FORMATTER,
    "MG": _MAMMO_FORMATTER,
    "RF": _CARM_FORMATTER,
    "FL": _CARM_FORMATTER,
    "XA": _CARM_FORMATTER,
}


class ReportFormatter:
    """
    Rule-based radiology report formatter.

    This is the Kompact AI placeholder — when the SDK is received,
    only report_structurer.py needs to change; this class stays as fallback.
    """

    def format(self, text: str, modality: Optional[str] = None) -> dict:
        """
        Format a corrected transcript into a structured radiology report.

        Args:
            text: Corrected transcript text.
            modality: DICOM modality code. Defaults to 'CR' (X-Ray).

        Returns:
            dict with modality-appropriate sections (findings, impression, etc.)
        """
        mod = (modality or "CR").upper()
        meta = MODALITY_META.get(mod, MODALITY_META["CR"])
        formatter = _FORMATTER_MAP.get(mod, _XRAY_FORMATTER)

        logger.info(
            "Formatting report as %s (%s) using rule-based engine",
            mod,
            meta["name"],
        )

        structured = formatter.format(text)
        structured["modality_name"] = meta["name"]
        return structured

    def get_supported_modalities(self) -> list[str]:
        return list(MODALITY_META.keys())
