from .ct_transforms import (
    ct_lung_nodule_transforms,
    ct_multi_organ_transforms,
    ct_brain_transforms,
    ct_pe_transforms,
    ct_vertebral_transforms,
    ct_train_augmentation,
)
from .mri_transforms import (
    mri_brain_tumor_transforms,
    mri_prostate_transforms,
    mri_cardiac_transforms,
    mri_knee_transforms,
    mri_train_augmentation,
)
from .cxr_transforms import (
    cxr_14class_transforms,
    cxr_tb_covid_transforms,
    cxr_fracture_transforms,
    cxr_train_augmentation,
)
from .us_transforms import us_tirads_transforms, us_fast_transforms
from .postprocessing import (
    segmentation_postprocess,
    detection_postprocess,
    classification_postprocess,
)

TRANSFORM_MAP: dict[str, callable] = {
    "ct_lung_nodule": ct_lung_nodule_transforms,
    "ct_multi_organ_seg": ct_multi_organ_transforms,
    "ct_brain_hemorrhage": ct_brain_transforms,
    "ct_pe_classification": ct_pe_transforms,
    "ct_vertebral_fracture": ct_vertebral_transforms,
    "mri_brain_tumor": mri_brain_tumor_transforms,
    "mri_prostate_seg": mri_prostate_transforms,
    "mri_cardiac_seg": mri_cardiac_transforms,
    "mri_knee_cartilage": mri_knee_transforms,
    "cxr_14class": cxr_14class_transforms,
    "cxr_tb_covid": cxr_tb_covid_transforms,
    "cxr_fracture_detection": cxr_fracture_transforms,
    "us_tirads": us_tirads_transforms,
    "us_fast_exam": us_fast_transforms,
}


def get_inference_transforms(model_name: str):
    """Return the inference transform pipeline for a given model name."""
    factory = TRANSFORM_MAP.get(model_name)
    if factory is None:
        raise ValueError(f"No transforms registered for model: {model_name}")
    return factory()
