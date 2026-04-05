# TDAI PACS Stack — Fully Dockerized Medical Imaging System

Production-ready, containerized RIS/PACS viewer system with Orthanc, OHIF Viewer,
and optional Dicoogle indexing — all running inside Docker with zero host dependencies.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Network: pacs-net                                   │
│                                                             │
│  ┌───────────────┐       DICOMWeb       ┌───────────────┐  │
│  │   Orthanc     │◄────────────────────►│  OHIF Viewer  │  │
│  │  (PACS Core)  │   (QIDO/WADO/STOW)  │  (nginx + SPA)│  │
│  │               │                      │               │  │
│  │  DICOM: 4242  │                      │  HTTP: 80     │  │
│  │  HTTP:  8042  │                      └───────────────┘  │
│  └───────────────┘                             │           │
│         │                                      │           │
│  ┌──────┴────────┐                             │           │
│  │  Dicoogle     │  (optional, indexing only)  │           │
│  │  DICOM: 104   │                             │           │
│  │  HTTP:  8080  │                             │           │
│  └───────────────┘                             │           │
└────────────────────────────────────────────────┼───────────┘
                                                 │
         Exposed to host:                        │
         • localhost:8042  → Orthanc Explorer     │
         • localhost:4242  → DICOM (Weasis etc.)  │
         • localhost:3000  → OHIF Viewer ─────────┘
```

## Data Flow

1. **Upload** → DICOM files sent to Orthanc (C-STORE on port 4242, REST upload on 8042, or STOW-RS)
2. **Store** → Orthanc persists in Docker volume `orthanc-storage`
3. **Query** → OHIF calls QIDO-RS via nginx reverse-proxy (`/dicom-web/studies`)
4. **Retrieve** → OHIF fetches pixel data via WADO-RS (`/dicom-web/studies/.../series/.../instances/...`)
5. **Display** → Cornerstone.js renders DICOM images in-browser

## Quick Start

```bash
cd pacs-stack
docker-compose up -d
```

Wait ~20 seconds for Orthanc to become healthy, then:

| Service         | URL                          |
|-----------------|------------------------------|
| OHIF Viewer     | http://localhost:3000         |
| Orthanc Explorer| http://localhost:8042         |
| DICOM Port      | localhost:4242 (AET: ORTHANC)|

## Upload DICOM Files

### Option A: Orthanc Explorer UI

1. Open http://localhost:8042
2. Click **Upload** in the top-right
3. Drag-and-drop `.dcm` files or a DICOM folder
4. Click **Start Upload**

### Option B: REST API (curl)

```bash
# Upload a single DICOM file
curl -X POST http://localhost:8042/instances \
  --data-binary @/path/to/file.dcm \
  -H "Content-Type: application/dicom"
```

### Option C: STOW-RS (DICOMWeb standard upload)

```bash
curl -X POST "http://localhost:8042/dicom-web/studies" \
  -H "Content-Type: application/dicom" \
  --data-binary @/path/to/file.dcm
```

### Option D: DICOM C-STORE (from any DICOM toolkit)

```bash
# Using dcm4che storescu
storescu localhost 4242 -aec ORTHANC /path/to/dicom/folder/

# Using DCMTK
storescu -aec ORTHANC localhost 4242 /path/to/file.dcm
```

## Verify the System

Run these checks after `docker-compose up -d`:

```bash
# 1. Check all containers are running
docker-compose ps

# 2. Orthanc system endpoint
curl -s http://localhost:8042/system | python -m json.tool

# 3. DICOMWeb QIDO endpoint (returns [] if no studies uploaded yet)
curl -s http://localhost:8042/dicom-web/studies

# 4. Same endpoint via OHIF's nginx proxy
curl -s http://localhost:3000/dicom-web/studies

# 5. Check Orthanc statistics
curl -s http://localhost:8042/statistics

# 6. Verify CORS headers
curl -sI http://localhost:3000/dicom-web/studies | grep -i access-control
```

Expected results:
- Step 2: JSON with `"DicomAet": "ORTHANC"` and plugin info
- Steps 3-4: `[]` (empty array) if no studies uploaded, or JSON array of study metadata
- Step 5: JSON with storage counts
- Step 6: `Access-Control-Allow-Origin: *` header present

## Connect Weasis (Desktop DICOM Viewer)

Weasis connects to Orthanc via the DICOM protocol on the exposed port.

### Configure Weasis DICOM Node

1. Open Weasis
2. Go to **File → Preferences → DICOM Node List**
3. Add a new node:
   - **AE Title**: `ORTHANC`
   - **Hostname**: `localhost` (or your Docker host IP)
   - **Port**: `4242`
4. Click **Verify** to test the connection
5. Use **File → DICOM Query/Retrieve** to search and retrieve studies

### Alternative: Launch via Orthanc

If you have Weasis installed, you can configure Orthanc to launch it. Add this to
`orthanc.json` under the root object:

```json
"ExternalViewers": {
  "Weasis": {
    "Enabled": true,
    "Url": "weasis://$dicom:get -w 'http://localhost:8042' -r 'studyUID=${StudyInstanceUID}'"
  }
}
```

## Optional: Enable Dicoogle Indexing

Dicoogle can be started alongside the stack for DICOM metadata indexing and search.
It does **not** replace Orthanc — it supplements it.

```bash
# Start with Dicoogle enabled
docker-compose --profile dicoogle up -d

# Access Dicoogle web UI
open http://localhost:8080
# Default credentials: dicoogle / dicoogle
```

To have Orthanc forward incoming studies to Dicoogle for indexing, add this to
`orthanc.json` → `"DicomModalities"`:

```json
"DicomModalities": {
  "DICOOGLE": ["DICOOGLE", "dicoogle", 104]
}
```

Then configure a Lua auto-forward script in Orthanc, or use Orthanc's
auto-routing feature.

## Tear Down

```bash
# Stop and remove containers (data volumes persist)
docker-compose down

# Stop and remove containers AND volumes (deletes all DICOM data)
docker-compose down -v
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| OHIF shows "No studies" | No DICOM data uploaded | Upload via Orthanc UI or C-STORE |
| 404 on `/dicom-web/studies` | Orthanc not healthy yet | Wait for healthcheck, check `docker-compose logs orthanc` |
| CORS errors in browser | Accessing Orthanc directly from OHIF origin | Use the nginx-proxied paths (default config handles this) |
| Weasis can't connect | Firewall blocking port 4242 | Check `docker-compose ps` shows 4242 mapped, check firewall |
| Container restart loop | Port conflict | Check nothing else uses 3000, 4242, or 8042 |

## File Structure

```
pacs-stack/
├── docker-compose.yml      # Service orchestration
├── orthanc/
│   └── orthanc.json        # Orthanc configuration (DICOMWeb, CORS, storage)
├── ohif/
│   ├── app-config.js       # OHIF viewer configuration (data sources)
│   └── nginx.conf          # Nginx reverse-proxy (DICOMWeb → Orthanc)
└── README.md               # This file
```
