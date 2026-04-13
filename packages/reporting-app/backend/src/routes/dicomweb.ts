import { NextFunction, Request, Response, Router } from "express";
import axios from "axios";
import fs from "fs"; 
import path from "path";
import { createHash } from "node:crypto";
import dicomParser from "dicom-parser";
import { Decoder as JpegLosslessDecoder } from "jpeg-lossless-decoder-js";
import { env } from "../config/env";
import { ensureAuthenticated } from "../middleware/auth";
import type { GatewayRequest } from "../middleware/apiGateway";
import { getDicoogleAuthHeaders, clearDicoogleTokenCache } from "../services/dicoogleAuth";
import { logger } from "../services/logger";
import { verifyWeasisAccessToken } from "../services/weasisAccess";

/**
 * DICOMweb proxy — translates standard QIDO-RS / WADO-RS requests
 * from OHIF viewer into Dicoogle's proprietary REST API.
 *
 * Endpoints:
 *   GET /studies                           → QIDO-RS: list studies
 *   GET /studies/:studyUID/series          → QIDO-RS: list series
 *   GET /studies/:studyUID/series/:seriesUID/instances → QIDO-RS: list instances
 *   GET /studies/:studyUID/series/:seriesUID → WADO-RS: retrieve full series
 *   GET /studies/:studyUID/series/:seriesUID/instances/:sopUID → WADO-RS: retrieve DICOM
 *   GET /studies/:studyUID                 → WADO-RS: retrieve full study
 */

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");
const TENANT_STORAGE_ROOT = path.resolve(env.TENANT_STORAGE_ROOT || DICOOGLE_STORAGE_DIR);

function getStorageScanRoots(): string[] {
  return Array.from(new Set([path.resolve(DICOOGLE_STORAGE_DIR), path.resolve(TENANT_STORAGE_ROOT)]));
}

interface DicoogleDIMPatient {
  id: string;
  name: string;
  gender: string;
  nStudies: number;
  birthdate: string;
  studies: DicoogleDIMStudy[];
}

interface DicoogleDIMStudy {
  studyInstanceUID: string;
  studyDate: string;
  studyDescription: string;
  institutionName: string;
  modalities: string;
  series: DicoogleDIMSeries[];
}

interface DicoogleDIMSeries {
  serieNumber: number;
  serieInstanceUID: string;
  serieDescription: string;
  serieModality: string;
  images: DicoogleDIMImage[];
}

interface DicoogleDIMImage {
  sopInstanceUID: string;
  rawPath: string;
  uri: string;
  filename: string;
}

const LONG_VR_TYPES = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UN", "UR", "UT"]);

function getDicoogleEndpoints(): string[] {
  return Array.from(
    new Set(
      [env.DICOOGLE_BASE_URL, env.DICOOGLE_FALLBACK_BASE_URL].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

export type DicomwebStudyValidationReason =
  | "STUDY_NOT_FOUND"
  | "NO_SERIES"
  | "NO_INSTANCES"
  | "WADO_FRAME_UNAVAILABLE"
  | "VALIDATION_ERROR";

export interface DicomwebStudyValidationResult {
  studyInstanceUID: string;
  isValid: boolean;
  reason?: DicomwebStudyValidationReason;
  message: string;
  attempts: number;
  endpointUrls: {
    qidoStudies: string;
    qidoSeries: string;
    qidoInstances?: string;
    wadoFrame?: string;
  };
  responseStatus: {
    qidoStudies: number;
    qidoSeries?: number;
    qidoInstances?: number;
    wadoFrame?: number;
  };
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function validationMessageFromReason(reason: DicomwebStudyValidationReason): string {
  switch (reason) {
    case "STUDY_NOT_FOUND":
      return "Study not found in Dicoogle";
    case "NO_SERIES":
    case "NO_INSTANCES":
      return "Study exists but images not yet available";
    case "WADO_FRAME_UNAVAILABLE":
      return "Study exists but WADO frame retrieval failed";
    case "VALIDATION_ERROR":
    default:
      return "Unable to validate study availability from Dicoogle";
  }
}

// Cached DIM query — avoids hitting Dicoogle on every request
let dimCache: { data: DicoogleDIMPatient[]; ts: number } | null = null;
let dicoogleDimProviderState: "unknown" | "available" | "unavailable" = "unknown";
const DIM_CACHE_TTL = 120_000; // 2 minutes

// Per-tenant DIM caches: tenant slug → { data, ts }
const tenantDimCaches = new Map<string, { data: DicoogleDIMPatient[]; ts: number }>();
// Per-tenant SOP → file path maps
const tenantSopFilePathMaps = new Map<string, Map<string, string>>();

/** Built lazily for uploads stored as storage/<patientId>/*.dcm (flat basename fallback misses subfolders) */
let storedBasenameToPathCache: Map<string, string[]> | null = null;

/** Clear the DIM cache so next request fetches fresh data from Dicoogle */
export function clearDimCache(): void {
  dimCache = null;
  sopFilePathMap.clear();
  dicomTagCache.clear();
  fileSopUidCache.clear();
  readableFrameCache.clear();
  pixelDataStatusCache.clear();
  syntheticSopUids.clear();
  tenantDimCaches.clear();
  tenantSopFilePathMaps.clear();
  storedBasenameToPathCache = null;
}

/**
 * Register an externally-generated DICOM file (e.g. AI SR) so the DICOMweb
 * proxy serves it alongside Dicoogle-indexed data. The file is parsed for its
 * Study/Series/SOP UIDs and injected into the next DIM cache refresh.
 */
export function registerExtraDicomFile(filePath: string): void {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const ds = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });

    const studyUID = normalizeDicomUid(ds.string("x0020000d")) ?? "";
    const seriesUID = normalizeDicomUid(ds.string("x0020000e")) ?? "";
    const sopUID = normalizeDicomUid(ds.string("x00080018")) ?? "";
    const modality = ds.string("x00080060") ?? "SR";
    const seriesDesc = ds.string("x0008103e") ?? "AI Structured Report";
    const patientName = ds.string("x00100010") ?? "";
    const patientId = ds.string("x00100020") ?? "";
    const seriesNumber = ds.intString("x00200011") ?? 999;

    if (!studyUID || !seriesUID || !sopUID) return;

    const staleIdx: number[] = [];
    for (let i = 0; i < pendingExtraFiles.length; i++) {
      if (pendingExtraFiles[i].studyUID === studyUID && pendingExtraFiles[i].modality === modality) {
        sopFilePathMap.delete(pendingExtraFiles[i].sopUID);
        staleIdx.push(i);
      }
    }
    for (let i = staleIdx.length - 1; i >= 0; i--) {
      pendingExtraFiles.splice(staleIdx[i], 1);
    }

    sopFilePathMap.set(sopUID, filePath);

    pendingExtraFiles.push({
      filePath,
      studyUID,
      seriesUID,
      sopUID,
      modality,
      seriesDesc,
      patientName,
      patientId,
      seriesNumber,
    });
  } catch {
    // silently ignore parse failures
  }
}

interface ExtraDicomEntry {
  filePath: string;
  studyUID: string;
  seriesUID: string;
  sopUID: string;
  modality: string;
  seriesDesc: string;
  patientName: string;
  patientId: string;
  seriesNumber: number;
}

const pendingExtraFiles: ExtraDicomEntry[] = [];

const MAX_SCAN_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_DICOM_SCAN_DEPTH = 16;
const fileSopUidCache = new Map<string, string | null>();
const readableFrameCache = new Map<string, boolean>();
type DicomPixelDataStatus = "present" | "absent" | "unknown";
const pixelDataStatusCache = new Map<string, DicomPixelDataStatus>();
const syntheticSopUids = new Set<string>();

function normalizeDicomUid(rawValue: string | undefined | null): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.replace(/\0/g, "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildSyntheticSopInstanceUid(seed: string): string {
  const digest = createHash("sha1").update(seed).digest("hex");
  return `2.25.${BigInt(`0x${digest}`).toString()}`;
}

function getDimImageMergeKey(image: DicoogleDIMImage): string {
  return `${image.uri}|${image.filename}|${image.rawPath || ""}`;
}

function shouldInspectAsDicomFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".dcm") ||
    lower.endsWith(".dicom") ||
    lower.endsWith(".ima") ||
    lower.endsWith(".img") ||
    !path.extname(lower)
  );
}

function findDicomFilesRecursive(dir: string, maxDepth = MAX_DICOM_SCAN_DEPTH, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findDicomFilesRecursive(fullPath, maxDepth, depth + 1));
      } else if (entry.isFile()) {
        if (shouldInspectAsDicomFile(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // skip unreadable directories
  }
  return results;
}

/** Locate stored DICOM paths by basename under the full storage tree (patient/tenant subfolders). */
function findStoredFilesByBasename(filename: string): string[] {
  if (!filename) return [];
  if (!storedBasenameToPathCache) {
    storedBasenameToPathCache = new Map<string, string[]>();
    for (const root of getStorageScanRoots()) {
      for (const p of findDicomFilesRecursive(root, MAX_DICOM_SCAN_DEPTH)) {
        const basename = path.basename(p);
        const existing = storedBasenameToPathCache.get(basename);
        if (existing) {
          existing.push(p);
        } else {
          storedBasenameToPathCache.set(basename, [p]);
        }
      }
    }
  }
  return storedBasenameToPathCache.get(filename) ?? [];
}

function parseDicomHeaderFromFile(filePath: string): dicomParser.DataSet | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, MAX_SCAN_HEADER_BYTES);
    const buffer = Buffer.alloc(readSize);
    const bytesRead = fs.readSync(fd, buffer, 0, readSize, 0);
    if (bytesRead < 132) return null;
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    return dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function getFileSopInstanceUid(filePath: string): string | null {
  if (fileSopUidCache.has(filePath)) {
    return fileSopUidCache.get(filePath) ?? null;
  }
  const ds = parseDicomHeaderFromFile(filePath);
  const sopUid = ds?.string("x00080018")?.trim() ?? null;
  fileSopUidCache.set(filePath, sopUid);
  return sopUid;
}

function scanStorageForDIM(): DicoogleDIMPatient[] {
  const patientMap = new Map<string, DicoogleDIMPatient>();
  const scanRoots = getStorageScanRoots();
  const dicomFiles = Array.from(
    new Set(
      scanRoots.flatMap((root) => findDicomFilesRecursive(root)),
    ),
  );
  for (const filePath of dicomFiles) {
    const ds = parseDicomHeaderFromFile(filePath);
    if (!ds) continue;

    const studyUID = normalizeDicomUid(ds.string("x0020000d"));
    const seriesUID = normalizeDicomUid(ds.string("x0020000e"));
    const sopUID = normalizeDicomUid(ds.string("x00080018")) ?? "";
    if (!studyUID || !seriesUID) continue;

    const patientId = ds.string("x00100020") || "UNKNOWN";
    const patientName = ds.string("x00100010") || "Unknown";

    let patient = patientMap.get(patientId);
    if (!patient) {
      patient = {
        id: patientId,
        name: patientName,
        gender: ds.string("x00100040") || "",
        nStudies: 0,
        birthdate: ds.string("x00100030") || "",
        studies: [],
      };
      patientMap.set(patientId, patient);
    }

    let study = patient.studies.find((s) => s.studyInstanceUID === studyUID);
    if (!study) {
      study = {
        studyInstanceUID: studyUID,
        studyDate: ds.string("x00080020") || "",
        studyDescription: ds.string("x00081030") || "",
        institutionName: ds.string("x00080080") || "",
        modalities: ds.string("x00080060") || "OT",
        series: [],
      };
      patient.studies.push(study);
      patient.nStudies = patient.studies.length;
    }

    const modality = ds.string("x00080060") || "OT";
    let series = study.series.find((s) => s.serieInstanceUID === seriesUID);
    if (!series) {
      series = {
        serieNumber: ds.intString("x00200011") ?? 1,
        serieInstanceUID: seriesUID,
        serieDescription: ds.string("x0008103e") || "",
        serieModality: modality,
        images: [],
      };
      study.series.push(series);
    }

    if (!series.images.some((img) => img.rawPath === filePath)) {
      series.images.push({
        sopInstanceUID: sopUID,
        rawPath: filePath,
        uri: `file:///${filePath.replace(/\\/g, "/")}`,
        filename: path.basename(filePath),
      });
    }
  }

  return Array.from(patientMap.values());
}

function mergeDIMData(target: DicoogleDIMPatient[], source: DicoogleDIMPatient[]): void {
  const existingImageKeys = new Set<string>();
  for (const p of target) {
    for (const st of p.studies) {
      for (const se of st.series) {
        for (const img of se.images) {
          existingImageKeys.add(getDimImageMergeKey(img));
        }
      }
    }
  }

  for (const srcPatient of source) {
    for (const srcStudy of srcPatient.studies) {
      for (const srcSeries of srcStudy.series) {
        for (const srcImage of srcSeries.images) {
          const mergeKey = getDimImageMergeKey(srcImage);
          if (existingImageKeys.has(mergeKey)) continue;

          let tgtPatient = target.find((p) => p.id === srcPatient.id);
          if (!tgtPatient) {
            tgtPatient = { ...srcPatient, studies: [] };
            target.push(tgtPatient);
          }

          let tgtStudy = tgtPatient.studies.find(
            (s) => s.studyInstanceUID === srcStudy.studyInstanceUID,
          );
          if (!tgtStudy) {
            tgtStudy = { ...srcStudy, series: [] };
            tgtPatient.studies.push(tgtStudy);
            tgtPatient.nStudies = tgtPatient.studies.length;
          }

          let tgtSeries = tgtStudy.series.find(
            (s) => s.serieInstanceUID === srcSeries.serieInstanceUID,
          );
          if (!tgtSeries) {
            tgtSeries = { ...srcSeries, images: [] };
            tgtStudy.series.push(tgtSeries);
          }

          tgtSeries.images.push(srcImage);
          existingImageKeys.add(mergeKey);
        }
      }
    }
  }
}

function normalizeDimSopUids(patients: DicoogleDIMPatient[]): void {
  const usedSopUids = new Set<string>();
  sopFilePathMap.clear();
  syntheticSopUids.clear();

  for (const patient of patients) {
    for (const study of patient.studies) {
      for (const series of study.series) {
        for (let index = 0; index < series.images.length; index += 1) {
          const image = series.images[index];
          const original = (image.sopInstanceUID ?? "").trim();
          let effective = original;

          if (!effective || usedSopUids.has(effective)) {
            let salt = 0;
            do {
              const seed =
                `${original}|${image.uri}|${image.filename}|${study.studyInstanceUID}|${series.serieInstanceUID}|${index}|${salt}`;
              effective = buildSyntheticSopInstanceUid(seed);
              salt += 1;
            } while (usedSopUids.has(effective));
            image.sopInstanceUID = effective;
            syntheticSopUids.add(effective);
          }

          usedSopUids.add(effective);

          const filePath = resolveExistingImagePath(image);
          if (filePath) {
            sopFilePathMap.set(effective, filePath);
          }
        }
      }
    }
  }
}

async function queryDicoogleDIM(): Promise<DicoogleDIMPatient[]> {
  if (dimCache && Date.now() - dimCache.ts < DIM_CACHE_TTL) return dimCache.data;
  let data: DicoogleDIMPatient[] = [];
  const endpoints = getDicoogleEndpoints();

  let authHeaders: Record<string, string> = {};
  try {
    authHeaders = await getDicoogleAuthHeaders();
  } catch {
    authHeaders = {};
  }

  const endpointErrors: string[] = [];
  let querySucceeded = false;
  let noDimProvidersAvailable = dicoogleDimProviderState === "unavailable";

  if (!noDimProvidersAvailable) {
    for (const endpoint of endpoints) {
      const headersCandidates = Object.keys(authHeaders).length > 0 ? [authHeaders, {}] : [{}];
      for (const headers of headersCandidates) {
        try {
          const response = await axios.get(`${endpoint}/searchDIM`, {
            params: { query: "SOPInstanceUID:*", provider: "lucene" },
            headers,
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 300,
          });
          data = (response.data as { results: DicoogleDIMPatient[] }).results || [];
          logger.info({
            message: "DICOMWeb DIM query succeeded",
            endpoint,
            studyCount: data.reduce((sum, patient) => sum + patient.studies.length, 0),
          });
          querySucceeded = true;
          break;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 401 && headers === authHeaders) {
            clearDicoogleTokenCache();
            endpointErrors.push(`${endpoint}: 401 Unauthorized (token cleared, will retry)`);
            continue;
          }
          if (axios.isAxiosError(error) && error.response?.status === 400) {
            const payload = error.response.data as { error?: unknown } | undefined;
            const apiError = typeof payload?.error === "string" ? payload.error : "";
            if (/no valid dim providers supplied|is not a valid query provider/i.test(apiError)) {
              noDimProvidersAvailable = true;
              endpointErrors.push(`${endpoint}: ${apiError}`);
              break;
            }
          }
          const message = error instanceof Error ? error.message : "Unknown error";
          endpointErrors.push(`${endpoint}: ${message}`);
        }
      }
      if (querySucceeded || noDimProvidersAvailable) break;
    }
  }

  if (!querySucceeded) {
    if (noDimProvidersAvailable) {
      dicoogleDimProviderState = "unavailable";
      logger.warn({
        message: "DICOMweb: Dicoogle is reachable but has no DIM providers enabled — falling back to filesystem scan",
        attempts: endpointErrors,
      });
    } else {
      logger.warn({
        message: "DICOMweb: Could not reach Dicoogle — falling back to filesystem scan",
        attempts: endpointErrors,
      });
    }
    data = scanStorageForDIM();
    logger.info({
      message: "Filesystem DIM scan completed (Dicoogle fallback)",
      patientCount: data.length,
      studyCount: data.reduce((sum, p) => sum + p.studies.length, 0),
    });
  } else {
    dicoogleDimProviderState = "available";
    const fsData = scanStorageForDIM();
    mergeDIMData(data, fsData);
  }

  mergeExtraFilesIntoDIM(data);
  normalizeDimSopUids(data);
  dimCache = { data, ts: Date.now() };
  return data;
}

/**
 * Tenant-scoped DIM query: scans only the tenant's storage subdirectory
 * so each tenant only sees their own DICOM studies.
 */
async function queryTenantDIM(tenantSlug: string): Promise<DicoogleDIMPatient[]> {
  const cached = tenantDimCaches.get(tenantSlug);
  if (cached && Date.now() - cached.ts < DIM_CACHE_TTL) return cached.data;

  const tenantStorageDir = path.join(TENANT_STORAGE_ROOT, tenantSlug);
  if (!fs.existsSync(tenantStorageDir)) {
    logger.info({ message: "Tenant storage dir does not exist yet", tenantSlug, tenantStorageDir });
    tenantDimCaches.set(tenantSlug, { data: [], ts: Date.now() });
    return [];
  }

  const data = scanStorageForDIMInDir(tenantStorageDir);

  // Build a dedicated SOP→filepath map for this tenant
  const tenantSopMap = new Map<string, string>();
  const usedSopUids = new Set<string>();
  for (const patient of data) {
    for (const study of patient.studies) {
      for (const series of study.series) {
        for (let index = 0; index < series.images.length; index += 1) {
          const image = series.images[index];
          const original = (image.sopInstanceUID ?? "").trim();
          let effective = original;

          if (!effective || usedSopUids.has(effective)) {
            let salt = 0;
            do {
              const seed =
                `${original}|${image.uri}|${image.filename}|${study.studyInstanceUID}|${series.serieInstanceUID}|${index}|${salt}`;
              effective = buildSyntheticSopInstanceUid(seed);
              salt += 1;
            } while (usedSopUids.has(effective));
            image.sopInstanceUID = effective;
            syntheticSopUids.add(effective);
          }

          usedSopUids.add(effective);

          const filePath = resolveExistingImagePath(image);
          if (filePath) {
            tenantSopMap.set(effective, filePath);
            sopFilePathMap.set(effective, filePath);
          }
        }
      }
    }
  }

  tenantSopFilePathMaps.set(tenantSlug, tenantSopMap);
  tenantDimCaches.set(tenantSlug, { data, ts: Date.now() });

  logger.info({
    message: "Tenant DIM scan completed",
    tenantSlug,
    patientCount: data.length,
    studyCount: data.reduce((sum, p) => sum + p.studies.length, 0),
    instanceCount: tenantSopMap.size,
  });

  return data;
}

/** Scan a specific directory for DICOM files and build DIM structure */
function scanStorageForDIMInDir(dir: string): DicoogleDIMPatient[] {
  const patientMap = new Map<string, DicoogleDIMPatient>();
  const dicomFiles = findDicomFilesRecursive(dir);

  for (const filePath of dicomFiles) {
    const ds = parseDicomHeaderFromFile(filePath);
    if (!ds) continue;

    const studyUID = normalizeDicomUid(ds.string("x0020000d"));
    const seriesUID = normalizeDicomUid(ds.string("x0020000e"));
    const sopUID = normalizeDicomUid(ds.string("x00080018")) ?? "";
    if (!studyUID || !seriesUID) continue;

    const patientId = ds.string("x00100020") || "UNKNOWN";
    const patientName = ds.string("x00100010") || "Unknown";

    let patient = patientMap.get(patientId);
    if (!patient) {
      patient = {
        id: patientId,
        name: patientName,
        gender: ds.string("x00100040") || "",
        nStudies: 0,
        birthdate: ds.string("x00100030") || "",
        studies: [],
      };
      patientMap.set(patientId, patient);
    }

    let study = patient.studies.find((s) => s.studyInstanceUID === studyUID);
    if (!study) {
      study = {
        studyInstanceUID: studyUID,
        studyDate: ds.string("x00080020") || "",
        studyDescription: ds.string("x00081030") || "",
        institutionName: ds.string("x00080080") || "",
        modalities: ds.string("x00080060") || "OT",
        series: [],
      };
      patient.studies.push(study);
      patient.nStudies = patient.studies.length;
    }

    const modality = ds.string("x00080060") || "OT";
    let series = study.series.find((s) => s.serieInstanceUID === seriesUID);
    if (!series) {
      series = {
        serieNumber: ds.intString("x00200011") ?? 1,
        serieInstanceUID: seriesUID,
        serieDescription: ds.string("x0008103e") || "",
        serieModality: modality,
        images: [],
      };
      study.series.push(series);
    }

    if (!series.images.some((img) => img.rawPath === filePath)) {
      series.images.push({
        sopInstanceUID: sopUID,
        rawPath: filePath,
        uri: `file:///${filePath.replace(/\\/g, "/")}`,
        filename: path.basename(filePath),
      });
    }
  }

  return Array.from(patientMap.values());
}

/** Resolve the correct DIM query — tenant-scoped when multi-tenant is active */
async function queryDIMForRequest(req: Request): Promise<DicoogleDIMPatient[]> {
  if (env.MULTI_TENANT_ENABLED) {
    const gwReq = req as GatewayRequest;
    if (gwReq.tenantSlug) {
      return queryTenantDIM(gwReq.tenantSlug);
    }
  }
  return queryDicoogleDIM();
}

function mergeExtraFilesIntoDIM(patients: DicoogleDIMPatient[]): void {
  for (const extra of pendingExtraFiles) {
    if (!fs.existsSync(extra.filePath)) continue;
    sopFilePathMap.set(extra.sopUID, extra.filePath);

    let targetStudy: DicoogleDIMStudy | undefined;
    for (const p of patients) {
      for (const st of p.studies) {
        if (st.studyInstanceUID === extra.studyUID) {
          targetStudy = st;
          break;
        }
      }
      if (targetStudy) break;
    }

    if (!targetStudy) {
      const syntheticPatient: DicoogleDIMPatient = {
        id: extra.patientId || "AI",
        name: extra.patientName || "AI Generated",
        gender: "",
        nStudies: 1,
        birthdate: "",
        studies: [
          {
            studyInstanceUID: extra.studyUID,
            studyDate: "",
            studyDescription: "",
            institutionName: "",
            modalities: extra.modality,
            series: [],
          },
        ],
      };
      patients.push(syntheticPatient);
      targetStudy = syntheticPatient.studies[0];
    }

    let targetSeries = targetStudy.series.find(
      (s) => s.serieInstanceUID === extra.seriesUID,
    );
    if (!targetSeries) {
      targetSeries = {
        serieNumber: extra.seriesNumber,
        serieInstanceUID: extra.seriesUID,
        serieDescription: extra.seriesDesc,
        serieModality: extra.modality,
        images: [],
      };
      targetStudy.series.push(targetSeries);
    }

    if (!targetSeries.images.some((img) => img.sopInstanceUID === extra.sopUID)) {
      targetSeries.images.push({
        sopInstanceUID: extra.sopUID,
        rawPath: extra.filePath,
        uri: `file:///${extra.filePath.replace(/\\/g, "/")}`,
        filename: path.basename(extra.filePath),
      });
    }
  }
}

// Fast SOP UID → file path lookup (populated from DIM cache)
const sopFilePathMap = new Map<string, string>();

function resolveFilePathFast(sopUID: string): string | null {
  return sopFilePathMap.get(sopUID) || null;
}

function resolveAndCacheImagePath(image: DicoogleDIMImage): string | null {
  const sopUID = (image.sopInstanceUID ?? "").trim();
  if (sopUID) {
    const cachedPath = resolveFilePathFast(sopUID);
    if (cachedPath) {
      return cachedPath;
    }
  }

  const resolvedPath = resolveExistingImagePath(image);
  if (resolvedPath && sopUID) {
    sopFilePathMap.set(sopUID, resolvedPath);
  }
  return resolvedPath;
}

function isNonEmptyDicomFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Returns a path suitable for QIDO/metadata listing.
 *
 * Avoid strict frame-readability filtering here; if DIM metadata is slightly
 * stale or parser capabilities differ, aggressive filtering collapses valid
 * series into empty lists (OHIF then shows a blank viewport).
 */
function resolveUsableImagePath(image: DicoogleDIMImage): string | null {
  const resolvedPath = resolveAndCacheImagePath(image);
  if (!resolvedPath) {
    return null;
  }
  if (!isNonEmptyDicomFile(resolvedPath)) {
    return null;
  }
  return resolvedPath;
}

function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    const parsed = new URL(uri);
    const decodedPath = decodeURIComponent(parsed.pathname);
    // Windows file:// URIs come in as /C:/path
    if (/^\/[A-Za-z]:\//.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }
    return decodedPath;
  } catch {
    const stripped = uri.replace(/^file:\/\//, "");
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
}

/**
 * Keep WADO instance payload SOP UID aligned with the requested path param.
 *
 * DIM normalization may synthesize unique 2.25.* SOP UIDs to avoid collisions.
 * If we return the original file unchanged, the embedded SOP UID can differ from
 * the requested synthetic UID, causing client-side dedup/caching issues.
 */
function rewriteSopUidInDicomBuffer(fileBuffer: Buffer, requestedSopUid: string): Buffer {
  if (!requestedSopUid?.trim()) return fileBuffer;

  const byteArray = new Uint8Array(
    fileBuffer.buffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength,
  );

  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
  } catch {
    return fileBuffer;
  }

  const targetUid = requestedSopUid.trim();
  const rewriteElements: Array<dicomParser.Element> = [];
  for (const tag of ["x00080018", "x00020003"] as const) {
    const el = dataSet.elements[tag];
    if (!el || el.dataOffset == null || el.length < 0) continue;
    const current = (dataSet.string(tag) ?? "").trim();
    if (current !== targetUid) {
      rewriteElements.push(el);
    }
  }

  if (rewriteElements.length === 0) return fileBuffer;

  rewriteElements.sort((a, b) => b.dataOffset - a.dataOffset);
  let buf = Buffer.from(fileBuffer);

  for (const element of rewriteElements) {
    let padded = targetUid;
    if (padded.length % 2 !== 0) padded += " ";
    const newValue = Buffer.from(padded, "latin1");

    const oldDataOffset = element.dataOffset;
    const oldLength = element.length;

    if (newValue.length <= oldLength) {
      const paddedBuf = Buffer.alloc(oldLength, 0x20);
      newValue.copy(paddedBuf);
      paddedBuf.copy(buf, oldDataOffset);
      continue;
    }

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
      lengthBuf.writeUInt16LE(newValue.length);
    } else {
      lengthBuf.writeUInt32LE(newValue.length);
    }
    const after = buf.subarray(oldDataOffset + oldLength);
    buf = Buffer.concat([before, lengthBuf, newValue, after]);
  }

  return buf;
}

/** Resolve DIM image to a readable local path (upload layout uses nested patient directories). */
function resolveExistingImagePath(image: DicoogleDIMImage): string | null {
  const candidatePaths: string[] = [];
  const pushCandidate = (candidate: string | null | undefined) => {
    if (!candidate || !fs.existsSync(candidate)) return;
    if (!candidatePaths.includes(candidate)) {
      candidatePaths.push(candidate);
    }
  };

  pushCandidate(image.rawPath);
  pushCandidate(fileUriToPath(image.uri));
  pushCandidate(path.join(DICOOGLE_STORAGE_DIR, image.filename));
  for (const candidate of findStoredFilesByBasename(image.filename)) {
    pushCandidate(candidate);
  }

  if (candidatePaths.length === 0) {
    return null;
  }

  const sopUID = (image.sopInstanceUID ?? "").trim();
  if (!sopUID || syntheticSopUids.has(sopUID)) {
    return candidatePaths[0] ?? null;
  }

  const matchingBySop = candidatePaths.find((candidatePath) => {
    return getFileSopInstanceUid(candidatePath) === sopUID;
  });
  if (matchingBySop) {
    return matchingBySop;
  }

  return candidatePaths[0] ?? null;
}

async function resolveWadoFilePath(req: Request, sopUID: string): Promise<string | null> {
  await queryDIMForRequest(req);
  const fast = resolveFilePathFast(sopUID);
  if (fast) return fast;
  const patients = await queryDIMForRequest(req);
  for (const patient of patients) {
    for (const study of patient.studies) {
      for (const series of study.series) {
        for (const image of series.images) {
          if (image.sopInstanceUID === sopUID) {
            const resolved = resolveExistingImagePath(image);
            if (resolved) {
              sopFilePathMap.set(sopUID, resolved);
              return resolved;
            }
          }
        }
      }
    }
  }
  return null;
}

function streamMultipartDicomFiles(
  res: Response,
  filePaths: string[],
  cacheControl = "public, max-age=3600",
): void {
  const boundary = "dicoogle-boundary";
  const headerPrefix = `--${boundary}\r\nContent-Type: application/dicom\r\nContent-Transfer-Encoding: binary\r\n\r\n`;

  res.setHeader(
    "Content-Type",
    `multipart/related; type="application/dicom"; boundary=${boundary}`,
  );
  res.setHeader("Cache-Control", cacheControl);

  for (const filePath of filePaths) {
    const dicomBuffer = fs.readFileSync(filePath);
    res.write(Buffer.from(headerPrefix));
    res.write(dicomBuffer);
    res.write(Buffer.from("\r\n"));
  }
  res.end(Buffer.from(`--${boundary}--\r\n`));
}

function getRequestOrigin(req: Request): string | null {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!host) return null;
  return `${forwardedProto || req.protocol}://${host}`;
}

function getDicomwebBaseUrl(req: Request): string {
  return `${getRequestOrigin(req) ?? env.BACKEND_URL.replace(/\/+$/, "")}${req.baseUrl}`;
}

function collectStudyUidQueryFragments(query: Request["query"]): string[] {
  const out: string[] = [];
  const keys = ["StudyInstanceUID", "studyUID", "StudyInstanceUIDs", "studyInstanceUIDs"] as const;
  for (const key of keys) {
    const v = query[key];
    if (typeof v === "string" && v.trim()) {
      out.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) {
          out.push(item);
        }
      }
    }
  }
  return out;
}

/** QIDO study filters; supports plural / camelCase keys some clients send. */
function parseStudyInstanceUidFilters(query: Request["query"]): string[] {
  const fragments = collectStudyUidQueryFragments(query);
  if (fragments.length === 0) {
    return [];
  }
  return fragments
    .join(",")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getRequestedStudyUID(req: Request): string | null {
  const studyUIDParam = req.params.studyUID;
  if (typeof studyUIDParam === "string" && studyUIDParam.trim()) {
    return studyUIDParam;
  }

  const fromQuery = parseStudyInstanceUidFilters(req.query);
  return fromQuery.length > 0 ? fromQuery[0]! : null;
}

function hasReadableFirstFrame(filePath: string): boolean {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    const dataSet = dicomParser.parseDicom(byteArray);
    const pixelDataElement = dataSet.elements["x7fe00010"];
    if (!pixelDataElement) return false;

    if (pixelDataElement.encapsulatedPixelData) {
      const fragments = pixelDataElement.fragments;
      return Array.isArray(fragments) && fragments.length > 0;
    }

    return pixelDataElement.length > 0;
  } catch {
    return false;
  }
}

function hasReadableFirstFrameCached(filePath: string): boolean {
  const cached = readableFrameCache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  const readable = hasReadableFirstFrame(filePath);
  readableFrameCache.set(filePath, readable);
  return readable;
}

function extractEncapsulatedFrame(
  dataSet: dicomParser.DataSet,
  pixelDataElement: dicomParser.Element,
  frameIndex: number,
  byteArray: Uint8Array,
): Buffer | null {
  const parserWithFrameReader = dicomParser as unknown as {
    readEncapsulatedImageFrame?: (
      dataSet: dicomParser.DataSet,
      pixelDataElement: dicomParser.Element,
      frameIndex: number,
    ) => Uint8Array;
  };

  if (typeof parserWithFrameReader.readEncapsulatedImageFrame === "function") {
    try {
      const frameBytes = parserWithFrameReader.readEncapsulatedImageFrame(
        dataSet,
        pixelDataElement,
        frameIndex,
      );
      if (frameBytes && frameBytes.byteLength > 0) {
        return Buffer.from(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength);
      }
    } catch {
      // Fall through to fragment-based fallback.
    }
  }

  const fragments = pixelDataElement.fragments;
  if (!fragments || frameIndex >= fragments.length) {
    return null;
  }
  const fragment = fragments[frameIndex];
  return Buffer.from(byteArray.buffer, byteArray.byteOffset + fragment.position, fragment.length);
}

function getRequestedFrameIndex(frameNumbers: string): number {
  const firstFrame = frameNumbers.split(",")[0]?.trim() ?? "1";
  const parsed = Number.parseInt(firstFrame, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed - 1;
}

function extractNativeFrame(
  dataSet: dicomParser.DataSet,
  pixelDataElement: dicomParser.Element,
  frameIndex: number,
  byteArray: Uint8Array,
): Buffer | null {
  if (frameIndex < 0) return null;

  const numberOfFramesRaw = dataSet.intString("x00280008");
  const numberOfFrames = numberOfFramesRaw && numberOfFramesRaw > 0 ? numberOfFramesRaw : 1;
  if (frameIndex >= numberOfFrames) return null;

  const rows = dataSet.uint16("x00280010") ?? 0;
  const columns = dataSet.uint16("x00280011") ?? 0;
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;

  if (rows <= 0 || columns <= 0 || samplesPerPixel <= 0 || bitsAllocated <= 0) {
    if (frameIndex === 0) {
      return Buffer.from(
        byteArray.buffer,
        byteArray.byteOffset + pixelDataElement.dataOffset,
        pixelDataElement.length,
      );
    }
    return null;
  }

  const bitsPerFrame = rows * columns * samplesPerPixel * bitsAllocated;
  const bytesPerFrame = Math.ceil(bitsPerFrame / 8);
  if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
    return null;
  }

  const pixelDataStart = byteArray.byteOffset + pixelDataElement.dataOffset;
  const pixelDataEnd = pixelDataStart + pixelDataElement.length;
  const frameStart = pixelDataStart + frameIndex * bytesPerFrame;
  if (frameStart >= pixelDataEnd) {
    return null;
  }

  const frameLength = Math.min(bytesPerFrame, pixelDataEnd - frameStart);
  return Buffer.from(byteArray.buffer, frameStart, frameLength);
}

const JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS = new Set([
  "1.2.840.10008.1.2.4.57",
  "1.2.840.10008.1.2.4.70",
]);
const EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID = "1.2.840.10008.1.2.1";

function getEffectiveFrameTransferSyntaxUID(transferSyntaxUID?: string): string {
  const normalized = normalizeDicomUid(transferSyntaxUID);
  if (normalized && JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS.has(normalized)) {
    return EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID;
  }
  return normalized || EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID;
}

function decodeJpegLosslessFrame(
  frameData: Buffer,
  dataSet: dicomParser.DataSet,
): Buffer | null {
  try {
    const decoder = new JpegLosslessDecoder();
    const decoded = decoder.decode(
      frameData.buffer as ArrayBufferLike,
      frameData.byteOffset,
      frameData.byteLength,
    );
    const valueCount = (decoded as { length?: number }).length ?? 0;
    if (valueCount <= 0) {
      return null;
    }

    const values = decoded as ArrayLike<number>;
    const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
    if (bitsAllocated <= 8) {
      const out = Buffer.allocUnsafe(valueCount);
      for (let i = 0; i < valueCount; i += 1) {
        const value = values[i] ?? 0;
        out[i] = value & 0xff;
      }
      return out;
    }

    const out = Buffer.allocUnsafe(valueCount * 2);
    for (let i = 0; i < valueCount; i += 1) {
      const value = values[i] ?? 0;
      out.writeUInt16LE(value & 0xffff, i * 2);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Whether the WADO-RS /frames/1 route can return pixel data for this file.
 * OHIF calls GET .../studies/:uid/validate before viewing; that path used only
 * {@link hasReadableFirstFrameCached}, which is stricter than actual frame
 * extraction (e.g. some encapsulated JPEG layouts). Weasis skips this check.
 */
function canWadoServeFirstFrame(filePath: string): boolean {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    const dataSet = dicomParser.parseDicom(byteArray);
    const pixelDataElement = dataSet.elements["x7fe00010"];
    if (!pixelDataElement) return false;

    const frameIndex = 0;

    if (pixelDataElement.encapsulatedPixelData) {
      const frameData = extractEncapsulatedFrame(dataSet, pixelDataElement, frameIndex, byteArray);
      return Boolean(frameData && frameData.length > 0);
    }

    const nativeFrame = extractNativeFrame(dataSet, pixelDataElement, frameIndex, byteArray);
    return nativeFrame != null && nativeFrame.length > 0;
  } catch {
    return false;
  }
}

export async function validateStudyAvailability({
  studyInstanceUID,
  dicomwebBaseUrl,
  tenantId,
  patientId,
  maxAttempts = 3,
  retryDelayMs = 2000,
}: {
  studyInstanceUID: string;
  dicomwebBaseUrl: string;
  tenantId?: string;
  patientId?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<DicomwebStudyValidationResult> {
  const baseUrl = dicomwebBaseUrl.replace(/\/+$/, "");
  const endpointUrls: DicomwebStudyValidationResult["endpointUrls"] = {
    qidoStudies: `${baseUrl}/studies?StudyInstanceUID=${encodeURIComponent(studyInstanceUID)}`,
    qidoSeries: `${baseUrl}/studies/${studyInstanceUID}/series`,
  };

  const responseStatus: DicomwebStudyValidationResult["responseStatus"] = {
    qidoStudies: 200,
  };

  let lastFailure: DicomwebStudyValidationResult | null = null;
  // Validation is used for launch gating, so avoid serving stale cache snapshots.
  clearDimCache();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        clearDimCache();
      }

      const patients = await queryDicoogleDIM();
      let matchedStudy: DicoogleDIMStudy | null = null;
      const matchingStudies: Array<{ patient: DicoogleDIMPatient; study: DicoogleDIMStudy }> = [];

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID === studyInstanceUID) {
            matchingStudies.push({ patient, study });
          }
        }
      }

      if (matchingStudies.length > 0) {
        if (patientId) {
          matchedStudy =
            matchingStudies.find(({ patient }) => patient.id === patientId)?.study ?? matchingStudies[0].study;
        } else {
          matchedStudy = matchingStudies[0].study;
        }
      }

      logger.info({
        message: "DICOMWeb validation QIDO study check",
        studyInstanceUID,
        tenantId: tenantId ?? null,
        endpointUrl: endpointUrls.qidoStudies,
        responseStatus: 200,
        resultCount: matchedStudy ? 1 : 0,
        attempt,
      });

      if (!matchedStudy) {
        lastFailure = {
          studyInstanceUID,
          isValid: false,
          reason: "STUDY_NOT_FOUND",
          message: validationMessageFromReason("STUDY_NOT_FOUND"),
          attempts: attempt,
          endpointUrls,
          responseStatus,
        };
      } else {
        responseStatus.qidoSeries = 200;
        logger.info({
          message: "DICOMWeb validation QIDO series check",
          studyInstanceUID,
          tenantId: tenantId ?? null,
          endpointUrl: endpointUrls.qidoSeries,
          responseStatus: 200,
          resultCount: matchedStudy.series.length,
          attempt,
        });

        if (matchedStudy.series.length === 0) {
          lastFailure = {
            studyInstanceUID,
            isValid: false,
            reason: "NO_SERIES",
            message: validationMessageFromReason("NO_SERIES"),
            attempts: attempt,
            endpointUrls,
            responseStatus,
          };
        } else {
          const seriesWithInstances = matchedStudy.series.filter((series) => series.images.length > 0);

          endpointUrls.qidoInstances = `${baseUrl}/studies/${studyInstanceUID}/series/${
            seriesWithInstances[0]?.serieInstanceUID ?? matchedStudy.series[0].serieInstanceUID
          }/instances`;
          responseStatus.qidoInstances = 200;
          logger.info({
            message: "DICOMWeb validation QIDO instances check",
            studyInstanceUID,
            tenantId: tenantId ?? null,
            endpointUrl: endpointUrls.qidoInstances,
            responseStatus: 200,
            resultCount: seriesWithInstances.reduce((sum, series) => sum + series.images.length, 0),
            attempt,
          });

          if (seriesWithInstances.length === 0) {
            lastFailure = {
              studyInstanceUID,
              isValid: false,
              reason: "NO_INSTANCES",
              message: validationMessageFromReason("NO_INSTANCES"),
              attempts: attempt,
              endpointUrls,
              responseStatus,
            };
          } else {
            let readableSeries: DicoogleDIMSeries | null = null;
            let readableInstance: DicoogleDIMImage | null = null;
            let attemptedFrameChecks = 0;
            let lastCheckedSeriesUID: string | undefined;
            let lastCheckedSopUID: string | undefined;

            outer:
            for (const series of seriesWithInstances) {
              for (const instance of series.images) {
                attemptedFrameChecks += 1;
                lastCheckedSeriesUID = series.serieInstanceUID;
                lastCheckedSopUID = instance.sopInstanceUID;

                const filePath =
                  resolveFilePath(instance.sopInstanceUID) || resolveAndCacheImagePath(instance);
                if (!filePath) {
                  continue;
                }
                if (!hasReadableFirstFrameCached(filePath) && !canWadoServeFirstFrame(filePath)) {
                  continue;
                }

                readableSeries = series;
                readableInstance = instance;
                break outer;
              }
            }

            const fallbackSeriesUID =
              lastCheckedSeriesUID ?? seriesWithInstances[0]?.serieInstanceUID ?? matchedStudy.series[0]?.serieInstanceUID;
            const fallbackSopUID =
              lastCheckedSopUID ?? seriesWithInstances[0]?.images[0]?.sopInstanceUID;

            if (!readableSeries || !readableInstance) {
              endpointUrls.wadoFrame =
                fallbackSeriesUID && fallbackSopUID
                  ? `${baseUrl}/studies/${studyInstanceUID}/series/${fallbackSeriesUID}/instances/${fallbackSopUID}/frames/1`
                  : undefined;
              responseStatus.wadoFrame = 404;

              logger.info({
                message: "DICOMWeb validation WADO frame check",
                studyInstanceUID,
                tenantId: tenantId ?? null,
                endpointUrl: endpointUrls.wadoFrame,
                responseStatus: responseStatus.wadoFrame,
                attemptedFrameChecks,
                attempt,
              });

              lastFailure = {
                studyInstanceUID,
                isValid: false,
                reason: "WADO_FRAME_UNAVAILABLE",
                message: validationMessageFromReason("WADO_FRAME_UNAVAILABLE"),
                attempts: attempt,
                endpointUrls,
                responseStatus,
                seriesInstanceUID: fallbackSeriesUID,
                sopInstanceUID: fallbackSopUID,
              };
            } else {
              endpointUrls.wadoFrame =
                `${baseUrl}/studies/${studyInstanceUID}/series/${readableSeries.serieInstanceUID}` +
                `/instances/${readableInstance.sopInstanceUID}/frames/1`;
              responseStatus.wadoFrame = 200;

              logger.info({
                message: "DICOMWeb validation WADO frame check",
                studyInstanceUID,
                tenantId: tenantId ?? null,
                endpointUrl: endpointUrls.wadoFrame,
                responseStatus: responseStatus.wadoFrame,
                attemptedFrameChecks,
                attempt,
              });

              return {
                studyInstanceUID,
                isValid: true,
                message: "Study, series, instances, and WADO frame retrieval validated",
                attempts: attempt,
                endpointUrls,
                responseStatus,
                seriesInstanceUID: readableSeries.serieInstanceUID,
                sopInstanceUID: readableInstance.sopInstanceUID,
              };
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown validation error";
      lastFailure = {
        studyInstanceUID,
        isValid: false,
        reason: "VALIDATION_ERROR",
        message: validationMessageFromReason("VALIDATION_ERROR"),
        attempts: attempt,
        endpointUrls,
        responseStatus,
      };
      logger.error({
        message: "DICOMWeb validation unexpected error",
        studyInstanceUID,
        tenantId: tenantId ?? null,
        attempt,
        error: message,
      });
    }

    if (attempt < maxAttempts) {
      await delay(retryDelayMs);
    }
  }

  const failure =
    lastFailure ??
    ({
      studyInstanceUID,
      isValid: false,
      reason: "VALIDATION_ERROR",
      message: validationMessageFromReason("VALIDATION_ERROR"),
      attempts: maxAttempts,
      endpointUrls,
      responseStatus,
    } as DicomwebStudyValidationResult);

  logger.warn({
    message: "DICOMWeb validation failed",
    studyInstanceUID,
    tenantId: tenantId ?? null,
    reason: failure.reason ?? "VALIDATION_ERROR",
    attempts: failure.attempts,
    endpointUrls: failure.endpointUrls,
    responseStatus: failure.responseStatus,
  });

  return failure;
}

function isKnownOhifOrigin(origin: string): boolean {
  const ohifUrls = [env.OHIF_BASE_URL, env.OHIF_PUBLIC_BASE_URL].filter(Boolean);
  try {
    const reqOrigin = new URL(origin).origin;
    return ohifUrls.some((url) => {
      try { return new URL(url).origin === reqOrigin; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function ensureDicomwebAccess(req: Request, res: Response, next: NextFunction): void {
  const accessToken = req.params.accessToken;
  if (typeof accessToken === "string" && accessToken.trim()) {
    const requestStudyUID = getRequestedStudyUID(req);
    const tokenResult = verifyWeasisAccessToken(accessToken, requestStudyUID);
    if (!tokenResult.valid) {
      logger.warn({
        message: "Weasis access token rejected",
        path: req.path,
        hasRequestStudyUID: Boolean(requestStudyUID),
      });
      res.status(401).json({ error: "Invalid or expired Weasis access token" });
      return;
    }
    logger.info({
      message: "Weasis DICOMweb access granted",
      path: req.path,
      tokenStudyUID: tokenResult.studyUID,
      tenantSlug: tokenResult.tenantSlug ?? null,
    });
    if (tokenResult.tenantSlug) {
      const gwReq = req as GatewayRequest;
      gwReq.tenantSlug = tokenResult.tenantSlug;
    }
    (req as unknown as Record<string, unknown>).weasisStudyUID = tokenResult.studyUID;
    next();
    return;
  }

  // Allow DICOMweb requests from the OHIF viewer origin.
  // Cross-origin fetch from the OHIF iframe cannot carry the session cookie
  // (SameSite=lax blocks it), so we trust the OHIF origin explicitly.
  const requestOrigin = req.get("origin") || "";
  const requestReferer = req.get("referer") || "";
  if (requestOrigin && isKnownOhifOrigin(requestOrigin)) {
    next();
    return;
  }
  if (!requestOrigin && requestReferer && isKnownOhifOrigin(requestReferer)) {
    next();
    return;
  }

  if (!env.ENABLE_AUTH || req.session.user) {
    ensureAuthenticated(req, res, next);
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

/** Resolve a SOP Instance UID to a local DICOM file path (uses cached map) */
function resolveFilePath(sopUID: string): string | null {
  return resolveFilePathFast(sopUID);
}

/** Parse key DICOM tags from a file for metadata responses */
const dicomTagCache = new Map<string, Record<string, unknown>>();

function parseDicomTags(filePath: string): Record<string, unknown> {
  const cached = dicomTagCache.get(filePath);
  if (cached) return cached;

  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });

    const getString = (tag: string) => dataSet.string(tag) || undefined;
    const getUint16 = (tag: string) => {
      const el = dataSet.elements[tag];
      return el ? dataSet.uint16(tag) : undefined;
    };
    const getFloat = (tag: string): number | undefined => {
      const el = dataSet.elements[tag];
      if (!el) return undefined;
      const v = dataSet.floatString(tag);
      return v !== undefined && !isNaN(v) ? v : undefined;
    };
    const getFloatArray = (tag: string): number[] | undefined => {
      const raw = getString(tag);
      if (!raw) return undefined;
      const parts = raw.split("\\").map(Number);
      return parts.every((n) => !isNaN(n)) ? parts : undefined;
    };

    const tags: Record<string, unknown> = {
      sopClassUID: getString("x00080016"),
      transferSyntaxUID: getString("x00020010"),
      rows: getUint16("x00280010"),
      columns: getUint16("x00280011"),
      bitsAllocated: getUint16("x00280100"),
      bitsStored: getUint16("x00280101"),
      highBit: getUint16("x00280102"),
      pixelRepresentation: getUint16("x00280103"),
      samplesPerPixel: getUint16("x00280002"),
      photometricInterpretation: getString("x00280004"),
      windowCenter: getString("x00281050"),
      windowWidth: getString("x00281051"),
      numberOfFrames: getString("x00280008"),
      instanceNumber: getString("x00200013"),
      seriesDescription: getString("x0008103e"),
      imagePositionPatient: getFloatArray("x00200032"),
      imageOrientationPatient: getFloatArray("x00200037"),
      pixelSpacing: getFloatArray("x00280030"),
      sliceThickness: getFloat("x00180050"),
      rescaleIntercept: getFloat("x00281052"),
      rescaleSlope: getFloat("x00281053"),
      studyDescription: getString("x00081030"),
      seriesNumber: getString("x00200011"),
    };

    dicomTagCache.set(filePath, tags);
    return tags;
  } catch {
    return {};
  }
}

const STRING_VRS = new Set([
  "AE", "AS", "CS", "DA", "DT", "LO", "LT", "SH", "ST", "TM", "UC", "UI", "UR", "UT",
]);
const BINARY_VRS = new Set(["OB", "OD", "OF", "OL", "OW", "UN"]);

function parserTagToDicomTag(tag: string): string {
  return tag.replace(/^x/i, "").toUpperCase();
}

function splitDicomValues(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("\\")
    .map((part) => part.replace(/\0/g, "").trim())
    .filter((part) => part.length > 0);
}

function readElementValues(
  dataSet: dicomParser.DataSet,
  parserTag: string,
  vr: string,
): unknown[] | undefined {
  if (BINARY_VRS.has(vr)) return undefined;
  const element = dataSet.elements[parserTag];
  if (!element || element.length <= 0) {
    return undefined;
  }

  if (vr === "PN") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => ({ Alphabetic: v }));
  }
  if (vr === "US") {
    const count = Math.floor(element.length / 2);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.uint16(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "SS") {
    const count = Math.floor(element.length / 2);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.int16(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "UL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.uint32(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "SL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.int32(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "FL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.float(parserTag, i);
      if (value !== undefined && Number.isFinite(value)) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "FD") {
    const count = Math.floor(element.length / 8);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.double(parserTag, i);
      if (value !== undefined && Number.isFinite(value)) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "IS") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => {
      const parsed = Number.parseInt(v, 10);
      return Number.isFinite(parsed) ? parsed : v;
    });
  }
  if (vr === "DS") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => {
      const parsed = Number.parseFloat(v);
      return Number.isFinite(parsed) ? parsed : v;
    });
  }
  if (STRING_VRS.has(vr) || vr === "AT") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values;
  }
  return undefined;
}

function convertDataSetToDicomJson(
  dataSet: dicomParser.DataSet,
  bulkDataURI?: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const elements = dataSet.elements as Record<string, dicomParser.Element>;

  for (const parserTag of Object.keys(elements).sort()) {
    const element = elements[parserTag];
    if (!element) continue;

    const tag = parserTagToDicomTag(parserTag);
    const vr = String(element.vr || "").toUpperCase();
    if (!vr) continue;

    if (vr === "SQ") {
      const items: Record<string, unknown>[] = [];
      for (const item of element.items ?? []) {
        const itemDataSet = (item as unknown as { dataSet?: dicomParser.DataSet }).dataSet;
        if (!itemDataSet) continue;
        const converted = convertDataSetToDicomJson(itemDataSet);
        if (Object.keys(converted).length > 0) {
          items.push(converted);
        }
      }
      metadata[tag] = { vr, Value: items };
      continue;
    }

    if (tag === "7FE00010" && bulkDataURI) {
      metadata[tag] = { vr, BulkDataURI: bulkDataURI };
      continue;
    }

    const values = readElementValues(dataSet, parserTag, vr);
    if (values && values.length > 0) {
      metadata[tag] = { vr, Value: values };
    } else {
      metadata[tag] = { vr };
    }
  }

  return metadata;
}

function parseRichDicomMetadata(
  filePath: string,
  bulkDataURI: string,
): Record<string, unknown> | null {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
    const metadata = convertDataSetToDicomJson(dataSet, bulkDataURI);
    return Object.keys(metadata).length > 0 ? metadata : null;
  } catch {
    return null;
  }
}

function applyMetadataOverrides(
  metadata: Record<string, unknown>,
  patient: DicoogleDIMPatient,
  studyUID: string,
  seriesUID: string,
  sopUID: string,
  modality: string,
  bulkDataURI: string,
): Record<string, unknown> {
  const result = { ...metadata };

  result["00080018"] = { vr: "UI", Value: [sopUID] };
  result["0020000D"] = { vr: "UI", Value: [studyUID] };
  result["0020000E"] = { vr: "UI", Value: [seriesUID] };
  result["00080060"] = { vr: "CS", Value: [modality || "OT"] };
  result["00100010"] = { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] };
  result["00100020"] = { vr: "LO", Value: [patient.id || ""] };
  const transferSyntaxTag = result["00020010"] as { Value?: unknown[] } | undefined;
  const transferSyntaxValue =
    transferSyntaxTag && Array.isArray(transferSyntaxTag.Value)
      ? normalizeDicomUid(String(transferSyntaxTag.Value[0] ?? ""))
      : null;
  result["00020010"] = {
    vr: "UI",
    Value: [getEffectiveFrameTransferSyntaxUID(transferSyntaxValue ?? undefined)],
  };

  const pixelDataAttr = result["7FE00010"] as Record<string, unknown> | undefined;
  if (pixelDataAttr) {
    result["7FE00010"] = {
      vr: String(pixelDataAttr.vr || "OW"),
      BulkDataURI: bulkDataURI,
    };
  } else {
    result["7FE00010"] = { vr: "OW", BulkDataURI: bulkDataURI };
  }

  return result;
}

const OHIF_REQUIRED_IMAGE_METADATA_TAGS = [
  "00080016",
  "00280002",
  "00280004",
  "00280008",
  "00280010",
  "00280011",
  "00280100",
  "00280101",
  "00280102",
  "00280103",
  "7FE00010",
] as const;

function getMissingImageMetadataTags(metadata: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const tag of OHIF_REQUIRED_IMAGE_METADATA_TAGS) {
    if (!(tag in metadata)) {
      missing.push(tag);
    }
  }
  return missing;
}

function fillMissingMetadataTags(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...primary };
  for (const [tag, value] of Object.entries(fallback)) {
    if (!(tag in merged)) {
      merged[tag] = value;
    }
  }
  return merged;
}

/** Resolve a SOP Instance UID to a DICOM file path via Dicoogle DIM data */
function resolveFilePathFromDIM(image: DicoogleDIMImage): string | null {
  return resolveExistingImagePath(image);
}

const NON_IMAGE_SOP_CLASSES = new Set([
  "1.2.840.10008.5.1.4.1.1.88.11",  // Basic Text SR
  "1.2.840.10008.5.1.4.1.1.88.22",  // Enhanced SR
  "1.2.840.10008.5.1.4.1.1.88.33",  // Comprehensive SR
  "1.2.840.10008.5.1.4.1.1.88.34",  // Comprehensive 3D SR
  "1.2.840.10008.5.1.4.1.1.88.35",  // Extensible SR
  "1.2.840.10008.5.1.4.1.1.88.40",  // Procedure Log
  "1.2.840.10008.5.1.4.1.1.88.50",  // Mammography CAD SR
  "1.2.840.10008.5.1.4.1.1.88.65",  // Chest CAD SR
  "1.2.840.10008.5.1.4.1.1.88.67",  // X-Ray Radiation Dose SR
  "1.2.840.10008.5.1.4.1.1.88.69",  // Simplified Adult Echo SR
  "1.2.840.10008.5.1.4.1.1.88.71",  // Radiopharmaceutical Radiation Dose SR
  "1.2.840.10008.5.1.4.1.1.88.74",  // Acquisition Context SR
  "1.2.840.10008.5.1.4.1.1.11.1",   // Grayscale Softcopy Presentation State
  "1.2.840.10008.5.1.4.1.1.11.2",   // Color Softcopy Presentation State
  "1.2.840.10008.5.1.4.1.1.104.1",  // Encapsulated PDF
  "1.2.840.10008.5.1.4.1.1.104.2",  // Encapsulated CDA
  "1.2.840.10008.5.1.4.1.1.88.59",  // Key Object Selection Document
]);

function buildFallbackInstanceMetadata(
  patient: DicoogleDIMPatient,
  studyUID: string,
  seriesUID: string,
  sopUID: string,
  modality: string,
  bulkDataURI: string,
  image?: DicoogleDIMImage,
): Record<string, unknown> {
  let tags: Record<string, unknown> = {};
  if (image) {
    const filePath = resolveFilePathFromDIM(image);
    if (filePath) tags = parseDicomTags(filePath);
  }

  const sopClassUID = (tags.sopClassUID as string) || "1.2.840.10008.5.1.4.1.1.4";
  const isNonImage = NON_IMAGE_SOP_CLASSES.has(sopClassUID);

  const meta: Record<string, unknown> = {
    "00080016": { vr: "UI", Value: [sopClassUID] },
    "00080018": { vr: "UI", Value: [sopUID] },
    "00080060": { vr: "CS", Value: [modality || "OT"] },
    "00200013": { vr: "IS", Value: [tags.instanceNumber || "1"] },
    "0008103E": { vr: "LO", Value: [tags.seriesDescription || ""] },
    "0020000D": { vr: "UI", Value: [studyUID] },
    "0020000E": { vr: "UI", Value: [seriesUID] },
    "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
    "00100020": { vr: "LO", Value: [patient.id || ""] },
    "00020010": {
      vr: "UI",
      Value: [getEffectiveFrameTransferSyntaxUID(tags.transferSyntaxUID as string | undefined)],
    },
  };

  if (tags.studyDescription) {
    meta["00081030"] = { vr: "LO", Value: [tags.studyDescription] };
  }
  if (tags.seriesNumber) {
    meta["00200011"] = { vr: "IS", Value: [tags.seriesNumber] };
  }

  if (!isNonImage) {
    meta["00280002"] = { vr: "US", Value: [tags.samplesPerPixel ?? 1] };
    meta["00280004"] = { vr: "CS", Value: [tags.photometricInterpretation || "MONOCHROME2"] };
    meta["00280008"] = { vr: "IS", Value: [tags.numberOfFrames || "1"] };
    meta["00280010"] = { vr: "US", Value: [tags.rows ?? 256] };
    meta["00280011"] = { vr: "US", Value: [tags.columns ?? 256] };
    meta["00280100"] = { vr: "US", Value: [tags.bitsAllocated ?? 16] };
    meta["00280101"] = { vr: "US", Value: [tags.bitsStored ?? 16] };
    meta["00280102"] = { vr: "US", Value: [tags.highBit ?? 15] };
    meta["00280103"] = { vr: "US", Value: [tags.pixelRepresentation ?? 0] };
    meta["00281050"] = { vr: "DS", Value: [tags.windowCenter || "2048"] };
    meta["00281051"] = { vr: "DS", Value: [tags.windowWidth || "4096"] };

    const ipp = tags.imagePositionPatient as number[] | undefined;
    meta["00200032"] = { vr: "DS", Value: ipp && ipp.length === 3 ? ipp : [0, 0, 0] };

    const iop = tags.imageOrientationPatient as number[] | undefined;
    meta["00200037"] = { vr: "DS", Value: iop && iop.length === 6 ? iop : [1, 0, 0, 0, 1, 0] };

    const ps = tags.pixelSpacing as number[] | undefined;
    meta["00280030"] = { vr: "DS", Value: ps && ps.length === 2 ? ps : [1, 1] };

    if (tags.sliceThickness != null) {
      meta["00180050"] = { vr: "DS", Value: [tags.sliceThickness] };
    }

    const rescaleIntercept = tags.rescaleIntercept as number | undefined;
    meta["00281052"] = { vr: "DS", Value: [rescaleIntercept ?? 0] };

    const rescaleSlope = tags.rescaleSlope as number | undefined;
    meta["00281053"] = { vr: "DS", Value: [rescaleSlope ?? 1] };

    meta["7FE00010"] = { vr: "OW", BulkDataURI: bulkDataURI };
  }

  return meta;
}

/** Build DICOM JSON metadata for a single instance with all tags cornerstone needs */
function buildInstanceMetadata(
  patient: DicoogleDIMPatient,
  studyUID: string,
  seriesUID: string,
  sopUID: string,
  modality: string,
  bulkDataURI: string,
  image?: DicoogleDIMImage,
): Record<string, unknown> {
  if (image) {
    const filePath = resolveFilePathFromDIM(image);
    if (filePath) {
      const richMetadata = parseRichDicomMetadata(filePath, bulkDataURI);
      if (richMetadata) {
        const metadataWithOverrides = applyMetadataOverrides(
          richMetadata,
          patient,
          studyUID,
          seriesUID,
          sopUID,
          modality,
          bulkDataURI,
        );
        const missingTags = getMissingImageMetadataTags(metadataWithOverrides);
        if (missingTags.length === 0) {
          return metadataWithOverrides;
        }
        const fallbackMetadata = buildFallbackInstanceMetadata(
          patient,
          studyUID,
          seriesUID,
          sopUID,
          modality,
          bulkDataURI,
          image,
        );
        logger.debug({
          message: "Rich DICOM metadata missing required image tags — filling from fallback parser",
          sopUID,
          missingTags,
        });
        return fillMissingMetadataTags(metadataWithOverrides, fallbackMetadata);
      }
    }
  }

  return buildFallbackInstanceMetadata(
    patient,
    studyUID,
    seriesUID,
    sopUID,
    modality,
    bulkDataURI,
    image,
  );
}

/**
 * Given a StudyInstanceUID, return ALL StudyInstanceUIDs that belong to the
 * same patient according to DIM data. When DIM returns the same StudyInstanceUID
 * under multiple patient buckets, use patient hints (PatientID/PatientName)
 * to avoid cross-patient contamination.
 */
type StudyGroupCandidate = {
  patientId: string;
  patientName: string;
  identityKey: string;
  uids: string[];
};

const PLACEHOLDER_PATIENT_IDENTIFIERS = new Set(["", "unknown", "anon", "anonymous", "none", "n/a", "na", "unspecified"]);

function normalizeIdentityValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\^+/g, " ")
    .replace(/\s+/g, " ");
}

function isUsableIdentityValue(value: string | undefined): boolean {
  const normalized = normalizeIdentityValue(value);
  if (!normalized) return false;
  return !PLACEHOLDER_PATIENT_IDENTIFIERS.has(normalized);
}

function normalizePatientNameIdentity(value: string | undefined): string {
  const normalized = normalizeIdentityValue(value);
  if (!normalized) return "";
  // Match "Last^First" and "First Last" equally.
  return normalized
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function buildStudyGroupCandidatesByUid(
  patients: DicoogleDIMPatient[],
): Map<string, StudyGroupCandidate[]> {
  const candidateMap = new Map<string, StudyGroupCandidate[]>();
  for (let patientIndex = 0; patientIndex < patients.length; patientIndex += 1) {
    const patient = patients[patientIndex]!;
    const uids = Array.from(new Set(patient.studies.map((s) => s.studyInstanceUID).filter(Boolean)));
    if (uids.length === 0) continue;
    const patientId = patient.id || "";
    const patientName = patient.name || "";
    const normalizedPatientId = normalizeIdentityValue(patientId);
    const normalizedPatientName = normalizePatientNameIdentity(patientName);
    const hasUsablePatientId = isUsableIdentityValue(patientId);
    const hasUsablePatientName = normalizedPatientName.length > 0 && isUsableIdentityValue(patientName);
    const identityKey =
      hasUsablePatientId || hasUsablePatientName
        ? `${hasUsablePatientId ? normalizedPatientId : ""}|${hasUsablePatientName ? normalizedPatientName : ""}`
        : `__unknown__:${patientIndex}:${uids.join(",")}`;
    const candidate: StudyGroupCandidate = { patientId, patientName, identityKey, uids };
    for (const uid of uids) {
      const list = candidateMap.get(uid);
      if (list) {
        list.push(candidate);
      } else {
        candidateMap.set(uid, [candidate]);
      }
    }
  }
  return candidateMap;
}

function finalizeResolvedUids(studyInstanceUid: string, uids: string[]): string[] {
  const ordered = [studyInstanceUid, ...uids.filter((uid) => uid !== studyInstanceUid)];
  return Array.from(new Set(ordered.filter(Boolean)));
}

export async function getStudyUidsForSamePatient(
  studyInstanceUid: string,
  options?: { patientIdHint?: string; patientNameHint?: string },
): Promise<string[]> {
  const patients = await queryDicoogleDIM();
  const candidateMap = buildStudyGroupCandidatesByUid(patients);
  const candidates = candidateMap.get(studyInstanceUid) ?? [];

  const patientIdHint = isUsableIdentityValue(options?.patientIdHint)
    ? normalizeIdentityValue(options?.patientIdHint)
    : "";
  const patientNameHint = isUsableIdentityValue(options?.patientNameHint)
    ? normalizePatientNameIdentity(options?.patientNameHint)
    : "";

  let selectedUids: string[] = [studyInstanceUid];

  if (candidates.length === 1) {
    selectedUids = candidates[0]!.uids;
  } else if (candidates.length > 1) {
    const scored = candidates.map((candidate) => {
      let score = 0;
      if (patientIdHint && normalizeIdentityValue(candidate.patientId) === patientIdHint) {
        score += 4;
      }
      if (patientNameHint && normalizePatientNameIdentity(candidate.patientName) === patientNameHint) {
        score += 2;
      }
      return { candidate, score };
    });

    const bestScore = Math.max(...scored.map((entry) => entry.score));
    if (bestScore > 0) {
      const top = scored.filter((entry) => entry.score === bestScore);
      const topIdentityCount = new Set(top.map((entry) => entry.candidate.identityKey)).size;
      if (topIdentityCount === 1) {
        selectedUids = top[0]!.candidate.uids;
      }
    } else {
      // Ambiguous UID (same study under multiple patients) with no usable hint:
      // prefer safety and keep only the requested study.
      selectedUids = [studyInstanceUid];
    }
  }

  const resolved = finalizeResolvedUids(studyInstanceUid, selectedUids);
  return resolved;
}

/**
 * Build a Map<studyUID, studyUID[]> from DIM data so callers can look up
 * all sibling study UIDs for any study in O(1) after the initial build.
 */
export async function buildPatientStudyGroupMap(): Promise<Map<string, string[]>> {
  const patients = await queryDicoogleDIM();
  const candidateMap = buildStudyGroupCandidatesByUid(patients);
  const out = new Map<string, string[]>();
  for (const [studyUid, candidates] of candidateMap) {
    if (candidates.length === 1) {
      out.set(studyUid, finalizeResolvedUids(studyUid, candidates[0]!.uids));
      continue;
    }
    const identityCount = new Set(candidates.map((candidate) => candidate.identityKey)).size;
    if (identityCount === 1) {
      out.set(studyUid, finalizeResolvedUids(studyUid, candidates[0]!.uids));
    } else {
      // Do not cross-link study groups across conflicting patient identities.
      out.set(studyUid, [studyUid]);
    }
  }
  return out;
}

export function dicomwebRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(ensureDicomwebAccess);

  // Pre-warm the DIM cache on startup (non-blocking)
  setTimeout(() => {
    queryDicoogleDIM().catch(() => {});
  }, 3000);

  // Cache warm endpoint — called after upload to pre-load DIM data
  router.post("/warm", ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      clearDimCache();
      await queryDIMForRequest(req);
      res.json({ ok: true, cached: dimCache ? dimCache.data.length : 0 });
    } catch {
      res.json({ ok: false });
    }
  });

  // WADO-URI: Retrieve full DICOM object — used when imageRendering='wadouri'
  // URL: /dicomweb?requestType=WADO&studyUID=...&seriesUID=...&objectUID=...&contentType=application/dicom
  router.get("/", async (req: Request, res: Response, next) => {
    if (req.query.requestType !== "WADO") {
      next();
      return;
    }
    try {
      const objectUID = req.query.objectUID as string;
      if (!objectUID) {
        res.status(400).json({ error: "objectUID is required" });
        return;
      }
      await queryDIMForRequest(req);
      const filePath = resolveFilePathFast(objectUID);
      if (!filePath) {
        res.status(404).json({ error: "DICOM file not found" });
        return;
      }
      const dicomBuffer = rewriteSopUidInDicomBuffer(fs.readFileSync(filePath), objectUID);
      res.setHeader("Content-Type", "application/dicom");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(dicomBuffer);
    } catch (err) {
      console.error("WADO-URI error:", err);
      res.status(500).json({ error: "Failed to retrieve DICOM object" });
    }
  });

  // QIDO-RS: Search for studies
  // Patient isolation: at least one scoping filter (StudyInstanceUID, PatientID,
  // or PatientName) is required. Unscoped queries that would expose every
  // patient's data are rejected.
  router.get("/studies", async (req: Request, res: Response) => {
    try {
      const filterPatientID = req.query.PatientID as string | undefined;
      const filterPatientName = req.query.PatientName as string | undefined;
      const filterStudyUIDs = parseStudyInstanceUidFilters(req.query);
      const filterStudyDate = req.query.StudyDate as string | undefined;
      const filterModality = req.query.ModalitiesInStudy as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const weasisStudyUID = (req as unknown as Record<string, unknown>).weasisStudyUID as string | undefined;
      if (weasisStudyUID && filterStudyUIDs.length === 0) {
        filterStudyUIDs.push(weasisStudyUID);
      }

      const hasPatientScope = !!(
        filterStudyUIDs.length > 0 ||
        filterPatientID ||
        (filterPatientName && filterPatientName.replace(/\*/g, ""))
      );

      // In multi-tenant mode, tenant scoping replaces the patient-scope requirement
      const gwReq = req as GatewayRequest;
      const isTenantScoped = env.MULTI_TENANT_ENABLED && !!gwReq.tenantSlug;

      if (!hasPatientScope && !isTenantScoped) {
        res.json([]);
        return;
      }

      const patients = await queryDIMForRequest(req);
      const studies: Record<string, unknown>[] = [];

      // Aggregate study data across all patients sharing the same StudyInstanceUID
      const studyAgg = new Map<string, {
        patient: DicoogleDIMPatient;
        study: DicoogleDIMStudy;
        seriesMap: Map<string, { series: DicoogleDIMSeries; instanceCount: number }>;
      }>();

      for (const patient of patients) {
        if (filterPatientID && patient.id !== filterPatientID) continue;
        if (filterPatientName) {
          const pattern = filterPatientName.replace(/\*/g, "");
          if (pattern && !patient.name.toLowerCase().includes(pattern.toLowerCase())) continue;
        }

        for (const study of patient.studies) {
          if (filterStudyUIDs.length > 0 && !filterStudyUIDs.includes(study.studyInstanceUID)) continue;
          if (filterStudyDate && study.studyDate !== filterStudyDate) continue;

          let agg = studyAgg.get(study.studyInstanceUID);
          if (!agg) {
            agg = { patient, study, seriesMap: new Map() };
            studyAgg.set(study.studyInstanceUID, agg);
          }

          for (const series of study.series) {
            const instanceCount = series.images.reduce((count, image) => {
              return resolveUsableImagePath(image) ? count + 1 : count;
            }, 0);
            const existing = agg.seriesMap.get(series.serieInstanceUID);
            if (existing) {
              existing.instanceCount += instanceCount;
            } else {
              agg.seriesMap.set(series.serieInstanceUID, { series, instanceCount });
            }
          }
        }
      }

      for (const [studyUID_agg, agg] of studyAgg) {
        const seriesWithInstances = [...agg.seriesMap.values()].filter(({ instanceCount }) => instanceCount > 0);

        if (seriesWithInstances.length === 0) {
          continue;
        }

        const modalities = seriesWithInstances
          .map(({ series }) => series.serieModality)
          .filter(Boolean);
        if (filterModality && !modalities.includes(filterModality)) continue;

        const instanceCount = seriesWithInstances.reduce(
          (sum, { instanceCount: seriesCount }) => sum + seriesCount,
          0,
        );

        const { patient, study } = agg;
        studies.push({
          "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
          "00080020": { vr: "DA", Value: [study.studyDate || ""] },
          "00080030": { vr: "TM", Value: [""] },
          "00080050": { vr: "SH", Value: [""] },
          "00080061": { vr: "CS", Value: modalities },
          "00080090": { vr: "PN", Value: [{ Alphabetic: "" }] },
          "00081030": { vr: "LO", Value: [study.studyDescription || ""] },
          "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
          "00100020": { vr: "LO", Value: [patient.id || ""] },
          "00100030": { vr: "DA", Value: [patient.birthdate || ""] },
          "00100040": { vr: "CS", Value: [patient.gender || ""] },
          "0020000D": { vr: "UI", Value: [studyUID_agg] },
          "00200010": { vr: "SH", Value: [""] },
          "00201206": { vr: "IS", Value: [seriesWithInstances.length] },
          "00201208": { vr: "IS", Value: [instanceCount] },
        });
      }

      const paged = limit ? studies.slice(offset, offset + limit) : studies.slice(offset);
      logger.info({
        message: "QIDO /studies response",
        studyCount: paged.length,
        totalStudyCount: studies.length,
      });
      res.json(paged);
    } catch (err) {
      console.error("QIDO-RS /studies error:", err);
      res.json([]);
    }
  });

  // Validation endpoint: runs QIDO → Series → Instances → WADO frame checks.
  router.get("/studies/:studyUID/validate", async (req: Request, res: Response) => {
    const studyUID = String(req.params.studyUID ?? "");
    const tenantId = req.get("x-tenant-id")?.trim() || undefined;
    const validation = await validateStudyAvailability({
      studyInstanceUID: studyUID,
      dicomwebBaseUrl: getDicomwebBaseUrl(req),
      tenantId,
    });

    if (validation.isValid) {
      res.json(validation);
      return;
    }

    const statusCode = validation.reason === "STUDY_NOT_FOUND" ? 404 : 409;
    res.status(statusCode).json(validation);
  });

  // QIDO-RS: List series for a study
  router.get("/studies/:studyUID/series", async (req: Request, res: Response) => {
    try {
      const { studyUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const seen = new Set<string>();
      const seriesList: Record<string, unknown>[] = [];

      const seriesAggregated = new Map<string, { modality: string; description: string; number: number; instanceCount: number }>();
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            const instanceCount = series.images.reduce((count, image) => {
              return resolveUsableImagePath(image) ? count + 1 : count;
            }, 0);
            const existing = seriesAggregated.get(series.serieInstanceUID);
            if (existing) {
              existing.instanceCount += instanceCount;
            } else {
              seriesAggregated.set(series.serieInstanceUID, {
                modality: series.serieModality || "",
                description: series.serieDescription || "",
                number: series.serieNumber,
                instanceCount,
              });
            }
          }
        }
      }
      for (const [seriesUID, info] of seriesAggregated) {
        if (info.instanceCount === 0) {
          continue;
        }
        seen.add(seriesUID);
        seriesList.push({
          "00080060": { vr: "CS", Value: [info.modality] },
          "0008103E": { vr: "LO", Value: [info.description] },
          "00200011": { vr: "IS", Value: [info.number] },
          "0020000D": { vr: "UI", Value: [studyUID] },
          "0020000E": { vr: "UI", Value: [seriesUID] },
          "00201209": { vr: "IS", Value: [info.instanceCount] },
        });
      }
      logger.info({
        message: "QIDO /studies/{studyUID}/series response",
        studyUID,
        seriesCount: seriesList.length,
      });
      res.json(seriesList);
    } catch (err) {
      console.error("QIDO-RS /studies/:studyUID/series error:", err);
      res.json([]);
    }
  });

  // QIDO-RS: List instances for a series
  router.get("/studies/:studyUID/series/:seriesUID/instances", async (req: Request, res: Response) => {
    try {
      const { studyUID, seriesUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const instances: Record<string, unknown>[] = [];
      const seenInstanceKeys = new Set<string>();

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const imgFilePath = resolveUsableImagePath(image);
              if (!imgFilePath) {
                continue;
              }
              const instanceKey = `${image.sopInstanceUID}|${imgFilePath}`;
              if (seenInstanceKeys.has(instanceKey)) {
                continue;
              }
              seenInstanceKeys.add(instanceKey);
              const bulkUri =
                `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}` +
                `/instances/${image.sopInstanceUID}/frames/1`;
              instances.push(
                buildInstanceMetadata(
                  patient,
                  studyUID,
                  seriesUID,
                  image.sopInstanceUID,
                  series.serieModality,
                  bulkUri,
                  image,
                ),
              );
            }
          }
        }
      }

      logger.info({
        message: "QIDO /studies/{studyUID}/series/{seriesUID}/instances response",
        studyUID,
        seriesUID,
        instanceCount: instances.length,
      });
      res.json(instances);
    } catch (err) {
      console.error("QIDO-RS instances error:", err);
      res.json([]);
    }
  });

  // WADO-RS: Retrieve series (all instances in one series)
  router.get("/studies/:studyUID/series/:seriesUID", async (req: Request, res: Response) => {
    try {
      const { studyUID, seriesUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const filePathSet = new Set<string>();

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const filePath = resolveUsableImagePath(image);
              if (filePath) {
                filePathSet.add(filePath);
              }
            }
          }
        }
      }

      const filePaths = Array.from(filePathSet).filter((filePath) => isNonEmptyDicomFile(filePath));
      if (filePaths.length === 0) {
        res.status(404).json({ error: "No DICOM files found for this series" });
        return;
      }

      logger.info({
        message: "WADO series retrieve response",
        studyUID,
        seriesUID,
        instanceCount: filePaths.length,
      });
      streamMultipartDicomFiles(res, filePaths);
    } catch (err) {
      console.error("WADO-RS series retrieve error:", err);
      res.status(500).json({ error: "Failed to retrieve series" });
    }
  });

  // WADO-RS: Retrieve DICOM instance (multipart/related response)
  router.get(
    "/studies/:studyUID/series/:seriesUID/instances/:sopUID",
    async (req: Request, res: Response) => {
      try {
        const sopUID = req.params.sopUID as string;
        const filePath = await resolveWadoFilePath(req, sopUID);

        if (!filePath) {
          res.status(404).json({ error: "DICOM file not found" });
          return;
        }

        const dicomBuffer = rewriteSopUidInDicomBuffer(fs.readFileSync(filePath), sopUID);
        const boundary = "dicoogle-boundary";

        res.setHeader(
          "Content-Type",
          `multipart/related; type="application/dicom"; boundary=${boundary}`,
        );
        res.setHeader("Cache-Control", "public, max-age=3600");

        const header = Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`);
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

        res.write(header);
        res.write(dicomBuffer);
        res.end(footer);
      } catch (err) {
        console.error("WADO-RS retrieve error:", err);
        res.status(500).json({ error: "Failed to retrieve DICOM instance" });
      }
    },
  );

  // WADO-RS: Retrieve frames (pixel data) — cornerstone.js requests this
  router.get(
    "/studies/:studyUID/series/:seriesUID/instances/:sopUID/frames/:frameNumbers",
    async (req: Request, res: Response) => {
      try {
        const sopUID = req.params.sopUID as string;
        const filePath = await resolveWadoFilePath(req, sopUID);

        if (!filePath) {
          res.status(404).json({ error: "DICOM file not found" });
          return;
        }

        const fileBuffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
        const dataSet = dicomParser.parseDicom(byteArray);

        const pixelDataElement = dataSet.elements["x7fe00010"];
        if (!pixelDataElement) {
          res.status(404).json({ error: "No pixel data in DICOM file" });
          return;
        }

        const transferSyntaxUID = normalizeDicomUid(dataSet.string("x00020010"));
        let pixelData: Buffer;
        const frameIndex = getRequestedFrameIndex(req.params.frameNumbers as string);

        if (pixelDataElement.encapsulatedPixelData) {
          const frameData = extractEncapsulatedFrame(dataSet, pixelDataElement, frameIndex, byteArray);
          if (!frameData) {
            res.status(404).json({ error: `Frame ${frameIndex + 1} not found` });
            return;
          }
          if (transferSyntaxUID && JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS.has(transferSyntaxUID)) {
            const decodedFrame = decodeJpegLosslessFrame(frameData, dataSet);
            if (decodedFrame) {
              pixelData = decodedFrame;
            } else {
              logger.warn({
                message: "JPEG Lossless frame decode failed — returning original encapsulated bytes",
                sopUID,
                transferSyntaxUID,
                frameIndex,
              });
              pixelData = frameData;
            }
          } else {
            pixelData = frameData;
          }
        } else {
          const nativeFrame = extractNativeFrame(dataSet, pixelDataElement, frameIndex, byteArray);
          if (!nativeFrame) {
            res.status(404).json({ error: `Frame ${frameIndex + 1} not found` });
            return;
          }
          pixelData = nativeFrame;
        }

        const mediaType = "application/octet-stream";
        const acceptHeader = (req.headers.accept || "").toLowerCase();
        res.setHeader("Cache-Control", "public, max-age=3600");

        if (acceptHeader.includes("multipart")) {
          const boundary = "dicoogle-boundary";
          res.setHeader(
            "Content-Type",
            `multipart/related; type="${mediaType}"; boundary=${boundary}`,
          );
          const header = Buffer.from(`--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`);
          const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
          res.write(header);
          res.write(pixelData);
          res.end(footer);
        } else {
          res.setHeader("Content-Type", mediaType);
          res.end(pixelData);
        }
      } catch (err) {
        console.error("WADO-RS frames error:", err);
        res.status(500).json({ error: "Failed to retrieve frames" });
      }
    },
  );

  // WADO-RS: Series-level metadata (all instances in a series)
  router.get("/studies/:studyUID/series/:seriesUID/metadata", async (req: Request, res: Response) => {
    try {
      const { studyUID, seriesUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const metadata: Record<string, unknown>[] = [];

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const imgFilePath = resolveUsableImagePath(image);
              if (!imgFilePath) {
                continue;
              }
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(
                buildInstanceMetadata(patient, studyUID, seriesUID, image.sopInstanceUID, series.serieModality, bulkUri, image),
              );
            }
          }
        }
      }

      res.json(metadata);
    } catch (err) {
      console.error("WADO-RS series metadata error:", err);
      res.json([]);
    }
  });

  // WADO-RS: Retrieve study (all instances)
  router.get("/studies/:studyUID", async (req: Request, res: Response) => {
    try {
      const { studyUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const filePathSet = new Set<string>();

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              const filePath = resolveUsableImagePath(image);
              if (filePath) {
                filePathSet.add(filePath);
              }
            }
          }
        }
      }

      const filePaths = Array.from(filePathSet).filter((filePath) => isNonEmptyDicomFile(filePath));
      if (filePaths.length === 0) {
        res.status(404).json({ error: "No DICOM files found for this study" });
        return;
      }

      logger.info({
        message: "WADO study retrieve response",
        studyUID,
        instanceCount: filePaths.length,
      });
      streamMultipartDicomFiles(res, filePaths);
    } catch (err) {
      console.error("WADO-RS study retrieve error:", err);
      res.status(500).json({ error: "Failed to retrieve study" });
    }
  });

  // WADO-RS: Retrieve metadata
  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID/metadata", async (req: Request, res: Response) => {
    try {
      const { studyUID, seriesUID, sopUID } = req.params;
      const patients = await queryDIMForRequest(req);

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              if (image.sopInstanceUID !== sopUID) continue;
              const imgFilePath = resolveUsableImagePath(image);
              if (!imgFilePath) {
                continue;
              }

              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/frames/1`;

              res.json([
                buildInstanceMetadata(patient, studyUID, seriesUID, sopUID, series.serieModality, bulkUri, image),
              ]);
              return;
            }
          }
        }
      }

      res.json([]);
    } catch (err) {
      console.error("WADO-RS metadata error:", err);
      res.json([]);
    }
  });

  // Study-level metadata
  router.get("/studies/:studyUID/metadata", async (req: Request, res: Response) => {
    try {
      const { studyUID } = req.params;
      const patients = await queryDIMForRequest(req);
      const metadata: Record<string, unknown>[] = [];

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              const imgFilePath = resolveUsableImagePath(image);
              if (!imgFilePath) {
                continue;
              }
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${series.serieInstanceUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(
                buildInstanceMetadata(patient, studyUID, series.serieInstanceUID, image.sopInstanceUID, series.serieModality, bulkUri, image),
              );
            }
          }
        }
      }

      res.json(metadata);
    } catch (err) {
      console.error("WADO-RS study metadata error:", err);
      res.json([]);
    }
  });

  return router;
}
