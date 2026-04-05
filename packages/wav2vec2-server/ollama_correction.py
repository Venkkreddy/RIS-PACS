"""
Ollama-based Medical Report Formatting Module

Calls a local Ollama instance for radiology transcript correction and formatting.
Falls back to rule-based formatting when Ollama is unavailable.
"""

import re
import json
import logging
from typing import Optional

import httpx
from pydantic import BaseModel

from config import settings

logger = logging.getLogger("wav2vec2-server.ollama")


class RadiologyReport(BaseModel):
    findings: str
    impression: str
    raw_input: Optional[str] = None
    corrections_applied: list[str] = []


RADIOLOGY_PROMPT = """You are a radiology report structuring assistant.

Task:
Given a medical speech-to-text transcript from a radiologist, structure it into a
proper radiology report.

Instructions:
- Fix any remaining medical terminology errors
- Correct grammar and punctuation
- Expand abbreviations appropriately (e.g., "ggo" -> "ground-glass opacity")
- Do NOT change clinical meaning
- Keep it concise and professional
- Format as a proper radiology report with Findings and Impression sections

You MUST respond with valid JSON in this exact format:
{
  "findings": "Detailed findings paragraph(s)",
  "impression": "Concise clinical impression",
  "corrections_applied": ["list of corrections made"]
}

Do not include any text outside the JSON object."""


class OllamaCorrector:
    """Routes transcripts to local Ollama for medical report formatting.

    Falls back to rule-based formatting if Ollama is unavailable.
    """

    def __init__(self):
        self._mode = "fallback"
        self._client = httpx.AsyncClient(timeout=90.0)
        self._init_backend()

    def _init_backend(self):
        if settings.OLLAMA_URL:
            try:
                resp = httpx.get(f"{settings.OLLAMA_URL}/api/tags", timeout=5.0)
                if resp.status_code == 200:
                    self._mode = "ollama"
                    models = [m["name"] for m in resp.json().get("models", [])]
                    logger.info(
                        "Ollama connected at %s (models: %s, using: %s)",
                        settings.OLLAMA_URL,
                        ", ".join(models[:5]) or "none loaded",
                        settings.OLLAMA_MODEL,
                    )
                    return
            except Exception as e:
                logger.info("Ollama not reachable at %s: %s", settings.OLLAMA_URL, e)

        logger.info("Ollama unavailable — using fallback formatting")

    async def correct_and_format(self, transcript: str) -> RadiologyReport:
        if self._mode == "ollama":
            return await self._call_ollama(transcript)
        return self.fallback_format(transcript)

    async def _call_ollama(self, transcript: str) -> RadiologyReport:
        try:
            response = await self._client.post(
                f"{settings.OLLAMA_URL}/api/generate",
                json={
                    "model": settings.OLLAMA_MODEL,
                    "prompt": f"{RADIOLOGY_PROMPT}\n\nTranscript:\n{transcript}",
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.1, "num_predict": 2000},
                },
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("response", "").strip()
            return self._parse_response(content, transcript)
        except Exception as e:
            logger.warning("Ollama call failed: %s — falling back to rule-based", e)
            return self.fallback_format(transcript)

    def _parse_response(self, content: str, original: str) -> RadiologyReport:
        try:
            content = content.strip()
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                content = json_match.group()

            parsed = json.loads(content)
            return RadiologyReport(
                findings=parsed.get("findings", ""),
                impression=parsed.get("impression", ""),
                raw_input=original,
                corrections_applied=parsed.get("corrections_applied", []),
            )
        except (json.JSONDecodeError, KeyError) as e:
            logger.error("Failed to parse Ollama response: %s", e)
            return self.fallback_format(original)

    def fallback_format(self, transcript: str) -> RadiologyReport:
        text = transcript.strip()

        impression_markers = ["impression", "conclusion", "summary"]
        findings = text
        impression = ""

        text_lower = text.lower()
        for marker in impression_markers:
            idx = text_lower.rfind(marker)
            if idx != -1:
                colon_idx = text.find(":", idx)
                split_point = colon_idx + 1 if colon_idx != -1 and colon_idx < idx + len(marker) + 3 else idx + len(marker)
                findings = text[:idx].strip().rstrip(".")
                impression = text[split_point:].strip()
                break

        findings_markers = ["findings", "finding"]
        for marker in findings_markers:
            idx = findings.lower().find(marker)
            if idx != -1:
                colon_idx = findings.find(":", idx)
                start = colon_idx + 1 if colon_idx != -1 and colon_idx < idx + len(marker) + 3 else idx + len(marker)
                findings = findings[start:].strip()
                break

        if not findings:
            findings = text

        if not impression:
            sentences = re.split(r"[.!?]+", findings)
            meaningful = [s.strip() for s in sentences if len(s.strip()) > 10]
            if meaningful:
                impression = "Clinical correlation recommended." if len(meaningful) > 2 else meaningful[-1] + "."

        findings = findings.strip().rstrip(".")
        if findings and not findings.endswith("."):
            findings += "."
        impression = impression.strip().rstrip(".")
        if impression and not impression.endswith("."):
            impression += "."

        return RadiologyReport(
            findings=findings,
            impression=impression or "Clinical correlation recommended.",
            raw_input=transcript,
            corrections_applied=["rule-based formatting (Ollama unavailable)"],
        )
