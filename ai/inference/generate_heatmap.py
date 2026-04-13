"""Generate focused GradCAM heatmaps for CXR DICOM studies."""

from __future__ import annotations

import argparse
import io
import json
import logging
from pathlib import Path
from typing import Any

import matplotlib.cm as mpl_cm
import numpy as np
import pydicom
import torch
import torch.nn as nn
import torch.nn.functional as F
from monai.networks.nets import DenseNet121
from monai.transforms import (
    Compose,
    EnsureChannelFirst,
    EnsureType,
    NormalizeIntensity,
    Resize,
    ScaleIntensityRange,
    ToTensor,
)
from monai.visualize import GradCAM
from PIL import Image
from scipy.ndimage import gaussian_filter

LOGGER = logging.getLogger("ai.generate_heatmap")
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
ACTIVATION_THRESHOLD = 0.25
HEATMAP_ALPHA_ORIGINAL = 0.55
HEATMAP_ALPHA_CAM = 0.45


def _log_array_stats(name: str, array: np.ndarray | torch.Tensor) -> None:
    """Log shape, dtype, and numeric range for an array-like object."""
    if isinstance(array, torch.Tensor):
        arr = array.detach().cpu().numpy()
    else:
        arr = np.asarray(array)

    if arr.size == 0:
        LOGGER.info("%s: empty array shape=%s dtype=%s", name, arr.shape, arr.dtype)
        return

    LOGGER.info(
        "%s: shape=%s dtype=%s min=%.6f max=%.6f",
        name,
        arr.shape,
        arr.dtype,
        float(np.min(arr)),
        float(np.max(arr)),
    )


def _normalize_to_unit_range(image: np.ndarray) -> np.ndarray:
    """Normalize a single image to [0, 1] using per-image min-max scaling."""
    image = image.astype(np.float32, copy=False)
    min_value = float(np.min(image))
    max_value = float(np.max(image))
    if max_value - min_value < 1e-8:
        return np.zeros_like(image, dtype=np.float32)
    return ((image - min_value) / (max_value - min_value)).astype(np.float32)


def _extract_pixel_array(dcm: pydicom.Dataset) -> np.ndarray:
    """Extract a 2D grayscale float32 image from a DICOM dataset."""
    if not hasattr(dcm, "PixelData"):
        raise ValueError("DICOM dataset does not contain PixelData.")

    transfer_syntax_uid = (
        str(getattr(getattr(dcm, "file_meta", None), "TransferSyntaxUID", ""))
        if hasattr(dcm, "file_meta")
        else ""
    )
    compressed_transfer_syntaxes = {
        "1.2.840.10008.1.2.4.50",  # JPEG Baseline
        "1.2.840.10008.1.2.4.51",  # JPEG Extended
        "1.2.840.10008.1.2.4.57",  # JPEG Lossless NH
        "1.2.840.10008.1.2.4.70",  # JPEG Lossless
        "1.2.840.10008.1.2.4.80",  # JPEG-LS Lossless
        "1.2.840.10008.1.2.4.81",  # JPEG-LS Near-lossless
        "1.2.840.10008.1.2.4.90",  # JPEG 2000 Lossless
        "1.2.840.10008.1.2.4.91",  # JPEG 2000
    }

    if transfer_syntax_uid in compressed_transfer_syntaxes:
        try:
            dcm.decompress()
        except Exception as exc:  # pragma: no cover - plugin/runtime dependent
            LOGGER.warning("DICOM decompression failed, continuing with pydicom decoder: %s", exc)

    try:
        pixel_array = dcm.pixel_array.astype(np.float32)
    except Exception as exc:
        raise RuntimeError(
            "Unable to decode DICOM pixel data. Install pylibjpeg/pylibjpeg-libjpeg/"
            "pylibjpeg-openjpeg for compressed transfer syntaxes."
        ) from exc

    if pixel_array.ndim == 3:
        if pixel_array.shape[-1] <= 4:
            pixel_array = pixel_array.mean(axis=-1)
        else:
            pixel_array = pixel_array[pixel_array.shape[0] // 2]

    if pixel_array.ndim != 2:
        raise AssertionError(f"Expected 2D grayscale image, got shape {pixel_array.shape}.")

    if hasattr(dcm, "RescaleSlope") and hasattr(dcm, "RescaleIntercept"):
        slope = float(getattr(dcm, "RescaleSlope", 1.0))
        intercept = float(getattr(dcm, "RescaleIntercept", 0.0))
        pixel_array = pixel_array * slope + intercept

    return pixel_array.astype(np.float32)


def find_last_conv_layer(model: nn.Module) -> str:
    """Find the name of the last Conv2d layer in a model."""
    for name, module in reversed(list(model.named_modules())):
        if isinstance(module, nn.Conv2d):
            LOGGER.info("GradCAM fallback target layer found: %s", name)
            return name
    raise RuntimeError("No Conv2d layer found in model; cannot run GradCAM.")


def _resolve_gradcam_target_layer(model: nn.Module) -> str:
    """Resolve the best GradCAM target layer for DenseNet CXR classification."""
    named_modules = dict(model.named_modules())
    preferred_layers = [
        "class_layers.relu",  # explicitly requested primary layer
        "features.norm5",
        "features.denseblock4",
    ]

    for layer_name in preferred_layers:
        if layer_name in named_modules:
            LOGGER.info("GradCAM target layer selected: %s", layer_name)
            return layer_name

    fallback_layer = find_last_conv_layer(model)
    LOGGER.info("GradCAM target layer fallback: %s", fallback_layer)
    return fallback_layer


def _prepare_input(pixel_array: np.ndarray) -> tuple[np.ndarray, torch.Tensor]:
    """Prepare source image and MONAI tensor input for DenseNet121."""
    assert pixel_array.ndim == 2, f"Expected 2D array, got {pixel_array.shape}."

    original_gray = pixel_array.astype(np.float32, copy=False)
    original_norm = _normalize_to_unit_range(original_gray)
    original_rgb = np.stack([original_norm, original_norm, original_norm], axis=-1)

    preprocess = Compose(
        [
            EnsureChannelFirst(channel_dim=-1),
            Resize(spatial_size=(224, 224), mode="bilinear", align_corners=False),
            ScaleIntensityRange(a_min=0.0, a_max=1.0, b_min=0.0, b_max=1.0, clip=True),
            NormalizeIntensity(
                subtrahend=IMAGENET_MEAN.tolist(),
                divisor=IMAGENET_STD.tolist(),
                channel_wise=True,
            ),
            EnsureType(dtype=np.float32),
            ToTensor(dtype=torch.float32),
        ]
    )

    input_tensor = preprocess(original_rgb)
    if not isinstance(input_tensor, torch.Tensor):
        input_tensor = torch.as_tensor(input_tensor, dtype=torch.float32)

    assert input_tensor.ndim == 3, f"Expected CHW tensor, got shape {tuple(input_tensor.shape)}."
    assert tuple(input_tensor.shape[1:]) == (224, 224), (
        f"Expected resized tensor to be (3, 224, 224), got {tuple(input_tensor.shape)}."
    )

    input_tensor = input_tensor.unsqueeze(0)
    assert input_tensor.shape == (1, 3, 224, 224), (
        f"Expected batched tensor shape (1, 3, 224, 224), got {tuple(input_tensor.shape)}."
    )

    _log_array_stats("Original grayscale", original_gray)
    _log_array_stats("Preprocessed model input", input_tensor)
    return original_gray, input_tensor


def _extract_state_dict(checkpoint: Any) -> dict[str, Any]:
    """Extract the model state dictionary from common checkpoint formats."""
    if isinstance(checkpoint, dict):
        if "state_dict" in checkpoint and isinstance(checkpoint["state_dict"], dict):
            checkpoint = checkpoint["state_dict"]
        elif "model_state_dict" in checkpoint and isinstance(
            checkpoint["model_state_dict"], dict
        ):
            checkpoint = checkpoint["model_state_dict"]

    if not isinstance(checkpoint, dict):
        raise TypeError("Model checkpoint does not contain a valid state dictionary.")

    if any(key.startswith("module.") for key in checkpoint.keys()):
        return {key.replace("module.", "", 1): value for key, value in checkpoint.items()}
    return checkpoint


def _load_model(model_path: str, device: torch.device) -> nn.Module:
    """Load MONAI DenseNet121 CXR model weights."""
    model_file = Path(model_path)
    if not model_file.exists():
        raise FileNotFoundError(f"Model weights not found at: {model_file}")

    model = DenseNet121(spatial_dims=2, in_channels=3, out_channels=14)
    checkpoint = torch.load(model_file, map_location=device)
    state_dict = _extract_state_dict(checkpoint)

    missing, unexpected = model.load_state_dict(state_dict, strict=False)
    if missing:
        LOGGER.warning("Missing model keys while loading checkpoint: %s", missing)
    if unexpected:
        LOGGER.warning("Unexpected model keys while loading checkpoint: %s", unexpected)

    model.to(device)
    model.eval()
    LOGGER.info("Model loaded from %s on device %s", model_file, device)
    return model


def _infer_top_class(
    model: nn.Module,
    input_tensor: torch.Tensor,
    device: torch.device,
) -> tuple[torch.Tensor, int, float]:
    """Run inference and return logits, top class index, and confidence."""
    with torch.no_grad():
        logits = model(input_tensor.to(device))
    if logits.ndim != 2:
        raise AssertionError(f"Expected logits shape [B, C], got {tuple(logits.shape)}.")
    if logits.shape[0] != 1:
        raise AssertionError(f"Expected batch size 1, got {logits.shape[0]}.")

    probabilities = torch.softmax(logits, dim=1)
    top_class_idx = int(torch.argmax(probabilities, dim=1).item())
    confidence = float(probabilities[0, top_class_idx].item())

    _log_array_stats("Model logits", logits)
    _log_array_stats("Model probabilities", probabilities)
    LOGGER.info("Top predicted class index=%d confidence=%.4f", top_class_idx, confidence)
    return logits, top_class_idx, confidence


def _generate_gradcam_map(
    model: nn.Module,
    input_tensor: torch.Tensor,
    target_layer: str,
    class_index: int,
) -> torch.Tensor:
    """Generate GradCAM map tensor for a selected class."""
    gradcam = GradCAM(nn_module=model, target_layers=target_layer)
    cam = gradcam(input_tensor, class_idx=class_index)

    if not isinstance(cam, torch.Tensor):
        cam = torch.as_tensor(cam, dtype=torch.float32)

    if cam.ndim == 4 and cam.shape[1] == 1:
        cam = cam[:, 0, :, :]

    assert cam.ndim == 3, f"Expected CAM shape [B, H, W], got {tuple(cam.shape)}."
    assert cam.shape[0] == 1, f"Expected CAM batch size of 1, got {cam.shape[0]}."
    _log_array_stats("Raw GradCAM", cam)
    return cam


def _post_process_cam(cam: torch.Tensor, output_shape: tuple[int, int]) -> np.ndarray:
    """Upsample, normalize, threshold, and smooth GradCAM output."""
    h, w = output_shape
    assert h > 0 and w > 0, f"Invalid output shape: {output_shape}"

    cam = cam.detach().float()
    cam = cam.unsqueeze(1)  # [B, 1, H, W]
    resized = F.interpolate(cam, size=(h, w), mode="bilinear", align_corners=False)
    resized_np = resized.squeeze(0).squeeze(0).cpu().numpy().astype(np.float32)
    _log_array_stats("Resized CAM", resized_np)

    normalized = _normalize_to_unit_range(resized_np)
    _log_array_stats("CAM normalized (pre-threshold)", normalized)

    thresholded = normalized.copy()
    thresholded[thresholded < ACTIVATION_THRESHOLD] = 0.0
    _log_array_stats("CAM thresholded", thresholded)

    smoothed = gaussian_filter(thresholded, sigma=2.0).astype(np.float32)
    _log_array_stats("CAM smoothed", smoothed)

    smoothed_norm = _normalize_to_unit_range(smoothed)
    smoothed_norm[smoothed_norm < ACTIVATION_THRESHOLD] = 0.0
    smoothed_norm = np.clip(smoothed_norm, 0.0, 1.0).astype(np.float32)
    _log_array_stats("CAM final normalized", smoothed_norm)
    return smoothed_norm


def _to_uint8(image: np.ndarray) -> np.ndarray:
    """Convert float image to uint8 via per-image min-max normalization."""
    unit = _normalize_to_unit_range(image)
    return np.clip(unit * 255.0, 0.0, 255.0).astype(np.uint8)


def _blend_heatmap(original_gray: np.ndarray, cam_normalized: np.ndarray) -> np.ndarray:
    """Blend colorized heatmap with grayscale anatomy image."""
    if original_gray.shape != cam_normalized.shape:
        raise AssertionError(
            f"Shape mismatch for blending: original={original_gray.shape} cam={cam_normalized.shape}"
        )

    base_uint8 = _to_uint8(original_gray)
    base_rgb = np.stack([base_uint8, base_uint8, base_uint8], axis=-1).astype(np.float32)

    jet_rgb = (mpl_cm.jet(cam_normalized)[..., :3] * 255.0).astype(np.uint8)
    blended_rgb = base_rgb.copy()

    activation_mask = cam_normalized > ACTIVATION_THRESHOLD
    overlay = (
        HEATMAP_ALPHA_ORIGINAL * base_rgb + HEATMAP_ALPHA_CAM * jet_rgb.astype(np.float32)
    ).clip(0, 255)

    blended_rgb[activation_mask] = overlay[activation_mask]
    result = blended_rgb.astype(np.uint8)
    _log_array_stats("Blended heatmap RGB", result)
    return result


def infer_top_class_confidence(
    source_dcm: pydicom.Dataset,
    model_path: str,
) -> tuple[int, float]:
    """Infer top class index and confidence from a source DICOM dataset."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pixel_array = _extract_pixel_array(source_dcm)
    _, input_tensor = _prepare_input(pixel_array)
    model = _load_model(model_path=model_path, device=device)
    _, top_class_idx, confidence = _infer_top_class(model, input_tensor, device=device)
    return top_class_idx, confidence


def generate_heatmap(
    dicom_path: str,
    model_path: str,
    output_dir: str,
) -> tuple[np.ndarray, int, pydicom.Dataset]:
    """Generate a thresholded GradCAM heatmap and preview image.

    Returns:
        cam_normalized: float32 array shape (H, W), values in [0.0, 1.0]
        top_class_idx: predicted top class index
        dcm: original source DICOM dataset
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    LOGGER.info("Output directory: %s", output_path.resolve())

    dcm = pydicom.dcmread(dicom_path)
    LOGGER.info("Loaded source DICOM: %s", dicom_path)

    pixel_array = _extract_pixel_array(dcm)
    original_gray, input_tensor = _prepare_input(pixel_array)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = _load_model(model_path=model_path, device=device)

    _, top_class_idx, confidence = _infer_top_class(model, input_tensor, device=device)
    target_layer = _resolve_gradcam_target_layer(model)
    cam_tensor = _generate_gradcam_map(
        model=model,
        input_tensor=input_tensor.to(device),
        target_layer=target_layer,
        class_index=top_class_idx,
    )

    cam_normalized = _post_process_cam(cam_tensor, output_shape=original_gray.shape)
    assert cam_normalized.shape == original_gray.shape, (
        f"CAM shape {cam_normalized.shape} does not match source image shape {original_gray.shape}."
    )
    assert cam_normalized.dtype == np.float32, f"CAM dtype must be float32, got {cam_normalized.dtype}."

    cam_raw_path = output_path / "cam_raw.npy"
    np.save(cam_raw_path, cam_normalized)
    LOGGER.info("Saved CAM array to %s", cam_raw_path.resolve())

    blended_preview = _blend_heatmap(original_gray, cam_normalized)
    preview_path = output_path / "heatmap_preview.png"
    Image.fromarray(blended_preview, mode="RGB").save(preview_path)
    LOGGER.info("Saved blended heatmap preview to %s", preview_path.resolve())

    metadata_path = output_path / "heatmap_metadata.json"
    metadata = {
        "top_class_idx": top_class_idx,
        "confidence": round(confidence, 6),
        "gradcam_target_layer": target_layer,
        "cam_shape": list(cam_normalized.shape),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    LOGGER.info("Saved heatmap metadata to %s", metadata_path.resolve())

    return cam_normalized, top_class_idx, dcm


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build CLI argument parser for standalone Task 1 execution."""
    parser = argparse.ArgumentParser(description="Generate MONAI GradCAM heatmap for CXR DICOM.")
    parser.add_argument("--dicom", required=True, help="Path to source DICOM file.")
    parser.add_argument(
        "--model",
        default="./models/cxr_14class.pth",
        help="Path to CXR DenseNet121 model weights.",
    )
    parser.add_argument(
        "--output",
        default="./output",
        help="Directory where heatmap outputs should be written.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level.",
    )
    return parser


def main() -> int:
    """CLI entry point for generating heatmap outputs."""
    parser = _build_arg_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    cam, top_idx, _ = generate_heatmap(
        dicom_path=args.dicom,
        model_path=args.model,
        output_dir=args.output,
    )
    LOGGER.info(
        "Heatmap generation complete: top_class_idx=%d cam_shape=%s cam_max=%.4f",
        top_idx,
        cam.shape,
        float(np.max(cam)),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
