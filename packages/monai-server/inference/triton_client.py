"""
NVIDIA Triton Inference Server client.

Supports the model_repository/ layout:
    model_repository/
      ├── lung_nodule/     (TensorRT optimized)
      ├── brain_seg/       (ONNX)
      ├── cxr_14class/     (TorchScript)
    Dynamic batching ON, max_batch_size=8

Falls back to local PyTorch inference when Triton is unreachable.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from config import TRITON_URL

logger = logging.getLogger("monai-server.triton")

try:
    import tritonclient.grpc as grpcclient
    TRITON_AVAILABLE = True
except ImportError:
    grpcclient = None
    TRITON_AVAILABLE = False
    logger.info("tritonclient not installed — Triton integration disabled")


class TritonModelClient:
    """Thin wrapper around the Triton gRPC client."""

    def __init__(self, url: str = TRITON_URL):
        self.url = url
        self._client = None
        self._connected = False

    def connect(self) -> bool:
        if not TRITON_AVAILABLE:
            return False
        try:
            self._client = grpcclient.InferenceServerClient(url=self.url)
            if self._client.is_server_live():
                self._connected = True
                logger.info("Connected to Triton at %s", self.url)
                return True
        except Exception as e:
            logger.warning("Cannot connect to Triton at %s: %s", self.url, e)
        return False

    def is_model_ready(self, model_name: str) -> bool:
        if not self._connected:
            return False
        try:
            return self._client.is_model_ready(model_name)
        except Exception:
            return False

    def infer(
        self,
        model_name: str,
        input_data: np.ndarray,
        input_name: str = "INPUT__0",
        output_name: str = "OUTPUT__0",
    ) -> Optional[np.ndarray]:
        """Run inference on Triton. Returns None if unavailable."""
        if not self._connected:
            return None

        try:
            triton_input = grpcclient.InferInput(
                input_name, input_data.shape, "FP32"
            )
            triton_input.set_data_from_numpy(input_data.astype(np.float32))

            triton_output = grpcclient.InferRequestedOutput(output_name)

            response = self._client.infer(
                model_name=model_name,
                inputs=[triton_input],
                outputs=[triton_output],
            )

            result = response.as_numpy(output_name)
            logger.info("Triton inference: model=%s  output_shape=%s", model_name, result.shape)
            return result

        except Exception as e:
            logger.error("Triton inference failed for %s: %s", model_name, e)
            return None

    def get_model_metadata(self, model_name: str) -> Optional[dict]:
        if not self._connected:
            return None
        try:
            meta = self._client.get_model_metadata(model_name)
            return {
                "name": meta.name,
                "versions": list(meta.versions),
                "inputs": [
                    {"name": inp.name, "shape": list(inp.shape), "datatype": inp.datatype}
                    for inp in meta.inputs
                ],
                "outputs": [
                    {"name": out.name, "shape": list(out.shape), "datatype": out.datatype}
                    for out in meta.outputs
                ],
            }
        except Exception as e:
            logger.error("Failed to get metadata for %s: %s", model_name, e)
            return None

    def list_models(self) -> list[str]:
        if not self._connected:
            return []
        try:
            repo = self._client.get_model_repository_index()
            return [m.name for m in repo.models]
        except Exception:
            return []


def generate_triton_config(
    model_name: str,
    max_batch_size: int = 8,
    input_dims: list[int] | None = None,
    output_dims: list[int] | None = None,
    backend: str = "onnxruntime",
) -> str:
    """Generate a Triton config.pbtxt for a model."""
    input_dims = input_dims or [1, 96, 96, 96]
    output_dims = output_dims or [7, 96, 96, 96]

    return f"""name: "{model_name}"
platform: "{backend}"
max_batch_size: {max_batch_size}

input [
  {{
    name: "INPUT__0"
    data_type: TYPE_FP32
    dims: {input_dims}
  }}
]

output [
  {{
    name: "OUTPUT__0"
    data_type: TYPE_FP32
    dims: {output_dims}
  }}
]

dynamic_batching {{
  preferred_batch_size: [ 2, 4, 8 ]
  max_queue_delay_microseconds: 100000
}}

instance_group [
  {{
    count: 1
    kind: KIND_GPU
  }}
]
"""
