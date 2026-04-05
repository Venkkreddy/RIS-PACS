import { Router } from "express";
import { ensureAuthenticated } from "../middleware/auth";
import { DicoogleService } from "../services/dicoogleService";
import { isOhifAvailable, resetOhifCache } from "../services/ohifHealthCheck";

export function healthRouter(dicoogle: DicoogleService): Router {
  const router = Router();
  const resolveStudyId = (study: Record<string, unknown>): string | null => {
    const candidates = ["studyId", "StudyInstanceUID", "0020000D"];
    for (const key of candidates) {
      const value = study[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return null;
  };

  router.get("/", (_req, res) => res.json({ status: "ok" }));

  router.get("/ohif", async (_req, res) => {
    const force = _req.query.force === "true";
    if (force) resetOhifCache();
    const available = await isOhifAvailable();
    res.json({ available });
  });

  router.get("/worklist-sync", ensureAuthenticated, async (req, res) => {
    const searchText = typeof req.query.search === "string" && req.query.search.trim().length > 0 ? req.query.search : undefined;

    try {
      const startedAt = Date.now();
      const remoteStudies = await dicoogle.searchStudies(searchText);
      const sampleStudyId = remoteStudies.map(resolveStudyId).find((value) => value !== null) ?? null;

      res.json({
        status: "ok",
        remoteStudyCount: remoteStudies.length,
        sampleStudyId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      res.status(503).json({
        status: "error",
        message: error instanceof Error ? error.message : "Worklist sync failed",
      });
    }
  });

  router.get("/webhook-connectivity", ensureAuthenticated, async (req, res) => {
    const requestedStudyId = typeof req.query.studyId === "string" && req.query.studyId.trim().length > 0 ? req.query.studyId : null;

    try {
      const startedAt = Date.now();
      const studies = await dicoogle.searchStudies();
      const discoveredStudyId = studies.map(resolveStudyId).find((value) => value !== null) ?? null;
      const studyId = requestedStudyId ?? discoveredStudyId;

      if (!studyId) {
        res.json({
          status: "ok",
          connectivity: "reachable",
          metadataFetch: "skipped-no-study-id",
          remoteStudyCount: studies.length,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      const metadata = await dicoogle.fetchStudyMetadata(studyId);
      res.json({
        status: "ok",
        connectivity: "reachable",
        metadataFetch: "ok",
        studyId,
        metadataFieldCount: Object.keys(metadata).length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      res.status(503).json({
        status: "error",
        message: error instanceof Error ? error.message : "Webhook connectivity check failed",
      });
    }
  });

  return router;
}
