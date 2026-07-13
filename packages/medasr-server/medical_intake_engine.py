"""
TD|ai Medical Intake Engine
============================

Three-layer clinical reasoning system for smart patient intake.

Layer 1: ClinicalReasoningEngine
  - Analyzes complaint using mechanism, symptoms, and clinical context
  - Fast deterministic pre-analysis (<20ms) — no LLM needed
  - Narrows candidates so the LLM has a focused task

Layer 2: MissingInfoDetector
  - Decides exactly what questions to ask (max 3)
  - Returns questions in order of clinical importance
  - Questions shown one at a time in the UI

Layer 3: IntakeRefiner
  - Maps answers + LLM output → final DICOM tags
  - Pure mapping, no model needed

The LLM (llama3.2:3b via Ollama, or Kompact AI in production)
receives the pre-analyzed context + complaint and returns structured
JSON. This means:
  - The model doesn't need to figure out mechanism from scratch
  - It gets the clinical context already worked out
  - It focuses on: body part confirmation, ICD-10, protocol notes
"""

import json
import re
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# DICOM reference data
# ─────────────────────────────────────────────────────────────────────────────

BODY_PART_VIEWS: dict[str, list[str]] = {
    "CHEST":    ["PA", "LATERAL"],
    "ABDOMEN":  ["AP"],
    "PELVIS":   ["AP"],
    "SKULL":    ["PA", "LATERAL", "TOWNES"],
    "CSPINE":   ["AP", "LATERAL", "ODONTOID"],
    "TSPINE":   ["AP", "LATERAL"],
    "LSPINE":   ["AP", "LATERAL"],
    "SACRUM":   ["AP", "LATERAL"],
    "SHOULDER": ["AP", "AXIAL", "Y-VIEW"],
    "CLAVICLE": ["AP", "LORDOTIC"],
    "ARM":      ["AP", "LATERAL"],
    "ELBOW":    ["AP", "LATERAL"],
    "FOREARM":  ["AP", "LATERAL"],
    "WRIST":    ["PA", "LATERAL", "SCAPHOID"],
    "HAND":     ["PA", "OBLIQUE", "LATERAL"],
    "FINGER":   ["PA", "LATERAL"],
    "HIP":      ["AP", "LATERAL", "FROG-LEG"],
    "THIGH":    ["AP", "LATERAL"],
    "KNEE":     ["AP", "LATERAL"],
    "LEG":      ["AP", "LATERAL"],
    "ANKLE":    ["AP", "LATERAL", "MORTISE"],
    "FOOT":     ["AP", "LATERAL", "OBLIQUE"],
    "TOE":      ["AP", "LATERAL"],
    "RIBS":     ["AP", "OBLIQUE"],
    "STERNUM":  ["PA", "LATERAL"],
    "SCAPULA":  ["AP", "LATERAL"],
}

BODY_PART_ICD10: dict[str, list[dict]] = {
    "KNEE":     [{"code": "M25.36", "description": "Pain in knee", "confidence": 0.8},
                 {"code": "S80.00", "description": "Contusion of knee", "confidence": 0.65}],
    "ANKLE":    [{"code": "M25.37", "description": "Pain in ankle", "confidence": 0.8},
                 {"code": "S93.40", "description": "Sprain of ankle", "confidence": 0.6}],
    "FOOT":     [{"code": "M79.67", "description": "Pain in foot", "confidence": 0.7}],
    "HIP":      [{"code": "M25.35", "description": "Pain in hip", "confidence": 0.8},
                 {"code": "S70.00", "description": "Contusion of hip", "confidence": 0.6}],
    "THIGH":    [{"code": "M79.65", "description": "Pain in thigh", "confidence": 0.6}],
    "LEG":      [{"code": "M79.67", "description": "Pain in lower leg", "confidence": 0.6}],
    "SHOULDER": [{"code": "M25.31", "description": "Pain in shoulder", "confidence": 0.8}],
    "ELBOW":    [{"code": "M25.32", "description": "Pain in elbow", "confidence": 0.8}],
    "WRIST":    [{"code": "M25.33", "description": "Pain in wrist", "confidence": 0.8}],
    "HAND":     [{"code": "M79.64", "description": "Pain in hand", "confidence": 0.7}],
    "FOREARM":  [{"code": "M79.63", "description": "Pain in forearm", "confidence": 0.6}],
    "ARM":      [{"code": "M79.62", "description": "Pain in upper arm", "confidence": 0.6}],
    "FINGER":   [{"code": "M79.64", "description": "Pain in finger", "confidence": 0.6}],
    "CHEST":    [{"code": "R07.9", "description": "Chest pain, unspecified", "confidence": 0.7}],
    "RIBS":     [{"code": "S22.3", "description": "Fracture of rib", "confidence": 0.6}],
    "ABDOMEN":  [{"code": "R10.9", "description": "Unspecified abdominal pain", "confidence": 0.6}],
    "LSPINE":   [{"code": "M54.5", "description": "Low back pain", "confidence": 0.9}],
    "TSPINE":   [{"code": "M54.6", "description": "Pain in thoracic spine", "confidence": 0.7}],
    "CSPINE":   [{"code": "M54.2", "description": "Cervicalgia", "confidence": 0.8}],
    "SKULL":    [{"code": "S09.90XA", "description": "Head injury", "confidence": 0.6}],
    "PELVIS":   [{"code": "M25.35", "description": "Pain in hip region", "confidence": 0.6}],
}

NON_LATERAL_PARTS = {
    "CHEST", "ABDOMEN", "PELVIS", "SPINE", "CSPINE",
    "TSPINE", "LSPINE", "SKULL", "STERNUM", "SACRUM",
}

REGION_CANDIDATES: dict[str, list[str]] = {
    "LOWER_LIMB": ["HIP", "THIGH", "KNEE", "LEG", "ANKLE", "FOOT"],
    "UPPER_LIMB": ["SHOULDER", "ARM", "ELBOW", "FOREARM", "WRIST", "HAND"],
    "SPINE":      ["LSPINE", "TSPINE", "CSPINE"],  # LSPINE first — most common
    "HEAD":       ["SKULL"],
    "CHEST":      ["CHEST", "RIBS"],
    "ABDOMEN":    ["ABDOMEN"],
    "PELVIS":     ["PELVIS", "HIP"],
}

# ─────────────────────────────────────────────────────────────────────────────
# Survey protocols
# ─────────────────────────────────────────────────────────────────────────────

TRAUMA_SURVEY_RESULT = {
    "body_part_examined": "TRAUMA_SURVEY",
    "study_description":  "TRAUMA SURVEY",
    "view_positions":     ["AP", "LATERAL"],
    "series_descriptions": [
        "AP Chest", "AP Pelvis",
        "AP + LAT C-Spine",
        "AP + LAT Both Knees",
        "AP + LAT Both Ankles",
    ],
    "urgency":  "stat",
    "ai_notes": "High velocity trauma — full survey protocol. Radiologist to determine final imaging areas.",
}

LOWER_LIMB_SURVEY_RESULT = {
    "body_part_examined": "LOWER_LIMB_SURVEY",
    "study_description":  "LOWER LIMB SURVEY",
    "view_positions":     ["AP", "LATERAL"],
    "series_descriptions": [
        "AP + LAT Hip", "AP + LAT Knee",
        "AP + LAT Ankle", "AP + LAT Foot",
    ],
    "urgency":  "urgent",
    "ai_notes": "Location unclear — lower limb survey. Radiologist to identify primary injury site.",
}

UPPER_LIMB_SURVEY_RESULT = {
    "body_part_examined": "UPPER_LIMB_SURVEY",
    "study_description":  "UPPER LIMB SURVEY",
    "view_positions":     ["AP", "LATERAL"],
    "series_descriptions": [
        "AP + LAT Shoulder",
        "AP + LAT Elbow",
        "PA + LAT Wrist",
    ],
    "urgency":  "urgent",
    "ai_notes": "Location unclear — upper limb survey. Radiologist to identify primary injury site.",
}


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — Clinical Reasoning Engine
# ─────────────────────────────────────────────────────────────────────────────

class ClinicalReasoningEngine:
    """
    Fast deterministic clinical pre-analysis.
    Narrows the clinical context so the LLM has a focused task.
    Works offline, < 20ms.
    """

    # ── Mechanism patterns ────────────────────────────────────────────────────

    _HIGH_VEL = [
        "road accident", "rta", "motor vehicle", "motorcycle accident",
        "car accident", "head-on", "high speed", "polytrauma",
        "fall from height", "fell from height", "fell from building",
        "fell from roof", "fell from tree",
    ]
    _MED_VEL = [
        "fell from cycle", "fell from bike", "bicycle accident",
        "cycle accident", "fell from ladder", "fell down stairs",
        "fell down steps", "sports injury", "fell from playground",
        "fell from horse",
    ]
    _LOW_VEL = [
        "slipped", "tripped", "twisted", "stepped wrong",
        "fell standing", "fell walking", "fell from chair", "fell from bed",
    ]

    # ── Symptom → region mapping ──────────────────────────────────────────────

    _LOWER_LIMB_SX = [
        "not able to walk", "unable to walk", "can't walk", "cannot walk",
        "difficulty walking", "limping", "weight bearing", "cannot bear weight",
        "foot pain", "knee pain", "ankle pain", "hip pain", "thigh pain",
        "calf pain", "shin pain", "heel pain", "toe pain",
    ]
    _UPPER_LIMB_SX = [
        "cannot lift arm", "not able to lift", "arm pain", "elbow pain",
        "wrist pain", "hand pain", "finger pain", "shoulder pain",
        "cannot move arm", "arm swelling", "forearm pain",
    ]
    _SPINE_SX = [
        "back pain", "neck pain", "spine pain", "backache",
        "lower back", "upper back", "mid back", "radiating to leg",
        "radiating to arm", "sciatica", "neck stiffness",
    ]
    _HEAD_SX = [
        "head injury", "head pain", "face pain", "jaw pain",
        "unconscious", "loss of consciousness", "hit head",
        "head trauma", "facial injury", "scalp",
    ]
    _CHEST_SX = [
        "chest pain", "chest injury", "rib pain", "shortness of breath",
        "breathing difficulty", "cannot breathe", "chest trauma",
        "chest tightness",
    ]
    _ABDOMEN_SX = [
        "abdominal pain", "stomach pain", "belly pain",
        "flank pain",
    ]

    # ── Specific body part keywords (word-level match) ────────────────────────
    # Only unambiguous, specific body parts → direct mapping.
    # Ambiguous words like "arm", "leg" are handled via region detection.

    _SPECIFIC_PARTS: dict[str, str] = {
        "knee": "KNEE", "knees": "KNEE",
        "ankle": "ANKLE", "ankles": "ANKLE",
        "foot": "FOOT", "feet": "FOOT",
        "toe": "TOE", "toes": "TOE", "heel": "FOOT",
        "hip": "HIP", "hips": "HIP",
        "thigh": "THIGH",
        "shin": "LEG", "calf": "LEG",
        "shoulder": "SHOULDER",
        "elbow": "ELBOW",
        "wrist": "WRIST",
        "hand": "HAND",
        "finger": "FINGER", "fingers": "FINGER", "thumb": "FINGER",
        "forearm": "FOREARM",
        "clavicle": "CLAVICLE", "collarbone": "CLAVICLE",
        "scapula": "SCAPULA",
        "chest": "CHEST",
        "rib": "RIBS", "ribs": "RIBS",
        "abdomen": "ABDOMEN", "stomach": "ABDOMEN",
        "pelvis": "PELVIS",
        "skull": "SKULL",
        "face": "SKULL", "jaw": "SKULL", "scalp": "SKULL",
    }

    # Ambiguous region words → region (not specific part)
    # "back" → LSPINE directly (lumbar is most common back complaint)
    # "neck" → CSPINE directly
    # "arm"/"leg" → region (ask which part)
    _REGION_WORDS: dict[str, str] = {
        "back":      "BACK_DIRECT",   # handled specially below → LSPINE
        "neck":      "NECK_DIRECT",   # handled specially below → CSPINE
        "arm":       "UPPER_LIMB",
        "leg":       "LOWER_LIMB",
        "limb":      "LOWER_LIMB",
        "extremity": "LOWER_LIMB",
    }

    # Direct mappings for ambiguous words that have a clear default
    _REGION_DIRECT_PART: dict[str, str] = {
        "BACK_DIRECT": "LSPINE",
        "NECK_DIRECT": "CSPINE",
    }

    # ── Laterality ────────────────────────────────────────────────────────────

    _RIGHT_KW = ["right", " rt ", "r/t", "right side", "right-sided", "(r)"]
    _LEFT_KW  = ["left", " lt ", "l/t", "left side", "left-sided", "(l)"]
    _BILAT_KW = ["bilateral", "both", "both sides", "b/l", "bilaterally"]

    # ── Urgency ───────────────────────────────────────────────────────────────

    _STAT_PATTERNS = [
        "road accident", "rta", "unconscious", "loss of consciousness",
        "not breathing", "severe chest pain", "stroke", "seizure",
        "head injury", "polytrauma", "fall from height", "motor vehicle",
        "high speed", "hit by vehicle", "hit by car",
    ]
    _URGENT_PATTERNS = [
        "not able to walk", "unable to walk", "can't walk", "cannot walk",
        "severe pain", "swelling", "deformity", "fell from cycle",
        "fell from bike", "sports injury", "fracture", "suspected fracture",
        "dislocation", "cannot move", "unable to move", "road accident",
        "accident", "trauma",
    ]

    # ─────────────────────────────────────────────────────────────────────────

    def analyze(
        self,
        complaint: str,
        patient_age: Optional[int] = None,
        patient_sex: Optional[str] = None,
        clarification_answers: Optional[dict] = None,
    ) -> dict:
        """
        Primary entry point.
        Returns clinical context dict used by the LLM prompt builder
        and by MissingInfoDetector.
        """
        text = (complaint or "").lower().strip()
        answers = clarification_answers or {}

        mechanism   = self._detect_mechanism(text)
        urgency     = self._detect_urgency(text, mechanism)
        laterality  = answers.get("laterality") or self._detect_laterality(text)
        is_pediatric = (patient_age is not None and patient_age < 16)

        # Check for specific body part directly mentioned
        direct_part = self._detect_specific_part(text)
        region_word = self._detect_region_word(text)

        # Resolve body part and candidates
        if direct_part:
            region = self._part_to_region(direct_part)
            candidates = [direct_part]
            known_part = direct_part
        elif region_word in self._REGION_DIRECT_PART:
            # "back" → LSPINE, "neck" → CSPINE — known part directly
            known_part = self._REGION_DIRECT_PART[region_word]
            region = self._part_to_region(known_part)
            candidates = [known_part]
        elif region_word:
            region = region_word
            candidates = REGION_CANDIDATES.get(region, [])
            known_part = None
        else:
            region = self._detect_region_from_symptoms(text, mechanism)
            candidates = REGION_CANDIDATES.get(region, [])
            known_part = None

        # Override with clarification answers
        if answers.get("body_part") and answers["body_part"] != "UNSURE":
            known_part = answers["body_part"]
            candidates = [known_part]

        needs_laterality = (
            laterality is None
            and region in {"LOWER_LIMB", "UPPER_LIMB", "HEAD"}
            and (not known_part or known_part not in NON_LATERAL_PARTS)
        )
        needs_body_part = (not known_part and len(candidates) > 1)

        return {
            "clinical_region":      region,
            "candidate_body_parts": candidates,
            "known_body_part":      known_part,
            "laterality":           laterality,
            "urgency":              urgency,
            "mechanism":            mechanism,
            "is_pediatric":         is_pediatric,
            "needs_laterality":     needs_laterality,
            "needs_body_part":      needs_body_part,
            "complaint":            complaint,
            "patient_age":          patient_age,
            "patient_sex":          patient_sex,
        }

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _detect_mechanism(self, text: str) -> dict:
        if any(p in text for p in self._HIGH_VEL):
            return {"velocity": "high", "type": "high_velocity_trauma"}
        if any(p in text for p in self._MED_VEL):
            t = "cycle_accident" if ("cycle" in text or "bike" in text) else "fall"
            return {"velocity": "medium", "type": t}
        if any(p in text for p in self._LOW_VEL):
            return {"velocity": "low", "type": "fall"}
        if "fell" in text or "fall" in text:
            return {"velocity": "medium", "type": "fall"}
        return {"velocity": "low", "type": "pain"}

    def _detect_urgency(self, text: str, mechanism: dict) -> str:
        if any(p in text for p in self._STAT_PATTERNS):
            return "stat"
        if mechanism.get("velocity") == "high":
            return "stat"
        if any(p in text for p in self._URGENT_PATTERNS):
            return "urgent"
        if mechanism.get("velocity") == "medium":
            return "urgent"
        return "routine"

    def _detect_laterality(self, text: str) -> Optional[str]:
        if any(k in text for k in self._BILAT_KW):
            return "B"
        r = any(k in text for k in self._RIGHT_KW)
        l = any(k in text for k in self._LEFT_KW)
        if r and l:
            return "B"
        if r:
            return "R"
        if l:
            return "L"
        return None

    def _detect_specific_part(self, text: str) -> Optional[str]:
        words = re.split(r"[\s,./\-\(\)]+", text)
        for word in words:
            if word in self._SPECIFIC_PARTS:
                return self._SPECIFIC_PARTS[word]
        # Substring match for longer terms
        for kw, bp in self._SPECIFIC_PARTS.items():
            if len(kw) > 4 and kw in text:
                return bp
        return None

    def _detect_region_word(self, text: str) -> Optional[str]:
        words = re.split(r"[\s,./\-\(\)]+", text)
        for word in words:
            if word in self._REGION_WORDS:
                return self._REGION_WORDS[word]
        return None

    def _detect_region_from_symptoms(self, text: str, mechanism: dict) -> str:
        if any(s in text for s in self._LOWER_LIMB_SX):
            return "LOWER_LIMB"
        if any(s in text for s in self._UPPER_LIMB_SX):
            return "UPPER_LIMB"
        if any(s in text for s in self._SPINE_SX):
            return "SPINE"
        if any(s in text for s in self._HEAD_SX):
            return "HEAD"
        if any(s in text for s in self._CHEST_SX):
            return "CHEST"
        if any(s in text for s in self._ABDOMEN_SX):
            return "ABDOMEN"
        # Mechanism inference
        mtype = mechanism.get("type", "")
        vel   = mechanism.get("velocity", "low")
        if mtype in ("cycle_accident", "fall") and vel in ("medium", "high"):
            return "LOWER_LIMB"
        return "CHEST"

    def _part_to_region(self, part: str) -> str:
        for region, parts in REGION_CANDIDATES.items():
            if part in parts:
                return region
        return "CHEST"


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Missing Info Detector
# ─────────────────────────────────────────────────────────────────────────────

class MissingInfoDetector:
    """
    Determines which follow-up questions to ask (max 3).
    Questions are shown one at a time in the UI.
    """

    _OPTION_MAP: dict[str, dict] = {
        # Lower limb — anatomical order top to bottom
        "HIP":      {"label": "Hip / Groin",     "sublabel": "Upper leg / hip joint",     "icon": "🦴", "order": 1},
        "THIGH":    {"label": "Thigh",            "sublabel": "Upper leg",                 "icon": "🦵", "order": 2},
        "KNEE":     {"label": "Knee",             "sublabel": "Knee joint",                "icon": "🦴", "order": 3},
        "LEG":      {"label": "Shin / Lower leg", "sublabel": "Between knee and ankle",    "icon": "🦵", "order": 4},
        "ANKLE":    {"label": "Ankle",            "sublabel": "Ankle joint",               "icon": "🦶", "order": 5},
        "FOOT":     {"label": "Foot / Toes",      "sublabel": "Foot and toes",             "icon": "🦶", "order": 6},
        # Upper limb — anatomical order top to bottom
        "SHOULDER": {"label": "Shoulder",         "sublabel": "Shoulder joint",            "icon": "💪", "order": 1},
        "ARM":      {"label": "Upper arm",        "sublabel": "Between shoulder and elbow","icon": "💪", "order": 2},
        "ELBOW":    {"label": "Elbow",            "sublabel": "Elbow joint",               "icon": "🦴", "order": 3},
        "FOREARM":  {"label": "Forearm",          "sublabel": "Between elbow and wrist",   "icon": "💪", "order": 4},
        "WRIST":    {"label": "Wrist",            "sublabel": "Wrist joint",               "icon": "✋", "order": 5},
        "HAND":     {"label": "Hand / Fingers",   "sublabel": "Hand and fingers",          "icon": "✋", "order": 6},
        # Spine — top to bottom
        "CSPINE":   {"label": "Neck",             "sublabel": "Cervical spine (C1-C7)",    "icon": "🦴", "order": 1},
        "TSPINE":   {"label": "Mid back",         "sublabel": "Thoracic spine (T1-T12)",   "icon": "🦴", "order": 2},
        "LSPINE":   {"label": "Lower back",       "sublabel": "Lumbar spine (L1-L5)",      "icon": "🦴", "order": 3},
    }

    _REGION_QUESTIONS: dict[str, str] = {
        "LOWER_LIMB": "Where is the pain or injury?",
        "UPPER_LIMB": "Which part of the arm is affected?",
        "SPINE":      "Which part of the spine?",
        "HEAD":       "Which area of the head?",
    }

    def get_follow_up_questions(
        self, medical_context: dict, complaint: str
    ) -> list[dict]:
        questions: list[dict] = []
        region     = medical_context.get("clinical_region", "")
        candidates = medical_context.get("candidate_body_parts", [])
        laterality = medical_context.get("laterality")
        mechanism  = medical_context.get("mechanism", {})
        known_part = medical_context.get("known_body_part")

        # Q1 — Laterality
        if (laterality is None
                and region in {"LOWER_LIMB", "UPPER_LIMB", "HEAD"}
                and (not known_part or known_part not in NON_LATERAL_PARTS)):
            questions.append({
                "id":       "laterality",
                "question": "Which side is affected?",
                "type":     "single_select",
                "required": True,
                "options": [
                    {"label": "Left",       "value": "L", "icon": "←", "sublabel": "Left side"},
                    {"label": "Right",      "value": "R", "icon": "→", "sublabel": "Right side"},
                    {"label": "Both sides", "value": "B", "icon": "↔", "sublabel": "Bilateral"},
                ],
            })

        # Q2 — Body part (if still multiple candidates after Q1)
        if not known_part and len(candidates) > 1:
            questions.append({
                "id":       "body_part",
                "question": self._REGION_QUESTIONS.get(region, "Which specific area is affected?"),
                "type":     "single_select",
                "required": True,
                "options":  self._build_options(candidates),
            })

        # Q3 — Additional injury areas (high velocity only, if we have room)
        if mechanism.get("velocity") == "high" and len(questions) < 2:
            questions.append({
                "id":       "additional_areas",
                "question": "Any other injured areas?",
                "type":     "multi_select",
                "required": False,
                "options": [
                    {"label": "Head / Neck",  "value": "HEAD",       "icon": "🧠"},
                    {"label": "Chest",        "value": "CHEST",      "icon": "🫁"},
                    {"label": "Abdomen",      "value": "ABDOMEN",    "icon": "🫀"},
                    {"label": "Upper limbs",  "value": "UPPER_LIMB", "icon": "💪"},
                    {"label": "Lower limbs",  "value": "LOWER_LIMB", "icon": "🦵"},
                    {"label": "No other areas","value": "NONE",      "icon": "✅"},
                ],
            })

        return questions[:3]

    def _build_options(self, candidates: list[str]) -> list[dict]:
        options = []
        for c in candidates:
            if c in self._OPTION_MAP:
                opt = self._OPTION_MAP[c].copy()
                opt["value"] = c
                options.append(opt)
        options.sort(key=lambda x: x.get("order", 99))
        options.append({
            "label": "Not sure", "sublabel": "Show all views",
            "value": "UNSURE",   "icon": "❓", "order": 99,
        })
        return options


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3 — Intake Refiner
# ─────────────────────────────────────────────────────────────────────────────

class IntakeRefiner:
    """
    Merges LLM output + clarification answers → final DICOM result.
    Also used when building the result directly from the pre-analysis.
    """

    def build_result(
        self,
        body_part: str,
        laterality: Optional[str],
        urgency: str,
        complaint: str,
        follow_up_questions: list,
        confidence: float,
        is_pediatric: bool,
        mechanism: dict,
        patient_age: Optional[int] = None,
    ) -> dict:
        views   = BODY_PART_VIEWS.get(body_part, ["AP", "LATERAL"])
        icd10   = BODY_PART_ICD10.get(body_part, [])
        side    = ("RIGHT "    if laterality == "R"
                   else "LEFT "     if laterality == "L"
                   else "BILATERAL " if laterality == "B"
                   else "")

        # Clinical notes
        notes: list[str] = []
        if is_pediatric:
            notes.append(
                "⚠ Pediatric patient — growth plate injury possible. "
                "Use appropriate technique and radiation protection.")
        if body_part == "KNEE" and urgency in ("urgent", "stat"):
            notes.append("Consider weight-bearing AP view if patient can stand.")
        if mechanism.get("type") == "cycle_accident":
            notes.append("Cycle accident — consider associated injuries (elbow, wrist, shoulder).")
        if mechanism.get("velocity") == "high":
            notes.append("High-energy mechanism — screen for associated injuries.")

        return {
            "body_part_examined":  body_part,
            "laterality":          laterality,
            "study_description":   f"{side}{body_part} X-RAY",
            "view_positions":      views,
            "series_descriptions": [f"{side}{body_part} {v}" for v in views],
            "reason_for_exam":     complaint.strip(),
            "icd10_codes":         icd10,
            "urgency":             urgency,
            "confidence":          confidence,
            "ambiguities":         follow_up_questions,
            "follow_up_needed":    len(follow_up_questions) > 0,
            "follow_up_question":  (follow_up_questions[0]["question"]
                                    if follow_up_questions else None),
            "ai_notes":            " | ".join(notes) if notes else None,
            "source":              "ai",
            "is_pediatric":        is_pediatric,
        }

    def build_survey(
        self,
        region: str,
        complaint: str,
        urgency: str,
        is_pediatric: bool,
    ) -> dict:
        if region == "LOWER_LIMB":
            base = LOWER_LIMB_SURVEY_RESULT.copy()
        elif region == "UPPER_LIMB":
            base = UPPER_LIMB_SURVEY_RESULT.copy()
        else:
            base = LOWER_LIMB_SURVEY_RESULT.copy()

        note = base.get("ai_notes", "")
        if is_pediatric:
            note += " | ⚠ Pediatric patient — growth plate injury possible."

        base.update({
            "laterality":       None,
            "reason_for_exam":  complaint.strip(),
            "icd10_codes":      [],
            "urgency":          urgency,
            "confidence":       0.4,
            "ambiguities":      [],
            "follow_up_needed": False,
            "follow_up_question": None,
            "ai_notes":         note,
            "source":           "ai",
            "is_pediatric":     is_pediatric,
        })
        return base

    def build_trauma_survey(
        self, complaint: str, is_pediatric: bool
    ) -> dict:
        base = TRAUMA_SURVEY_RESULT.copy()
        note = base.get("ai_notes", "")
        if is_pediatric:
            note += " | ⚠ Pediatric patient — growth plate injury possible."
        base.update({
            "laterality":       None,
            "reason_for_exam":  complaint.strip(),
            "icd10_codes":      [],
            "confidence":       0.9,
            "ambiguities":      [],
            "follow_up_needed": False,
            "follow_up_question": None,
            "ai_notes":         note,
            "source":           "ai",
            "is_pediatric":     is_pediatric,
        })
        return base


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: build LLM system prompt enriched with pre-analysis
# ─────────────────────────────────────────────────────────────────────────────

def build_intake_prompt(clinical_context: dict) -> tuple[str, str]:
    """
    Returns (system_prompt, user_message) for the LLM call.
    The pre-analysis context is embedded so the model has a focused task.
    """
    ctx = clinical_context
    region     = ctx.get("clinical_region", "UNKNOWN")
    candidates = ctx.get("candidate_body_parts", [])
    laterality = ctx.get("laterality")
    urgency    = ctx.get("urgency", "routine")
    mechanism  = ctx.get("mechanism", {})
    is_ped     = ctx.get("is_pediatric", False)

    candidates_str = ", ".join(candidates) if candidates else "CHEST"

    system_prompt = f"""You are a medical assistant. Choose the most likely body part from the candidates.
Confirm laterality: "R" (Right), "L" (Left), "B" (Both/Bilateral), or null if unspecified.
Determine urgency: "routine", "urgent", or "stat".
List 1-2 relevant ICD-10 codes.

PRE-ANALYSIS CONTEXT:
  Clinical region: {region}
  Candidates: {candidates_str}
  Laterality detected: {laterality or 'NOT DETECTED'}
  Urgency: {urgency}
  Mechanism: {mechanism.get('type', 'unknown')} ({mechanism.get('velocity', 'unknown')} velocity)
  Pediatric patient: {is_ped}

Output ONLY valid JSON matching this exact format:
{{
  "body_part_examined": "{candidates[0] if candidates else 'CHEST'}",
  "laterality": {json.dumps(laterality)},
  "urgency": "{urgency}",
  "icd10_codes": [{{"code": "S80.00", "description": "Contusion of knee", "confidence": 0.9}}],
  "ai_notes": null
}}"""

    complaint = ctx.get("complaint", "")
    age       = ctx.get("patient_age")
    sex       = ctx.get("patient_sex", "")
    age_str   = f", age {age}" if age else ""
    sex_str   = f", sex {sex}" if sex else ""

    user_message = (
        f"Patient complaint{age_str}{sex_str}: \"{complaint}\"\n"
        f"Choose body part from: {candidates_str}. Output JSON."
    )

    return system_prompt, user_message
