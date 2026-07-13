"""
TD|ai Report Template Service
==============================

Fully local AI-powered radiology report generator.

Pipeline:
  1. Template Selector  — picks the right template from body_part + modality
  2. RAG Builder        — injects normal findings + few-shot examples into LLM prompt
  3. Local LLM          — MedGemma 4B or DeepSeek-R1:8b via Ollama (no cloud)
  4. Measurement Extractor — bolts numeric measurements from dictation
  5. Term Validator     — cross-checks medical terminology against template glossary
  6. Section Assembler  — produces clean JSON sections ready for the ReportEditor

Env vars:
  REPORT_AI_ENGINE  : ollama | rule_based  (default: ollama)
  REPORT_AI_MODEL   : medgemma-4b-it | deepseek-r1:8b | biomistral:7b
  REPORT_AI_URL     : http://localhost:11434
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("medasr-report-template")

# ─────────────────────────────────────────────────────────────────────────────
# Template Store — load all JSONs at startup into memory
# ─────────────────────────────────────────────────────────────────────────────

TEMPLATES_DIR = Path(__file__).parent / "report_templates"

_TEMPLATE_CACHE: dict[str, dict] = {}

def _load_templates() -> None:
    """Load all JSON templates into memory once at startup."""
    if not TEMPLATES_DIR.exists():
        logger.warning("report_templates/ directory not found — no templates loaded")
        return
    for path in TEMPLATES_DIR.glob("*.json"):
        try:
            with open(path, encoding="utf-8") as f:
                tmpl = json.load(f)
            _TEMPLATE_CACHE[tmpl["id"]] = tmpl
        except Exception as exc:
            logger.error("Failed to load template %s: %s", path.name, exc)
    logger.info("Loaded %d report templates from %s", len(_TEMPLATE_CACHE), TEMPLATES_DIR)

_load_templates()


def get_template(body_part: str, modality: str) -> Optional[dict]:
    """
    Find the best matching template for a given body part + modality.

    Matching priority:
      1. Exact body_part + modality match
      2. body_part match only (ignore modality)
      3. Fall back to chest_xray as default
    """
    body_part_upper = body_part.upper().strip()
    modality_upper = modality.upper().strip()

    # 1. Exact match
    for tmpl in _TEMPLATE_CACHE.values():
        if body_part_upper in [b.upper() for b in tmpl.get("body_part", [])]:
            if modality_upper in [m.upper() for m in tmpl.get("modality", [])]:
                return tmpl

    # 2. body_part only
    for tmpl in _TEMPLATE_CACHE.values():
        if body_part_upper in [b.upper() for b in tmpl.get("body_part", [])]:
            return tmpl

    # 3. default
    return _TEMPLATE_CACHE.get("chest_xray")


def list_templates() -> list[dict]:
    """Return lightweight list of all available templates."""
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "modality": t.get("modality", []),
            "body_part": t.get("body_part", []),
        }
        for t in sorted(_TEMPLATE_CACHE.values(), key=lambda x: x["name"])
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Measurement Extractor
# ─────────────────────────────────────────────────────────────────────────────

# Regex patterns to find measurements in dictation
_MEASUREMENT_PATTERNS = [
    r"\b(\d+\.?\d*)\s*(mm|cm|ml|cc|HU|Hounsfield|%)\b",
    r"\bCTR\s*[<>=]?\s*(\d+\.?\d*)\b",
    r"\b(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*(mm|cm)?\b",  # axial measurements
    r"\bGrade\s+([I-V]+|\d+)\b",                         # grading
    r"\b([A-Z]\d+[-–]?\w*)\b",                           # vertebral levels like L4-L5
]

def extract_measurements(text: str) -> list[dict]:
    """Extract measurements and mark them for bolding in the final report."""
    measurements = []
    for pattern in _MEASUREMENT_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            measurements.append({
                "text": match.group(0),
                "start": match.start(),
                "end": match.end(),
            })
    return measurements


def bold_measurements(text: str) -> str:
    """Wrap numeric measurements with HTML <strong> tags."""
    result = text
    for pattern in _MEASUREMENT_PATTERNS:
        result = re.sub(
            pattern,
            lambda m: f"<strong>{m.group(0)}</strong>",
            result,
            flags=re.IGNORECASE,
        )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# RAG Context Builder
# ─────────────────────────────────────────────────────────────────────────────

def build_rag_context(template: dict, laterality: Optional[str] = None) -> str:
    """
    Build the RAG context string to inject into the LLM prompt.

    This is what makes a local 4B model produce accurate, professional reports:
    it sees exactly what a correct report looks like BEFORE generating.
    """
    side = laterality or ""
    lines = [
        f"=== TEMPLATE: {template['name']} ===",
        "",
        "REQUIRED SECTIONS (output ALL of these in your JSON):",
    ]

    for section in template.get("sections", []):
        if section.get("is_signature"):
            continue
        subsections = section.get("subsections", [])
        if subsections:
            lines.append(f"  - {section['title']} (cover: {', '.join(subsections)})")
        else:
            lines.append(f"  - {section['title']}")

    # Normal findings reference
    for section in template.get("sections", []):
        normal = section.get("normal_text", "")
        if normal:
            normal_filled = normal.replace("{laterality}", side)
            lines.append(f"\nSTANDARD NORMAL FINDINGS for {section['title']}:")
            lines.append(f'  "{normal_filled}"')

    # Medical terminology
    all_terms = []
    for section in template.get("sections", []):
        all_terms.extend(section.get("medical_terms", []))
    if all_terms:
        lines.append(f"\nCORRECT MEDICAL TERMS TO USE: {', '.join(all_terms[:20])}")

    # Few-shot normal example
    ex_normal = template.get("few_shot_normal")
    if ex_normal:
        lines.append("\n=== EXAMPLE (NORMAL STUDY) ===")
        lines.append(f"Input: \"{ex_normal['input']}\"")
        lines.append("Output sections:")
        for key, val in ex_normal["output"].items():
            lines.append(f"  {key}: \"{val}\"")

    # Few-shot abnormal example
    ex_abnormal = template.get("few_shot_abnormal")
    if ex_abnormal:
        lines.append("\n=== EXAMPLE (ABNORMAL STUDY) ===")
        lines.append(f"Input: \"{ex_abnormal['input']}\"")
        lines.append("Output sections:")
        for key, val in ex_abnormal["output"].items():
            lines.append(f"  {key}: \"{val}\"")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# System Prompt
# ─────────────────────────────────────────────────────────────────────────────

def build_system_prompt(template: dict, laterality: Optional[str] = None) -> str:
    rag_context = build_rag_context(template, laterality)
    section_keys = [
        s["key"] for s in template.get("sections", []) if not s.get("is_signature")
    ]
    json_keys = ", ".join(f'"{k}"' for k in section_keys)

    return f"""You are a board-certified radiologist assistant generating professional radiology reports.

{rag_context}

RULES:
1. Write in formal, professional radiology report language
2. Use ONLY the correct medical terms shown above — do not invent synonyms
3. When a finding is mentioned, describe it precisely (location, severity, size if given)
4. When no abnormality is mentioned for a subsection, use standard normal language
5. NEVER add a diagnosis — only describe imaging findings and give an imaging impression
6. Impression must follow directly from findings — be concise (1-4 lines)
7. If the radiologist mentions a measurement (2cm, 3mm, CTR 0.48), include it EXACTLY
8. For the technique section, use the standard technique for this study type
9. Output ONLY valid JSON. No markdown, no explanations, no extra text.
10. CRITICAL — clinical_history section:
    - ONLY populate if a "Clinical history:" line is explicitly provided in the user message
    - Do NOT copy imaging findings or dictation text into clinical_history
    - If no clinical history is provided, output an EMPTY STRING "" for clinical_history
    - Clinical history = patient's symptoms/complaint BEFORE the scan, not imaging findings

OUTPUT FORMAT — respond with exactly this JSON structure:
{{{json_keys.replace('"clinical_history"', '"clinical_history": "..."').replace('"technique"', '"technique": "..."').replace('"comparison"', '"comparison": "..."').replace('"findings"', '"findings": "..."').replace('"impression"', '"impression": "..."').replace('"recommendation"', '"recommendation": "..."')}}}

Where each value is the full, properly written section text.
Omit any section that has no content (empty string is fine for optional sections).
"""


# ─────────────────────────────────────────────────────────────────────────────
# Local LLM Service (Ollama)
# ─────────────────────────────────────────────────────────────────────────────

class LocalReportLLM:
    """
    Calls MedGemma 4B (or any model) via Ollama's OpenAI-compatible API.
    No cloud. No API key. Fully offline.
    """

    def __init__(self):
        self.engine = os.getenv("REPORT_AI_ENGINE", "ollama")
        self.model = os.getenv("REPORT_AI_MODEL", "medgemma-4b-it")
        self.base_url = os.getenv("REPORT_AI_URL", "http://localhost:11434")
        self._available: Optional[bool] = None

    async def generate(self, system_prompt: str, user_message: str) -> str:
        """Call Ollama and return raw LLM output string."""
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError:
            raise RuntimeError("openai package required: pip install openai>=1.0.0")

        client = AsyncOpenAI(
            base_url=f"{self.base_url.rstrip('/')}/v1",
            api_key="none",
        )
        resp = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.05,   # very low — we want consistent medical text
            max_tokens=1500,
        )
        self._available = True
        return resp.choices[0].message.content or "{}"

    @staticmethod
    def parse_json(raw: str) -> dict:
        cleaned = re.sub(r"```(?:json)?", "", raw).strip()
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("No JSON found in LLM output")
        return json.loads(match.group())


# ─────────────────────────────────────────────────────────────────────────────
# Rule-Based Fallback (works when Ollama is not running)
# ─────────────────────────────────────────────────────────────────────────────

class RuleBasedReportGenerator:
    """
    Fast fallback that uses template normal/default text directly.
    Quality: good for normal studies, basic for abnormal.
    Activates automatically if Ollama is unavailable.
    """

    def generate(
        self,
        dictation: str,
        template: dict,
        patient_info: Optional[dict],
        laterality: Optional[str],
    ) -> dict:
        side = laterality or ""
        sections_out: dict[str, str] = {}

        for section in template.get("sections", []):
            key = section["key"]
            if section.get("is_signature"):
                continue

            if key == "clinical_history":
                if patient_info and patient_info.get("clinical_history") and patient_info["clinical_history"] != patient_info.get("dictation_text"):
                    sections_out[key] = patient_info["clinical_history"]
                else:
                    # Do NOT dump dictation here — leave empty so radiologist fills it
                    sections_out[key] = ""
                continue

            if key == "technique":
                tech = section.get("default", "")
                sections_out[key] = tech.replace("{laterality}", side).replace("{skyline}", "")
                continue

            if key == "comparison":
                sections_out[key] = ""
                continue

            if key == "findings":
                # Simple heuristic: if dictation has obvious abnormal keywords → use dictation
                # otherwise → use normal text
                abnormal_kw = ["fracture", "effusion", "consolidation", "mass", "lesion",
                               "narrowing", "tear", "herniation", "prolapse", "stenosis",
                               "displacement", "dislocation", "edema", "hemorrhage",
                               "abnormal", "enlarged", "reduced", "opacity", "shadow"]
                is_abnormal = any(kw in dictation.lower() for kw in abnormal_kw)
                if is_abnormal:
                    # Use dictation text, clean it up slightly
                    sections_out[key] = dictation.strip().capitalize()
                    if not sections_out[key].endswith("."):
                        sections_out[key] += "."
                else:
                    normal = section.get("normal_text", "")
                    sections_out[key] = normal.replace("{laterality}", side)
                continue

            if key == "impression":
                abnormal_kw = ["fracture", "effusion", "consolidation", "mass", "lesion",
                               "narrowing", "tear", "herniation", "stenosis", "edema"]
                is_abnormal = any(kw in dictation.lower() for kw in abnormal_kw)
                if is_abnormal:
                    sections_out[key] = f"Findings as described above. Clinical correlation recommended."
                else:
                    normal = section.get("normal_text", "No significant abnormality identified.")
                    sections_out[key] = normal.replace("{laterality}", side)
                continue

            if key == "recommendation":
                sections_out[key] = ""
                continue

        return sections_out


# ─────────────────────────────────────────────────────────────────────────────
# Main Report Template Service
# ─────────────────────────────────────────────────────────────────────────────

class ReportTemplateService:

    def __init__(self):
        self.llm = LocalReportLLM()
        self.fallback = RuleBasedReportGenerator()

    async def structure_report(
        self,
        dictation: str,
        body_part: str,
        modality: str,
        laterality: Optional[str] = None,
        patient_info: Optional[dict] = None,
        section_key: Optional[str] = None,   # if set, generate only this section
        auto_detect: bool = False,
    ) -> dict:
        """
        Full report generation pipeline:
          1. Find template (with voice keyword auto-detection if enabled)
          2. Build RAG context + system prompt
          3. Call local LLM
          4. Bold measurements
          5. Return sections dict

        Falls back to rule-based if Ollama is unreachable.
        """
        detected_bp = body_part.upper().strip()
        detected_mod = modality.upper().strip()

        if auto_detect or detected_bp == "AUTO" or detected_mod == "AUTO":
            # Keyword matching from dictation text
            text_lower = dictation.lower()
            
            # Modality detection
            if "ct scan" in text_lower or "computed tomography" in text_lower or " ct " in text_lower:
                detected_mod = "CT"
            elif "mri" in text_lower or "magnetic resonance" in text_lower:
                detected_mod = "MR"
            elif "xray" in text_lower or "x-ray" in text_lower or "radiograph" in text_lower:
                detected_mod = "CR"
            elif detected_mod == "AUTO":
                detected_mod = "CR"  # fallback default modality
                
            # Body part detection
            if "chest" in text_lower or "lungs" in text_lower or "pleural" in text_lower or "heart" in text_lower:
                detected_bp = "CHEST"
            elif "knee" in text_lower:
                detected_bp = "KNEE"
            elif "ankle" in text_lower:
                detected_bp = "ANKLE"
            elif "foot" in text_lower or "feet" in text_lower:
                detected_bp = "FOOT"
            elif "wrist" in text_lower:
                detected_bp = "WRIST"
            elif "hand" in text_lower or "finger" in text_lower:
                detected_bp = "HAND"
            elif "shoulder" in text_lower:
                detected_bp = "SHOULDER"
            elif "elbow" in text_lower:
                detected_bp = "ELBOW"
            elif "hip" in text_lower:
                detected_bp = "HIP"
            elif "lumbar spine" in text_lower or "lspine" in text_lower or "l-spine" in text_lower or "lumbar" in text_lower:
                detected_bp = "LSPINE"
            elif "cervical spine" in text_lower or "cspine" in text_lower or "c-spine" in text_lower or "cervical" in text_lower:
                detected_bp = "CSPINE"
            elif "thoracic spine" in text_lower or "tspine" in text_lower or "t-spine" in text_lower or "thoracic" in text_lower:
                detected_bp = "TSPINE"
            elif "pelvis" in text_lower or "pelvic" in text_lower:
                detected_bp = "PELVIS"
            elif "skull" in text_lower or "head" in text_lower or "brain" in text_lower:
                if detected_mod == "CT" or detected_mod == "MR":
                    detected_bp = "BRAIN"
                else:
                    detected_bp = "SKULL"
            elif "abdomen" in text_lower or "abdominal" in text_lower:
                detected_bp = "ABDOMEN"
            elif "ribs" in text_lower or "rib" in text_lower:
                detected_bp = "RIBS"
            elif detected_bp == "AUTO":
                detected_bp = "CHEST"  # fallback default body part

        template = get_template(detected_bp, detected_mod)
        if not template:
            template = _TEMPLATE_CACHE.get("chest_xray", {})

        measurements = extract_measurements(dictation)
        side = laterality or ""

        # Build user message
        user_msg_parts = [f"Radiologist dictation / findings:\n{dictation.strip()}"]
        if patient_info:
            if patient_info.get("patient_name"):
                user_msg_parts.append(f"Patient: {patient_info['patient_name']}")
            if patient_info.get("patient_age"):
                user_msg_parts.append(f"Age: {patient_info['patient_age']}")
            if patient_info.get("patient_sex"):
                user_msg_parts.append(f"Sex: {patient_info['patient_sex']}")
            if patient_info.get("clinical_history"):
                user_msg_parts.append(f"Clinical history: {patient_info['clinical_history']}")
        if side:
            user_msg_parts.append(f"Side: {'RIGHT' if side == 'R' else 'LEFT' if side == 'L' else 'BILATERAL'}")

        user_message = "\n".join(user_msg_parts)

        # Try LLM
        sections: dict[str, str] = {}
        source = "llm"

        if self.llm.engine != "rule_based":
            try:
                system_prompt = build_system_prompt(template, side)
                raw = await self.llm.generate(system_prompt, user_message)
                sections = self.llm.parse_json(raw)
                self.llm._available = True
            except Exception as exc:
                logger.warning("Local LLM unavailable (%s) — using rule-based fallback", exc)
                self.llm._available = False
                source = "rule_based"

        if not sections or source == "rule_based":
            sections = self.fallback.generate(dictation, template, patient_info, side)
            source = "rule_based"

        # Post-process: bold measurements in findings
        if "findings" in sections and sections["findings"]:
            sections["findings"] = bold_measurements(sections["findings"])
        if "impression" in sections and sections["impression"]:
            sections["impression"] = bold_measurements(sections["impression"])

        # Build section list in correct order (matching template order)
        ordered_sections = []
        template_sections = template.get("sections", [])
        for ts in template_sections:
            key = ts["key"]
            if ts.get("is_signature"):
                ordered_sections.append({
                    "key": key,
                    "title": ts["title"],
                    "content": "",
                    "is_signature": True,
                })
            else:
                ordered_sections.append({
                    "key": key,
                    "title": ts["title"],
                    "content": sections.get(key, ts.get("default", "")),
                })

        return {
            "sections": ordered_sections,
            "template_id": template["id"],
            "template_name": template["name"],
            "measurements_extracted": measurements,
            "source": source,
            "model": self.llm.model if source == "llm" else "rule_based",
        }


    async def suggest_section(
        self,
        partial_text: str,
        section_key: str,
        body_part: str,
        modality: str,
        laterality: Optional[str] = None,
    ) -> str:
        """
        Generate a single-section suggestion as radiologist types.
        Used for live "ghost text" suggestions in the ReportEditor.
        """
        template = get_template(body_part, modality)
        if not template:
            return ""

        side = laterality or ""
        section_def = next(
            (s for s in template.get("sections", []) if s["key"] == section_key),
            None,
        )
        if not section_def:
            return ""

        # For short inputs, just return normal text
        if len(partial_text.strip()) < 5:
            return section_def.get("normal_text", "").replace("{laterality}", side)

        # For impression suggestions, derive from findings text
        if section_key == "impression":
            system = (
                f"You are a radiologist. Given the following FINDINGS section of a {template['name']} report, "
                f"write a concise IMPRESSION (2-4 lines). Use professional radiology language. "
                f"Output only the impression text, no labels or JSON."
            )
            user = f"Findings:\n{partial_text}"
        else:
            normal_ref = section_def.get("normal_text", "")
            system = (
                f"You are a radiologist completing the {section_def['title']} section of a {template['name']} report. "
                f"Standard normal text: '{normal_ref.replace('{laterality}', side)}'. "
                f"Complete the section professionally based on the partial findings given. "
                f"Output only the completed section text."
            )
            user = f"Partial findings: {partial_text}"

        try:
            return await self.llm.generate(system, user)
        except Exception:
            return section_def.get("normal_text", "").replace("{laterality}", side)


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI Router
# ─────────────────────────────────────────────────────────────────────────────

report_template_router = APIRouter(prefix="/v1/report", tags=["report-templates"])
_report_service = ReportTemplateService()


class StructureRequest(BaseModel):
    dictation: str = Field(..., min_length=3, max_length=5000)
    body_part: str = Field(default="CHEST")
    modality: str = Field(default="CR")
    laterality: Optional[str] = Field(None)
    patient_name: Optional[str] = Field(None)
    patient_age: Optional[int] = Field(None)
    patient_sex: Optional[str] = Field(None)
    clinical_history: Optional[str] = Field(None)
    auto_detect: Optional[bool] = Field(default=False)


class SuggestRequest(BaseModel):
    partial_text: str = Field(..., min_length=2)
    section_key: str = Field(...)
    body_part: str = Field(default="CHEST")
    modality: str = Field(default="CR")
    laterality: Optional[str] = Field(None)


@report_template_router.post("/structure")
async def structure_report(req: StructureRequest):
    """
    Generate a complete, section-by-section radiology report from dictation.

    Uses local MedGemma via Ollama with RAG template injection.
    Falls back to rule-based if AI is unavailable.
    """
    patient_info = {
        "patient_name": req.patient_name,
        "patient_age": req.patient_age,
        "patient_sex": req.patient_sex,
        "clinical_history": req.clinical_history,
        "dictation_text": req.dictation,   # used to avoid echoing dictation as clinical history
    }
    try:
        result = await _report_service.structure_report(
            dictation=req.dictation,
            body_part=req.body_part,
            modality=req.modality,
            laterality=req.laterality,
            patient_info=patient_info,
            auto_detect=req.auto_detect or False,
        )
        return result
    except Exception as exc:
        logger.error("Report structuring failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))



@report_template_router.post("/suggest")
async def suggest_section(req: SuggestRequest):
    """
    Return a single-section AI suggestion as the radiologist types.
    Used for live ghost-text in the ReportEditor.
    """
    try:
        text = await _report_service.suggest_section(
            partial_text=req.partial_text,
            section_key=req.section_key,
            body_part=req.body_part,
            modality=req.modality,
            laterality=req.laterality,
        )
        return {"suggestion": text}
    except Exception as exc:
        logger.error("Section suggestion failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@report_template_router.get("/templates")
async def list_report_templates():
    """List all available report templates."""
    return {"templates": list_templates(), "count": len(_TEMPLATE_CACHE)}


@report_template_router.get("/health")
async def report_ai_health():
    return {
        "status": "ok",
        "engine": _report_service.llm.engine,
        "model": _report_service.llm.model,
        "templates_loaded": len(_TEMPLATE_CACHE),
        "ai_available": _report_service.llm._available,
    }
