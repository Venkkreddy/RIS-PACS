"""
MedGemma / Gemini Medical Report Formatting Module

Supports two modes:
  1. Gemini API key (direct REST) — simplest, works with GEMINI_API_KEY
  2. Vertex AI SDK — requires GCP project + service account
  3. Fallback rule-based formatting when neither is available
"""

import re
import json
import logging
from typing import Optional

import httpx
from pydantic import BaseModel

from config import settings

logger = logging.getLogger("medasr-server.medgemma")


class RadiologyReport(BaseModel):
    findings: str
    impression: str
    raw_input: Optional[str] = None
    corrections_applied: list[str] = []


MEDGEMMA_PROMPT = """You are a radiology report structuring assistant.

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


class MedGemmaCorrector:
    """Routes transcripts to Gemini/MedGemma for medical report formatting.

    Priority: Vertex AI SDK -> Gemini API key -> fallback rule-based
    """

    def __init__(self):
        self._model = None
        self._mode = "fallback"
        self._client = httpx.AsyncClient(timeout=60.0)
        self._init_backend()

    def _init_backend(self):
        if settings.VERTEX_AI_ENABLED and settings.GCP_PROJECT_ID:
            try:
                import vertexai
                from vertexai.generative_models import GenerativeModel

                vertexai.init(
                    project=settings.GCP_PROJECT_ID,
                    location=settings.GCP_LOCATION,
                )
                model_name = settings.MEDGEMMA_ENDPOINT or settings.GEMINI_MODEL
                self._model = GenerativeModel(model_name)
                self._mode = "vertex_ai"
                logger.info("LLM initialized via Vertex AI (model: %s, project: %s)", model_name, settings.GCP_PROJECT_ID)
                return
            except ImportError:
                logger.warning("google-cloud-aiplatform not installed — falling back to API key")
            except Exception as e:
                logger.warning("Vertex AI init failed: %s — falling back to API key", e)

        if settings.GEMINI_API_KEY:
            self._mode = "gemini_api"
            self._model = True
            logger.info("MedGemma initialized via Gemini API key (model: %s)", settings.GEMINI_MODEL)
            return

        logger.info("No Vertex AI or Gemini API key configured — using fallback formatting")

    async def correct_and_format(self, transcript: str) -> RadiologyReport:
        if self._mode == "gemini_api":
            return await self._call_gemini_api(transcript)
        elif self._mode == "vertex_ai" and self._model is not None:
            return await self._call_vertex_ai(transcript)
        return self.fallback_format(transcript)

    async def _call_gemini_api(self, transcript: str) -> RadiologyReport:
        """Call Gemini directly via REST with API key."""
        try:
            response = await self._client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent",
                params={"key": settings.GEMINI_API_KEY},
                json={
                    "contents": [
                        {
                            "parts": [
                                {"text": f"{MEDGEMMA_PROMPT}\n\nTranscript:\n{transcript}"}
                            ]
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.1,
                        "maxOutputTokens": 2000,
                        "responseMimeType": "application/json",
                    },
                },
            )
            response.raise_for_status()
            data = response.json()
            content = data["candidates"][0]["content"]["parts"][0]["text"]
            return self._parse_response(content, transcript)
        except Exception as e:
            logger.warning("Gemini API call failed: %s — falling back to rule-based", e)
            return self.fallback_format(transcript)

    async def _call_vertex_ai(self, transcript: str) -> RadiologyReport:
        """Call MedGemma via Vertex AI SDK."""
        try:
            prompt = f"{MEDGEMMA_PROMPT}\n\nTranscript:\n{transcript}"

            response = self._model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 2000,
                    "response_mime_type": "application/json",
                },
            )

            content = response.text.strip()
            return self._parse_response(content, transcript)
        except Exception as e:
            logger.warning("Vertex AI MedGemma call failed: %s — falling back", e)
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
            logger.error("Failed to parse response: %s", e)
            return self.fallback_format(original)

    def fallback_format(self, transcript: str) -> RadiologyReport:
        """Rule-based formatting when Gemini/MedGemma is unavailable."""
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
            corrections_applied=["rule-based formatting (Gemini/MedGemma unavailable)"],
        )
