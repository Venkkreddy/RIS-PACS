"""Query Orthanc and summarize all series for a study UID."""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

LOGGER = logging.getLogger("ai.orthanc.verify_series")


def _load_env() -> None:
    """Load environment variables from project-level env files."""
    for candidate in (Path(".env"), Path("ai/.env"), Path("ai/.env.example")):
        if candidate.exists():
            load_dotenv(candidate, override=False)


def _get_auth() -> tuple[str, str] | None:
    """Return Orthanc basic-auth tuple if credentials are configured."""
    username = os.getenv("ORTHANC_USER", "").strip()
    password = os.getenv("ORTHANC_PASS", "").strip()
    if username and password:
        return (username, password)
    return None


def _safe_get(url: str, session: requests.Session) -> dict[str, Any]:
    """Perform GET and parse JSON response."""
    response = session.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def _study_ids_for_uid(
    session: requests.Session,
    orthanc_url: str,
    study_instance_uid: str,
) -> list[str]:
    """Resolve Orthanc study IDs for a DICOM StudyInstanceUID."""
    payload = {
        "Level": "Study",
        "Query": {"StudyInstanceUID": study_instance_uid},
        "Expand": False,
    }
    response = session.post(f"{orthanc_url}/tools/find", json=payload, timeout=30)
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, list):
        return []
    return [str(item) for item in result if str(item).strip()]


def _extract_sop_class_uid(
    session: requests.Session,
    orthanc_url: str,
    series_payload: dict[str, Any],
) -> str:
    """Extract SOPClassUID for a series using first available instance."""
    instances = series_payload.get("Instances", [])
    if not isinstance(instances, list) or not instances:
        return ""

    first_instance_id = str(instances[0]).strip()
    if not first_instance_id:
        return ""

    instance_payload = _safe_get(f"{orthanc_url}/instances/{first_instance_id}", session)
    main_tags = instance_payload.get("MainDicomTags", {}) or {}
    if isinstance(main_tags, dict):
        return str(main_tags.get("SOPClassUID", "")).strip()
    return ""


def verify_heatmap_series(
    study_instance_uid: str,
    orthanc_url: str | None = None,
) -> list[dict[str, str]]:
    """List series metadata for a study UID and print a formatted table."""
    _load_env()
    base_url = (orthanc_url or os.getenv("ORTHANC_URL", "http://localhost:8042")).rstrip("/")

    session = requests.Session()
    auth = _get_auth()
    if auth is not None:
        session.auth = auth

    study_ids = _study_ids_for_uid(
        session=session,
        orthanc_url=base_url,
        study_instance_uid=study_instance_uid,
    )
    if not study_ids:
        raise RuntimeError(f"No Orthanc study found for StudyInstanceUID={study_instance_uid}")

    rows: list[dict[str, str]] = []
    for study_id in study_ids:
        study_payload = _safe_get(f"{base_url}/studies/{study_id}", session)
        series_ids = study_payload.get("Series", [])
        if not isinstance(series_ids, list):
            continue

        for series_id in series_ids:
            series_payload = _safe_get(f"{base_url}/series/{series_id}", session)
            main_tags = series_payload.get("MainDicomTags", {}) or {}
            if not isinstance(main_tags, dict):
                main_tags = {}

            series_number = str(main_tags.get("SeriesNumber", "")).strip()
            series_description = str(main_tags.get("SeriesDescription", "")).strip()
            sop_class_uid = _extract_sop_class_uid(
                session=session,
                orthanc_url=base_url,
                series_payload=series_payload,
            )
            instances = series_payload.get("Instances", [])
            instance_count = str(len(instances)) if isinstance(instances, list) else "0"

            rows.append(
                {
                    "series_number": series_number,
                    "series_description": series_description,
                    "sop_class_uid": sop_class_uid,
                    "instances": instance_count,
                }
            )

    if not rows:
        raise RuntimeError(
            f"Study found for UID {study_instance_uid}, but no series metadata could be read."
        )

    rows.sort(key=lambda row: (row["series_number"] or "999999", row["series_description"]))

    header = (
        f"{'SeriesNumber':<14} | {'SeriesDescription':<44} | {'SOPClassUID':<36} | {'Instances':<9}"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        is_ai = row["series_number"] == "900" or "ai heatmap" in row["series_description"].lower()
        prefix = ">> " if is_ai else "   "
        print(
            f"{prefix}"
            f"{row['series_number']:<14} | "
            f"{row['series_description'][:44]:<44} | "
            f"{row['sop_class_uid'][:36]:<36} | "
            f"{row['instances']:<9}"
        )

    return rows


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build CLI argument parser for Orthanc series verification."""
    parser = argparse.ArgumentParser(description="Verify heatmap series in Orthanc by study UID.")
    parser.add_argument("--study-uid", required=True, help="DICOM StudyInstanceUID to inspect.")
    parser.add_argument("--orthanc-url", default=None, help="Orthanc base URL.")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def main() -> int:
    """CLI entry point for heatmap series verification."""
    args = _build_arg_parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    verify_heatmap_series(study_instance_uid=args.study_uid, orthanc_url=args.orthanc_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
