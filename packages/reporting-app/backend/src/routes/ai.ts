import { Router } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { MonaiService } from "../services/monaiService";
import { StoreService } from "../services/store";
import { logger } from "../services/logger";
import { registerExtraDicomFile, clearDimCache } from "./dicomweb";
import { env } from "../config/env";

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

const inferSchema = z.object({
  studyId: z.string().min(1).regex(SAFE_ID_RE, "studyId contains invalid characters"),
  seriesId: z.string().regex(SAFE_ID_RE, "seriesId contains invalid characters").optional(),
  model: z.string().default("monai_chest_xray"),
  generateSR: z.boolean().default(false),
});

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");
const AI_OUTPUT_DIR = path.join(DICOOGLE_STORAGE_DIR, "ai-sr");

function ensureOutputDir() {
  if (!fs.existsSync(AI_OUTPUT_DIR)) {
    fs.mkdirSync(AI_OUTPUT_DIR, { recursive: true });
  }
}

function collectDcmFiles(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "ai-sr") continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".dcm")) {
      results.push(full);
    } else if (entry.isDirectory()) {
      results.push(...collectDcmFiles(full, maxDepth, depth + 1));
    }
  }
  return results;
}

const DICOM_IMAGE_SOPS = new Set([
  "1.2.840.10008.5.1.4.1.1.1",     // CR Image
  "1.2.840.10008.5.1.4.1.1.1.1",   // Digital X-Ray
  "1.2.840.10008.5.1.4.1.1.2",     // CT Image
  "1.2.840.10008.5.1.4.1.1.4",     // MR Image
  "1.2.840.10008.5.1.4.1.1.7",     // Secondary Capture
]);

function looksLikeDicomImage(headerContent: string): boolean {
  for (const sop of DICOM_IMAGE_SOPS) {
    if (headerContent.includes(sop)) return true;
  }
  const srSops = ["1.2.840.10008.5.1.4.1.1.88", "1.2.840.10008.5.1.4.1.1.11"];
  for (const sop of srSops) {
    if (headerContent.includes(sop)) return false;
  }
  return true;
}

function findDicomFileForStudy(studyId: string): string | null {
  if (!fs.existsSync(DICOOGLE_STORAGE_DIR)) return null;

  const files = collectDcmFiles(DICOOGLE_STORAGE_DIR);
  let fallback: string | null = null;

  for (const filePath of files) {
    try {
      const fd = fs.openSync(filePath, "r");
      const headerBuf = Buffer.alloc(16384);
      const bytesRead = fs.readSync(fd, headerBuf, 0, 16384, 0);
      fs.closeSync(fd);
      const content = headerBuf.toString("latin1", 0, bytesRead);

      if (!looksLikeDicomImage(content)) continue;

      if (content.includes(studyId)) {
        logger.info({ message: "DICOM file matched for study", studyId, path: filePath });
        return filePath;
      }

      if (!fallback) fallback = filePath;
    } catch {
      continue;
    }
  }

  if (fallback) {
    logger.info({ message: "No exact DICOM match for study; using fallback", studyId, path: fallback });
  }
  return fallback;
}

function cleanOldFiles(prefix: string) {
  if (!fs.existsSync(AI_OUTPUT_DIR)) return;
  for (const f of fs.readdirSync(AI_OUTPUT_DIR)) {
    if (f.startsWith(prefix) && f.endsWith(".dcm")) {
      fs.unlinkSync(path.join(AI_OUTPUT_DIR, f));
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isPathUnder(parent: string, child: string): boolean {
  const resolved = path.resolve(child);
  return resolved.startsWith(path.resolve(parent) + path.sep) || resolved === path.resolve(parent);
}

function saveDicomObject(
  b64: string,
  prefix: string,
  studyId: string,
  label: string,
): string | null {
  try {
    ensureOutputDir();
    const safeStudy = sanitizeId(studyId);
    const filename = `${prefix}_${safeStudy}_${Date.now()}.dcm`;
    const filePath = path.join(AI_OUTPUT_DIR, filename);
    if (!isPathUnder(AI_OUTPUT_DIR, filePath)) {
      logger.error({ message: `Path traversal blocked for ${label}`, path: filePath });
      return null;
    }
    fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
    logger.info({ message: `${label} saved`, path: filePath });
    registerExtraDicomFile(filePath);
    return filePath;
  } catch (err) {
    logger.error({ message: `Failed to save ${label}`, error: String(err) });
    return null;
  }
}

export function aiRouter(monaiService: MonaiService, store: StoreService): Router {
  const router = Router();

  router.get("/models", ensureAuthenticated, asyncHandler(async (_req, res) => {
    const models = await monaiService.listModels();
    res.json({ enabled: monaiService.isEnabled(), models });
  }));

  router.post(
    "/analyze",
    ensureAuthenticated,
    ensurePermission(store, "ai:analyze"),
    asyncHandler(async (req, res) => {
      const body = inferSchema.parse(req.body);
      const safeStudy = body.studyId.replace(/\./g, "_");

      cleanOldFiles(`ai_sr_${safeStudy}_`);
      cleanOldFiles(`ai_sc_${safeStudy}_`);
      cleanOldFiles(`ai_gsps_${safeStudy}_`);

      const dicomFilePath = findDicomFileForStudy(body.studyId);

      let result;
      if (dicomFilePath && body.generateSR) {
        const dicomBuffer = fs.readFileSync(dicomFilePath);
        result = await monaiService.analyzeDicomFile(
          dicomBuffer,
          path.basename(dicomFilePath),
          body.studyId,
          body.model,
        );
      } else if (body.generateSR) {
        result = await monaiService.runInferenceWithSR({
          studyId: body.studyId,
          seriesId: body.seriesId,
          model: body.model,
        });
      } else {
        result = await monaiService.runInference({
          studyId: body.studyId,
          seriesId: body.seriesId,
          model: body.model,
        });
      }

      if (result.status === "completed" && result.findings.length > 0) {
        const metadataPatch: Record<string, unknown> = {
          aiFindings: result.findings,
          aiSummary: result.summary,
          aiModel: result.model,
        };

        if (result.dicomSrBase64) {
          const srPath = saveDicomObject(result.dicomSrBase64, "ai_sr", body.studyId, "DICOM SR");
          if (srPath) {
            metadataPatch.aiDicomSrPath = srPath;
            metadataPatch.aiDicomSrSizeBytes = result.dicomSrSizeBytes;
          }
        }

        if (result.dicomScBase64) {
          const scPath = saveDicomObject(result.dicomScBase64, "ai_sc", body.studyId, "AI Heatmap (Secondary Capture)");
          if (scPath) {
            metadataPatch.aiDicomScPath = scPath;
            metadataPatch.aiDicomScSizeBytes = result.dicomScSizeBytes;
          }
        }

        if (result.dicomGspsBase64) {
          const gspsPath = saveDicomObject(result.dicomGspsBase64, "ai_gsps", body.studyId, "GSPS Annotations");
          if (gspsPath) {
            metadataPatch.aiDicomGspsPath = gspsPath;
            metadataPatch.aiDicomGspsSizeBytes = result.dicomGspsSizeBytes;
          }
        }

        if (result.heatmapPngBase64) {
          metadataPatch.aiHeatmapPngBase64 = result.heatmapPngBase64;
        }

        clearDimCache();
        await store.upsertStudyRecord(body.studyId, { metadata: metadataPatch }).catch(() => {});
      }

      const {
        dicomSrBase64: _a,
        dicomScBase64: _b,
        dicomGspsBase64: _c,
        ...responseClean
      } = result;

      res.json({
        ...responseClean,
        dicomSrGenerated: !!result.dicomSrBase64,
        dicomScGenerated: !!result.dicomScBase64,
        dicomGspsGenerated: !!result.dicomGspsBase64,
        heatmapPngBase64: result.heatmapPngBase64 ?? null,
        heatmapUrl: result.heatmapPngBase64 ? `/ai/heatmap/${encodeURIComponent(body.studyId)}` : null,
        gspsUrl: result.dicomGspsBase64 ? `/ai/gsps/${encodeURIComponent(body.studyId)}` : null,
      });
    }),
  );

  router.get(
    "/results/:studyId",
    ensureAuthenticated,
    ensurePermission(store, "ai:view_results"),
    asyncHandler(async (req, res) => {
      const studyId = Array.isArray(req.params.studyId) ? req.params.studyId[0] : req.params.studyId;
      const record = await store.getStudyRecord(studyId);
      const metadata = (record?.metadata ?? {}) as Record<string, unknown>;

      res.json({
        studyId,
        findings: metadata.aiFindings ?? [],
        summary: metadata.aiSummary ?? null,
        model: metadata.aiModel ?? null,
        dicomSrAvailable: !!metadata.aiDicomSrPath,
        dicomScAvailable: !!metadata.aiDicomScPath,
        dicomGspsAvailable: !!metadata.aiDicomGspsPath,
        heatmapUrl: metadata.aiHeatmapPngBase64 ? `/ai/heatmap/${encodeURIComponent(studyId)}` : null,
        gspsUrl: metadata.aiDicomGspsPath ? `/ai/gsps/${encodeURIComponent(studyId)}` : null,
      });
    }),
  );

  router.get(
    "/heatmap/:studyId",
    ensureAuthenticated,
    ensurePermission(store, "ai:view_results"),
    asyncHandler(async (req, res) => {
      const studyId = Array.isArray(req.params.studyId) ? req.params.studyId[0] : req.params.studyId;
      const record = await store.getStudyRecord(studyId);
      const metadata = (record?.metadata ?? {}) as Record<string, unknown>;
      const heatmapB64 = metadata.aiHeatmapPngBase64 as string | undefined;

      if (!heatmapB64) {
        const scPath = metadata.aiDicomScPath as string | undefined;
        if (scPath && isPathUnder(AI_OUTPUT_DIR, scPath) && fs.existsSync(scPath)) {
          res.setHeader("Content-Type", "application/dicom");
          res.setHeader("Content-Disposition", 'attachment; filename="ai_heatmap.dcm"');
          fs.createReadStream(scPath).pipe(res);
          return;
        }
        res.status(404).json({ error: "No heatmap available for this study" });
        return;
      }

      const pngBuf = Buffer.from(heatmapB64, "base64");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", pngBuf.length.toString());
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(pngBuf);
    }),
  );

  router.get(
    "/gsps/:studyId",
    ensureAuthenticated,
    ensurePermission(store, "ai:view_results"),
    asyncHandler(async (req, res) => {
      const studyId = Array.isArray(req.params.studyId) ? req.params.studyId[0] : req.params.studyId;
      const record = await store.getStudyRecord(studyId);
      const metadata = (record?.metadata ?? {}) as Record<string, unknown>;
      const gspsPath = metadata.aiDicomGspsPath as string | undefined;

      if (!gspsPath || !isPathUnder(AI_OUTPUT_DIR, gspsPath) || !fs.existsSync(gspsPath)) {
        res.status(404).json({ error: "No GSPS available for this study" });
        return;
      }

      res.setHeader("Content-Type", "application/dicom");
      res.setHeader("Content-Disposition", 'attachment; filename="ai_gsps.dcm"');
      fs.createReadStream(gspsPath).pipe(res);
    }),
  );

  router.get(
    "/sr/:studyId",
    ensureAuthenticated,
    ensurePermission(store, "ai:view_results"),
    asyncHandler(async (req, res) => {
      const studyId = Array.isArray(req.params.studyId) ? req.params.studyId[0] : req.params.studyId;
      const record = await store.getStudyRecord(studyId);
      const metadata = (record?.metadata ?? {}) as Record<string, unknown>;
      const srPath = metadata.aiDicomSrPath as string | undefined;

      if (!srPath || !isPathUnder(AI_OUTPUT_DIR, srPath) || !fs.existsSync(srPath)) {
        res.status(404).json({ error: "No DICOM SR available for this study" });
        return;
      }

      res.setHeader("Content-Type", "application/dicom");
      res.setHeader("Content-Disposition", 'attachment; filename="ai_sr.dcm"');
      fs.createReadStream(srPath).pipe(res);
    }),
  );

  return router;
}
