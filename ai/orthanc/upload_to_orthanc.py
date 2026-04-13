"""Upload AI DICOM outputs to Orthanc and verify stored metadata."""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path
from typing import Any

import pydicom
import requests
from dotenv import load_dotenv

LOGGER = logging.getLogger("ai.orthanc.upload")


def _load_env() -> None:
    """Load environment variables from common project locations."""
    candidates = [
        Path(".env"),
        Path("ai/.env"),
        Path("ai/.env.example"),
    ]
    for candidate in candidates:
        if candidate.exists():
            load_dotenv(candidate, override=False)


def _get_auth() -> tuple[str, str] | None:
    """Build basic auth tuple from ORTHANC_USER/PASS if present."""
    username = os.getenv("ORTHANC_USER", "").strip()
    password = os.getenv("ORTHANC_PASS", "").strip()
    if username and password:
        return (username, password)
    return None


def _request_with_retries(
    session: requests.Session,
    method: str,
    url: str,
    retries: int = 3,
    backoff_seconds: float = 2.0,
    **kwargs: Any,
) -> requests.Response:
    """Run an HTTP request with retry on HTTP/network failures."""
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            response = session.request(method, url, timeout=30, **kwargs)
            if response.status_code >= 400:
                response.raise_for_status()
            return response
        except (requests.RequestException, requests.HTTPError) as exc:
            last_error = exc
            LOGGER.warning(
                "HTTP request failed (attempt %d/%d): %s %s -> %s",
                attempt,
                retries,
                method.upper(),
                url,
                exc,
            )
            if attempt < retries:
                time.sleep(backoff_seconds)

    raise RuntimeError(f"Request failed after {retries} attempts: {method.upper()} {url}") from last_error


def _parse_study_uid_from_instance(instance_payload: dict[str, Any]) -> str:
    """Extract StudyInstanceUID from Orthanc instance metadata payload."""
    main_tags = instance_payload.get("MainDicomTags", {}) or {}
    if isinstance(main_tags, dict):
        value = str(main_tags.get("StudyInstanceUID", "")).strip()
        if value:
            return value

    simplified_tags = instance_payload.get("SimplifiedTags", {}) or {}
    if isinstance(simplified_tags, dict):
        value = str(simplified_tags.get("StudyInstanceUID", "")).strip()
        if value:
            return value

    return ""


def _parse_series_description_from_tags(tags_payload: dict[str, Any]) -> str:
    """Extract SeriesDescription from Orthanc /tags payload."""
    # /tags payload may be nested with "SeriesDescription": {"Type":"...", "Value":"..."}
    series_desc = tags_payload.get("SeriesDescription")
    if isinstance(series_desc, dict):
        value = str(series_desc.get("Value", "")).strip()
        if value:
            return value
    if isinstance(series_desc, str):
        return series_desc.strip()

    # Fallback for lowercase naming variations
    for key in ("SeriesDescription", "0008,103E"):
        value = tags_payload.get(key)
        if isinstance(value, dict):
            text = str(value.get("Value", "")).strip()
            if text:
                return text
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return ""


def _upload_single_instance(
    session: requests.Session,
    orthanc_url: str,
    dicom_path: Path,
) -> str:
    """Upload one DICOM file to Orthanc and return Orthanc instance ID."""
    payload = dicom_path.read_bytes()
    if not payload:
        raise ValueError(f"DICOM file is empty: {dicom_path}")

    upload_resp = _request_with_retries(
        session=session,
        method="POST",
        url=f"{orthanc_url}/instances",
        data=payload,
        headers={"Content-Type": "application/dicom"},
    )
    upload_json = upload_resp.json()
    instance_id = str(upload_json.get("ID", "")).strip()
    if not instance_id:
        raise RuntimeError(f"Orthanc upload response missing instance ID: {upload_json}")

    LOGGER.info("Uploaded %s -> Orthanc instance ID %s", dicom_path, instance_id)
    return instance_id


def _verify_uploaded_instance(
    session: requests.Session,
    orthanc_url: str,
    orthanc_instance_id: str,
    expected_study_uid: str,
) -> dict[str, str]:
    """Verify uploaded Orthanc instance metadata and return key tags."""
    instance_resp = _request_with_retries(
        session=session,
        method="GET",
        url=f"{orthanc_url}/instances/{orthanc_instance_id}",
    )
    instance_payload = instance_resp.json()
    observed_study_uid = _parse_study_uid_from_instance(instance_payload)

    tags_resp = _request_with_retries(
        session=session,
        method="GET",
        url=f"{orthanc_url}/instances/{orthanc_instance_id}/tags",
    )
    tags_payload = tags_resp.json()
    series_description = _parse_series_description_from_tags(tags_payload)

    if not observed_study_uid:
        # Some Orthanc configurations omit Study UID from /instances payload;
        # attempt to recover from /tags.
        series_study = tags_payload.get("StudyInstanceUID")
        if isinstance(series_study, dict):
            observed_study_uid = str(series_study.get("Value", "")).strip()
        elif isinstance(series_study, str):
            observed_study_uid = series_study.strip()

    if observed_study_uid != expected_study_uid:
        raise RuntimeError(
            "StudyInstanceUID mismatch after Orthanc upload: "
            f"instance_id={orthanc_instance_id} expected={expected_study_uid} "
            f"observed={observed_study_uid or '<missing>'}"
        )

    if not series_description:
        raise RuntimeError(
            f"SeriesDescription missing in Orthanc tags for instance {orthanc_instance_id}."
        )

    LOGGER.info(
        "Verified Orthanc instance %s: StudyUID=%s SeriesDescription=%s",
        orthanc_instance_id,
        observed_study_uid,
        series_description,
    )
    return {
        "study_instance_uid": observed_study_uid,
        "series_description": series_description,
    }


def upload_to_orthanc(
    pm_path: str,
    sc_path: str,
    source_dcm: pydicom.Dataset,
    orthanc_url: str | None = None,
) -> dict[str, str]:
    """Upload Parametric Map and Secondary Capture files to Orthanc.

    Returns:
        Dictionary containing Orthanc IDs:
        {"orthanc_pm_id": "...", "orthanc_sc_id": "..."}
    """
    _load_env()
    auth = _get_auth()
    base_url = (orthanc_url or os.getenv("ORTHANC_URL", "http://localhost:8042")).rstrip("/")
    expected_study_uid = str(getattr(source_dcm, "StudyInstanceUID", "")).strip()
    if not expected_study_uid:
        raise ValueError("Source DICOM must include StudyInstanceUID for upload verification.")

    pm_file = Path(pm_path)
    sc_file = Path(sc_path)
    if not pm_file.exists():
        raise FileNotFoundError(f"Parametric Map file not found: {pm_file}")
    if not sc_file.exists():
        raise FileNotFoundError(f"Secondary Capture file not found: {sc_file}")

    session = requests.Session()
    if auth is not None:
        session.auth = auth

    pm_id = _upload_single_instance(session=session, orthanc_url=base_url, dicom_path=pm_file)
    _verify_uploaded_instance(
        session=session,
        orthanc_url=base_url,
        orthanc_instance_id=pm_id,
        expected_study_uid=expected_study_uid,
    )

    sc_id = _upload_single_instance(session=session, orthanc_url=base_url, dicom_path=sc_file)
    _verify_uploaded_instance(
        session=session,
        orthanc_url=base_url,
        orthanc_instance_id=sc_id,
        expected_study_uid=expected_study_uid,
    )

    print(f"Orthanc PM instance ID: {pm_id}")
    print(f"Orthanc SC instance ID: {sc_id}")

    return {
        "orthanc_pm_id": pm_id,
        "orthanc_sc_id": sc_id,
    }


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build CLI parser for standalone Orthanc upload."""
    parser = argparse.ArgumentParser(description="Upload AI PM and SC DICOM files to Orthanc.")
    parser.add_argument("--pm", required=True, help="Path to ai_heatmap_pm.dcm")
    parser.add_argument("--sc", required=True, help="Path to ai_heatmap_sc.dcm")
    parser.add_argument("--source", required=True, help="Path to source DICOM used for UID verification")
    parser.add_argument("--orthanc-url", default=None, help="Orthanc base URL")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def main() -> int:
    """CLI entry point for Orthanc upload with verification."""
    args = _build_arg_parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    source = pydicom.dcmread(args.source)
    result = upload_to_orthanc(
        pm_path=args.pm,
        sc_path=args.sc,
        source_dcm=source,
        orthanc_url=args.orthanc_url,
    )
    LOGGER.info("Upload complete: %s", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
