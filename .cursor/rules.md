# Cursor Repository Rules

1. Use `shared/types/*.d.ts` contracts for cross-package API interfaces.
2. Keep `/packages/reporting-app/backend` endpoints backward compatible unless explicitly versioned.
3. New Dicoogle or OHIF integrations must be documented in `shared/api-endpoints.md`.
4. Avoid hardcoded service URLs; prefer environment variables with local fallbacks.
5. For report updates, preserve immutable versioning semantics (append-only addendums/logs).
