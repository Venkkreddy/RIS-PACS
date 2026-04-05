# Files — Workspace Structure

> Monorepo root: `metupalle-jpg/tdai/`

```
tdai/
├── .env / .env.example          # Environment variables
├── .gitignore
├── package.json                 # npm workspaces root (medical-imaging-platform)
├── package-lock.json
├── turbo.json                   # Turborepo task pipeline
├── Dockerfile                   # Production image (reporting backend)
├── docker-compose.yml           # Full local stack (6 services)
├── deploy.sh                    # GCP Cloud Run deploy script
│
├── .cursor/
│   └── rules.md                 # AI coding rules
│
├── .github/workflows/
│   └── deploy.yml               # CI: build → GCP Cloud Run on push to main
│
├── shared/                      # Cross-package shared assets
│   ├── api-endpoints.md         # Dicoogle + Reporting API reference
│   ├── tailwind.preset.js       # Shared Tailwind design tokens
│   ├── styles/tdai-tokens.css   # CSS custom properties (brand colors)
│   └── types/report.d.ts        # Shared TypeScript report interfaces
│
├── scripts/                     # Dev/ops utility scripts
│   ├── fly-secrets.sh           # Set Fly.io secrets
│   ├── generate_sample_dicoms.py
│   ├── post_deploy_smoke.py     # Post-deploy health check
│   ├── read_dicoms.py
│   ├── real_dicom_info.json     # Sample DICOM metadata
│   ├── setup-dicom-local.bat    # Windows DICOM local setup
│   ├── start-dicoogle-local.bat # Windows Dicoogle launcher
│   └── step1-restructure.sh     # Monorepo restructure migration
│
├── docs/
│   ├── ARCHITECTURE.md          # Full platform architecture doc
│   ├── dicoogle-import-commands.md
│   ├── ohif-import-commands.md
│   ├── files.md                 # (this file)
│   ├── command.md
│   ├── memory.md
│   └── tools.md
│
├── tests/
│   └── e2e_bot.py               # E2E automation bot
│
├── storage/                     # Dicoogle DICOM file storage (volume-mounted)
├── dicoogle-index/              # Dicoogle Lucene index (volume-mounted)
├── dicoogle-local/              # Local Dicoogle runtime data
│
└── packages/
    ├── reporting-app/           # Main app (npm sub-workspaces)
    │   ├── package.json         # Workspaces: backend, frontend, shared
    │   ├── deploy.sh
    │   ├── integrations/
    │   │   ├── dicoogle-webhook.lua   # Dicoogle→RIS webhook script
    │   │   └── ohif-export-plugin.ts  # OHIF→Reporting bridge
    │   │
    │   ├── shared/              # Shared TS types for backend/frontend
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   │   └── src/
    │   │       ├── index.ts
    │   │       └── types.ts
    │   │
    │   ├── backend/
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   │   ├── jest.config.ts
    │   │   └── src/
    │   │       ├── server.ts            # Entry point
    │   │       ├── app.ts               # Express app setup
    │   │       ├── auth/passport.ts     # Google OAuth strategy
    │   │       ├── config/
    │   │       │   ├── env.ts           # Env var loader
    │   │       │   └── seedDevData.ts   # Dev seed data
    │   │       ├── data/
    │   │       │   └── radiologyTemplates.ts
    │   │       ├── middleware/
    │   │       │   ├── asyncHandler.ts
    │   │       │   ├── auth.ts          # JWT/session auth guard
    │   │       │   ├── errorHandler.ts
    │   │       │   ├── requestLogger.ts
    │   │       │   └── security.ts      # Helmet, rate-limit, CORS
    │   │       ├── routes/
    │   │       │   ├── admin.ts         # User mgmt, audit log
    │   │       │   ├── ai.ts            # MONAI/MedGemma proxy
    │   │       │   ├── auth.ts          # Login/register/me
    │   │       │   ├── billing.ts
    │   │       │   ├── dicomUpload.ts
    │   │       │   ├── dicomweb.ts      # DICOMweb proxy to Dicoogle
    │   │       │   ├── health.ts        # Health + connectivity checks
    │   │       │   ├── orders.ts
    │   │       │   ├── patients.ts
    │   │       │   ├── permissions.ts
    │   │       │   ├── referringPhysicians.ts
    │   │       │   ├── reports.ts       # CRUD, sign, addendum, PDF
    │   │       │   ├── services.ts      # Service registry routes
    │   │       │   ├── templates.ts
    │   │       │   ├── transcribe.ts    # Speech→text
    │   │       │   ├── webhook.ts       # Dicoogle study webhook
    │   │       │   └── worklist.ts
    │   │       ├── services/
    │   │       │   ├── dicoogleAuth.ts
    │   │       │   ├── dicoogleService.ts
    │   │       │   ├── emailService.ts  # SendGrid
    │   │       │   ├── firebaseAdmin.ts
    │   │       │   ├── inMemoryStore.ts
    │   │       │   ├── logger.ts        # Winston
    │   │       │   ├── monaiService.ts  # MONAI/AI bridge
    │   │       │   ├── pdfService.ts    # pdf-lib
    │   │       │   ├── permissions.ts
    │   │       │   ├── reportService.ts
    │   │       │   ├── serviceRegistry.ts
    │   │       │   ├── speechService.ts # GCP Speech-to-Text
    │   │       │   ├── storageService.ts # GCS
    │   │       │   ├── store.ts         # In-memory data store
    │   │       │   └── confs.xml        # Dicoogle config template
    │   │       └── types/express.d.ts
    │   │
    │   └── frontend/
    │       ├── package.json
    │       ├── Dockerfile / fly.toml
    │       ├── vite.config.ts
    │       ├── vitest.config.ts
    │       ├── cypress.config.ts
    │       ├── tailwind.config.ts
    │       ├── tsconfig.json
    │       ├── index.html
    │       └── src/
    │           ├── main.tsx / App.tsx / theme.ts / index.css
    │           ├── api/client.ts        # Axios API client
    │           ├── lib/firebase.ts      # Firebase client init
    │           ├── hooks/
    │           │   ├── useAuthRole.ts
    │           │   ├── useDebouncedValue.ts
    │           │   └── useReport.ts
    │           ├── types/worklist.ts
    │           ├── components/
    │           │   ├── AdminDashboard / AdminSection / BillingDashboard
    │           │   ├── BrandLogo / Dashboard / DicomUpload
    │           │   ├── InternalNavbar / InviteForm
    │           │   ├── LocalDicoogleDownload / MonaiPanel
    │           │   ├── PermissionGate / PermissionsManager
    │           │   ├── RadiologistDashboard / ReceptionistDashboard
    │           │   ├── ReferringDashboard / ReportEditor / ReportList
    │           │   ├── RoleGate / ServiceTogglePanel / ShareButton
    │           │   ├── TechDashboard / TemplateEditor / TipTapEditor
    │           │   ├── VoiceRecorder / Worklist
    │           │   └── TemplateEditor.test.tsx
    │           └── pages/
    │               ├── LandingPage / LoginPage / PendingApprovalPage
    │               ├── AdminPage / AdminDashboardPage
    │               ├── WorklistPage / OrdersPage / PatientsPage
    │               ├── ReportsPage / ReportPage / TemplatesPage
    │               ├── SchedulePage / BillingPage / BillingDashboardPage
    │               ├── RadiologistPage / ReceptionistPage / TechPage
    │               ├── ReferringPage / ReferringPhysiciansPage
    │               └── MyStudiesPage / MyUploadsPage
    │
    ├── monai-server/            # Python AI service (MONAI + MedGemma)
    │   ├── requirements.txt
    │   └── server.py
    │
    ├── medasr-server/           # Python medical ASR service
    │   ├── requirements.txt
    │   ├── Dockerfile
    │   ├── config.py
    │   ├── llm_correction.py    # Gemini post-correction
    │   ├── medical_vocab.py
    │   └── server.py
    │
    ├── wav2vec2-server/         # Python speech-to-text (wav2vec2)
    │   ├── requirements.txt
    │   ├── Dockerfile
    │   ├── config.py
    │   ├── ollama_correction.py # Ollama LLM correction
    │   └── server.py
    │
    ├── dicoogle-server/         # Java Dicoogle PACS (Maven project)
    │   ├── Dockerfile / fly.toml
    │   ├── package.json
    │   ├── pom.xml
    │   ├── build.sh / build-local-installer.sh
    │   ├── config/              # XML configs, plugin settings
    │   ├── src/                 # Java source tree
    │   └── bin/                 # Built JARs (dicoogle, lucene, filestorage)
    │
    └── ohif-viewer/             # OHIF 3.x fork (Yarn + Lerna)
        ├── Dockerfile / fly.toml
        ├── package.json
        ├── platform/            # app, cli, core, i18n, ui, ui-next
        ├── extensions/          # 15+ OHIF extensions
        │   └── reporting-extension/  # Custom TD|ai reporting panel
        ├── modes/               # 9 OHIF modes
        └── addOns/
```

## Key Directories

| Dir | Purpose |
|-----|---------|
| `shared/` | Cross-package types, tokens, API docs |
| `scripts/` | DICOM utils, deploy helpers, smoke tests |
| `docs/` | Architecture, import guides, this reference |
| `storage/` | Dicoogle DICOM file volume |
| `packages/reporting-app/` | Core app (backend + frontend + shared) |
| `packages/monai-server/` | AI image analysis microservice |
| `packages/medasr-server/` | Medical speech recognition |
| `packages/wav2vec2-server/` | Wav2vec2 speech-to-text |
| `packages/dicoogle-server/` | PACS/indexing (Java) |
| `packages/ohif-viewer/` | DICOM viewer fork |
