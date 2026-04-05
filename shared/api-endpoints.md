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
