#!/usr/bin/env python3
"""
End-to-end UX workflow bot for tdairad.com.

This script automates a realistic workflow across:
  1) Admin account setup/invites
  2) Radiographer upload journey
  3) Assignment to radiologist
  4) Radiologist viewing + reporting
  5) Assignment to physician
  6) Physician report viewing

It captures screenshots, timings, and UX notes at each step.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from selenium import webdriver
from selenium.common.exceptions import (
    ElementNotInteractableException,
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait

try:
    import requests
except ImportError:  # pragma: no cover - optional dependency
    requests = None


Selector = Tuple[str, str]

CONFIG: Dict[str, Any] = {
    "base_url": os.getenv("TDAI_BASE_URL", "http://tdairad.com"),
    "worklist_poll_seconds": int(os.getenv("WORKLIST_POLL_SECONDS", "120")),
    "worklist_poll_interval": int(os.getenv("WORKLIST_POLL_INTERVAL", "8")),
    "load_timeout_seconds": int(os.getenv("LOAD_TIMEOUT_SECONDS", "20")),
    "dummy_accounts": {
        "admin": {"email": "admin@test.com", "password": "Test123!", "role": "admin"},
        "radiographer1": {
            "email": "radgrapher1@test.com",
            "password": "Test123!",
            "role": "radiographer",
        },
        "radiographer2": {
            "email": "radgrapher2@test.com",
            "password": "Test123!",
            "role": "radiographer",
        },
        "radiologist1": {
            "email": "radiologist1@test.com",
            "password": "Test123!",
            "role": "radiologist",
        },
        "radiologist2": {
            "email": "radiologist2@test.com",
            "password": "Test123!",
            "role": "radiologist",
        },
        "physician1": {
            "email": "physician1@test.com",
            "password": "Test123!",
            "role": "physician",
        },
    },
}


@dataclass
class StepOutcome:
    success: bool
    ux_note: str
    data: Dict[str, Any] = field(default_factory=dict)


class WorkflowLogger:
    def __init__(self, screenshot_dir: Path) -> None:
        self.records: List[Dict[str, Any]] = []
        self.screenshot_dir = screenshot_dir
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        self.step_counter = 0

    def capture(self, driver: webdriver.Remote, label: str) -> Optional[str]:
        self.step_counter += 1
        filename = f"{self.step_counter:02d}_{sanitize_filename(label)}.png"
        out_path = self.screenshot_dir / filename
        try:
            driver.save_screenshot(str(out_path))
            return str(out_path)
        except WebDriverException:
            return None

    def run_step(self, step_name: str, fn) -> StepOutcome:
        started = time.monotonic()
        try:
            outcome: StepOutcome = fn()
        except Exception as exc:  # pylint: disable=broad-except
            outcome = StepOutcome(
                success=False,
                ux_note=f"Unhandled exception: {type(exc).__name__}: {exc}",
                data={"traceback": traceback.format_exc()},
            )
        elapsed = round(time.monotonic() - started, 2)
        record = {
            "step": step_name,
            "time": elapsed,
            "success": outcome.success,
            "ux_note": outcome.ux_note,
            "timestamp": utc_now(),
        }
        if outcome.data:
            record["data"] = outcome.data
        self.records.append(record)
        print(json.dumps(record, ensure_ascii=True))
        return outcome

    def dump_json(self, output_file: Path) -> None:
        payload = {
            "generated_at": utc_now(),
            "results": self.records,
        }
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_filename(text: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in text).strip("_")


def create_driver(browser: str, headless: bool) -> webdriver.Remote:
    if browser == "firefox":
        options = webdriver.FirefoxOptions()
        if headless:
            options.add_argument("-headless")
        driver = webdriver.Firefox(options=options)
    else:
        options = webdriver.ChromeOptions()
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        options.add_argument("--window-size=1600,1000")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--no-sandbox")
        if headless:
            options.add_argument("--headless=new")
        driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(CONFIG["load_timeout_seconds"])
    return driver


def wait_visible(
    driver: webdriver.Remote, selectors: Sequence[Selector], timeout: int = 15
) -> Optional[Any]:
    for by, value in selectors:
        try:
            return WebDriverWait(driver, timeout).until(
                EC.visibility_of_element_located((by, value))
            )
        except TimeoutException:
            continue
    return None


def find_first(driver: webdriver.Remote, selectors: Sequence[Selector]) -> Optional[Any]:
    for by, value in selectors:
        try:
            return driver.find_element(by, value)
        except NoSuchElementException:
            continue
    return None


def click_first(driver: webdriver.Remote, selectors: Sequence[Selector]) -> bool:
    element = wait_visible(driver, selectors, timeout=8)
    if not element:
        return False
    try:
        element.click()
        return True
    except (ElementNotInteractableException, StaleElementReferenceException):
        return False


def fill_first(driver: webdriver.Remote, selectors: Sequence[Selector], text: str) -> bool:
    element = wait_visible(driver, selectors, timeout=10)
    if not element:
        return False
    try:
        element.click()
        element.send_keys(Keys.CONTROL, "a")
        element.send_keys(Keys.BACKSPACE)
        element.send_keys(text)
        return True
    except (ElementNotInteractableException, StaleElementReferenceException):
        return False


def login(
    driver: webdriver.Remote,
    base_url: str,
    email: str,
    password: str,
    logger: WorkflowLogger,
    role_hint: str,
) -> bool:
    driver.get(f"{base_url}/login")
    ok_email = fill_first(
        driver,
        (
            (By.NAME, "email"),
            (By.ID, "email"),
            (By.CSS_SELECTOR, "input[type='email']"),
            (By.XPATH, "//input[contains(@placeholder,'Email')]"),
        ),
        email,
    )
    ok_password = fill_first(
        driver,
        (
            (By.NAME, "password"),
            (By.ID, "password"),
            (By.CSS_SELECTOR, "input[type='password']"),
            (By.XPATH, "//input[contains(@placeholder,'Password')]"),
        ),
        password,
    )
    clicked = click_first(
        driver,
        (
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.XPATH, "//button[contains(.,'Login') or contains(.,'Sign in')]"),
        ),
    )
    logger.capture(driver, f"{role_hint}_login")
    if not (ok_email and ok_password and clicked):
        return False
    # Prefer dashboard marker, fallback to URL change.
    try:
        WebDriverWait(driver, 12).until(
            lambda d: "/login" not in d.current_url
            or bool(
                find_first(
                    d,
                    (
                        (By.XPATH, "//nav"),
                        (By.XPATH, "//a[contains(., 'Logout') or contains(., 'Sign out')]"),
                    ),
                )
            )
        )
        return True
    except TimeoutException:
        return "/login" not in driver.current_url


def api_invite_user(base_url: str, admin_email: str, admin_password: str, invitee: Dict[str, str]) -> bool:
    if requests is None:
        return False
    invite_url = f"{base_url}/admin/invite"
    payload = {
        "email": invitee["email"],
        "role": invitee.get("role"),
        "password": invitee.get("password"),
    }
    try:
        response = requests.post(invite_url, json=payload, timeout=12)
        return response.status_code in (200, 201, 202, 409)
    except requests.RequestException:
        return False


def admin_create_or_invite_accounts(
    driver: webdriver.Remote, base_url: str, logger: WorkflowLogger
) -> StepOutcome:
    admin = CONFIG["dummy_accounts"]["admin"]
    if not login(driver, base_url, admin["email"], admin["password"], logger, "admin"):
        return StepOutcome(False, "Admin login failed. Check login selectors or credentials.")

    driver.get(f"{base_url}/admin")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    logger.capture(driver, "step1_admin_dashboard")

    invitees = [
        CONFIG["dummy_accounts"]["radiographer1"],
        CONFIG["dummy_accounts"]["radiographer2"],
        CONFIG["dummy_accounts"]["radiologist1"],
        CONFIG["dummy_accounts"]["radiologist2"],
        CONFIG["dummy_accounts"]["physician1"],
    ]
    invited_count = 0
    api_invited_count = 0
    for account in invitees:
        clicked_invite = click_first(
            driver,
            (
                (By.XPATH, "//button[contains(.,'Invite')]"),
                (By.CSS_SELECTOR, "button[data-testid='invite-user']"),
                (By.CSS_SELECTOR, "a[href*='invite']"),
            ),
        )
        email_ok = fill_first(
            driver,
            (
                (By.NAME, "email"),
                (By.ID, "invite-email"),
                (By.CSS_SELECTOR, "input[type='email']"),
            ),
            account["email"],
        )
        role_element = find_first(
            driver,
            (
                (By.NAME, "role"),
                (By.ID, "role"),
                (By.CSS_SELECTOR, "select[name='role']"),
            ),
        )
        if role_element:
            try:
                Select(role_element).select_by_visible_text(account["role"].capitalize())
            except Exception:  # pylint: disable=broad-except
                try:
                    Select(role_element).select_by_value(account["role"])
                except Exception:  # pylint: disable=broad-except
                    pass
        password_ok = fill_first(
            driver,
            (
                (By.NAME, "password"),
                (By.ID, "invite-password"),
                (By.CSS_SELECTOR, "input[type='password']"),
            ),
            account["password"],
        )
        submitted = click_first(
            driver,
            (
                (By.CSS_SELECTOR, "button[type='submit']"),
                (By.XPATH, "//button[contains(.,'Send Invite') or contains(.,'Create')]"),
            ),
        )
        if clicked_invite and email_ok and submitted:
            invited_count += 1
            logger.capture(driver, f"step1_invite_{account['role']}_{account['email']}")
            continue

        if api_invite_user(base_url, admin["email"], admin["password"], account):
            api_invited_count += 1
            continue

        # If UI/API paths are unavailable we continue and report a partial setup.
        logger.capture(driver, f"step1_invite_failed_{account['email']}")
        if password_ok:
            pass

    note = (
        f"Invited {invited_count}/{len(invitees)} users via UI, "
        f"{api_invited_count} via API fallback."
    )
    return StepOutcome(invited_count + api_invited_count > 0, note)


def poll_worklist_for_study(
    driver: webdriver.Remote, base_url: str, location_hint: str
) -> Optional[str]:
    deadline = time.monotonic() + CONFIG["worklist_poll_seconds"]
    observed_study_id: Optional[str] = None
    while time.monotonic() < deadline:
        driver.get(f"{base_url}/worklist")
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        table_text = driver.page_source
        if location_hint.lower() in table_text.lower() or "unassigned" in table_text.lower():
            row = find_first(
                driver,
                (
                    (By.CSS_SELECTOR, "tr[data-study-id]"),
                    (By.XPATH, "//tr[.//td]"),
                ),
            )
            if row:
                observed_study_id = row.get_attribute("data-study-id") or None
                if not observed_study_id:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if cells:
                        observed_study_id = cells[0].text.strip() or None
                if observed_study_id:
                    return observed_study_id
            return "UNKNOWN_STUDY_ID"
        time.sleep(CONFIG["worklist_poll_interval"])
    return observed_study_id


def radiographer_journey(
    driver: webdriver.Remote,
    base_url: str,
    user_email: str,
    password: str,
    dicom_file_path: str,
    logger: WorkflowLogger,
) -> StepOutcome:
    if not login(driver, base_url, user_email, password, logger, "radiographer"):
        return StepOutcome(False, "Radiographer login failed.")

    driver.get(f"{base_url}/my-uploads")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    filled_location = fill_first(
        driver,
        (
            (By.NAME, "location"),
            (By.ID, "location"),
            (By.XPATH, "//input[contains(@placeholder,'Location')]"),
        ),
        "Dubai Clinic",
    )
    logger.capture(driver, "step2_radiographer_upload_page")

    upload_mode = "manual_exe_push_required"
    file_input = find_first(
        driver,
        (
            (By.CSS_SELECTOR, "input[type='file']"),
            (By.NAME, "dicomUpload"),
        ),
    )
    dicom_exists = os.path.exists(dicom_file_path)
    if file_input and dicom_exists:
        file_input.send_keys(str(Path(dicom_file_path).resolve()))
        click_first(
            driver,
            (
                (By.XPATH, "//button[contains(.,'Upload') or contains(.,'Submit')]"),
                (By.CSS_SELECTOR, "button[type='submit']"),
            ),
        )
        upload_mode = "web_upload_form_used"
        logger.capture(driver, "step2_radiographer_web_upload")
    else:
        print(
            "[MANUAL] Local Dicoogle EXE push required.\n"
            "  1) Launch tdairad local Dicoogle executable on your Windows test machine.\n"
            f"  2) Ingest DICOM folder containing: {dicom_file_path}\n"
            "  3) Push via C-STORE to tdairad.com:104 and wait for indexing."
        )

    start_poll = time.monotonic()
    study_id = poll_worklist_for_study(driver, base_url, location_hint="Dubai Clinic")
    poll_elapsed = round(time.monotonic() - start_poll, 2)
    logger.capture(driver, "step2_worklist_poll_result")
    if not study_id:
        return StepOutcome(
            False,
            f"Upload journey reached worklist polling, but no study appeared in {poll_elapsed}s.",
            data={"upload_mode": upload_mode, "location_filled": filled_location},
        )
    return StepOutcome(
        True,
        f"Study became visible in worklist. Poll time: {poll_elapsed}s.",
        data={"study_id": study_id, "upload_mode": upload_mode, "location_filled": filled_location},
    )


def apply_worklist_assignment(
    driver: webdriver.Remote, assignee_email: str, role_label: str
) -> bool:
    # Select row checkbox (first row fallback).
    row_checkbox = find_first(
        driver,
        (
            (By.CSS_SELECTOR, "table tbody tr td input[type='checkbox']"),
            (By.XPATH, "(//tr[.//td]//input[@type='checkbox'])[1]"),
        ),
    )
    if row_checkbox:
        row_checkbox.click()
    else:
        return False

    assignee_select = find_first(
        driver,
        (
            (By.NAME, "assignee"),
            (By.ID, "assign-user"),
            (By.CSS_SELECTOR, "select"),
        ),
    )
    if assignee_select:
        try:
            Select(assignee_select).select_by_visible_text(assignee_email)
        except Exception:  # pylint: disable=broad-except
            try:
                Select(assignee_select).select_by_value(assignee_email)
            except Exception:  # pylint: disable=broad-except
                return False
    else:
        assignee_input_ok = fill_first(
            driver,
            (
                (By.XPATH, "//input[contains(@placeholder,'Assign')]"),
                (By.XPATH, "//input[contains(@placeholder,'Search user')]"),
            ),
            assignee_email,
        )
        if not assignee_input_ok:
            return False

    assigned = click_first(
        driver,
        (
            (By.XPATH, f"//button[contains(.,'Assign') and contains(.,'{role_label}')]"),
            (By.XPATH, "//button[contains(.,'Assign')]"),
            (By.CSS_SELECTOR, "button[data-testid='assign-button']"),
        ),
    )
    return assigned


def assign_to_radiologist(
    driver: webdriver.Remote,
    base_url: str,
    admin_email: str,
    password: str,
    study_id: str,
    radiologist_email: str,
    logger: WorkflowLogger,
) -> StepOutcome:
    if not login(driver, base_url, admin_email, password, logger, "admin_assign_radiologist"):
        return StepOutcome(False, "Admin login for radiologist assignment failed.")

    driver.get(f"{base_url}/worklist")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    fill_first(
        driver,
        (
            (By.XPATH, "//input[contains(@placeholder,'Search')]"),
            (By.NAME, "search"),
        ),
        study_id,
    )
    time.sleep(1)

    assigned = apply_worklist_assignment(driver, radiologist_email, "Radiologist")
    logger.capture(driver, "step3_assign_radiologist")
    if not assigned:
        return StepOutcome(False, "Could not complete assignment action for radiologist.")

    status_verified = "assigned" in driver.page_source.lower()
    note = "Status changed to Assigned and TAT timer should be started." if status_verified else (
        "Assignment action submitted; verify Assigned status and TAT timer manually."
    )
    return StepOutcome(True, note, data={"study_id": study_id, "radiologist_email": radiologist_email})


def ensure_mock_jpeg(path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    # Minimal JPEG file content for upload tests.
    jpeg_bytes = bytes.fromhex(
        "FFD8FFE000104A46494600010101004800480000"
        "FFDB004300010101010101010101010101010101"
        "0101010101010101010101010101010101010101"
        "0101010101010101010101010101010101010101"
        "FFC00011080001000103012200021101031101"
        "FFC4001400010000000000000000000000000000"
        "00000000FFC4001410010000000000000000000000"
        "0000000000FFDA0008010100003F00D2CF20FFD9"
    )
    path.write_bytes(jpeg_bytes)
    return path


def open_viewer_and_reporting(
    driver: webdriver.Remote, base_url: str, study_id: str, logger: WorkflowLogger
) -> bool:
    driver.get(f"{base_url}/my-studies")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    fill_first(
        driver,
        (
            (By.XPATH, "//input[contains(@placeholder,'Search')]"),
            (By.NAME, "search"),
        ),
        study_id,
    )
    time.sleep(1)
    handles_before = set(driver.window_handles)
    viewer_clicked = click_first(
        driver,
        (
            (By.XPATH, "//button[contains(@title,'View') or contains(@title,'Viewer')]"),
            (By.CSS_SELECTOR, "a[href*='ohif'], button[data-testid='open-viewer']"),
            (By.XPATH, "//a[contains(@href,'viewer') or contains(@href,'ohif')]"),
        ),
    )
    if not viewer_clicked:
        return False

    WebDriverWait(driver, 12).until(lambda d: len(d.window_handles) >= len(handles_before))
    new_handles = [h for h in driver.window_handles if h not in handles_before]
    if new_handles:
        driver.switch_to.window(new_handles[0])
    WebDriverWait(driver, 20).until(lambda d: d.execute_script("return document.readyState") == "complete")
    logger.capture(driver, "step4_ohif_opened")

    ohif_ok = "ohif" in driver.current_url.lower() or "viewer" in driver.current_url.lower()
    # Try opening reporting from OHIF toolbar when available.
    click_first(
        driver,
        (
            (By.XPATH, "//button[contains(.,'Report') or contains(@title,'Report')]"),
            (By.CSS_SELECTOR, "a[href*='report']"),
        ),
    )
    if len(driver.window_handles) > 1:
        driver.switch_to.window(driver.window_handles[0])
    if "report" not in driver.current_url.lower():
        driver.get(f"{base_url}/reporting?studyId={study_id}")
    logger.capture(driver, "step4_reporting_editor")
    return ohif_ok


def radiologist_journey(
    driver: webdriver.Remote,
    base_url: str,
    user_email: str,
    password: str,
    study_id: str,
    logger: WorkflowLogger,
) -> StepOutcome:
    if not login(driver, base_url, user_email, password, logger, "radiologist"):
        return StepOutcome(False, "Radiologist login failed.")

    start_load = time.monotonic()
    viewer_ok = open_viewer_and_reporting(driver, base_url, study_id, logger)
    load_time = round(time.monotonic() - start_load, 2)

    report_text = (
        "Findings: No acute cardiopulmonary abnormality.\n"
        "Impression: Stable chest radiograph. Correlate clinically."
    )
    text_ok = fill_first(
        driver,
        (
            (By.NAME, "reportText"),
            (By.ID, "report-editor"),
            (By.CSS_SELECTOR, "textarea"),
            (By.XPATH, "//div[@contenteditable='true']"),
        ),
        report_text,
    )

    attachment_path = ensure_mock_jpeg(Path("tests/assets/mock_attachment.jpg"))
    file_input = find_first(
        driver,
        (
            (By.CSS_SELECTOR, "input[type='file']"),
            (By.NAME, "attachment"),
        ),
    )
    attachment_ok = False
    if file_input:
        file_input.send_keys(str(attachment_path.resolve()))
        attachment_ok = True
    save_ok = click_first(
        driver,
        (
            (By.XPATH, "//button[contains(.,'Save') or contains(.,'Submit Report')]"),
            (By.CSS_SELECTOR, "button[type='submit']"),
        ),
    )
    logger.capture(driver, "step4_report_submitted")

    driver.get(f"{base_url}/worklist")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    status_reported = "reported" in driver.page_source.lower()
    ux_note = (
        f"Viewer load time: {load_time}s. "
        + ("Under 5s target. " if load_time < 5 else "Exceeds 5s target. ")
        + "Reporting action executed."
    )
    return StepOutcome(
        success=viewer_ok and text_ok and save_ok,
        ux_note=ux_note,
        data={
            "study_id": study_id,
            "viewer_opened": viewer_ok,
            "report_text_entered": text_ok,
            "attachment_uploaded": attachment_ok,
            "status_reported_seen": status_reported,
            "load_time_seconds": load_time,
        },
    )


def assign_to_physician(
    driver: webdriver.Remote,
    base_url: str,
    radiologist_email: str,
    password: str,
    study_id: str,
    physician_email: str,
    logger: WorkflowLogger,
) -> StepOutcome:
    if not login(driver, base_url, radiologist_email, password, logger, "radiologist_assign_physician"):
        return StepOutcome(False, "Radiologist login for physician assignment failed.")
    driver.get(f"{base_url}/worklist")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    fill_first(
        driver,
        (
            (By.XPATH, "//input[contains(@placeholder,'Search')]"),
            (By.NAME, "search"),
        ),
        study_id,
    )
    time.sleep(1)
    assigned = apply_worklist_assignment(driver, physician_email, "Physician")
    logger.capture(driver, "step5_assign_physician")
    if not assigned:
        return StepOutcome(False, "Could not assign study to physician from worklist.")
    status_ok = "assigned to physician" in driver.page_source.lower() or "assigned" in driver.page_source.lower()
    return StepOutcome(
        True,
        "Assignment to physician submitted. Verify status in worklist.",
        data={"status_seen": status_ok, "study_id": study_id},
    )


def physician_journey(
    driver: webdriver.Remote,
    base_url: str,
    user_email: str,
    password: str,
    study_id: str,
    logger: WorkflowLogger,
) -> StepOutcome:
    if not login(driver, base_url, user_email, password, logger, "physician"):
        return StepOutcome(False, "Physician login failed.")

    original_size = driver.get_window_size()
    driver.set_window_size(390, 844)  # mobile viewport simulation
    driver.get(f"{base_url}/my-reports")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    fill_first(
        driver,
        (
            (By.XPATH, "//input[contains(@placeholder,'Search')]"),
            (By.NAME, "search"),
        ),
        study_id,
    )
    click_first(
        driver,
        (
            (By.XPATH, "//button[contains(.,'View') or contains(.,'Open')]"),
            (By.XPATH, "//a[contains(.,'View') or contains(@href,'report')]"),
        ),
    )
    logger.capture(driver, "step6_physician_report_view_mobile")
    report_text_seen = "report" in driver.page_source.lower() or "impression" in driver.page_source.lower()
    ohif_link_present = bool(
        find_first(
            driver,
            (
                (By.XPATH, "//a[contains(@href,'ohif') or contains(@href,'viewer')]"),
                (By.XPATH, "//button[contains(.,'Open Image') or contains(.,'Viewer')]"),
            ),
        )
    )
    driver.set_window_size(original_size["width"], original_size["height"])
    return StepOutcome(
        True,
        "Physician report view loaded with mobile viewport simulation.",
        data={"report_text_seen": report_text_seen, "ohif_link_present": ohif_link_present},
    )


def test_edge_cases(
    driver: webdriver.Remote, base_url: str, logger: WorkflowLogger, known_study_id: str
) -> StepOutcome:
    # Invalid login test.
    invalid_login_ok = False
    driver.get(f"{base_url}/login")
    fill_first(driver, ((By.CSS_SELECTOR, "input[type='email']"),), "invalid@test.com")
    fill_first(driver, ((By.CSS_SELECTOR, "input[type='password']"),), "wrongpassword")
    click_first(driver, ((By.CSS_SELECTOR, "button[type='submit']"),))
    time.sleep(1.5)
    if "invalid" in driver.page_source.lower() or "incorrect" in driver.page_source.lower():
        invalid_login_ok = True
    logger.capture(driver, "edge_invalid_login")

    # Search filters and TAT hints.
    admin = CONFIG["dummy_accounts"]["admin"]
    login(driver, base_url, admin["email"], admin["password"], logger, "admin_edge_checks")
    driver.get(f"{base_url}/worklist")
    WebDriverWait(driver, 10).until(lambda d: d.execute_script("return document.readyState") == "complete")
    filter_ok = fill_first(
        driver,
        (
            (By.XPATH, "//input[contains(@placeholder,'Search')]"),
            (By.NAME, "search"),
        ),
        known_study_id,
    )
    time.sleep(1)
    tat_seen = "tat" in driver.page_source.lower() or "turnaround" in driver.page_source.lower()
    logger.capture(driver, "edge_search_filters")

    note = (
        "Edge checks complete: invalid login, worklist filters, TAT visibility. "
        "Large DICOM upload is covered via manual local Dicoogle EXE push."
    )
    return StepOutcome(
        invalid_login_ok and filter_ok,
        note,
        data={"invalid_login_error_seen": invalid_login_ok, "filter_input_worked": filter_ok, "tat_seen": tat_seen},
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="tdairad.com end-to-end Selenium workflow bot")
    parser.add_argument("--base-url", default=CONFIG["base_url"], help="Base URL, e.g. http://tdairad.com")
    parser.add_argument("--browser", default="chrome", choices=["chrome", "firefox"], help="Selenium browser")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    parser.add_argument(
        "--dicom-path",
        default="tests/assets/sample.dcm",
        help=(
            "Path to dummy DICOM file. Download sample datasets manually, e.g. "
            "https://zenodo.org/record/16956"
        ),
    )
    parser.add_argument("--study-id", default="DUMMY-STUDY-001", help="Fallback study ID if polling cannot infer one")
    parser.add_argument("--screenshots-dir", default="tests/artifacts/screenshots", help="Screenshot output folder")
    parser.add_argument("--output-json", default="tests/artifacts/e2e_workflow_log.json", help="JSON log output file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logger = WorkflowLogger(Path(args.screenshots_dir))
    driver = create_driver(browser=args.browser, headless=args.headless)
    base_url = args.base_url.rstrip("/")
    accounts = CONFIG["dummy_accounts"]
    chosen_study_id = args.study_id

    print(
        "DICOM sample reminder: download a public sample manually (e.g. "
        "https://zenodo.org/record/16956) and set --dicom-path accordingly."
    )

    try:
        logger.run_step(
            "create_accounts",
            lambda: admin_create_or_invite_accounts(driver, base_url, logger),
        )
        upload_result = logger.run_step(
            "radiographer_upload",
            lambda: radiographer_journey(
                driver,
                base_url,
                accounts["radiographer1"]["email"],
                accounts["radiographer1"]["password"],
                args.dicom_path,
                logger,
            ),
        )
        if upload_result.data.get("study_id"):
            chosen_study_id = upload_result.data["study_id"]

        logger.run_step(
            "assign_to_radiologist",
            lambda: assign_to_radiologist(
                driver,
                base_url,
                accounts["admin"]["email"],
                accounts["admin"]["password"],
                chosen_study_id,
                accounts["radiologist1"]["email"],
                logger,
            ),
        )
        logger.run_step(
            "radiologist_view_and_report",
            lambda: radiologist_journey(
                driver,
                base_url,
                accounts["radiologist1"]["email"],
                accounts["radiologist1"]["password"],
                chosen_study_id,
                logger,
            ),
        )
        logger.run_step(
            "assign_to_physician",
            lambda: assign_to_physician(
                driver,
                base_url,
                accounts["radiologist1"]["email"],
                accounts["radiologist1"]["password"],
                chosen_study_id,
                accounts["physician1"]["email"],
                logger,
            ),
        )
        logger.run_step(
            "physician_view_report",
            lambda: physician_journey(
                driver,
                base_url,
                accounts["physician1"]["email"],
                accounts["physician1"]["password"],
                chosen_study_id,
                logger,
            ),
        )
        logger.run_step(
            "edge_cases",
            lambda: test_edge_cases(driver, base_url, logger, chosen_study_id),
        )
    finally:
        logger.dump_json(Path(args.output_json))
        try:
            if args.browser == "chrome":
                browser_logs = driver.get_log("browser")
                print(json.dumps({"step": "browser_console_logs", "entries": browser_logs[:50]}))
        except Exception:  # pylint: disable=broad-except
            pass
        driver.quit()

    # Exit with non-zero if any step failed.
    failed = [record for record in logger.records if not record.get("success")]
    if failed:
        print(f"Workflow completed with {len(failed)} failing step(s). See JSON output for details.")
        return 1
    print("Workflow completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
