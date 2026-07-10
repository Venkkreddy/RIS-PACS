"""
TD|ai Smart Intake AI Service
==============================

Accepts a free-text patient complaint / clinical indication
and returns structured DICOM tag suggestions via LLM or rule-based fallback.

Engines supported:
  - ollama     : any OpenAI-compatible model via Ollama (default: biomistral:7b)
  - kompact_ai : Kompact AI SDK when hardware arrives (swap env var only)
  - rule_based : offline keyword matching (always available as fallback)

FastAPI router is appended to the main server.py at the bottom via `include_router`.
"""

import asyncio
import json
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("medasr-intake")

# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT  (authoritative — do not shorten)
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
You are an expert radiology triage assistant. You know DICOM standards,
human anatomy, standard X-Ray view protocols, and ICD-10-CM coding.

Given a patient complaint, return ONLY a valid JSON object with EXACTLY these fields:

{
  "body_part_examined": "<ONE of the DICOM codes listed below — NEVER use anatomical names like 'lower extremity'>",
  "laterality": "R or L or B or null",
  "study_description": "SHORT PROFESSIONAL RADIOLOGY DESCRIPTION IN CAPS",
  "series_descriptions": ["BODY_PART VIEW", ...],
  "view_positions": ["AP", "LATERAL", ...],
  "reason_for_exam": "cleaned clinical reason",
  "icd10_codes": [
    {"code": "ICD10", "description": "description", "confidence": 0.85}
  ],
  "ai_notes": "optional protocol note or null",
  "urgency": "routine or urgent or stat",
  "ambiguities": []
}

=== DICOM BODY PART CODES (use ONLY these — never use anatomical names) ===
CHEST, ABDOMEN, PELVIS, SKULL,
SPINE, CSPINE, TSPINE, LSPINE,
SHOULDER, CLAVICLE, SCAPULA, STERNUM, RIBS,
ARMn, ELBOW, FOREARM, WRIST, HAND, FINGER,
HIP, THIGH, KNEE, LEG, ANKLE, FOOT, TOE

=== TRAUMA / MOBILITY KEYWORD MAPPING ===
When you see these patterns, map directly to the DICOM code:
- "fell from cycle" / "fell from bike" / "road accident" + "can't walk" / "unable to walk" → KNEE or LEG (ask laterality)
- "wrist pain after fall" → WRIST
- "head injury" / "fell and hit head" → SKULL
- "chest pain" / "breathlessness" → CHEST (no laterality needed)
- "back pain" / "lumbar" → LSPINE
- "neck pain" / "cervical" → CSPINE
- "shoulder pain" → SHOULDER (ask laterality)
- "ankle twist" / "ankle sprain" → ANKLE (ask laterality)
- "hip pain after fall" (elderly) → HIP (ask laterality)

=== STANDARD VIEWS BY BODY PART ===
CHEST: PA, LATERAL | KNEE: AP, LATERAL | ANKLE: AP, LATERAL, MORTISE
FOOT: AP, LATERAL, OBLIQUE | WRIST: PA, LATERAL | HAND: PA, OBLIQUE
SHOULDER: AP, AXIAL | ELBOW: AP, LATERAL | HIP: AP, LATERAL
SPINE: AP, LATERAL | SKULL: PA, LATERAL | PELVIS: AP | RIBS: AP, OBLIQUE
LEG: AP, LATERAL | THIGH: AP, LATERAL | FOREARM: AP, LATERAL

=== ICD-10 RULES ===
- Trauma → S-chapter; Pain → M25.3xx; Fracture → S-chapter
- Include laterality in code when available (right=1, left=2)
- Return top 3 most likely codes with confidence 0.0–1.0

=== URGENCY RULES ===
- STAT: fracture, head injury, chest pain, difficulty breathing, stroke, unconscious, major trauma
- URGENT: unable to walk, severe pain, swelling, suspected infection, high fever
- ROUTINE: everything else

=== AMBIGUITIES ARRAY (max 4 entries) ===
If key information is missing or unclear, add up to 4 items to "ambiguities".
Each item MUST have:
  - "field": one of: "laterality", "body_part", "urgency", "injury_type"
  - "question": SHORT question (max 8 words)
  - "options": list of 2–4 short answer strings (max 3 words each)

Only add an ambiguity if you genuinely cannot determine the answer from context.
Do NOT ask about laterality for CHEST, ABDOMEN, PELVIS, SKULL, SPINE, RIBS, STERNUM.
Maximum 4 ambiguity entries total.

Example ambiguities:
[
  {"field": "laterality", "question": "Which leg is affected?", "options": ["Left leg", "Right leg", "Both legs"]},
  {"field": "injury_type", "question": "Type of injury?", "options": ["Fall / Trauma", "Chronic pain", "Swelling"]}
]

If nothing is ambiguous, return: "ambiguities": []

=== OUTPUT RULES ===
- Return ONLY valid JSON — no explanation, no markdown fences, no extra text.
- body_part_examined MUST be one of the DICOM codes above.
- ambiguities must be an array (empty [] if no clarification needed).
"""

# ─────────────────────────────────────────────────────────────────────────────
# RULE-BASED FALLBACK
# ─────────────────────────────────────────────────────────────────────────────

class RuleBasedIntake:
    """
    Keyword-based matching covering ~80% of common radiology cases.
    Used when AI service is unavailable.
    """

    BODY_PARTS = {
        "chest": ("CHEST", ["PA", "LATERAL"], [("R05", "Cough", 0.5), ("R07.9", "Chest pain, unspecified", 0.7)]),
        "abdomen": ("ABDOMEN", ["AP"], [("R10.9", "Unspecified abdominal pain", 0.7)]),
        "pelvis": ("PELVIS", ["AP"], [("M79.3", "Panniculitis", 0.3)]),
        "spine": ("SPINE", ["AP", "LATERAL"], [("M54.5", "Low back pain", 0.6)]),
        "back": ("LSPINE", ["AP", "LATERAL"], [("M54.5", "Low back pain", 0.8)]),
        "lumbar": ("LSPINE", ["AP", "LATERAL"], [("M54.5", "Low back pain", 0.9)]),
        "cervical": ("CSPINE", ["AP", "LATERAL"], [("M54.2", "Cervicalgia", 0.8)]),
        "thoracic": ("TSPINE", ["AP", "LATERAL"], [("M54.6", "Pain in thoracic spine", 0.7)]),
        "skull": ("SKULL", ["PA", "LATERAL"], [("S09.90XA", "Head injury", 0.6)]),
        "head": ("SKULL", ["PA", "LATERAL"], [("S09.90XA", "Head injury", 0.5)]),
        "shoulder": ("SHOULDER", ["AP", "AXIAL"], [("M25.31", "Pain in shoulder", 0.7)]),
        "clavicle": ("CLAVICLE", ["AP"], [("S42.00", "Fracture of clavicle", 0.5)]),
        "arm": ("ARM", ["AP", "LATERAL"], [("M79.62", "Pain in upper arm", 0.6)]),
        "elbow": ("ELBOW", ["AP", "LATERAL"], [("M25.32", "Pain in elbow", 0.7)]),
        "forearm": ("FOREARM", ["AP", "LATERAL"], [("M79.63", "Pain in forearm", 0.6)]),
        "wrist": ("WRIST", ["PA", "LATERAL"], [("M25.33", "Pain in wrist", 0.7)]),
        "hand": ("HAND", ["PA", "OBLIQUE"], [("M79.64", "Pain in hand", 0.6)]),
        "finger": ("FINGER", ["PA", "LATERAL"], [("M79.64", "Pain in hand", 0.5)]),
        "hip": ("HIP", ["AP", "LATERAL"], [("M25.35", "Pain in hip", 0.7)]),
        "thigh": ("THIGH", ["AP", "LATERAL"], [("M79.65", "Pain in thigh", 0.6)]),
        "knee": ("KNEE", ["AP", "LATERAL"], [("M25.36", "Pain in knee", 0.8)]),
        "leg": ("LEG", ["AP", "LATERAL"], [("M79.67", "Pain in foot and toes", 0.4)]),
        "tibia": ("LEG", ["AP", "LATERAL"], [("S82.20", "Fracture of tibia", 0.5)]),
        "fibula": ("LEG", ["AP", "LATERAL"], [("S82.40", "Fracture of fibula", 0.5)]),
        "ankle": ("ANKLE", ["AP", "LATERAL", "MORTISE"], [("M25.37", "Pain in ankle", 0.8)]),
        "foot": ("FOOT", ["AP", "LATERAL", "OBLIQUE"], [("M79.67", "Pain in foot", 0.7)]),
        "toe": ("TOE", ["AP", "LATERAL"], [("M79.67", "Pain in foot and toes", 0.5)]),
        "ribs": ("RIBS", ["AP", "OBLIQUE"], [("S22.3", "Fracture of rib", 0.5)]),
        "sternum": ("STERNUM", ["PA", "LATERAL"], [("S22.2", "Fracture of sternum", 0.4)]),
        "scapula": ("SCAPULA", ["AP", "LATERAL"], [("S42.1", "Fracture of scapula", 0.4)]),
    }

    LATERALITY_MAP = {
        "right": "R", "rt": "R", "r/t": "R",
        "left": "L", "lt": "L", "l/t": "L",
        "bilateral": "B", "both": "B", "b/l": "B",
    }

    STAT_KEYWORDS = [
        "fracture", "head injury", "chest pain", "shortness of breath",
        "difficulty breathing", "cannot breathe", "stroke", "unconscious",
        "trauma", "accident", "rta", "fall from height",
    ]
    URGENT_KEYWORDS = [
        "severe pain", "unable to walk", "swelling", "fever", "infection",
        "suspected", "dislocation", "cannot move",
    ]
    BILATERAL_PARTS = {"CHEST", "ABDOMEN", "PELVIS", "SPINE", "CSPINE", "TSPINE", "LSPINE", "SKULL", "STERNUM"}

    def analyze(self, complaint: str, patient_age: Optional[int] = None, patient_sex: Optional[str] = None) -> dict:
        text = complaint.lower()
        words = re.split(r"[\s,./\-]+", text)

        # Detect body part
        matched_part = "CHEST"
        matched_views = ["PA", "LATERAL"]
        matched_icd = [{"code": "R07.9", "description": "Chest pain, unspecified", "confidence": 0.5}]
        for kw, (bp, views, icd_list) in self.BODY_PARTS.items():
            if kw in words or kw in text:
                matched_part = bp
                matched_views = views
                matched_icd = [{"code": c, "description": d, "confidence": conf} for c, d, conf in icd_list]
                break

        # Detect laterality
        laterality = None
        for kw, lat in self.LATERALITY_MAP.items():
            if kw in words or kw in text:
                laterality = lat
                break

        # Determine urgency
        urgency = "routine"
        for kw in self.STAT_KEYWORDS:
            if kw in text:
                urgency = "stat"
                break
        if urgency != "stat":
            for kw in self.URGENT_KEYWORDS:
                if kw in text:
                    urgency = "urgent"
                    break

        # Determine if follow-up needed
        needs_followup = (
            laterality is None
            and matched_part not in self.BILATERAL_PARTS
        )

        side_prefix = (
            "RIGHT " if laterality == "R"
            else "LEFT " if laterality == "L"
            else "BILATERAL " if laterality == "B"
            else ""
        )

        # Generate view names with laterality prefix
        series = [f"{side_prefix}{matched_part} {v}" for v in matched_views]

        return {
            "body_part_examined": matched_part,
            "laterality": laterality,
            "study_description": f"{side_prefix}{matched_part} X-RAY",
            "view_positions": matched_views,
            "series_descriptions": series,
            "reason_for_exam": complaint.strip(),
            "icd10_codes": matched_icd,
            "urgency": urgency,
            "follow_up_needed": needs_followup,
            "follow_up_question": "Which side is affected?" if needs_followup else None,
            "ai_notes": "Rule-based detection — AI service unavailable or not configured.",
            "source": "rule_based",
        }


# ─────────────────────────────────────────────────────────────────────────────
# AI SERVICE  (Ollama / Kompact AI)
# ─────────────────────────────────────────────────────────────────────────────

class IntakeAIService:
    """
    Phase 1 : BioMistral via Ollama (OpenAI-compatible API)
    Phase 2 : swap INTAKE_AI_ENGINE=kompact_ai + point URL to Kompact AI

    Zero code changes needed between phases — only env vars change.
    """

    def __init__(self):
        self.engine = os.getenv("INTAKE_AI_ENGINE", "ollama")
        self.model = os.getenv("INTAKE_AI_MODEL", "biomistral:7b")
        # Ollama base_url WITHOUT /v1 suffix (added in _call_llm)
        self.base_url = os.getenv("INTAKE_AI_URL", "http://localhost:11434")
        self.fallback = RuleBasedIntake()
        self._available: Optional[bool] = None  # cache after first check

    async def analyze(
        self,
        complaint: str,
        patient_age: Optional[int] = None,
        patient_sex: Optional[str] = None,
    ) -> dict:
        user_message = f"Patient complaint / clinical indication:\n{complaint}\n"
        if patient_age:
            user_message += f"Patient age: {patient_age}\n"
        if patient_sex:
            user_message += f"Patient sex: {patient_sex}\n"

        if self.engine == "rule_based":
            result = self.fallback.analyze(complaint, patient_age, patient_sex)
            result["source"] = "rule_based"
            return result

        try:
            # Hard 8-second budget for LLM — anything slower falls back to rule-based.
            raw = await asyncio.wait_for(self._call_llm(user_message), timeout=8.0)
            result = self._parse_json(raw)
            result["source"] = "ai"
            self._available = True
            return result
        except asyncio.TimeoutError:
            logger.warning("Intake AI timeout (>8s). Falling back to rule-based.")
            self._available = False
            result = self.fallback.analyze(complaint, patient_age, patient_sex)
            result["source"] = "rule_based"
            return result
        except Exception as exc:
            logger.warning("Intake AI unavailable (%s). Falling back to rule-based.", exc)
            self._available = False
            result = self.fallback.analyze(complaint, patient_age, patient_sex)
            result["source"] = "rule_based"
            return result

    async def _call_llm(self, message: str) -> str:
        """OpenAI-compatible call — works with Ollama, Kompact AI, LM Studio, vLLM.
        The caller wraps this with asyncio.wait_for(timeout=8.0) so we only
        set a generous httpx-level timeout as a safety net.
        """
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError:
            raise RuntimeError("openai package not installed — run: pip install openai>=1.0.0")

        client = AsyncOpenAI(
            base_url=f"{self.base_url.rstrip('/')}/v1",
            api_key="none",  # Ollama doesn't require a real key
            timeout=10.0,   # httpx safety net — asyncio.wait_for provides the real 8s limit
        )
        resp = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": message},
            ],
            temperature=0.1,
            max_tokens=512,   # Reduced — we only need a small JSON response
        )
        return resp.choices[0].message.content or "{}"

    @staticmethod
    def _parse_json(raw: str) -> dict:
        """Strip any markdown fences then parse JSON."""
        cleaned = re.sub(r"```(?:json)?", "", raw).strip()
        # Find first { ... } block
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found in LLM response")
        return json.loads(match.group())


# ─────────────────────────────────────────────────────────────────────────────
# FASTAPI ROUTER
# ─────────────────────────────────────────────────────────────────────────────

intake_router = APIRouter(prefix="/v1/intake", tags=["intake"])
_intake_service = IntakeAIService()


class IntakeRequest(BaseModel):
    complaint: str = Field(..., min_length=3, max_length=1000)
    patient_age: Optional[int] = Field(None, ge=0, le=130)
    patient_sex: Optional[str] = Field(None)
    # Answers to ambiguity questions — dict of field -> chosen option
    clarification_answers: Optional[dict] = Field(None, description="Map of field->answer from follow-up questions")


class AmbiguityItem(BaseModel):
    field: str          # laterality | body_part | urgency | injury_type
    question: str
    options: list[str]


class IntakeResponse(BaseModel):
    body_part_examined: str
    laterality: Optional[str]
    study_description: str
    series_descriptions: list[str]
    view_positions: list[str]
    reason_for_exam: str
    icd10_codes: list[dict]
    ai_notes: Optional[str]
    urgency: str
    ambiguities: list[dict]     # list of AmbiguityItem dicts
    follow_up_needed: bool      # True if ambiguities is non-empty (kept for backward compat)
    follow_up_question: Optional[str]  # kept for backward compat
    source: str  # "ai" | "rule_based"


@intake_router.post("/analyze", response_model=IntakeResponse)
async def analyze_intake(req: IntakeRequest):
    """
    Analyze free-text complaint and return structured DICOM tag suggestions.
    If `clarification_answers` is provided, they are appended to the complaint
    so the model incorporates those answers.
    """
    complaint = req.complaint.strip()

    # Append any clarification answers to the complaint text
    if req.clarification_answers:
        extras = []
        for field, answer in req.clarification_answers.items():
            if answer:
                extras.append(f"{field}: {answer}")
        if extras:
            complaint = complaint + ". Additional info: " + "; ".join(extras)

    try:
        result = await _intake_service.analyze(
            complaint=complaint,
            patient_age=req.patient_age,
            patient_sex=req.patient_sex,
        )
    except Exception as exc:
        logger.error("Intake analysis failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Intake analysis error: {exc}")

    # Ensure all required keys are present (guard against partial AI output)
    defaults = {
        "body_part_examined": "CHEST",
        "laterality": None,
        "study_description": complaint.upper()[:60],
        "series_descriptions": [],
        "view_positions": [],
        "reason_for_exam": complaint,
        "icd10_codes": [],
        "ai_notes": None,
        "urgency": "routine",
        "ambiguities": [],
        "follow_up_needed": False,
        "follow_up_question": None,
        "source": "rule_based",
    }
    for key, default in defaults.items():
        result.setdefault(key, default)

    # Normalise ambiguities — enforce max 4, ensure correct shape
    raw_amb = result.get("ambiguities", [])
    if not isinstance(raw_amb, list):
        raw_amb = []
    validated_amb = []
    for item in raw_amb[:4]:
        if isinstance(item, dict) and "question" in item and "options" in item:
            validated_amb.append({
                "field": item.get("field", "general"),
                "question": str(item["question"])[:80],
                "options": [str(o)[:40] for o in item["options"][:4] if o],
            })
    result["ambiguities"] = validated_amb
    result["follow_up_needed"] = len(validated_amb) > 0
    if validated_amb:
        result["follow_up_question"] = validated_amb[0]["question"]

    return result


@intake_router.get("/health")
async def intake_health():
    return {
        "status": "ok",
        "engine": _intake_service.engine,
        "model": _intake_service.model,
        "ai_available": _intake_service._available,
    }
