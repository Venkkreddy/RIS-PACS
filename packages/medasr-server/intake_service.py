"""
TD|ai Smart Intake Service
===========================

Architecture:
  Layer 1 — ClinicalReasoningEngine (deterministic, <20ms, offline)
    Pre-analyzes complaint: mechanism, symptoms, region, laterality, urgency.
    Narrows candidates so the LLM has a focused task.

  Layer 2 — LLM (llama3.2:3b via Ollama / Kompact AI in production)
    Receives pre-analyzed context + complaint.
    Returns structured JSON with confirmed body part, ICD-10, ambiguities.
    Model swap: set INTAKE_AI_MODEL env var. No code changes needed.

  Layer 3 — IntakeRefiner (deterministic, <5ms)
    Merges clarification answers into final DICOM result.
    Handles special cases: trauma survey, bilateral, pediatric.

Endpoints:
  POST /v1/intake/analyze  — initial analysis (returns result + questions)
  POST /v1/intake/refine   — process clarification answers → final result
  GET  /v1/intake/health   — engine status

FastAPI router included in server.py via `include_router`.
"""

import asyncio
import json
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medical_intake_engine import (
    ClinicalReasoningEngine,
    MissingInfoDetector,
    IntakeRefiner,
    build_intake_prompt,
    BODY_PART_VIEWS,
    BODY_PART_ICD10,
    REGION_CANDIDATES,
    NON_LATERAL_PARTS,
)

logger = logging.getLogger("medasr-intake")

# ─────────────────────────────────────────────────────────────────────────────
# Shared engine instances
# ─────────────────────────────────────────────────────────────────────────────

_reasoning_engine  = ClinicalReasoningEngine()
_missing_detector  = MissingInfoDetector()
_refiner           = IntakeRefiner()


# ─────────────────────────────────────────────────────────────────────────────
# LLM service  (Ollama / Kompact AI)
# ─────────────────────────────────────────────────────────────────────────────

class IntakeLLMService:
    """
    Calls the LLM with pre-analyzed clinical context.
    The model's job: confirm/refine body part, laterality, ICD-10, notes.
    NOT to diagnose from scratch — the ClinicalReasoningEngine already did that.

    Swap to Kompact AI: set INTAKE_AI_ENGINE=kompact_ai + INTAKE_AI_URL=<url>
    """

    def __init__(self):
        self.engine   = os.getenv("INTAKE_AI_ENGINE", "ollama")
        self.model    = os.getenv("INTAKE_AI_MODEL",  "llama3.2:1b")
        self.base_url = os.getenv("INTAKE_AI_URL",    "http://host.docker.internal:11434")
        self.timeout  = float(os.getenv("INTAKE_AI_TIMEOUT", "15"))
        self._available: Optional[bool] = None

    async def call(
        self,
        clinical_context: dict,
        timeout: float = 0,
    ) -> Optional[dict]:
        """
        Returns parsed JSON dict or None if unavailable/timeout.
        Caller should fall back to pre-analysis result if None returned.
        """
        t = timeout if timeout > 0 else self.timeout
        system_prompt, user_message = build_intake_prompt(clinical_context)

        try:
            raw = await asyncio.wait_for(
                self._call_llm(system_prompt, user_message),
                timeout=t,
            )
            result = self._parse_json(raw)
            result["source"] = "ai"
            self._available = True
            logger.info("LLM intake analysis OK (model=%s)", self.model)
            return result
        except asyncio.TimeoutError:
            logger.warning("LLM intake timeout (>%ss) — using pre-analysis", timeout)
            self._available = False
            return None
        except Exception as exc:
            logger.warning("LLM intake error: %s — using pre-analysis", exc)
            self._available = False
            return None

    async def _call_llm(self, system_prompt: str, user_message: str) -> str:
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError:
            raise RuntimeError("openai package not installed")

        client = AsyncOpenAI(
            base_url=f"{self.base_url.rstrip('/')}/v1",
            api_key="none",
            timeout=15.0,
        )
        resp = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
            temperature=0.05,   # Very low — we want consistent JSON
            max_tokens=600,
        )
        return resp.choices[0].message.content or "{}"

    @staticmethod
    def _parse_json(raw: str) -> dict:
        cleaned = re.sub(r"```(?:json)?", "", raw).strip()
        match   = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("No JSON in LLM response")
        data = json.loads(match.group())
        # Ensure ambiguities is always a list
        if not isinstance(data.get("ambiguities"), list):
            data["ambiguities"] = []
        return data


_llm_service = IntakeLLMService()


# ─────────────────────────────────────────────────────────────────────────────
# Core analysis pipeline
# ─────────────────────────────────────────────────────────────────────────────

async def run_intake_analysis(
    complaint: str,
    patient_age: Optional[int] = None,
    patient_sex: Optional[str] = None,
    clarification_answers: Optional[dict] = None,
    run_llm: bool = True,
) -> dict:
    """
    Full pipeline:
    1. ClinicalReasoningEngine  → clinical context (always, fast)
    2. LLM                      → structured result (if available)
    3. IntakeRefiner             → merge + build final result

    If LLM times out or errors, builds result from pre-analysis directly.
    """
    # Clean complaint
    complaint = re.sub(r"</s>", "", complaint, flags=re.IGNORECASE).strip()
    answers   = clarification_answers or {}

    # ── Layer 1: Clinical reasoning (< 20ms) ──────────────────────────────
    ctx = _reasoning_engine.analyze(
        complaint=complaint,
        patient_age=patient_age,
        patient_sex=patient_sex,
        clarification_answers=answers,
    )
    ctx["patient_age"] = patient_age
    ctx["patient_sex"] = patient_sex

    is_pediatric = ctx.get("is_pediatric", False)
    urgency      = ctx.get("urgency", "routine")
    mechanism    = ctx.get("mechanism", {})
    region       = ctx.get("clinical_region", "CHEST")
    candidates   = ctx.get("candidate_body_parts", [])
    known_part   = ctx.get("known_body_part")
    laterality   = ctx.get("laterality")

    # ── High velocity trauma → trauma survey, skip LLM ────────────────────
    if mechanism.get("velocity") == "high" and not known_part:
        return _refiner.build_trauma_survey(complaint, is_pediatric)

    # ── Layer 2: LLM call (background, up to 12s) ────────────────────────
    llm_result = None
    if run_llm and _llm_service.engine != "rule_based":
        llm_result = await _llm_service.call(ctx, timeout=12.0)

    if llm_result:
        # Use LLM result — ensure all required fields present
        _ensure_defaults(llm_result, complaint)
        # Normalize ambiguities from LLM to our full option format
        llm_result["ambiguities"] = _normalize_ambiguities(
            llm_result.get("ambiguities", []),
            ctx,
        )
        llm_result["follow_up_needed"]    = len(llm_result["ambiguities"]) > 0
        llm_result["follow_up_question"]  = (
            llm_result["ambiguities"][0].get("question")
            if llm_result["ambiguities"] else None
        )
        llm_result["is_pediatric"]        = is_pediatric
        if is_pediatric:
            note = llm_result.get("ai_notes") or ""
            if "Pediatric" not in note:
                llm_result["ai_notes"] = (
                    note + " | ⚠ Pediatric patient — growth plate injury possible."
                    if note else "⚠ Pediatric patient — growth plate injury possible."
                )
        return llm_result

    # ── Layer 3: Build from pre-analysis (LLM unavailable) ────────────────
    questions = _missing_detector.get_follow_up_questions(ctx, complaint)

    # Still unclear after all analysis → survey
    if not known_part and not questions:
        return _refiner.build_survey(region, complaint, urgency, is_pediatric)

    body_part  = known_part or (candidates[0] if candidates else "CHEST")
    confidence = _calc_confidence(known_part, laterality, len(questions))

    return _refiner.build_result(
        body_part=body_part,
        laterality=laterality,
        urgency=urgency,
        complaint=complaint,
        follow_up_questions=questions,
        confidence=confidence,
        is_pediatric=is_pediatric,
        mechanism=mechanism,
        patient_age=patient_age,
    )


def _ensure_defaults(result: dict, complaint: str) -> None:
    defaults = {
        "body_part_examined":  "CHEST",
        "laterality":          None,
        "study_description":   "",
        "series_descriptions": [],
        "view_positions":      [],
        "reason_for_exam":     complaint,
        "icd10_codes":         [],
        "ai_notes":            None,
        "urgency":             "routine",
        "ambiguities":         [],
        "follow_up_needed":    False,
        "follow_up_question":  None,
        "confidence":          0.7,
        "source":              "ai",
        "is_pediatric":        False,
    }
    for k, v in defaults.items():
        result.setdefault(k, v)

    # Sanitize body part
    bp = str(result["body_part_examined"]).upper().strip()
    bp = re.sub(r"[<>\[\]]", "", bp)
    if "ONE OF:" in bp:
        parts = re.split(r"[\s,]+", bp)
        bp = parts[-1]
    if bp not in BODY_PART_VIEWS:
        bp = "CHEST"
    result["body_part_examined"] = bp

    # Sanitize laterality
    lat = result["laterality"]
    if isinstance(lat, str):
        lat = lat.upper().strip()
        lat = re.sub(r"[<>\[\]]", "", lat)
        if lat in ("RIGHT", "R"):
            lat = "R"
        elif lat in ("LEFT", "L"):
            lat = "L"
        elif lat in ("BILATERAL", "BOTH", "B"):
            lat = "B"
        else:
            lat = None
    else:
        lat = None
    result["laterality"] = lat

    # Ensure view positions
    vps = result.get("view_positions")
    if not isinstance(vps, list) or not vps or any("<" in str(v) for v in vps):
        vps = BODY_PART_VIEWS.get(bp, ["AP", "LATERAL"])
    result["view_positions"] = vps

    # Generate descriptions if missing or placeholder
    side = ("RIGHT " if lat == "R"
            else "LEFT " if lat == "L"
            else "BILATERAL " if lat == "B"
            else "")
    
    sd = result.get("study_description")
    if not sd or "<" in str(sd) or "E.G." in str(sd).upper():
        result["study_description"] = f"{side}{bp} X-RAY"

    sds = result.get("series_descriptions")
    if not isinstance(sds, list) or not sds or any("<" in str(s) for s in sds):
        result["series_descriptions"] = [f"{side}{bp} {v}" for v in vps]


def _normalize_ambiguities(raw: list, ctx: dict) -> list:
    """
    Normalise LLM ambiguity items — add rich option objects if missing.
    Also enforce max 3.
    """
    if not raw:
        # LLM returned no ambiguities — use MissingInfoDetector directly
        return _missing_detector.get_follow_up_questions(ctx, ctx.get("complaint", ""))

    normalized = []
    for item in raw[:3]:
        if not isinstance(item, dict):
            continue
        # If LLM gave simple string options, convert to rich format
        opts = item.get("options", [])
        rich_opts = []
        for opt in opts:
            if isinstance(opt, dict):
                rich_opts.append(opt)
            elif isinstance(opt, str):
                rich_opts.append({
                    "label": opt, "value": opt,
                    "sublabel": "", "icon": "•"
                })
        if not rich_opts:
            continue
        normalized.append({
            "id":       item.get("id", item.get("field", "general")),
            "question": str(item.get("question", ""))[:120],
            "type":     item.get("type", "single_select"),
            "required": item.get("required", True),
            "options":  rich_opts,
        })
    return normalized


def _calc_confidence(known_part, laterality, n_questions) -> float:
    base = 0.5
    if known_part:    base += 0.3
    if laterality:    base += 0.15
    base -= n_questions * 0.08
    return round(min(max(base, 0.3), 0.98), 2)


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI Router
# ─────────────────────────────────────────────────────────────────────────────

intake_router = APIRouter(prefix="/v1/intake", tags=["intake"])


class IntakeRequest(BaseModel):
    complaint:              str            = Field(..., min_length=2, max_length=1000)
    patient_age:            Optional[int]  = Field(None, ge=0, le=130)
    patient_sex:            Optional[str]  = Field(None)
    clarification_answers:  Optional[dict] = Field(None)


class RefineRequest(BaseModel):
    original_complaint:    str            = Field(..., min_length=2, max_length=1000)
    answers:               dict           = Field(...)
    patient_age:           Optional[int]  = Field(None, ge=0, le=130)
    patient_sex:           Optional[str]  = Field(None)


class IntakeResponse(BaseModel):
    body_part_examined:  str
    laterality:          Optional[str]
    study_description:   str
    series_descriptions: list[str]
    view_positions:      list[str]
    reason_for_exam:     str
    icd10_codes:         list[dict]
    ai_notes:            Optional[str]
    urgency:             str
    ambiguities:         list[dict]
    follow_up_needed:    bool
    follow_up_question:  Optional[str]
    confidence:          Optional[float]
    source:              str
    is_pediatric:        Optional[bool]


@intake_router.post("/analyze", response_model=IntakeResponse)
async def analyze_intake(req: IntakeRequest):
    """
    Analyze free-text complaint.
    Returns structured DICOM tags + follow-up questions (if needed).

    Flow:
      1. ClinicalReasoningEngine pre-analyzes in <20ms
      2. LLM refines in background (llama3.2:3b, max 12s)
      3. If LLM unavailable → uses pre-analysis result

    Frontend should show pre-analysis result INSTANTLY from its own
    rule-based JS engine, then call this endpoint. If this returns
    a better AI result, update the card with a toast notification.
    """
    result = await run_intake_analysis(
        complaint=req.complaint,
        patient_age=req.patient_age,
        patient_sex=req.patient_sex,
        clarification_answers=req.clarification_answers,
    )
    return result


@intake_router.post("/refine", response_model=IntakeResponse)
async def refine_intake(req: RefineRequest):
    """
    Process clarification answers and return final DICOM tags.
    This is called after the radiographer answers follow-up questions.
    The LLM is NOT called for refinement — pure deterministic mapping.
    Response time: < 50ms guaranteed.
    """
    result = await run_intake_analysis(
        complaint=req.original_complaint,
        patient_age=req.patient_age,
        patient_sex=req.patient_sex,
        clarification_answers=req.answers,
        run_llm=False,   # Answers are clear — no LLM needed
    )
    result["source"] = "ai"  # Result is confirmed, not provisional
    return result


@intake_router.get("/health")
async def intake_health():
    return {
        "status":       "ok",
        "engine":       _llm_service.engine,
        "model":        _llm_service.model,
        "ai_available": _llm_service._available,
    }
