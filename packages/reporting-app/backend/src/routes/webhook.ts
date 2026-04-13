import { Router } from "express";
import fs from "fs";
import path from "path";
import dicomParser from "dicom-parser";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { DicoogleService } from "../services/dicoogleService";
import { MonaiService } from "../services/monaiService";
import { ReportService } from "../services/reportService";
import { StoreService } from "../services/store";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { logger } from "../services/logger";
import { registerExtraDicomFile, clearDimCache } from "./dicomweb";

const webhookSchema = z.object({
  studyId: z.string().min(1),
  tenantSlug: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  ownerId: z.string().default("system"),
});

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");
const TENANT_STORAGE_ROOT = path.resolve(env.TENANT_STORAGE_ROOT || DICOOGLE_STORAGE_DIR);
const AI_OUTPUT_DIR = path.join(DICOOGLE_STORAGE_DIR, "ai-sr");
const MAX_DICOM_HEADER_READ_BYTES = 8 * 1024 * 1024;
const NON_DIAGNOSTIC_SERIES_HINTS = ["ai heatmap", "gradcam", "secondary capture", "structured report", "segmentation"];
const AUTO_ANALYSIS_DEDUP_WINDOW_MS = 15 * 60 * 1000;

function ensureOutputDir() {
  if (!fs.existsSync(AI_OUTPUT_DIR)) {
    fs.mkdirSync(AI_OUTPUT_DIR, { recursive: true });
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeDicomUid(rawValue: string | undefined | null): string | undefined {
  if (!rawValue) return undefined;
  const normalized = rawValue.replace(/\0/g, "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readDicomHeaderDataSet(filePath: string): dicomParser.DataSet | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const headerBuffer = Buffer.alloc(MAX_DICOM_HEADER_READ_BYTES);
    const bytesRead = fs.readSync(fd, headerBuffer, 0, MAX_DICOM_HEADER_READ_BYTES, 0);
    if (bytesRead === 0) {
      return null;
    }
    const byteArray = new Uint8Array(headerBuffer.buffer, headerBuffer.byteOffset, bytesRead);
    return dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}

function isPathUnder(parent: string, child: string): boolean {
  const resolved = path.resolve(child);
  return resolved.startsWith(path.resolve(parent) + path.sep) || resolved === path.resolve(parent);
}

function saveDicomObjectFromWebhook(
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
    if (!isPathUnder(AI_OUTPUT_DIR, filePath)) return null;
    fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
    logger.info({ message: `Webhook MONAI: ${label} saved`, path: filePath });
    registerExtraDicomFile(filePath);
    return filePath;
  } catch (err) {
    logger.error({ message: `Webhook MONAI: failed to save ${label}`, error: String(err) });
    return null;
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
  "1.2.840.10008.5.1.4.1.1.1",
  "1.2.840.10008.5.1.4.1.1.1.1",
  "1.2.840.10008.5.1.4.1.1.2",
  "1.2.840.10008.5.1.4.1.1.4",
  "1.2.840.10008.5.1.4.1.1.7",
]);

function looksLikeDicomImage(sopClassUid: string | undefined, modality: string | undefined): boolean {
  const normalizedSopClass = normalizeDicomUid(sopClassUid);
  const normalizedModality = (modality ?? "").trim().toUpperCase();
  if (normalizedModality === "SR" || normalizedModality === "PR") return false;
  if (!normalizedSopClass) return normalizedModality !== "SR" && normalizedModality !== "PR";
  return DICOM_IMAGE_SOPS.has(normalizedSopClass);
}

function getScanRoots(tenantSlug?: string): string[] {
  const roots = [DICOOGLE_STORAGE_DIR];
  if (tenantSlug && env.MULTI_TENANT_ENABLED) {
    roots.unshift(path.join(TENANT_STORAGE_ROOT, tenantSlug));
  }
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

interface DicomRepresentativeCandidate {
  filePath: string;
  area: number;
  instanceNumber: number | null;
}

function findDicomFilesForStudy(studyId: string, tenantSlug?: string): string[] {
  const normalizedStudyId = normalizeDicomUid(studyId);
  if (!normalizedStudyId) return [];

  const files = getScanRoots(tenantSlug)
    .filter((root) => fs.existsSync(root))
    .flatMap((root) => collectDcmFiles(root));
  if (files.length === 0) return [];

  const matched: string[] = [];
  for (const filePath of files) {
    const dataSet = readDicomHeaderDataSet(filePath);
    if (!dataSet) continue;

    const fileStudyUid = normalizeDicomUid(dataSet.string("x0020000d"));
    if (!fileStudyUid || fileStudyUid !== normalizedStudyId) continue;

    const sopClassUid = normalizeDicomUid(dataSet.string("x00080016"));
    const modality = (dataSet.string("x00080060") ?? "").trim().toUpperCase();
    if (!looksLikeDicomImage(sopClassUid, modality)) continue;

    const seriesDescription = (dataSet.string("x0008103e") ?? "").trim().toLowerCase();
    if (NON_DIAGNOSTIC_SERIES_HINTS.some((hint) => seriesDescription.includes(hint))) continue;
    matched.push(filePath);
  }
  return matched;
}

function pickRepresentativeDicomFile(dicomFilePaths: string[]): string | null {
  const candidates: DicomRepresentativeCandidate[] = [];
  for (const filePath of dicomFilePaths) {
    const dataSet = readDicomHeaderDataSet(filePath);
    if (!dataSet) continue;

    const rows = dataSet.uint16("x00280010") ?? 0;
    const columns = dataSet.uint16("x00280011") ?? 0;
    const area = rows * columns;
    if (area <= 0) continue;

    const instanceRaw = dataSet.string("x00200013");
    const parsedInstance = instanceRaw ? Number.parseInt(instanceRaw, 10) : Number.NaN;
    const instanceNumber = Number.isFinite(parsedInstance) ? parsedInstance : null;
    candidates.push({ filePath, area, instanceNumber });
  }

  if (candidates.length === 0) {
    return dicomFilePaths[0] ?? null;
  }

  const withInstanceNumbers = candidates.filter((candidate) => candidate.instanceNumber !== null);
  if (withInstanceNumbers.length > 2) {
    withInstanceNumbers.sort((a, b) => {
      if (a.instanceNumber === null || b.instanceNumber === null) return b.area - a.area;
      if (a.instanceNumber === b.instanceNumber) return b.area - a.area;
      return a.instanceNumber - b.instanceNumber;
    });
    return withInstanceNumbers[Math.floor(withInstanceNumbers.length / 2)]?.filePath ?? candidates[0]!.filePath;
  }

  candidates.sort((a, b) => b.area - a.area);
  return candidates[0]!.filePath;
}

function normalizePerImageResults(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"));
}

function mergeAiMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  metadataPatch: Record<string, unknown>,
  perImageResult: Record<string, unknown>,
): Record<string, unknown> {
  const mergedMetadata: Record<string, unknown> = {
    ...(existingMetadata ?? {}),
    ...metadataPatch,
  };

  const sourceFileKey = String(perImageResult.sourceFile ?? "");
  const priorPerImage = normalizePerImageResults(existingMetadata?.aiPerImageResults);
  const nextPerImage = [
    ...priorPerImage.filter((entry) => String(entry.sourceFile ?? "") !== sourceFileKey),
    perImageResult,
  ].sort((a, b) => String(a.processedAt ?? "").localeCompare(String(b.processedAt ?? "")));

  mergedMetadata.aiPerImageResults = nextPerImage;
  mergedMetadata.aiProcessedImageCount = nextPerImage.length;
  return mergedMetadata;
}

async function persistWebhookAiMetadata(
  store: StoreService,
  studyId: string,
  metadataPatch: Record<string, unknown>,
  perImageResult: Record<string, unknown>,
  options?: { tenantStore?: TenantScopedStore; tenantId?: string },
): Promise<void> {
  if (options?.tenantStore && options.tenantId) {
    const tenantStudy =
      (await options.tenantStore.getStudyByUid(options.tenantId, studyId))
      ?? (await options.tenantStore.getStudy(options.tenantId, studyId));
    if (tenantStudy) {
      const existingMetadata = (tenantStudy.metadata ?? {}) as Record<string, unknown>;
      const mergedMetadata = mergeAiMetadata(existingMetadata, metadataPatch, perImageResult);
      await options.tenantStore.upsertStudy(options.tenantId, {
        studyInstanceUid: tenantStudy.study_instance_uid,
        patientName: tenantStudy.patient_name,
        studyDate: tenantStudy.study_date,
        modality: tenantStudy.modality,
        description: tenantStudy.description,
        bodyPart: tenantStudy.body_part,
        location: tenantStudy.location,
        status: tenantStudy.status,
        uploaderId: tenantStudy.uploader_id,
        aeTitle: tenantStudy.ae_title,
        institutionName: tenantStudy.institution_name,
        metadata: mergedMetadata,
      });
      return;
    }
  }

  const existing = await store.getStudyRecord(studyId).catch(() => null);
  const existingMetadata = (existing?.metadata ?? {}) as Record<string, unknown>;
  const mergedMetadata = mergeAiMetadata(existingMetadata, metadataPatch, perImageResult);
  await store.upsertStudyRecord(studyId, { metadata: mergedMetadata });
}

async function getWebhookStudyMetadata(
  store: StoreService,
  studyId: string,
  options?: { tenantStore?: TenantScopedStore; tenantId?: string },
): Promise<Record<string, unknown> | undefined> {
  if (options?.tenantStore && options.tenantId) {
    const tenantStudy =
      (await options.tenantStore.getStudyByUid(options.tenantId, studyId))
      ?? (await options.tenantStore.getStudy(options.tenantId, studyId));
    return (tenantStudy?.metadata ?? undefined) as Record<string, unknown> | undefined;
  }

  const existing = await store.getStudyRecord(studyId).catch(() => null);
  return (existing?.metadata ?? undefined) as Record<string, unknown> | undefined;
}

function hasRecentWebhookAutoAnalysis(
  metadata: Record<string, unknown> | undefined,
  sourceFile: string,
): boolean {
  if (!metadata) return false;

  const processedAt = typeof metadata.aiProcessedAt === "string"
    ? Date.parse(metadata.aiProcessedAt)
    : Number.NaN;
  if (!Number.isFinite(processedAt)) return false;

  const ageMs = Date.now() - processedAt;
  if (ageMs < 0 || ageMs > AUTO_ANALYSIS_DEDUP_WINDOW_MS) return false;

  const hasAiOutputs = Boolean(
    metadata.aiDicomSegPath
    || metadata.aiDicomSrPath
    || metadata.aiDicomScPath
    || metadata.aiHeatmapPngBase64,
  );
  if (!hasAiOutputs) return false;

  const previousSourceFile = typeof metadata.aiSourceFile === "string" ? metadata.aiSourceFile : undefined;
  if (!previousSourceFile) return true;
  return previousSourceFile === sourceFile;
}

function cleanWebhookAiArtifactsForStudy(studyId: string): void {
  if (!fs.existsSync(AI_OUTPUT_DIR)) return;
  const safeStudyId = sanitizeId(studyId);
  const marker = `_${safeStudyId}_`;
  for (const filename of fs.readdirSync(AI_OUTPUT_DIR)) {
    if (!filename.endsWith(".dcm")) continue;
    if (!filename.startsWith("ai_")) continue;
    if (!filename.includes(marker)) continue;
    try {
      fs.unlinkSync(path.join(AI_OUTPUT_DIR, filename));
    } catch {
      // Ignore cleanup failures; newer artifact still gets persisted.
    }
  }
}

async function runAutoMonaiAnalysis(
  monaiService: MonaiService,
  store: StoreService,
  studyId: string,
  options?: { tenantSlug?: string; tenantStore?: TenantScopedStore; tenantId?: string },
): Promise<void> {
  if (!monaiService.isEnabled()) {
    logger.info({ message: "Webhook MONAI: skipped — MONAI not enabled", studyId });
    return;
  }

  const dicomFiles = findDicomFilesForStudy(studyId, options?.tenantSlug);
  if (dicomFiles.length === 0) {
    logger.warn({ message: "Webhook MONAI: no DICOM image found for study", studyId });
    return;
  }

  const representativeDicomPath = pickRepresentativeDicomFile(dicomFiles);
  if (!representativeDicomPath) {
    logger.warn({ message: "Webhook MONAI: no representative DICOM selected", studyId });
    return;
  }

  const fileBasename = path.basename(representativeDicomPath);
  const existingMetadata = await getWebhookStudyMetadata(store, studyId, options);
  if (hasRecentWebhookAutoAnalysis(existingMetadata, fileBasename)) {
    logger.info({
      message: "Webhook MONAI: skipping duplicate auto-analysis",
      studyId,
      file: fileBasename,
    });
    return;
  }

  logger.info({
    message: "Webhook MONAI: auto-analysis starting",
    studyId,
    totalCandidateFiles: dicomFiles.length,
    representativeFile: fileBasename,
  });

  try {
    const dicomBuffer = fs.readFileSync(representativeDicomPath);
    const result = await monaiService.analyzeDicomAutoRoute(
      dicomBuffer,
      fileBasename,
      studyId,
    );

    if (result.status !== "completed") {
      logger.warn({
        message: "Webhook MONAI: auto-route did not complete",
        studyId,
        file: fileBasename,
        status: result.status,
        summary: result.summary,
      });
      return;
    }

    cleanWebhookAiArtifactsForStudy(studyId);

    const metadataPatch: Record<string, unknown> = {
      aiFindings: result.findings,
      aiSummary: result.summary,
      aiModel: result.model,
      aiAutoRun: true,
      aiProcessedAt: result.processedAt,
      aiSourceFile: fileBasename,
    };

    if (result.dicomSrBase64) {
      const srPath = saveDicomObjectFromWebhook(result.dicomSrBase64, "ai_sr_primary", studyId, "DICOM SR");
      if (srPath) {
        metadataPatch.aiDicomSrPath = srPath;
        metadataPatch.aiDicomSrSizeBytes = result.dicomSrSizeBytes;
      }
    }

    if (result.dicomSegBase64) {
      const segPath = saveDicomObjectFromWebhook(result.dicomSegBase64, "ai_seg_primary", studyId, "DICOM SEG");
      if (segPath) {
        metadataPatch.aiDicomSegPath = segPath;
        metadataPatch.aiDicomSegSizeBytes = result.dicomSegSizeBytes;
      }
    }

    if (result.dicomScBase64) {
      const scPath = saveDicomObjectFromWebhook(
        result.dicomScBase64,
        "ai_sc_primary",
        studyId,
        "AI Heatmap (Secondary Capture)",
      );
      if (scPath) {
        metadataPatch.aiDicomScPath = scPath;
        metadataPatch.aiDicomScSizeBytes = result.dicomScSizeBytes;
      }
    }

    if (result.dicomGspsBase64) {
      const gspsPath = saveDicomObjectFromWebhook(result.dicomGspsBase64, "ai_gsps_primary", studyId, "GSPS Annotations");
      if (gspsPath) {
        metadataPatch.aiDicomGspsPath = gspsPath;
        metadataPatch.aiDicomGspsSizeBytes = result.dicomGspsSizeBytes;
      }
    }

    if (result.heatmapPngBase64) {
      metadataPatch.aiHeatmapPngBase64 = result.heatmapPngBase64;
    }

    const perImageResult: Record<string, unknown> = {
      sourceFile: fileBasename,
      model: result.model,
      summary: result.summary,
      findings: result.findings,
      processedAt: result.processedAt,
      studyInstanceUid: studyId,
    };
    if (metadataPatch.aiDicomSegPath) perImageResult.dicomSegPath = metadataPatch.aiDicomSegPath;
    if (metadataPatch.aiDicomSrPath) perImageResult.dicomSrPath = metadataPatch.aiDicomSrPath;
    if (metadataPatch.aiDicomScPath) perImageResult.dicomScPath = metadataPatch.aiDicomScPath;
    if (metadataPatch.aiDicomGspsPath) perImageResult.dicomGspsPath = metadataPatch.aiDicomGspsPath;
    if (result.heatmapPngBase64) perImageResult.heatmapAvailable = true;

    clearDimCache();
    await persistWebhookAiMetadata(store, studyId, metadataPatch, perImageResult, options).catch(() => {});

    logger.info({
      message: "Webhook MONAI: representative image analysis complete",
      studyId,
      file: fileBasename,
      findingsCount: result.findings.length,
      heatmapGenerated: !!result.heatmapPngBase64,
      segGenerated: !!result.dicomSegBase64,
      srGenerated: !!result.dicomSrBase64,
      scGenerated: !!result.dicomScBase64,
    });
  } catch (err) {
    logger.error({ message: "Webhook MONAI: analysis error", studyId, file: fileBasename, error: String(err) });
  }
}

export function webhookRouter(
  reportService: ReportService,
  dicoogle: DicoogleService,
  monaiService?: MonaiService,
  store?: StoreService,
): Router {
  const router = Router();

  router.post("/study", asyncHandler(async (req, res) => {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers["x-webhook-secret"] as string | undefined;
      if (provided !== webhookSecret) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }
    }

    const payload = webhookSchema.parse(req.body);
    const metadata = payload.metadata ?? (await dicoogle.fetchStudyMetadata(payload.studyId).catch(() => ({})));
    let resolvedTenantId: string | undefined;
    let resolvedTenantStore: TenantScopedStore | undefined;
    const draftMetadata = {
      ...metadata,
      reportStatus: "draft",
      source: "dicoogle-webhook",
      receivedAt: new Date().toISOString(),
      ...(payload.tenantSlug ? { tenantSlug: payload.tenantSlug } : {}),
    };

    // Multi-tenant: resolve tenant from the slug embedded by the Lua webhook
    if (env.MULTI_TENANT_ENABLED && payload.tenantSlug) {
      try {
        const { getFirestore } = await import("../services/firebaseAdmin");
        const db = getFirestore();
        const snapshot = await db.collection("tenants_meta")
          .where("slug", "==", payload.tenantSlug)
          .where("is_active", "==", true)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const tenantId = snapshot.docs[0].id;
          resolvedTenantId = tenantId;
          resolvedTenantStore = new TenantScopedStore();
          await resolvedTenantStore.upsertStudy(tenantId, {
            studyInstanceUid: payload.studyId,
            patientName: (metadata as Record<string, unknown>).patientName as string | undefined,
            studyDate: (metadata as Record<string, unknown>).studyDate as string | undefined,
            modality: (metadata as Record<string, unknown>).modality as string | undefined,
            location: (metadata as Record<string, unknown>).aeTitle as string | undefined,
            status: "unassigned",
            metadata: draftMetadata,
          });
          logger.info({
            message: "Webhook: tenant-scoped study upserted",
            tenantSlug: payload.tenantSlug,
            tenantId,
            studyId: payload.studyId,
          });
        }
      } catch (err) {
        logger.warn({
          message: "Webhook: failed to upsert tenant-scoped study",
          tenantSlug: payload.tenantSlug,
          error: String(err),
        });
      }
    }

    const report = await reportService.createReport({
      studyId: payload.studyId,
      content: "",
      ownerId: payload.ownerId,
      metadata: draftMetadata,
    });

    // Auto-trigger MONAI analysis in background (non-blocking)
    if (monaiService && store) {
      runAutoMonaiAnalysis(monaiService, store, payload.studyId, {
        tenantSlug: payload.tenantSlug,
        tenantId: resolvedTenantId,
        tenantStore: resolvedTenantStore,
      }).catch((err) => {
        logger.error({ message: "Webhook MONAI: background analysis error", studyId: payload.studyId, error: String(err) });
      });
    }

    res.status(201).json({ message: "Draft report created", report });
  }));

  return router;
}
