"""
Explainability: GradCAM heatmap generation using monai.visualize.

Generates class activation maps and writes them as:
  - NumPy array (for DICOM PR overlay)
  - PNG image (for API response)
  - DICOM Secondary Capture (for PACS viewing)
"""

from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from scipy.ndimage import gaussian_filter

from config import DEVICE

logger = logging.getLogger("monai-server.explainability")

try:
    from monai.visualize import GradCAM as MonaiGradCAM
    MONAI_GRADCAM_AVAILABLE = True
except ImportError:
    MONAI_GRADCAM_AVAILABLE = False
    logger.info("monai.visualize.GradCAM not available — using custom implementation")

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False


class GradCAMGenerator:
    """Generate GradCAM heatmaps for classification models.

    Prefers monai.visualize.GradCAM when available; falls back to a
    manual hook-based implementation.
    """

    def __init__(self, model: nn.Module, target_layer: Optional[str] = None):
        self.model = model
        self.target_layer = target_layer
        self._resolve_target_layer()

    def generate(
        self,
        input_tensor: torch.Tensor,
        class_idx: Optional[int] = None,
    ) -> np.ndarray:
        """Generate a GradCAM heatmap.

        Args:
            input_tensor: model input (B, C, H, W) or (B, C, D, H, W)
            class_idx: target class index (None = argmax)

        Returns:
            Normalised heatmap as float32 array in [0, 1]
        """
        input_tensor = input_tensor.to(DEVICE).requires_grad_(True)

        if MONAI_GRADCAM_AVAILABLE and self._layer_name:
            return self._monai_gradcam(input_tensor, class_idx)
        return self._manual_gradcam(input_tensor, class_idx)

    def generate_heatmap_png(
        self,
        cam: np.ndarray,
        original_image: Optional[np.ndarray] = None,
        alpha: float = 0.45,
        smooth_sigma: float = 1.0,
        activation_threshold: float = 0.30,
        activation_percentile: float = 85.0,
    ) -> bytes:
        """Render a GradCAM heatmap as a blended PNG."""
        cam_float = np.asarray(cam, dtype=np.float32)

        if cam_float.ndim == 3:
            mid = cam_float.shape[0] // 2
            cam_float = cam_float[mid]

        cam_float = _normalize_cam(cam_float)
        if smooth_sigma > 0:
            cam_float = gaussian_filter(cam_float, sigma=float(smooth_sigma))
            cam_float = _normalize_cam(cam_float)

        percentile_threshold = float(np.percentile(cam_float, activation_percentile))
        floor_threshold = float(max(0.0, min(1.0, activation_threshold)))
        effective_threshold = min(0.95, max(floor_threshold, percentile_threshold))
        if effective_threshold > 0:
            denom = max(1e-6, 1.0 - effective_threshold)
            cam_float = np.where(cam_float >= effective_threshold, (cam_float - effective_threshold) / denom, 0.0)
            cam_float = np.clip(cam_float, 0.0, 1.0)

        cam_uint8 = (cam_float * 255.0).astype(np.uint8)

        h, w = cam_uint8.shape[:2]
        heatmap = _apply_colormap(cam_uint8)

        if original_image is not None:
            if original_image.ndim == 3:
                original_image = original_image[original_image.shape[0] // 2]
            orig_uint8 = _normalize_to_uint8(original_image)
            orig_resized = np.array(
                Image.fromarray(orig_uint8).resize((w, h), Image.BILINEAR)
            )
            base_rgb = np.stack([orig_resized] * 3, axis=-1).astype(np.float32)

            # Weight alpha by activation so low-activation regions don't obscure anatomy.
            alpha_map = np.clip(cam_float[..., np.newaxis] * float(alpha), 0.0, 1.0)
            blended = (
                base_rgb * (1.0 - alpha_map) + heatmap.astype(np.float32) * alpha_map
            ).clip(0, 255).astype(np.uint8)
        else:
            blended = heatmap.astype(np.uint8)

        img = Image.fromarray(blended, "RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def _monai_gradcam(
        self, input_tensor: torch.Tensor, class_idx: Optional[int]
    ) -> np.ndarray:
        """Use MONAI's built-in GradCAM."""
        cam = MonaiGradCAM(nn_module=self.model, target_layers=self._layer_name)
        result = cam(input_tensor, class_idx=class_idx)
        arr = result.squeeze().detach().cpu().numpy()
        return _normalize_cam(arr)

    def _manual_gradcam(
        self, input_tensor: torch.Tensor, class_idx: Optional[int]
    ) -> np.ndarray:
        """Fallback hook-based GradCAM."""
        activations = []
        gradients = []

        target = self._resolved_layer
        if target is None:
            logger.warning("No target layer found for GradCAM")
            return np.zeros((7, 7), dtype=np.float32)

        def fwd_hook(_m, _i, o):
            activations.append(o.detach())

        def bwd_hook(_m, _gi, go):
            gradients.append(go[0].detach())

        h_fwd = target.register_forward_hook(fwd_hook)
        h_bwd = target.register_full_backward_hook(bwd_hook)

        try:
            self.model.zero_grad()
            output = self.model(input_tensor)

            if class_idx is None:
                class_idx = output.flatten().argmax().item()

            if output.ndim == 1:
                score = output[class_idx]
            else:
                score = output.flatten()[class_idx]

            score.backward(retain_graph=True)

            if not activations or not gradients:
                return np.zeros((7, 7), dtype=np.float32)

            act = activations[0]
            grad = gradients[0]

            spatial_dims = tuple(range(2, act.ndim))
            weights = grad.mean(dim=spatial_dims, keepdim=True)
            cam = (weights * act).sum(dim=1, keepdim=True)
            cam = torch.relu(cam)
            cam = cam.squeeze().cpu().numpy()

            return _normalize_cam(cam)

        finally:
            h_fwd.remove()
            h_bwd.remove()
            self.model.eval()

    def _resolve_target_layer(self) -> None:
        """Find the target conv layer for GradCAM."""
        self._layer_name = self.target_layer
        self._resolved_layer = None

        if self.target_layer:
            try:
                self._resolved_layer = dict(self.model.named_modules())[self.target_layer]
                self._layer_name = self.target_layer
                return
            except KeyError:
                pass

        for name, module in reversed(list(self.model.named_modules())):
            if isinstance(module, (nn.Conv2d, nn.Conv3d)):
                self._layer_name = name
                self._resolved_layer = module
                return

        if hasattr(self.model, "features"):
            features = self.model.features
            if isinstance(features, nn.Sequential) and len(features) > 0:
                self._resolved_layer = features[-1]
                self._layer_name = "features." + str(len(features) - 1)


def _normalize_cam(cam: np.ndarray) -> np.ndarray:
    cam_min, cam_max = cam.min(), cam.max()
    if cam_max - cam_min > 1e-8:
        return ((cam - cam_min) / (cam_max - cam_min)).astype(np.float32)
    return np.zeros_like(cam, dtype=np.float32)


def _normalize_to_uint8(arr: np.ndarray) -> np.ndarray:
    mn, mx = arr.min(), arr.max()
    if mx - mn < 1e-8:
        return np.zeros(arr.shape, dtype=np.uint8)
    return ((arr - mn) / (mx - mn) * 255).astype(np.uint8)


def _apply_colormap(gray: np.ndarray) -> np.ndarray:
    if CV2_AVAILABLE:
        bgr = cv2.applyColorMap(gray.astype(np.uint8), cv2.COLORMAP_JET)
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    # Fallback: smooth JET-like LUT interpolation
    lut = np.array(
        [
            [0, 0, 128], [0, 0, 255], [0, 128, 255], [0, 255, 255],
            [0, 255, 128], [0, 255, 0], [128, 255, 0], [255, 255, 0],
            [255, 128, 0], [255, 0, 0],
        ],
        dtype=np.float32,
    )
    idx = gray.astype(np.float32) / 255.0 * (len(lut) - 1)
    lo = np.floor(idx).astype(np.int32)
    hi = np.clip(lo + 1, 0, len(lut) - 1)
    w = (idx - lo)[..., np.newaxis]
    return (lut[lo] * (1.0 - w) + lut[hi] * w).astype(np.uint8)
