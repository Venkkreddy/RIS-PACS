# TDAI RIS/PACS Smart Radiology Workstation
## Product & Technical Documentation Suite

This document serves as the official product and technical specification for the TDAI RIS/PACS radiology workstation application suite. It covers requirements, architecture, launch configurations, and integration guidelines.

---

## 1. Executive Summary (One-Pager)

### The Problem
Radiology facilities face severe inefficiencies due to disjointed IT systems. Modalities (X-Ray, CT, MRI scans) are operated on acquisition PCs separated from the Radiology Information System (RIS) receptionist scheduling databases and the Picture Archiving and Communication System (PACS) viewing software. Radiographers must manually type patient names and MRNs on scanner screens (leading to typos and mismatches), and radiologists must jump between distinct viewers and reporting pages.

### The Solution
TDAI RIS/PACS solves this by providing a unified, multi-tenant workstation suite. It packages a React-based receptionist/radiographer/radiologist dashboard, a custom-configured Orthanc PACS server with Modality Worklist (MWL) and Modality Performed Procedure Step (MPPS) support, Dicoogle search indexing, voice-dictation AI services, and the OHIF web viewer into a single-click Electron desktop application.

### Business & Operational Impact
* **Zero Typing Errors:** Demographics sync from the receptionist check-in straight to the X-Ray scanner screen via MWL query protocol.
* **Real-time Status Automation:** Modality scans automatically push status updates (Scheduled -> In Progress -> Images Uploaded) back to the workstation screen using MPPS protocol.
* **Unified Workstation:** Allows radiologists to run dictation and view DICOM images directly inside a single browser or wrapper window.

### Status
* **Core Workstation Software:** Completed and validated locally.
* **Electron Desktop Wrapper & Setup Builder:** Complete and packaged.
* **Client Distribution Release:** Assembled and ready for deployment.

---

## 2. Product Requirements Document (PRD)

### Problem Statement
Modern diagnostic centers suffer from manual data entry overhead. When a patient checks in at the reception, their details are manually typed into the scheduling book. Then, the radiographer must re-type the patient's name, age, and ID on the hardware console. Any typographical mismatch makes it difficult for radiologists to link study records to the patient's record, causing billing leaks, diagnostic delays, and report inaccuracies.

### Goals & Non-Goals
#### **Goals:**
* Provide a single, downloadable `.exe` file that silently sets up the database, PACS, and web endpoints.
* Automatically feed checked-in patient records from the RIS scheduling system into the hardware scanner's Modality Worklist on port `4242`.
* Listen for scanner exposure updates on port `11115` (MPPS) to track real-time study progress.
* Enable voice-to-text reporting and high-fidelity DICOM viewing inside the same dashboard page.

#### **Non-Goals:**
* Building hardware acquisition drivers (we integrate via standard DICOM protocol).
* Supporting native legacy operating systems below Windows 10.

### Success Metrics
1. **Data Entry Accuracy:** 100% mismatch reduction. All patient details are pulled directly via MWL, eliminating manual typing.
2. **Setup Time Delta:** Under 3 minutes. Zero configuration required by the client to boot the entire Docker stack.
3. **Turnaround Time (TAT) reduction:** 40% speedup in reports due to inline OHIF viewer and integrated voice dictation.

### User Personas & Use Cases

#### **1. RIS Receptionist**
* *JTBD:* Register new patients, collect billing invoices, and schedule radiography exams.
* *User Story:* *"As a receptionist, I want to check in a patient and assign them to an X-Ray room so that they automatically appear in the radiographer's queue."*

#### **2. Radiographer (Technologist)**
* *JTBD:* Perform radiological scans, verify image quality, and route studies to the radiologist.
* *User Story:* *"As a radiographer, I want to query the check-in list directly from my console scanner, perform the exposure, check image quality, and send them to the PACS in one click."*

#### **3. Radiologist**
* *JTBD:* Read scans, perform voice dictations, compile diagnostic reports, and sign off studies.
* *User Story:* *"As a radiologist, I want to click 'Open Viewer' next to a patient's name, see their images instantly, and use voice-to-text to dictate my report."*

### Functional Requirements & System Workflows

```
[Receptionist] ────(Check-in)────> [RIS Database]
                                        │
                                 (Syncs via Python)
                                        │
                                        ▼
[DR Scanner Console] <──(C-FIND)─── [Orthanc MWL]
        │
    (Exposure)
        ├───────(MPPS: In-Progress)────> [RIS Worklist Status]
        └───────(C-STORE: DICOMs)──────> [PACS Server] ────> [OHIF Viewer]
```

1. **Scheduling & Check-In:**
   * Receptionist registers the patient. When marked as **Checked In**, a DICOM worklist entry (`.wl` file) is automatically generated in the Orthanc worklist directory.
2. **Scanner Acquisition (MWL Query):**
   * The radiographer clicks "Query Worklist" on the X-Ray console. The machine issues a `C-FIND` query to the PACS on port `4242`, returning the checked-in patient.
3. **Status Sync (MPPS):**
   * When the technician starts the exposure, the scanner sends an `N-CREATE` message to port `11115`. The RIS status changes to **In Progress**.
   * When the exposure is completed, the scanner sends an `N-SET` message, updating the status to **Images Uploaded**.
4. **DICOM Store (C-STORE):**
   * The console pushes the raw DICOM files to Orthanc on port `4242`.
5. **Quality Control (QC):**
   * The radiographer reviews the images in their workstation list, runs checkmarks (image contrast, patient positioning), and clicks "Complete" to release the study.
6. **Reporting:**
   * The case unlocks on the Radiologist dashboard. The radiologist opens the embedded OHIF Viewer on port `3000`, reviews the images, and uses voice dictation to compile and submit the report.

---

## 3. Technical Requirements & Specifications (TRD)

### System Overview & Port Configurations
The workstation stack consists of 8 Docker containers coordinated inside a bridged network (`imaging-net`).

| Service | Port Mapping | Purpose |
| :--- | :--- | :--- |
| **`reporting-app-frontend`** | `5173:443` | React SPA dashboard (Secure Nginx HTTPS with self-signed SSL). |
| **`reporting-app-backend`** | `8081:8080` | Express REST API server coordinating state changes. |
| **`orthanc`** | `8042:8042` / `4242:4242` / `11115:11115` | DICOM PACS Server, C-FIND MWL engine, and MPPS SCP port. |
| **`ohif`** | `3000:443` (internal 80/443) | Interactive Nginx-hosted Cornerstone DICOM Viewer. |
| **`dicoogle`** | `8080:8080` / `11112:104` | Secondary backup PACS and search indexer. |
| **`medasr-server`** | `5001:5001` | Voice dictation audio processing engine. |
| **`monai-server`** | `5000:5000` | Machine Learning model server for medical image segmentations. |
| **`postgres`** | `5432:5432` | Storage for system users and multi-tenant schema databases. |

### API Contracts (Key Endpoints)

#### **1. Patient Directory**
* `GET /patients` - Retrieve all registered patient records.
* `POST /patients` - Register a new patient.
  * *Request Body:* `{ patientId, firstName, lastName, dateOfBirth, gender, phone?, email?, address? }`

#### **2. Radiology Orders**
* `GET /orders` - Fetch list of active radiology orders.
* `POST /orders` - Create a new exam order.
  * *Request Body:* `{ patientId, modality, bodyPart, priority, status }`
* `PATCH /orders/:id` - Update status or notes (e.g. status changes to `in-progress` or notes set to `Checked In`).

#### **3. PACS Studies Worklist**
* `GET /worklist` - Queries the DICOM index from Dicoogle and Orthanc to return study details, status tracking parameters, and OHIF launch links.

### Data Model & Storage Decoupling
* **System State:** System configurations, user permissions, and audit logs are managed inside a secure cloud **Firebase Firestore** collection.
* **User Accounts:** Standardized login and authentication are managed via the Firebase Auth API.
* **PACS Metadata:** Raw image tags, studies, and series are indexed and parsed from DICOM files directly into Orthanc and Dicoogle SQLite/Lucene filesystems.

---

## 4. Design Document (Electron Desktop Wrapper)

### Rationale & Architecture
To deliver a desktop-app experience, we wrap the local Docker stack inside an Electron application shell. The client downloads a single setup installer. When launched:
1. Electron starts. A transparent splash screen opens showing a loading spinner.
2. The application checks if Docker Desktop is running. If not, it executes a shell command to start it silently.
3. It performs a force-cleanup (`docker rm -f`) to kill conflicting containers from old runs and release ports.
4. It calls `docker compose up -d` in the background to spin up the 8 services.
5. It polls the secure localhost frontend (`https://localhost:5173`) using `wait-on` with SSL checks bypassed.
6. Once online, the splash screen closes, and the main browser frame maximizes to display the workstation dashboards.
7. Closing the window minimizes the app to the Windows System Tray to prevent accidental shutdowns.

```
┌──────────────────────────────────────────────┐
│                  Electron                    │
│   ┌──────────────────┐  ┌────────────────┐   │
│   │  Splash Window   │  │  Main Window   │   │
│   └────────┬─────────┘  └────────▲───────┘   │
│            │ (Loads)             │ (Loads URL)│
│            ▼                     │           │
│   ┌──────────────────┐           │           │
│   │ docker compose   ├───────────┘           │
│   └────────┬─────────┘                       │
└────────────┼─────────────────────────────────┘
             ▼
┌──────────────────────────────────────────────┐
│               Docker Engine                  │
│  [Frontend:5173] [Backend:8081] [PACS:4242]  │
└──────────────────────────────────────────────┘
```

### Key Technical Decisions & Workaround Implementations

#### **1. Copying configuration files from setup directory:**
* *Problem:* Docker Compose bind-mounts relative host files (`orthanc.json`, `worklist.py`, `default.conf`, `migrations`). In production, the working directory is read-only inside `Program Files`, causing container mount crashes.
* *Resolution:* The Electron setup builder bundles these configurations as `extraResources` and copies them to the writeable AppData resource folders. The installer copies the large 2GB database container archive (`tdai-images.tar`) dynamically to save installer memory.

#### **2. Ignoring self-signed SSL certificate validations:**
* *Problem:* The secure frontend and OHIF viewer run over local HTTPS (`https://localhost:5173`). Electron blocks self-signed certificates by default, resulting in a blank screen.
* *Resolution:* We appended the `ignore-certificate-errors` global switch at startup and registered a custom `certificate-error` bypass handler to allow secure iframe loads without security warnings.

---

## 5. Launch & Installation Guide (GTM)

### Preparation & System Requirements
* **Operating System:** Windows 10 / 11 (64-bit).
* **Hardware:** Minimum 8GB RAM (16GB recommended), 10GB free disk space.
* **Pre-requisite:** Docker Desktop must be installed and configured with WSL 2 backend enabled.

### Installation Instructions
1. Download and extract `TDAI-RIS-PACS.zip` to a writeable directory.
2. Double-click `TDAI RIS-PACS Setup.exe` to run the setup installer.
3. Launch the desktop workstation by double-clicking the **TDAI RIS/PACS** desktop icon.

---

## 6. Metrics & HIPAA Compliance Specifications

### HIPAA Compliance Monitoring
The system implements a logging audit trail (`HipaaAuditService`) to record all interactions with Protected Health Information (PHI):
* **Audited Actions:** User login attempts, patient creation, editing records, opening the OHIF viewer, deleting cases, and exporting reports.
* **Log Properties:** Each entry records `timestamp`, `userId`, `userRole`, `actionType`, `patientMRN`, and `sourceIPAddress`.
* **Session Expiry:** Inactive user sessions are automatically logged out after 15 minutes of inactivity to protect clinical screens from unauthorized access.
