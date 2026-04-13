"""
Celery + Redis job queue for async inference.

Queue topology:
  STAT studies   → stat_gpu     (high priority, GPU worker)
  Routine        → routine_gpu  (normal priority, GPU/CPU)
  Batch overnight → batch_overnight (low priority)

Usage:
  result = enqueue_inference_job(dicom_bytes, priority=Priority.STAT)
  status = get_job_status(result.id)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from config import REDIS_URL, Priority, CELERY_QUEUES

logger = logging.getLogger("monai-server.job_queue")

try:
    from celery import Celery

    celery_app = Celery(
        "monai_inference",
        broker=REDIS_URL,
        backend=REDIS_URL,
    )

    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        task_routes={
            "inference.job_queue.run_inference_task": {
                "queue": "routine_gpu",
            },
        },
        task_queues={
            "stat_gpu": {"routing_key": "stat.gpu"},
            "routine_gpu": {"routing_key": "routine.gpu"},
            "batch_overnight": {"routing_key": "batch.cpu"},
        },
        worker_prefetch_multiplier=1,
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        task_time_limit=600,
        task_soft_time_limit=540,
    )
    CELERY_AVAILABLE = True
except ImportError:
    celery_app = None
    CELERY_AVAILABLE = False
    logger.warning("Celery not installed — async job queue disabled")


@dataclass
class InferenceJob:
    job_id: str
    model_names: list[str]
    priority: Priority
    status: str = "queued"
    result: Optional[dict] = None


def enqueue_inference_job(
    dicom_bytes: bytes,
    model_names: Optional[list[str]] = None,
    priority: Priority = Priority.ROUTINE,
    push_to_orthanc: bool = True,
) -> InferenceJob:
    """Enqueue an inference job onto the appropriate Celery queue."""
    import base64
    import uuid

    job_id = str(uuid.uuid4())
    queue_config = CELERY_QUEUES[priority]

    if not CELERY_AVAILABLE:
        logger.info("Celery unavailable — running inference synchronously")
        result = _run_sync(dicom_bytes, model_names, push_to_orthanc)
        return InferenceJob(
            job_id=job_id,
            model_names=model_names or [],
            priority=priority,
            status="completed",
            result=result,
        )

    encoded = base64.b64encode(dicom_bytes).decode("ascii")
    task = run_inference_task.apply_async(
        args=[encoded, model_names, push_to_orthanc],
        queue=queue_config["queue"],
        routing_key=queue_config["routing_key"],
        task_id=job_id,
        priority=_priority_int(priority),
    )

    logger.info(
        "Job enqueued: id=%s  queue=%s  models=%s",
        job_id, queue_config["queue"], model_names,
    )
    return InferenceJob(
        job_id=task.id,
        model_names=model_names or [],
        priority=priority,
        status="queued",
    )


def get_job_status(job_id: str) -> dict:
    """Check the status of an async inference job."""
    if not CELERY_AVAILABLE:
        return {"job_id": job_id, "status": "unknown", "detail": "Celery not available"}

    result = celery_app.AsyncResult(job_id)
    status_map = {
        "PENDING": "queued",
        "STARTED": "processing",
        "SUCCESS": "completed",
        "FAILURE": "failed",
        "REVOKED": "cancelled",
    }
    return {
        "job_id": job_id,
        "status": status_map.get(result.status, result.status),
        "result": result.result if result.ready() else None,
    }


def _run_sync(
    dicom_bytes: bytes,
    model_names: Optional[list[str]],
    push_to_orthanc: bool,
) -> dict:
    from inference.operators import MonaiDeployPipeline
    pipeline = MonaiDeployPipeline()
    ctx = pipeline.run(dicom_bytes, model_override=model_names, push_to_orthanc=push_to_orthanc)
    return {
        "study_uid": ctx.study_uid,
        "models_run": list(ctx.inference_results.keys()),
        "results": {
            k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
            for k, v in ctx.inference_results.items()
        },
        "errors": ctx.errors,
    }


def _priority_int(p: Priority) -> int:
    return {Priority.STAT: 9, Priority.ROUTINE: 5, Priority.BATCH: 1}[p]


if CELERY_AVAILABLE:
    @celery_app.task(name="inference.job_queue.run_inference_task", bind=True, max_retries=2)
    def run_inference_task(self, encoded_dicom: str, model_names, push_to_orthanc):
        import base64
        dicom_bytes = base64.b64decode(encoded_dicom)
        return _run_sync(dicom_bytes, model_names, push_to_orthanc)
