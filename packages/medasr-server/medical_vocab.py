"""
Medical Vocabulary Reference Module

MedASR handles medical terminology natively (4.6% WER on radiology dictation),
so this module now serves as a reference for known radiology terms and provides
lightweight post-processing utilities if needed.
"""

import logging

logger = logging.getLogger("medasr-server.vocab")

RADIOLOGY_TERMS = [
    "atelectasis", "cardiomegaly", "pneumothorax", "pneumonia", "effusion",
    "consolidation", "emphysema", "fibrosis", "nodule", "opacity",
    "infiltrate", "edema", "hernia", "pleural thickening", "mass",
    "lesion", "calcification", "lymphadenopathy", "mediastinum",
    "pericardial", "costophrenic", "diaphragm", "hilum", "hilar",
    "parenchyma", "interstitial", "alveolar", "bronchial", "vascular",
    "aortic", "pulmonary", "cardiac", "thoracic", "cervical",
    "lumbar", "sacral", "vertebral", "sternal", "clavicular",
    "scapular", "rib", "trachea", "bronchus", "carina",
    "ground-glass opacity", "tree-in-bud", "crazy paving",
    "honeycombing", "reticular", "reticulonodular",
    "air bronchogram", "silhouette sign", "air crescent sign",
    "halo sign", "meniscus sign", "deep sulcus sign",
    "Hounsfield", "contrast-enhanced", "non-contrast",
    "axial", "coronal", "sagittal", "posteroanterior", "anteroposterior",
]


def get_vocabulary_list() -> list[str]:
    """Return all known radiology terms (useful for vocabulary boosting / validation)."""
    return RADIOLOGY_TERMS.copy()
