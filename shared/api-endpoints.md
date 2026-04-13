# Dicoogle + Reporting API Endpoints

## Dicoogle REST APIs

- `GET /search`  
  Query indexed studies/instances.
- `GET /studies/{studyUID}`  
  Retrieve study-level metadata.
- `GET /legacy/wado`  
  WADO URI retrieval for rendered objects.
- `GET /dicom-web/studies`  
  DICOMweb study queries (if enabled by deployment config).

## Reporting App APIs

- `POST /templates`
- `GET /templates`
- `POST /reports`
- `GET /reports`
- `GET /reports/:id`
- `PATCH /reports/:id/addendum`
- `POST /reports/:id/attach`
- `POST /reports/:id/voice`
- `POST /reports/:id/share`
- `POST /webhook/study`
- `POST /transcribe`

## HIPAA Compliance APIs

- `GET /hipaa/audit-log` — Query PHI audit trail with filters (admin only)
- `GET /hipaa/audit-log/integrity` — Verify SHA-256 hash chain integrity (admin only)
- `POST /hipaa/emergency-access` — Request break-glass emergency PHI access
- `POST /hipaa/emergency-access/revoke` — Revoke emergency access grant (admin only)
- `GET /hipaa/emergency-access` — List all emergency access records (admin only)
- `GET /hipaa/compliance-status` — Real-time compliance dashboard (admin only)
