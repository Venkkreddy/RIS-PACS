# Tools & Dependencies

## Languages

| Language | Where |
|----------|-------|
| TypeScript / JavaScript | Reporting app (backend + frontend), OHIF, shared |
| Python 3 | monai-server, medasr-server, wav2vec2-server, scripts |
| Java 11+ | Dicoogle PACS (Maven) |
| Lua | Dicoogle webhook script (`dicoogle-webhook.lua`) |
| Shell / Batch | Deploy scripts, local setup |

## Monorepo & Build

| Tool | Version | Purpose |
|------|---------|---------|
| npm | 10.8+ | Package manager, workspaces |
| Turborepo | ^2.5.2 | Task orchestration, caching, parallel builds |
| Yarn | (OHIF only) | OHIF upstream dependency |
| Lerna | (OHIF only) | OHIF monorepo management |

## Backend (`reporting-app/backend`)

### Runtime

| Package | Purpose |
|---------|---------|
| express ^4.21 | HTTP framework |
| passport + passport-google-oauth20 | Google OAuth strategy |
| firebase-admin ^13.7 | Firebase JWT verification, Firestore |
| @google-cloud/firestore ^7.11 | Database (current) |
| @google-cloud/storage ^7.14 | GCS file storage |
| @google-cloud/speech ^7.2 | Speech-to-text |
| axios ^1.8 | HTTP client (Dicoogle, AI services) |
| zod ^3.24 | Schema validation |
| winston ^3.17 | Logging |
| pdf-lib ^1.17 | PDF report generation |
| @sendgrid/mail ^8.1 | Email delivery |
| dicom-parser ^1.8 | DICOM file parsing |
| multer ^2.0 | File upload handling |
| helmet ^8.0 | Security headers |
| express-rate-limit ^7.5 | Rate limiting |
| express-session ^1.18 | Session management |
| uuid ^11.1 | ID generation |
| dotenv ^16.4 | Env var loading |
| cors ^2.8 | CORS middleware |

### Dev

| Package | Purpose |
|---------|---------|
| typescript ^5.7 | Type checking + compilation |
| ts-node-dev ^2.0 | Hot-reload dev server |
| jest ^29.7 + ts-jest | Unit testing |
| supertest ^7.0 | HTTP assertion testing |

## Frontend (`reporting-app/frontend`)

### Runtime

| Package | Purpose |
|---------|---------|
| react ^18.3 + react-dom | UI framework |
| react-router-dom ^7.4 | Client routing |
| @tanstack/react-query ^5.90 | Server state management |
| @tanstack/react-table ^8.21 | Data table (worklist, reports) |
| @tiptap/* ^3.20 (14 packages) | Rich text editor (reports, templates) |
| firebase ^12.10 | Auth client (Google, email/password) |
| axios ^1.8 | API client |
| recharts ^3.8 | Charts (analytics dashboards) |
| react-quill ^2.0 | Legacy rich text (being replaced by TipTap) |

### Dev / Build

| Package | Purpose |
|---------|---------|
| vite ^6.2 | Dev server + bundler |
| @vitejs/plugin-react ^4.4 | React HMR/JSX transform |
| typescript ^5.7 | Type checking |
| tailwindcss ^3.4 | Utility-first CSS |
| postcss ^8.5 + autoprefixer | CSS processing |
| vitest ^3.0 | Unit testing |
| cypress ^15.12 | E2E testing |
| @testing-library/react ^16.2 | Component testing |
| jsdom ^26.0 | DOM simulation for tests |

## Python AI Services

### monai-server

| Package | Purpose |
|---------|---------|
| torch >=2.0 | PyTorch deep learning |
| monai >=1.3 | Medical image AI framework |
| fastapi >=0.110 | HTTP API |
| uvicorn | ASGI server |
| pydicom >=2.4 | DICOM file handling |
| google-cloud-aiplatform >=1.60 | Vertex AI / MedGemma |
| Pillow, numpy, scipy, scikit-image | Image processing |

### medasr-server

| Package | Purpose |
|---------|---------|
| torch + torchaudio >=2.0 | Audio ML |
| transformers >=4.40 | HuggingFace models |
| medasr >=0.1 | Medical ASR model |
| fastapi + uvicorn | HTTP API |
| google-cloud-aiplatform >=1.60 | Vertex AI |
| soundfile, numpy, scipy | Audio processing |

### wav2vec2-server

| Package | Purpose |
|---------|---------|
| torch + torchaudio >=2.0 | Audio ML |
| transformers >=4.40 | wav2vec2-base-960h model |
| fastapi + uvicorn | HTTP API |
| soundfile, numpy, scipy | Audio processing |

## Infrastructure

| Tool | Purpose |
|------|---------|
| Docker + Docker Compose 3.9 | Containerized local stack (6 services) |
| GitHub Actions | CI/CD on push to `main` |
| Google Cloud Run | Production hosting (reporting-api, ohif-viewer, dicoogle) |
| Fly.io | Legacy hosting (configs in `fly.toml` files) |
| gcloud CLI | Manual GCP deploys (`deploy.sh`) |
| Firebase Hosting | Landing page at `tdairad.com` |
| NVIDIA GPU (docker) | GPU reservation for monai-server container |

## External Services

| Service | Purpose |
|---------|---------|
| Firebase Auth | Authentication (Google OAuth + email/password) |
| Google Cloud Firestore | Document database |
| Google Cloud Storage | DICOM/report file storage |
| Google Cloud Speech | Speech-to-text |
| Google Vertex AI | MedGemma medical AI model hosting |
| Gemini API | LLM for medical text correction (primary) |
| Ollama (local) | LLM fallback (llama3) for text correction |
| SendGrid | Transactional email |

## Medical / Imaging

| Tool | Purpose |
|------|---------|
| Dicoogle | Open-source PACS — DICOM store, index, DICOMweb, webhooks |
| OHIF 3.x | Zero-footprint web DICOM viewer |
| Project MONAI | Medical image AI inference framework |
| MedGemma | Google medical foundation model |
| MedASR | Medical speech recognition model |
| wav2vec2 (facebook) | General speech-to-text base model |
| DICOMweb (QIDO/WADO/STOW) | Standard imaging web protocol |

## Testing Stack

| Layer | Tool |
|-------|------|
| Backend unit | Jest + ts-jest + supertest |
| Frontend unit | Vitest + @testing-library/react + jsdom |
| Frontend E2E | Cypress |
| Post-deploy | `scripts/post_deploy_smoke.py` (health + connectivity) |
| E2E bot | `tests/e2e_bot.py` |
