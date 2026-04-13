#!/usr/bin/env python3
"""Post-deploy smoke checks for tdairad API chain.

Checks:
1) /health endpoint
2) /health/worklist-sync (API -> Dicoogle fetch path)
3) /health/webhook-connectivity (webhook metadata path via Dicoogle)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class CheckResult:
    name: str
    success: bool
    status_code: int
    duration_ms: int
    details: dict[str, Any]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_json(method: str, url: str, payload: dict[str, Any] | None, timeout_seconds: int) -> tuple[int, dict[str, Any], str]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url=url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            return response.getcode(), parsed, ""
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return error.code, parsed, f"HTTPError: {error.reason}"
    except Exception as error:  # pylint: disable=broad-except
        return 0, {}, f"{type(error).__name__}: {error}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run tdairad post-deploy smoke checks.")
    parser.add_argument("--api-base-url", default="http://localhost:8081", help="Reporting API base URL")
    parser.add_argument("--timeout-seconds", type=int, default=20, help="Request timeout")
    parser.add_argument(
        "--output",
        default="tests/artifacts/post_deploy_smoke.json",
        help="JSON report output path",
    )
    args = parser.parse_args()

    base_url = args.api_base_url.rstrip("/")
    timeout_seconds = args.timeout_seconds
    checks: list[CheckResult] = []

    def perform_check(
        name: str,
        method: str,
        path: str,
        payload: dict[str, Any] | None,
        validator,
        extra_details: dict[str, Any] | None = None,
    ) -> CheckResult:
        started = time.perf_counter()
        status_code, response, error = request_json(method, f"{base_url}{path}", payload, timeout_seconds)
        duration_ms = int((time.perf_counter() - started) * 1000)
        details = {"response": response, "error": error}
        if extra_details:
            details.update(extra_details)
        return CheckResult(
            name=name,
            success=validator(status_code, response, error),
            status_code=status_code,
            duration_ms=duration_ms,
            details=details,
        )

    health = perform_check(
        name="health",
        method="GET",
        path="/health",
        payload=None,
        validator=lambda status, body, _error: status == 200 and body.get("status") == "ok",
    )
    checks.append(health)

    worklist_sync = perform_check(
        name="worklist_sync_from_dicoogle",
        method="GET",
        path="/health/worklist-sync",
        payload=None,
        validator=lambda status, body, _error: status == 200 and body.get("status") == "ok",
    )
    checks.append(worklist_sync)

    sample_study_id = worklist_sync.details.get("response", {}).get("sampleStudyId")
    query_suffix = f"?studyId={sample_study_id}" if isinstance(sample_study_id, str) and sample_study_id else ""
    webhook_connectivity = perform_check(
        name="webhook_connectivity_to_dicoogle",
        method="GET",
        path=f"/health/webhook-connectivity{query_suffix}",
        payload=None,
        validator=lambda status, body, _error: status == 200 and body.get("status") == "ok",
        extra_details={"requestedStudyId": sample_study_id},
    )
    checks.append(webhook_connectivity)

    overall_success = all(item.success for item in checks)
    payload = {
        "generated_at": now_iso(),
        "api_base_url": base_url,
        "overall_success": overall_success,
        "checks": [asdict(item) for item in checks],
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps(payload, indent=2))
    return 0 if overall_success else 1


if __name__ == "__main__":
    raise SystemExit(main())
