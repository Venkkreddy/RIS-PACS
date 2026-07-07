"""
Medical Terminology Correction Dictionary
==========================================

Modality-specific dictionaries for post-ASR correction of radiology dictation.
Covers phonetic errors, abbreviation confusion, and common ASR misrecognitions.

Modalities covered:
  - CR / DX / XR  : X-Ray (chest, skeletal, abdominal)
  - MG            : Mammography / Mammogram
  - RF / FL       : C-Arm / Fluoroscopy

Usage:
    from medical_dictionary import MedicalDictionary
    corrector = MedicalDictionary()
    corrected, changes = corrector.correct("no pleural affusion seen", modality="CR")
"""

import re
import logging
from typing import Optional

logger = logging.getLogger("medasr-server.dictionary")

# ---------------------------------------------------------------------------
# X-Ray / Plain Film Correction Dictionary
# Keys are ASR errors / phonetic variants; values are correct terms.
# ---------------------------------------------------------------------------
XRAY_CORRECTIONS: dict[str, str] = {
    # --- Phonetic / ASR errors ---
    "pleural affusion": "pleural effusion",
    "plural effusion": "pleural effusion",
    "plural affusion": "pleural effusion",
    "pleural effuision": "pleural effusion",
    "cardio megaly": "cardiomegaly",
    "cardio-megaly": "cardiomegaly",
    "cardio megally": "cardiomegaly",
    "cardiomegally": "cardiomegaly",
    "pnuemothorax": "pneumothorax",
    "numothorax": "pneumothorax",
    "nemo thorax": "pneumothorax",
    "attelactasis": "atelectasis",
    "atelectisis": "atelectasis",
    "atlectasis": "atelectasis",
    "atalectasis": "atelectasis",
    "consolidaton": "consolidation",
    "consalidation": "consolidation",
    "consolidaton": "consolidation",
    "pnuemonia": "pneumonia",
    "newmonia": "pneumonia",
    "noomonia": "pneumonia",
    "numonia": "pneumonia",
    "emphysoma": "emphysema",
    "emphezema": "emphysema",
    "interstitial fibrosis": "interstitial fibrosis",
    "interstiteal": "interstitial",
    "intersitial": "interstitial",
    "ground glass opacity": "ground-glass opacity",
    "ground glass": "ground-glass opacity",
    "GGO": "ground-glass opacity",
    "ggo": "ground-glass opacity",
    "air bronco gram": "air bronchogram",
    "air bronco-gram": "air bronchogram",
    "air bronkogram": "air bronchogram",
    "hilar adenopathy": "hilar lymphadenopathy",
    "hilar adnopathy": "hilar lymphadenopathy",
    "hilar lymphadenopthy": "hilar lymphadenopathy",
    "peri cardial": "pericardial",
    "pericardeal": "pericardial",
    "mediastinal widning": "mediastinal widening",
    "mediastinal widing": "mediastinal widening",
    "mediasinal": "mediastinal",
    "mediastinum widened": "widened mediastinum",
    "cost of frenic": "costophrenic",
    "cost o frenic": "costophrenic",
    "costo phrenic": "costophrenic",
    "costiphrenic": "costophrenic",
    "right costo frenic angle": "right costophrenic angle",
    "left costo frenic angle": "left costophrenic angle",
    "costaphenic": "costophrenic",
    "diaphram": "diaphragm",
    "diaphram": "diaphragm",
    "hemidiaphram": "hemidiaphragm",
    "right hemi diaphragm": "right hemidiaphragm",
    "left hemi diaphragm": "left hemidiaphragm",
    "carena": "carina",
    "cerna": "carina",
    "trachael": "tracheal",
    "trachial": "tracheal",
    "verdibral": "vertebral",
    "veterbral": "vertebral",
    "vertibral": "vertebral",
    "clavicel": "clavicle",
    "clavicle fracture": "clavicle fracture",
    "scapulla": "scapula",
    "scapular": "scapular",
    "sternal": "sternal",
    "sternul": "sternal",
    "reticular nodular": "reticulonodular",
    "reticulo nodular": "reticulonodular",
    "honey combing": "honeycombing",
    "honey-combing": "honeycombing",
    "tree in bud": "tree-in-bud",
    "crazy paving pattern": "crazy-paving pattern",
    "crazy pavement": "crazy-paving pattern",
    "silhouet sign": "silhouette sign",
    "siluet sign": "silhouette sign",
    "perihilar": "perihilar",
    "peri hilar": "perihilar",
    "peri-hilar": "perihilar",
    "halo sine": "halo sign",
    "deep sulkus sign": "deep sulcus sign",
    "air crescent sine": "air crescent sign",
    "pulmonary edemma": "pulmonary edema",
    "pulmonary edamma": "pulmonary edema",
    "parenkymal": "parenchymal",
    "parankimal": "parenchymal",
    "alveolar": "alveolar",
    "alviolar": "alveolar",
    "bronchiel": "bronchial",
    "bronkial": "bronchial",
    "vascular markings": "vascular markings",
    "aortic nob": "aortic knob",
    "aortic knobe": "aortic knob",
    # --- Abbreviation expansions ---
    " PA ": " posteroanterior (PA) ",
    " AP ": " anteroposterior (AP) ",
    " CXR ": " chest X-ray (CXR) ",
    " PTX ": " pneumothorax (PTX) ",
    " CHF ": " congestive heart failure (CHF) ",
    " COPD ": " chronic obstructive pulmonary disease (COPD) ",
    " TB ": " tuberculosis (TB) ",
    " ILD ": " interstitial lung disease (ILD) ",
    " LAD ": " left axis deviation (LAD) ",
}

# ---------------------------------------------------------------------------
# Mammogram / Mammography Correction Dictionary
# ---------------------------------------------------------------------------
MAMMOGRAM_CORRECTIONS: dict[str, str] = {
    # --- Phonetic / ASR errors ---
    "fibroglandular": "fibroglandular",
    "fibro glandular": "fibroglandular",
    "fibro-glandular": "fibroglandular",
    "fibroglanduar": "fibroglandular",
    "fibrocistic": "fibrocystic",
    "fibro cystic": "fibrocystic",
    "fibro-cystic": "fibrocystic",
    "fibrocistik": "fibrocystic",
    "calicifications": "calcifications",
    "calcifacations": "calcifications",
    "calcifactions": "calcifications",
    "calicification": "calcification",
    "mikro calcification": "microcalcification",
    "micro calcification": "microcalcification",
    "micro-calcification": "microcalcification",
    "mikrocalcification": "microcalcification",
    "mikrocalcifications": "microcalcifications",
    "micro calcifications": "microcalcifications",
    "spicuated": "spiculated",
    "spicullated": "spiculated",
    "spiculted": "spiculated",
    "spicualted": "spiculated",
    "assymetric": "asymmetric",
    "assymmetric": "asymmetric",
    "asymetric": "asymmetric",
    "dense tissue": "dense breast tissue",
    "scattered dencity": "scattered density",
    "heterogenous": "heterogeneous",
    "heterogenous density": "heterogeneous density",
    "retroareolear": "retroareolar",
    "retro areolar": "retroareolar",
    "axilary": "axillary",
    "axiliary": "axillary",
    "axillery": "axillary",
    "lymph nodes axillary": "axillary lymph nodes",
    "infra mammary": "inframammary",
    "infra-mammary": "inframammary",
    "infra mammory": "inframammary",
    "pectoralis": "pectoralis",
    "pectorales": "pectoralis",
    "pectoralis minor": "pectoralis minor",
    "pectoralis major": "pectoralis major",
    "subareolar": "subareolar",
    "sub areolar": "subareolar",
    "nipple retraction": "nipple retraction",
    "niple retraction": "nipple retraction",
    "skin thickening": "skin thickening",
    "skin thickining": "skin thickening",
    "trabeculer thickening": "trabecular thickening",
    "trabecullar": "trabecular",
    "posterior nipple line": "posterior nipple line",
    "PNL": "posterior nipple line (PNL)",
    "BIRADS": "BI-RADS",
    "Birads": "BI-RADS",
    "bi rads": "BI-RADS",
    "bi-rads": "BI-RADS",
    "birads 0": "BI-RADS 0",
    "birads 1": "BI-RADS 1",
    "birads 2": "BI-RADS 2",
    "birads 3": "BI-RADS 3",
    "birads 4": "BI-RADS 4",
    "birads 4a": "BI-RADS 4A",
    "birads 4b": "BI-RADS 4B",
    "birads 4c": "BI-RADS 4C",
    "birads 5": "BI-RADS 5",
    "birads 6": "BI-RADS 6",
    "bi rads 0": "BI-RADS 0",
    "bi rads 1": "BI-RADS 1",
    "bi rads 2": "BI-RADS 2",
    "bi rads 3": "BI-RADS 3",
    "bi rads 4": "BI-RADS 4",
    "bi rads 5": "BI-RADS 5",
    "bi rads 6": "BI-RADS 6",
    "category one": "Category 1",
    "category two": "Category 2",
    "category three": "Category 3",
    "category four": "Category 4",
    "category five": "Category 5",
    "mlo view": "MLO view",
    "MLO": "mediolateral oblique (MLO)",
    "CC view": "craniocaudal (CC) view",
    "craniocaudal": "craniocaudal",
    "cranio caudal": "craniocaudal",
    "medio lateral": "mediolateral",
    "medial lateral oblique": "mediolateral oblique (MLO)",
    "FFDM": "full-field digital mammography (FFDM)",
    "DBT": "digital breast tomosynthesis (DBT)",
    "digital tomosynthesis": "digital breast tomosynthesis (DBT)",
    # --- Abbreviation expansions ---
    " ACR ": " American College of Radiology (ACR) ",
    " DCIS ": " ductal carcinoma in situ (DCIS) ",
    " IDC ": " invasive ductal carcinoma (IDC) ",
    " ILC ": " invasive lobular carcinoma (ILC) ",
    " ADH ": " atypical ductal hyperplasia (ADH) ",
    " ALH ": " atypical lobular hyperplasia (ALH) ",
    " US ": " ultrasound (US) ",
}

# ---------------------------------------------------------------------------
# C-Arm / Fluoroscopy Correction Dictionary
# ---------------------------------------------------------------------------
CARM_CORRECTIONS: dict[str, str] = {
    # --- Phonetic / ASR errors ---
    "fluoroscopic": "fluoroscopic",
    "fleuroscopic": "fluoroscopic",
    "flouroscopic": "fluoroscopic",
    "floroscopy": "fluoroscopy",
    "flurascopy": "fluoroscopy",
    "flouroscopy": "fluoroscopy",
    "flurography": "fluorography",
    "c arm": "C-arm",
    "carm": "C-arm",
    "cee arm": "C-arm",
    "sea arm": "C-arm",
    "contrast injected": "contrast injected",
    "iodinated contrast": "iodinated contrast",
    "non ionic contrast": "non-ionic contrast",
    "radio opaque": "radiopaque",
    "radio-opaque": "radiopaque",
    "radio lucent": "radiolucent",
    "radio-lucent": "radiolucent",
    "guide wire": "guidewire",
    "guide-wire": "guidewire",
    "guide wire position": "guidewire position",
    "introducer sheath": "introducer sheath",
    "introducer sheet": "introducer sheath",
    "cathitar": "catheter",
    "catether": "catheter",
    "cathater": "catheter",
    "stent deployment": "stent deployment",
    "stent deplacement": "stent deployment",
    "balloon dilation": "balloon dilation",
    "baloon dilation": "balloon dilation",
    "balloon dilatation": "balloon dilatation",
    "angioplasty baloon": "angioplasty balloon",
    "intra op": "intraoperative",
    "intra operative": "intraoperative",
    "intra-operative": "intraoperative",
    "peroseous": "porous",
    "framer": "frame",
    "ostio": "ostium",
    "ostiom": "ostium",
    "osteum": "ostium",
    "pedicle screw": "pedicle screw",
    "pedical screw": "pedicle screw",
    "pedical screws": "pedicle screws",
    "vertebraplasty": "vertebroplasty",
    "vertebraplasty": "vertebroplasty",
    "kyphoplasty": "kyphoplasty",
    "kiphoplasty": "kyphoplasty",
    "intervertebral disc": "intervertebral disc",
    "intervirtebral": "intervertebral",
    "intervirtibral": "intervertebral",
    "fluoro time": "fluoroscopy time",
    "dap": "dose-area product (DAP)",
    "DAP": "dose-area product (DAP)",
    "kerma": "air kerma",
    "bolus injection": "bolus injection",
    "road map": "roadmap",
    "road-map": "roadmap",
    "digital subtraction": "digital subtraction angiography (DSA)",
    "DSA": "digital subtraction angiography (DSA)",
    "road mapping": "roadmapping",
    "c arm positioning": "C-arm positioning",
    "iso center": "isocenter",
    "iso-center": "isocenter",
    "isocenter": "isocenter",
    # --- Abbreviation expansions ---
    " LAO ": " left anterior oblique (LAO) ",
    " RAO ": " right anterior oblique (RAO) ",
    " AP ": " anteroposterior (AP) ",
    " PA ": " posteroanterior (PA) ",
    " IV ": " intravenous (IV) ",
    " IA ": " intraarterial (IA) ",
    " KV ": " kilovoltage (kV) ",
    " MA ": " milliampere (mA) ",
    " MAS ": " milliampere-second (mAs) ",
    " FPS ": " frames per second (FPS) ",
    " SID ": " source-to-image distance (SID) ",
}

# Modality code → dictionary mapping
MODALITY_DICT_MAP: dict[str, dict[str, str]] = {
    "CR": XRAY_CORRECTIONS,   # Computed Radiography
    "DX": XRAY_CORRECTIONS,   # Digital X-Ray
    "XR": XRAY_CORRECTIONS,   # General X-Ray alias
    "MG": MAMMOGRAM_CORRECTIONS,
    "RF": CARM_CORRECTIONS,   # Radiofluoroscopy
    "FL": CARM_CORRECTIONS,   # Fluoroscopy alias
    "XA": CARM_CORRECTIONS,   # X-Ray Angiography (C-arm)
}

# Universal corrections applied regardless of modality
UNIVERSAL_CORRECTIONS: dict[str, str] = {
    "right side": "right",
    "left side": "left",
    "no significant abnormality": "no significant abnormality detected",
    "unremarkeble": "unremarkable",
    "unremarkible": "unremarkable",
    "comparision": "comparison",
    "comparason": "comparison",
    "minimal": "minimal",
    "minmal": "minimal",
    "bilatteral": "bilateral",
    "bilaterel": "bilateral",
    "billateral": "bilateral",
    "ipsilateral": "ipsilateral",
    "ipsilatteral": "ipsilateral",
    "contralateral": "contralateral",
    "contralatteral": "contralateral",
    "superimposed": "superimposed",
    "superimpoased": "superimposed",
    "prominance": "prominence",
    "prominance": "prominence",
    "suggestive off": "suggestive of",
    "suggestive of of": "suggestive of",
    "concistant with": "consistent with",
    "consistant with": "consistent with",
    "consitent with": "consistent with",
    "cannot be excluded": "cannot be excluded",
    "cannot exclude": "cannot exclude",
    "recomendation": "recommendation",
    "recomend": "recommend",
    "recommand": "recommend",
    "followup": "follow-up",
    "follow up": "follow-up",
    "clinical corelation": "clinical correlation",
    "clinical coralation": "clinical correlation",
    "clinicaly": "clinically",
    "significiant": "significant",
    "signifcant": "significant",
    "insignificant": "insignificant",
}


class MedicalDictionary:
    """
    Post-ASR term corrector using modality-specific dictionaries.

    Applies corrections in order:
      1. Universal corrections (all modalities)
      2. Modality-specific corrections
      3. Whole-word boundary matching to avoid partial replacements

    Returns the corrected text and a list of (original, replacement) tuples.
    """

    def __init__(self) -> None:
        self._compiled: dict[str, list[tuple[re.Pattern, str]]] = {}
        self._universal = self._compile(UNIVERSAL_CORRECTIONS)
        for code, d in MODALITY_DICT_MAP.items():
            self._compiled[code] = self._compile(d)

    @staticmethod
    def _compile(d: dict[str, str]) -> list[tuple[re.Pattern, str]]:
        """Compile correction dictionary into sorted (longest-first) regex list."""
        pairs = sorted(d.items(), key=lambda kv: len(kv[0]), reverse=True)
        result = []
        for wrong, right in pairs:
            escaped = re.escape(wrong.strip())
            pattern = re.compile(r"(?<!\w)" + escaped + r"(?!\w)", re.IGNORECASE)
            result.append((pattern, right))
        return result

    def correct(
        self, text: str, modality: Optional[str] = None
    ) -> tuple[str, list[str]]:
        """
        Correct text using universal + modality-specific dictionaries.

        Args:
            text: Raw transcript text.
            modality: DICOM modality code (CR, DX, MG, RF, FL, XA, XR).
                      Falls back to X-Ray corrections when unknown.

        Returns:
            (corrected_text, list_of_correction_descriptions)
        """
        corrections_made: list[str] = []

        def apply_patterns(
            src: str, patterns: list[tuple[re.Pattern, str]]
        ) -> str:
            for pat, replacement in patterns:
                def replace_fn(m: re.Match, r: str = replacement) -> str:
                    corrections_made.append(f'"{m.group()}" → "{r}"')
                    return r
                src = pat.sub(replace_fn, src)
            return src

        # Step 1: universal corrections
        text = apply_patterns(text, self._universal)

        # Step 2: modality-specific corrections
        mod = (modality or "CR").upper()
        patterns = self._compiled.get(mod, self._compiled.get("CR", []))
        text = apply_patterns(text, patterns)

        if corrections_made:
            logger.info(
                "Dictionary corrections applied (%d): %s",
                len(corrections_made),
                ", ".join(corrections_made[:5]) + ("…" if len(corrections_made) > 5 else ""),
            )

        return text, corrections_made

    def get_supported_modalities(self) -> list[str]:
        return list(MODALITY_DICT_MAP.keys())
