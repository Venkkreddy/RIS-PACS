# Medical Report System

A full-stack radiology reporting application designed to work alongside Dicoogle (PACS) and OHIF (viewer).

## Project layout

- `backend/`: Node.js + Express API, Firestore/GCS/Speech integration, versioned reports, sharing.
- `frontend/`: React + Tailwind + Quill UI for templates and reporting workflow.
- `shared/`: Shared TypeScript interfaces.
- `docs/`: Architecture, deployment and integration notes.
- `integrations/`: OHIF and Dicoogle sample snippets.

## Quick start

```bash
npm install
npm run build -w shared
npm run dev -w backend
npm run dev -w frontend
```

See `docs/architecture.md` and `docs/deployment.md` for details.
