import { Router } from "express";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import dicomParser from "dicom-parser";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import type { GatewayRequest } from "../middleware/apiGateway";
import { StoreService } from "../services/store";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { ServiceRegistry } from "../services/serviceRegistry";
import { StorageService } from "../services/storageService";
import { MonaiService } from "../services/monaiService";
import { logger } from "../services/logger";
import { clearDimCache, registerExtraDicomFile } from "./dicomweb";

/**
 * Dicoogle ingests DICOM files from the filesystem, not via a REST upload
 * endpoint. The flow is:
 *   1. Write .dcm files to Dicoogle's storage directory.
 *   2. POST /management/tasks/index?uri=<dir> to trigger indexing.
 */
const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");

const STORAGE_ROOT = path.resolve(DICOOGLE_STORAGE_DIR);
const TENANT_STORAGE_ROOT = path.resolve(env.TENANT_STORAGE_ROOT || STORAGE_ROOT);

/** file:// URI passed to Dicoogle’s index task — must be a path on the Dicoogle server, not the reporting backend. */
function storageDirToDefaultFileUri(root: string): string {
  return `file:///${path.resolve(root).replace(/\\/g, "/")}`;
}

const MAX_UPLOAD_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_DICOM_HEADER_READ_BYTES = 8 * 1024 * 1024;

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function hasKnownDicomExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".dcm") ||
    lower.endsWith(".dicom") ||
    lower.endsWith(".ima") ||
    lower.endsWith(".img")
  );
}

function buildStoredFilename(originalName: string): string {
  const safeName = sanitizeFilename(originalName);
  const stamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const normalizedName = hasKnownDicomExtension(safeName) ? safeName : `${safeName}.dcm`;
  return `${stamp}-${randomSuffix}-${normalizedName}`;
}

function isInsideStorageDirectory(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved === STORAGE_ROOT || resolved.startsWith(`${STORAGE_ROOT}${path.sep}`);
}

function normalizeStudyDate(rawStudyDate?: string): string {
  if (typeof rawStudyDate === "string" && /^\d{8}$/.test(rawStudyDate)) {
    return `${rawStudyDate.slice(0, 4)}-${rawStudyDate.slice(4, 6)}-${rawStudyDate.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);
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
        // Ignore cleanup failures
      }
    }
  }
}

const LONG_VR_TYPES = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UN", "UR", "UT"]);

/** DICOM UID from UUID (OID 2.25) — suitable for Study, Series, or SOP Instance UID. */
function newDicomUid(): string {
  const hex = randomUUID().replace(/-/g, "");
  return `2.25.${BigInt(`0x${hex}`).toString()}`;
}

function newSopInstanceUid(): string {
  return newDicomUid();
}

function normalizeDicomUid(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  const normalized = rawValue.replace(/\0/g, "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

const PLACEHOLDER_PATIENT_IDS = new Set(["UNKNOWN", "ANON", "ANONYMOUS", "NONE", "NA", "N/A", "UNSPECIFIED"]);
const NON_DIAGNOSTIC_SERIES_HINTS = ["ai heatmap", "gradcam", "secondary capture", "structured report", "segmentation"];
const AUTO_ANALYSIS_DEDUP_WINDOW_MS = 15 * 60 * 1000;

function isUsablePatientId(patientId: string | undefined): boolean {
  if (!patientId) return false;
  const normalized = patientId.trim().toUpperCase();
  if (!normalized) return false;
  return !PLACEHOLDER_PATIENT_IDS.has(normalized);
}

function buildSyntheticUploadPatientId(): string {
  return `UPL-${Date.now().toString(36).toUpperCase()}`;
}

interface DicomRepresentativeCandidate {
  filePath: string;
  area: number;
  instanceNumber: number | null;
}

function pickRepresentativeDicomFile(dicomFilePaths: string[]): string | null {
  const candidates: DicomRepresentativeCandidate[] = [];

  for (const filePath of dicomFilePaths) {
    const dataSet = readDicomHeaderDataSet(filePath);
    if (!dataSet) continue;

    const modality = (dataSet.string("x00080060") ?? "").trim().toUpperCase();
    const sopClassUid = normalizeDicomUid(dataSet.string("x00080016"));
    const seriesDescription = (dataSet.string("x0008103e") ?? "").trim().toLowerCase();

    if (modality === "SR" || modality === "PR") continue;
    if (
      sopClassUid?.startsWith("1.2.840.10008.5.1.4.1.1.88")
      || sopClassUid === "1.2.840.10008.5.1.4.1.1.11.1"
      || sopClassUid === "1.2.840.10008.5.1.4.1.1.11.2"
    ) {
      continue;
    }
    if (NON_DIAGNOSTIC_SERIES_HINTS.some((hint) => seriesDescription.includes(hint))) {
      continue;
    }

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
    return dicomFilePaths.find((filePath) => fs.existsSync(filePath)) ?? null;
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

/**
 * Rewrite Patient ID / Name and/or assign a fresh SOP Instance UID on upload.
 *
 * Optionally rewrite Study / Series Instance UIDs so a multi-file upload shares
 * one study and series when headers would otherwise split the batch across
 * multiple studies (OHIF then loads every slice in one viewer session).
 *
 * Dicoogle (and most PACS) key instances by SOP Instance UID.  Multiple
 * files that share the same UID (common when copying the same export)
 * collapse to a single instance in the viewer.  We assign a new UID per
 * file and, for DICOM Part 10 files, update Media Storage SOP Instance UID
 * (0002,0003) to match the dataset (0008,0018).
 *
 * Patient tags: if the new value is shorter than or equal to the existing
 * allocation it is padded in-place; if longer the length field is resized.
 */
function rewriteDicomUploadTags(
  filePath: string,
  options: {
    patientId?: string;
    patientName?: string;
    sopInstanceUid?: string;
    studyInstanceUid?: string;
    seriesInstanceUid?: string;
  },
): boolean {
  const {
    patientId: newPatientId,
    patientName: newPatientName,
    sopInstanceUid: newSopUid,
    studyInstanceUid: newStudyUid,
    seriesInstanceUid: newSeriesUid,
  } = options;
  if (!newPatientId && !newPatientName && !newSopUid && !newStudyUid && !newSeriesUid) return false;

  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(filePath);
  } catch {
    return false;
  }

  const byteArray = new Uint8Array(
    fileBuffer.buffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength,
  );
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
  } catch {
    return false;
  }

  interface TagRewrite {
    element: dicomParser.Element;
    newValue: string;
  }

  const rewrites: TagRewrite[] = [];

  if (newPatientId) {
    const el = dataSet.elements["x00100020"];
    if (el && el.dataOffset != null && el.length >= 0) {
      const current = (dataSet.string("x00100020") ?? "").trim();
      if (current !== newPatientId.trim()) {
        rewrites.push({ element: el, newValue: newPatientId });
      }
    }
  }

  if (newPatientName) {
    const el = dataSet.elements["x00100010"];
    if (el && el.dataOffset != null && el.length >= 0) {
      const current = (dataSet.string("x00100010") ?? "").trim();
      if (current !== newPatientName.trim()) {
        rewrites.push({ element: el, newValue: newPatientName });
      }
    }
  }

  if (newSopUid) {
    const uid = newSopUid.trim();
    for (const tag of ["x00080018", "x00020003"] as const) {
      const el = dataSet.elements[tag];
      if (el && el.dataOffset != null && el.length >= 0) {
        rewrites.push({ element: el, newValue: uid });
      }
    }
  }

  if (newStudyUid) {
    const uid = newStudyUid.trim();
    const el = dataSet.elements["x0020000d"];
    if (el && el.dataOffset != null && el.length >= 0) {
      const current = (dataSet.string("x0020000d") ?? "").trim();
      if (current !== uid) {
        rewrites.push({ element: el, newValue: uid });
      }
    } else {
      logger.warn({
        message: "DICOM upload: StudyInstanceUID tag missing; file not merged into batch study",
        file: path.basename(filePath),
      });
    }
  }

  if (newSeriesUid) {
    const uid = newSeriesUid.trim();
    const el = dataSet.elements["x0020000e"];
    if (el && el.dataOffset != null && el.length >= 0) {
      const current = (dataSet.string("x0020000e") ?? "").trim();
      if (current !== uid) {
        rewrites.push({ element: el, newValue: uid });
      }
    } else {
      logger.warn({
        message: "DICOM upload: SeriesInstanceUID tag missing; file not merged into batch series",
        file: path.basename(filePath),
      });
    }
  }

  if (rewrites.length === 0) return false;

  // Process from end-of-file backwards so earlier offsets stay valid after resizes
  rewrites.sort((a, b) => b.element.dataOffset - a.element.dataOffset);

  let buf = Buffer.from(fileBuffer);

  for (const { element, newValue } of rewrites) {
    let padded = newValue;
    if (padded.length % 2 !== 0) padded += " ";
    const newBuf = Buffer.from(padded, "latin1");

    const oldDataOffset = element.dataOffset;
    const oldLength = element.length;

    if (newBuf.length <= oldLength) {
      // Fits within existing allocation — overwrite and space-pad the remainder
      const paddedBuf = Buffer.alloc(oldLength, 0x20);
      newBuf.copy(paddedBuf);
      paddedBuf.copy(buf, oldDataOffset);
    } else {
      // Longer value — determine length-field position, resize the region
      let lengthFieldOffset: number;
      let lengthFieldSize: number;

      if (element.vr) {
        if (LONG_VR_TYPES.has(element.vr)) {
          lengthFieldOffset = oldDataOffset - 4;
          lengthFieldSize = 4;
        } else {
          lengthFieldOffset = oldDataOffset - 2;
          lengthFieldSize = 2;
        }
      } else {
        lengthFieldOffset = oldDataOffset - 4;
        lengthFieldSize = 4;
      }

      const before = buf.subarray(0, lengthFieldOffset);
      const lengthBuf = Buffer.alloc(lengthFieldSize);
      if (lengthFieldSize === 2) {
        lengthBuf.writeUInt16LE(newBuf.length);
      } else {
        lengthBuf.writeUInt32LE(newBuf.length);
      }
      const after = buf.subarray(oldDataOffset + oldLength);
      buf = Buffer.concat([before, lengthBuf, newBuf, after]);
    }
  }

  try {
    fs.writeFileSync(filePath, buf);
    return true;
  } catch {
    return false;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(DICOOGLE_STORAGE_DIR, { recursive: true });
        cb(null, DICOOGLE_STORAGE_DIR);
      } catch (err) {
        cb(
          err instanceof Error ? err : new Error("Failed to prepare DICOM storage directory"),
          DICOOGLE_STORAGE_DIR,
        );
      }
    },
    filename: (_req, file, cb) => {
      cb(null, buildStoredFilename(file.originalname));
    },
  }),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES }, // 500 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/dicom", "application/octet-stream"];
    if (
      allowed.includes(file.mimetype) ||
      hasKnownDicomExtension(file.originalname) ||
      !path.extname(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only DICOM (.dcm) files are allowed"));
    }
  },
});

const AI_OUTPUT_DIR = path.join(STORAGE_ROOT, "ai-sr");

function ensureAiOutputDir() {
  if (!fs.existsSync(AI_OUTPUT_DIR)) {
    fs.mkdirSync(AI_OUTPUT_DIR, { recursive: true });
  }
}

function sanitizeStudyId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function saveUploadAiDicomObject(b64: string, prefix: string, studyId: string, label: string): string | null {
  try {
    ensureAiOutputDir();
    const filename = `${prefix}_${sanitizeStudyId(studyId)}_${Date.now()}.dcm`;
    const filePath = path.join(AI_OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
    logger.info({ message: `Upload MONAI: ${label} saved`, path: filePath });
    registerExtraDicomFile(filePath);
    return filePath;
  } catch (err) {
    logger.error({ message: `Upload MONAI: failed to save ${label}`, error: String(err) });
    return null;
  }
}

interface UploadMonaiStudyTarget {
  studyRecordId: string;
  studyInstanceUid: string;
  tenantId?: string;
  tenantStore?: TenantScopedStore;
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

async function persistUploadAiMetadata(
  store: StoreService,
  studyTarget: UploadMonaiStudyTarget,
  metadataPatch: Record<string, unknown>,
  perImageResult: Record<string, unknown>,
): Promise<void> {
  if (studyTarget.tenantStore && studyTarget.tenantId) {
    const tenantStudy =
      (await studyTarget.tenantStore.getStudy(studyTarget.tenantId, studyTarget.studyRecordId))
      ?? (await studyTarget.tenantStore.getStudyByUid(studyTarget.tenantId, studyTarget.studyInstanceUid));
    if (tenantStudy) {
      const existingMetadata = (tenantStudy.metadata ?? {}) as Record<string, unknown>;
      const mergedMetadata = mergeAiMetadata(existingMetadata, metadataPatch, perImageResult);
      await studyTarget.tenantStore.upsertStudy(studyTarget.tenantId, {
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

  const lookupIds = Array.from(new Set([studyTarget.studyRecordId, studyTarget.studyInstanceUid].filter(Boolean)));
  let targetStudyId = studyTarget.studyRecordId || studyTarget.studyInstanceUid;
  let existingMetadata: Record<string, unknown> | undefined;
  for (const id of lookupIds) {
    const existingRecord = await store.getStudyRecord(id).catch(() => null);
    if (existingRecord) {
      targetStudyId = id;
      existingMetadata = (existingRecord.metadata ?? {}) as Record<string, unknown>;
      break;
    }
  }
  const mergedMetadata = mergeAiMetadata(existingMetadata, metadataPatch, perImageResult);
  await store.upsertStudyRecord(targetStudyId, { metadata: mergedMetadata });
}

async function getUploadStudyMetadata(
  store: StoreService,
  studyTarget: UploadMonaiStudyTarget,
): Promise<Record<string, unknown> | undefined> {
  if (studyTarget.tenantStore && studyTarget.tenantId) {
    const tenantStudy =
      (await studyTarget.tenantStore.getStudy(studyTarget.tenantId, studyTarget.studyRecordId))
      ?? (await studyTarget.tenantStore.getStudyByUid(studyTarget.tenantId, studyTarget.studyInstanceUid));
    return (tenantStudy?.metadata ?? undefined) as Record<string, unknown> | undefined;
  }

  const lookupIds = Array.from(new Set([studyTarget.studyRecordId, studyTarget.studyInstanceUid].filter(Boolean)));
  for (const id of lookupIds) {
    const existingRecord = await store.getStudyRecord(id).catch(() => null);
    if (existingRecord?.metadata && typeof existingRecord.metadata === "object") {
      return existingRecord.metadata as Record<string, unknown>;
    }
  }

  return undefined;
}

function hasRecentStudyAutoAnalysis(
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

function cleanUploadAiArtifactsForStudy(studyId: string): void {
  if (!fs.existsSync(AI_OUTPUT_DIR)) return;
  const safeStudyId = sanitizeStudyId(studyId);
  const marker = `_${safeStudyId}_`;
  for (const filename of fs.readdirSync(AI_OUTPUT_DIR)) {
    if (!filename.endsWith(".dcm")) continue;
    if (!filename.startsWith("ai_")) continue;
    if (!filename.includes(marker)) continue;
    try {
      fs.unlinkSync(path.join(AI_OUTPUT_DIR, filename));
    } catch {
      // Ignore cleanup failures; newest artifact still gets written.
    }
  }
}

async function runAutoMonaiOnUpload(
  monaiService: MonaiService,
  store: StoreService,
  studyTarget: UploadMonaiStudyTarget,
  dicomFilePath: string,
): Promise<void> {
  if (!monaiService.isEnabled()) return;

  const fileBasename = path.basename(dicomFilePath);
  try {
    const existingMetadata = await getUploadStudyMetadata(store, studyTarget);
    if (hasRecentStudyAutoAnalysis(existingMetadata, fileBasename)) {
      logger.info({
        message: "Upload MONAI: skipping duplicate auto-analysis",
        studyId: studyTarget.studyRecordId,
        studyInstanceUid: studyTarget.studyInstanceUid,
        file: fileBasename,
      });
      return;
    }

    const dicomBuffer = fs.readFileSync(dicomFilePath);

    const result = await monaiService.analyzeDicomAutoRoute(
      dicomBuffer, fileBasename, studyTarget.studyInstanceUid,
    );

    if (result.status !== "completed") {
      logger.warn({
        message: "Upload MONAI: auto-route did not complete",
        studyId: studyTarget.studyRecordId,
        studyInstanceUid: studyTarget.studyInstanceUid,
        file: fileBasename,
        status: result.status,
        summary: result.summary,
      });
      return;
    }

    cleanUploadAiArtifactsForStudy(studyTarget.studyInstanceUid);

    // Build metadata — even 0 findings is a valid result ("no abnormalities")
    const metadataPatch: Record<string, unknown> = {
      aiFindings: result.findings,
      aiSummary: result.summary,
      aiModel: result.model,
      aiAutoRun: true,
      aiProcessedAt: result.processedAt,
      aiSourceFile: fileBasename,
      aiStudyInstanceUid: studyTarget.studyInstanceUid,
    };

    if (result.dicomSrBase64) {
      const p = saveUploadAiDicomObject(
        result.dicomSrBase64,
        "ai_sr_primary",
        studyTarget.studyInstanceUid,
        "DICOM SR",
      );
      if (p) { metadataPatch.aiDicomSrPath = p; metadataPatch.aiDicomSrSizeBytes = result.dicomSrSizeBytes; }
    }
    if (result.dicomSegBase64) {
      const p = saveUploadAiDicomObject(
        result.dicomSegBase64,
        "ai_seg_primary",
        studyTarget.studyInstanceUid,
        "DICOM SEG",
      );
      if (p) { metadataPatch.aiDicomSegPath = p; metadataPatch.aiDicomSegSizeBytes = result.dicomSegSizeBytes; }
    }
    if (result.dicomScBase64) {
      const p = saveUploadAiDicomObject(
        result.dicomScBase64,
        "ai_sc_primary",
        studyTarget.studyInstanceUid,
        "AI Heatmap",
      );
      if (p) { metadataPatch.aiDicomScPath = p; metadataPatch.aiDicomScSizeBytes = result.dicomScSizeBytes; }
    }
    if (result.dicomGspsBase64) {
      const p = saveUploadAiDicomObject(
        result.dicomGspsBase64,
        "ai_gsps_primary",
        studyTarget.studyInstanceUid,
        "GSPS Annotations",
      );
      if (p) { metadataPatch.aiDicomGspsPath = p; metadataPatch.aiDicomGspsSizeBytes = result.dicomGspsSizeBytes; }
    }
    if (result.heatmapPngBase64) metadataPatch.aiHeatmapPngBase64 = result.heatmapPngBase64;

    const perImageResult: Record<string, unknown> = {
      sourceFile: fileBasename,
      model: result.model,
      summary: result.summary,
      findings: result.findings,
      processedAt: result.processedAt,
      studyInstanceUid: studyTarget.studyInstanceUid,
    };
    if (metadataPatch.aiDicomSegPath) perImageResult.dicomSegPath = metadataPatch.aiDicomSegPath;
    if (metadataPatch.aiDicomSrPath) perImageResult.dicomSrPath = metadataPatch.aiDicomSrPath;
    if (metadataPatch.aiDicomScPath) perImageResult.dicomScPath = metadataPatch.aiDicomScPath;
    if (metadataPatch.aiDicomGspsPath) perImageResult.dicomGspsPath = metadataPatch.aiDicomGspsPath;
    if (result.heatmapPngBase64) perImageResult.heatmapAvailable = true;

    clearDimCache();
    await persistUploadAiMetadata(store, studyTarget, metadataPatch, perImageResult).catch(() => {});
    logger.info({
      message: "Upload MONAI: auto-analysis complete",
      studyId: studyTarget.studyRecordId,
      studyInstanceUid: studyTarget.studyInstanceUid,
      file: fileBasename,
      model: result.model,
      findingsCount: result.findings.length,
      heatmapGenerated: !!result.heatmapPngBase64,
      segGenerated: !!result.dicomSegBase64,
      srGenerated: !!result.dicomSrBase64,
      scGenerated: !!result.dicomScBase64,
    });
  } catch (err) {
    logger.error({
      message: "Upload MONAI: auto-analysis failed",
      studyId: studyTarget.studyRecordId,
      studyInstanceUid: studyTarget.studyInstanceUid,
      file: fileBasename,
      error: String(err),
    });
  }
}

export function dicomUploadRouter(
  store: StoreService,
  serviceRegistry: ServiceRegistry,
  storageService: StorageService,
  tenantStore?: TenantScopedStore,
  monaiService?: MonaiService,
): Router {
  const router = Router();

  router.post(
    "/upload",
    ensureAuthenticated,
    ensurePermission(store, "dicom:upload"),
    upload.array("files", 50),
    asyncHandler(async (req, res) => {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "No DICOM files provided" });
        return;
      }

      // Ensure the storage directory exists
      fs.mkdirSync(DICOOGLE_STORAGE_DIR, { recursive: true });

      const results: Array<{ filename: string; status: string; error?: string }> = [];
      const filePatientIds = new Map<string, string>();

      for (const file of files) {
        try {
          const storedPath = file.path;
          if (!storedPath) {
            results.push({ filename: file.originalname, status: "failed", error: "Missing stored file path" });
            continue;
          }
          if (!isInsideStorageDirectory(storedPath)) {
            results.push({ filename: file.originalname, status: "rejected", error: "Invalid stored file path" });
            continue;
          }
          results.push({ filename: file.originalname, status: "stored" });

          const dataSet = readDicomHeaderDataSet(storedPath);
          if (dataSet) {
            const dicomPatientId = dataSet.string("x00100020")?.trim();
            if (dicomPatientId) {
              filePatientIds.set(storedPath, dicomPatientId);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({ filename: file.originalname, status: "failed", error: message });
        }
      }

      const uploaderId = req.session?.user?.id ?? "unknown";
      const gwReq = req as GatewayRequest;
      const tenantId = gwReq.tenantId;
      const tenantSlug = gwReq.tenantSlug;
      const formPatientId = typeof req.body?.patientId === "string" ? req.body.patientId.trim() : undefined;
      const formPatientName = typeof req.body?.patientName === "string" ? req.body.patientName.trim() : undefined;
      const storedCount = results.filter((r) => r.status === "stored").length;
      const detectedPatientIds = Array.from(
        new Set(
          Array.from(filePatientIds.values())
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );
      const usableDetectedPatientIds = detectedPatientIds.filter((value) => isUsablePatientId(value));
      const effectiveUploadPatientId = formPatientId
        || (usableDetectedPatientIds.length === 1 ? usableDetectedPatientIds[0] : buildSyntheticUploadPatientId());
      let linkedRegistryPatient: Awaited<ReturnType<StoreService["getPatientByMrn"]>> | null = null;
      const linkedRegistryPatientMeta = (
        effectivePatientId: string | undefined,
      ): Record<string, unknown> => {
        if (!linkedRegistryPatient || !effectivePatientId) return {};
        const normalizedRegistryMrn = linkedRegistryPatient.patientId.trim().toUpperCase();
        const normalizedEffectivePatientId = effectivePatientId.trim().toUpperCase();
        if (normalizedRegistryMrn !== normalizedEffectivePatientId) return {};
        return {
          patientRegistryId: linkedRegistryPatient.id,
          patientDateOfBirth: linkedRegistryPatient.dateOfBirth,
          ...(linkedRegistryPatient.phone ? { patientPhone: linkedRegistryPatient.phone } : {}),
          ...(linkedRegistryPatient.email ? { patientEmail: linkedRegistryPatient.email } : {}),
          ...(linkedRegistryPatient.address ? { patientAddress: linkedRegistryPatient.address } : {}),
        };
      };
      const serviceConfig = await serviceRegistry.getConfig();
      const storageMode = serviceConfig.storage.mode;
      const cloudBucket = serviceConfig.storage.cloudBucket;
      const cloudPrefix = serviceConfig.storage.cloudPrefix.replace(/^\/+|\/+$/g, "");

      // Resolve tenant-specific storage root when multi-tenant is enabled.
      const effectiveStorageRoot = (env.MULTI_TENANT_ENABLED && tenantSlug)
        ? path.join(TENANT_STORAGE_ROOT, tenantSlug)
        : STORAGE_ROOT;

      if (env.MULTI_TENANT_ENABLED && tenantSlug) {
        fs.mkdirSync(effectiveStorageRoot, { recursive: true });
        logger.info({
          message: "Tenant-scoped DICOM upload",
          tenantSlug,
          storageRoot: effectiveStorageRoot,
          fileCount: files.length,
          storageMode,
        });
      }

      // Always normalize each upload batch into one fresh Study/Series UID pair.
      // This prevents cross-patient collisions when source DICOM headers reuse
      // non-unique StudyInstanceUID values.
      const shouldNormalizeBatchStudySeries = storedCount > 0;
      const batchStudyUid = shouldNormalizeBatchStudySeries ? newDicomUid() : undefined;
      const batchSeriesUid = shouldNormalizeBatchStudySeries ? newDicomUid() : undefined;
      if (shouldNormalizeBatchStudySeries && batchStudyUid && batchSeriesUid) {
        logger.info({
          message: "DICOM upload: assigning fresh Study/Series UIDs",
          fileCount: storedCount,
          studyInstanceUID: batchStudyUid,
          seriesInstanceUID: batchSeriesUid,
          patientId: effectiveUploadPatientId,
        });
      }

      let rewriteAppliedCount = 0;
      for (let i = 0; i < files.length; i++) {
        if (results[i]?.status !== "stored") continue;
        const file = files[i];
        if (!file.path || !fs.existsSync(file.path)) continue;
        const rewriteApplied = rewriteDicomUploadTags(file.path, {
          patientId: effectiveUploadPatientId,
          ...(formPatientName ? { patientName: formPatientName } : {}),
          sopInstanceUid: newSopInstanceUid(),
          ...(shouldNormalizeBatchStudySeries && batchStudyUid && batchSeriesUid
            ? { studyInstanceUid: batchStudyUid, seriesInstanceUid: batchSeriesUid }
            : {}),
        });
        filePatientIds.set(file.path, effectiveUploadPatientId);
        if (rewriteApplied) {
          rewriteAppliedCount += 1;
        }
      }

      if (shouldNormalizeBatchStudySeries && batchStudyUid && batchSeriesUid) {
        logger.info({
          message: "DICOM upload: completed patient + UID normalization",
          fileCount: storedCount,
          rewriteAppliedCount,
          studyInstanceUID: batchStudyUid,
          seriesInstanceUID: batchSeriesUid,
          patientId: effectiveUploadPatientId,
        });
      }

      const studyMap = new Map<
        string,
        {
          patientId?: string;
          patientName?: string;
          modality?: string;
          description?: string;
          studyDate?: string;
          fileCount: number;
        }
      >();
      for (let i = 0; i < files.length; i++) {
        if (results[i]?.status !== "stored") continue;
        const file = files[i];
        if (!file.path || !fs.existsSync(file.path)) continue;
        const dataSet = readDicomHeaderDataSet(file.path);
        if (!dataSet) continue;
        const studyUID = normalizeDicomUid(dataSet.string("x0020000d"));
        if (!studyUID) continue;
        const dicomPatientId = dataSet.string("x00100020")?.trim();
        const existing = studyMap.get(studyUID);
        if (existing) {
          existing.fileCount++;
          if (!existing.patientId && dicomPatientId) {
            existing.patientId = dicomPatientId;
          }
        } else {
          studyMap.set(studyUID, {
            patientId: dicomPatientId,
            patientName: dataSet.string("x00100010"),
            modality: dataSet.string("x00080060"),
            description: dataSet.string("x00081030"),
            studyDate: dataSet.string("x00080020"),
            fileCount: 1,
          });
        }
      }

      // Organize uploaded files into patient-specific subdirectories
      // under the (optionally tenant-scoped) storage root.
      const finalStoredPaths: string[] = [];
      for (const file of files) {
        if (!file.path || !fs.existsSync(file.path)) continue;
        const originalPath = file.path;
        const pid = effectiveUploadPatientId || filePatientIds.get(originalPath);
        let resolvedPath = originalPath;

        if (!pid) {
          // Even without a patient ID, move to tenant directory
          if (env.MULTI_TENANT_ENABLED && tenantSlug && effectiveStorageRoot !== STORAGE_ROOT) {
            const newPath = path.join(effectiveStorageRoot, path.basename(originalPath));
            if (newPath !== originalPath) {
              try {
                fs.renameSync(originalPath, newPath);
                resolvedPath = newPath;
              } catch {
                // File stays in flat dir.
              }
            }
          }
          file.path = resolvedPath;
          if (fs.existsSync(resolvedPath)) finalStoredPaths.push(resolvedPath);
          continue;
        }

        const safePid = pid.replace(/[^a-zA-Z0-9._-]/g, "_");
        const patientDir = path.join(effectiveStorageRoot, safePid);
        fs.mkdirSync(patientDir, { recursive: true });
        const newPath = path.join(patientDir, path.basename(originalPath));
        if (newPath !== originalPath) {
          try {
            fs.renameSync(originalPath, newPath);
            resolvedPath = newPath;
          } catch {
            // File stays in flat directory — still visible to filesystem scanner
          }
        }
        file.path = resolvedPath;
        if (fs.existsSync(resolvedPath)) finalStoredPaths.push(resolvedPath);
      }

      let cloudUploadedCount = 0;
      const cloudUploadErrors: Array<{ filename: string; error: string }> = [];
      if (storageMode === "cloud") {
        const cloudRoot = [cloudPrefix, tenantSlug ?? "default"].filter(Boolean).join("/");
        for (const filePath of finalStoredPaths) {
          const relativeFromTenantRoot = path.relative(effectiveStorageRoot, filePath).replace(/\\/g, "/");
          const destinationPath = [cloudRoot, relativeFromTenantRoot || path.basename(filePath)].join("/");
          try {
            await storageService.uploadFile(filePath, destinationPath, "application/dicom", cloudBucket);
            cloudUploadedCount += 1;
          } catch (err) {
            cloudUploadErrors.push({
              filename: path.basename(filePath),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info({
          message: "Cloud DICOM replication complete",
          storageMode,
          tenantSlug: tenantSlug ?? null,
          cloudBucket,
          cloudPrefix: cloudRoot,
          uploadedCount: cloudUploadedCount,
          attemptedCount: finalStoredPaths.length,
          errorCount: cloudUploadErrors.length,
        });
      }

      // Trigger Dicoogle re-indexing. URI must match Dicoogle’s configured root-dir
      // (see packages/dicoogle-server/config/filestorage.xml), not necessarily the
      // path where this Node process writes when using split containers + bind mounts.
      const dicoogleBase = env.DICOOGLE_BASE_URL;
      const configuredIndexRoot = env.DICOOGLE_INDEX_URI?.trim();
      const indexUri = (env.MULTI_TENANT_ENABLED && tenantSlug)
        ? (configuredIndexRoot
            ? `${configuredIndexRoot.replace(/\/+$/, "")}/${tenantSlug}`
            : storageDirToDefaultFileUri(effectiveStorageRoot))
        : configuredIndexRoot || storageDirToDefaultFileUri(STORAGE_ROOT);
      try {
        await axios.post(`${dicoogleBase}/management/tasks/index`, null, {
          params: { uri: indexUri },
          timeout: 120_000,
        });
      } catch (err) {
        logger.warn({
          message: "Dicoogle index request failed; new files may be missing until a manual index runs",
          indexUri,
          dicoogleBase,
          tenantSlug: tenantSlug ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Clear the DICOMweb DIM cache so OHIF picks up new files
      clearDimCache();

      // Auto-create or reuse the patient registry entry so uploads stay bound
      // to one stable patient identity (MRN + registry ID).
      if (effectiveUploadPatientId && formPatientName && (!env.MULTI_TENANT_ENABLED || !tenantId || !tenantStore)) {
        linkedRegistryPatient = await store.getPatientByMrn(effectiveUploadPatientId);
        if (!linkedRegistryPatient) {
          const nameParts = formPatientName.trim().split(/\s+/);
          const firstName = nameParts[0] ?? formPatientName;
          const lastName = nameParts.slice(1).join(" ") || firstName;
          try {
            linkedRegistryPatient = await store.createPatient({
              patientId: effectiveUploadPatientId,
              firstName,
              lastName,
              dateOfBirth: "1900-01-01",
              gender: "O",
            });
          } catch {
            // Ignore if race-condition duplicate or other error
          }
        }
      } else if (effectiveUploadPatientId && (!env.MULTI_TENANT_ENABLED || !tenantId || !tenantStore)) {
        linkedRegistryPatient = await store.getPatientByMrn(effectiveUploadPatientId);
      }

      // Create study records using real StudyInstanceUIDs from DICOM headers
      const createdStudies: UploadMonaiStudyTarget[] = [];
      const fallbackPatientId = effectiveUploadPatientId ?? filePatientIds.values().next().value;
      const linkedRegistryPatientName = linkedRegistryPatient
        ? `${linkedRegistryPatient.firstName} ${linkedRegistryPatient.lastName}`.trim()
        : undefined;
      const useTenantStudyStore = Boolean(env.MULTI_TENANT_ENABLED && tenantId && tenantStore);
      if (studyMap.size > 0) {
        for (const [studyUID, info] of studyMap) {
          const effectivePatientId = effectiveUploadPatientId ?? info.patientId;
          const normalizedStudyDate = normalizeStudyDate(info.studyDate);
          const patientDisplayName =
            formPatientName
            || linkedRegistryPatientName
            || info.patientName
            || `Patient ${effectivePatientId ?? "Unknown"}`;
          const description = info.description ?? `DICOM Upload (${info.fileCount} image${info.fileCount > 1 ? "s" : ""})`;
          if (useTenantStudyStore && tenantStore && tenantId) {
            const tenantStudy = await tenantStore.upsertStudy(tenantId, {
              studyInstanceUid: studyUID,
              patientName: patientDisplayName,
              studyDate: normalizedStudyDate,
              modality: info.modality ?? "OT",
              description,
              status: "unassigned",
              uploaderId,
              metadata: {
                patientId: effectivePatientId,
                fileCount: info.fileCount,
                ...linkedRegistryPatientMeta(effectivePatientId),
              },
            });
            createdStudies.push({
              studyRecordId: tenantStudy.id,
              studyInstanceUid: tenantStudy.study_instance_uid,
              tenantId,
              tenantStore,
            });
          } else {
            await store.upsertStudyRecord(studyUID, {
              patientName: patientDisplayName,
              studyDate: normalizedStudyDate,
              modality: info.modality ?? "OT",
              description,
              status: "unassigned",
              uploaderId,
              metadata: {
                patientId: effectivePatientId,
                fileCount: info.fileCount,
                ...linkedRegistryPatientMeta(effectivePatientId),
              },
            });
            createdStudies.push({ studyRecordId: studyUID, studyInstanceUid: studyUID });
          }
        }
      } else if (storedCount > 0) {
        // Fallback: no StudyInstanceUID readable after processing (rare if batch UIDs were written).
        // Prefer a real DICOM UID so viewer launch remains possible.
        const studyId =
          batchStudyUid ??
          newDicomUid();
        const fallbackPayload = {
          patientName: formPatientName ?? `Patient ${fallbackPatientId ?? "Unknown"}`,
          studyDate: new Date().toISOString().slice(0, 10),
          modality: "OT",
          description: `DICOM Upload (${storedCount} file${storedCount > 1 ? "s" : ""})`,
          status: "unassigned" as const,
          uploaderId,
          metadata: {
            patientId: fallbackPatientId,
            fileCount: storedCount,
            syntheticStudy: !batchStudyUid,
            StudyInstanceUID: studyId,
            ...linkedRegistryPatientMeta(fallbackPatientId),
          },
        };
        if (useTenantStudyStore && tenantStore && tenantId) {
          const tenantStudy = await tenantStore.upsertStudy(tenantId, {
            studyInstanceUid: studyId,
            patientName: fallbackPayload.patientName,
            studyDate: fallbackPayload.studyDate,
            modality: fallbackPayload.modality,
            description: fallbackPayload.description,
            status: fallbackPayload.status,
            uploaderId: fallbackPayload.uploaderId,
            metadata: fallbackPayload.metadata,
          });
          createdStudies.push({
            studyRecordId: tenantStudy.id,
            studyInstanceUid: tenantStudy.study_instance_uid,
            tenantId,
            tenantStore,
          });
        } else {
          await store.upsertStudyRecord(studyId, fallbackPayload);
          createdStudies.push({ studyRecordId: studyId, studyInstanceUid: studyId });
        }
      }

      // Auto-trigger MONAI analysis in background using one representative
      // DICOM image per study. This enforces a single high-quality AI output
      // per upload and avoids duplicate heatmap series.
      if (monaiService && createdStudies.length > 0 && finalStoredPaths.length > 0) {
        const studyFileMap = new Map<string, string[]>();
        for (const filePath of finalStoredPaths) {
          const ds = readDicomHeaderDataSet(filePath);
          const uid = normalizeDicomUid(ds?.string("x0020000d"));
          const key = uid ?? createdStudies[0]!.studyInstanceUid;
          const existing = studyFileMap.get(key) ?? [];
          existing.push(filePath);
          studyFileMap.set(key, existing);
        }

        for (const studyTarget of createdStudies) {
          const dicomFiles = studyFileMap.get(studyTarget.studyInstanceUid) ?? [];
          const representativeFile = pickRepresentativeDicomFile(dicomFiles);
          if (!representativeFile) {
            logger.warn({
              message: "Upload MONAI: no representative DICOM file found for study",
              studyId: studyTarget.studyRecordId,
              studyInstanceUid: studyTarget.studyInstanceUid,
            });
            continue;
          }

          runAutoMonaiOnUpload(monaiService, store, studyTarget, representativeFile).catch((err) => {
            logger.error({
              message: "Upload MONAI: background error",
              studyId: studyTarget.studyRecordId,
              studyInstanceUid: studyTarget.studyInstanceUid,
              file: path.basename(representativeFile),
              error: String(err),
            });
          });
        }
      }

      res.json({
        message: `${storedCount}/${files.length} files uploaded to Dicoogle`,
        results,
        uploaderId,
        studyIds: createdStudies.map((study) => study.studyRecordId),
        storageMode,
        cloudReplication: storageMode === "cloud"
          ? {
              bucket: cloudBucket,
              prefix: [cloudPrefix, tenantSlug ?? "default"].filter(Boolean).join("/"),
              uploadedCount: cloudUploadedCount,
              errorCount: cloudUploadErrors.length,
              errors: cloudUploadErrors,
            }
          : null,
        ...(effectiveUploadPatientId ? { patientId: effectiveUploadPatientId } : {}),
      });
    }),
  );

  return router;
}
