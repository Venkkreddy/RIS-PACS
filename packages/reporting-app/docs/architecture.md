# Architecture Design

## High-level architecture diagram

```mermaid
flowchart LR
    R[Radiologist Browser]
    OHIF[OHIF Viewer]
    D[Dicoogle PACS]
    FE[React Frontend]
    BE[Node.js/Express Backend]
    FS[(Firestore)]
    GCS[(Google Cloud Storage)]
    STT[Google Speech-to-Text]
    W2V[Wav2Vec 2.0 Server]
    LLM[LLM Medical Correction]
    SG[SendGrid]

    R --> FE
    OHIF -->|Export JPEG + study context| FE
    FE -->|REST + OAuth session| BE
    D -->|Webhook: new/selected study| BE
    BE -->|Persist templates/reports/version logs| FS
    BE -->|Audio/JPEG storage| GCS
    BE -->|Fallback audio transcription| STT
    BE -->|Audio → Wav2Vec transcription| W2V
    W2V -->|Raw transcript → structured report| LLM
    BE -->|Report PDF + attachments email| SG
    BE -->|Optional metadata pull| D
```

## Key stack choices and reasons

- **Node.js + Express (backend):** lightweight, fast API iteration, ideal for Cloud Run/App Engine.
- **React + Quill (frontend):** strong UX for rich-text radiology reports and template authoring.
- **Firestore:** document model maps naturally to templates, reports, immutable versions.
- **GCS:** durable object storage for JPEG exports and audio voice notes.
- **Wav2Vec 2.0 Server:** medical-grade speech-to-text with domain fine-tuning, medical vocabulary boosting, and LLM-powered report structuring (Findings/Impression).
- **Google Speech-to-Text:** fallback GCP voice transcription with long-running recognition support.
- **LLM Correction (OpenAI/Gemini/Ollama):** post-processing layer that corrects medical terminology, expands abbreviations, and formats dictations as structured radiology reports.
- **SendGrid:** robust transactional email delivery for report sharing workflows.
- **Google OAuth2 + session:** practical SSO and role control for radiologists.
- **Winston + GCP logging friendly JSON:** operational observability with HIPAA-compliant structured logging (service metadata, hostname, ISO 8601 timestamps).
- **HIPAA Audit Service:** SHA-256 hash-chained immutable audit trail for all PHI access, emergency break-glass access, compliance dashboard, 6-year retention.
- **HIPAA Middleware:** Automatic PHI route detection and logging, 15-minute session timeout, account lockout, HTTPS enforcement, password policy validation.

## Repository structure

```text
metupalle-jpg/tdai/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.ts
│   ├── tests/
│   ├── app.yaml
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── App.tsx
│   └── package.json
├── shared/
│   └── src/types.ts
├── docs/
│   ├── architecture.md
│   └── deployment.md
├── integrations/
│   ├── ohif-export-plugin.ts
│   └── dicoogle-webhook.lua
├── scripts/
│   └── init-repo.sh
├── .github/workflows/deploy.yml
└── deploy.sh
```
