import { NextFunction, Request, Response, Router } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import dicomParser from "dicom-parser";
import { env } from "../config/env";
import { ensureAuthenticated } from "../middleware/auth";
import type { GatewayRequest } from "../middleware/apiGateway";
import { getDicoogleAuthHeaders } from "../services/dicoogleAuth";
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
 *   GET /studies/:studyUID/series/:seriesUID/instances/:sopUID → WADO-RS: retrieve DICOM
 */

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");

interface DicoogleSearchResult {
  uri: string;
  fields: Record<string, string>;
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
const DIM_CACHE_TTL = 120_000; // 2 minutes

// Per-tenant DIM caches: tenant slug → { data, ts }
const tenantDimCaches = new Map<string, { data: DicoogleDIMPatient[]; ts: number }>();
// Per-tenant SOP → file path maps
const tenantSopFilePathMaps = new Map<string, Map<string, string>>();

/** Built lazily for uploads stored as storage/<patientId>/*.dcm (flat basename fallback misses subfolders) */
let storedBasenameToPathCache: Map<string, string> | null = null;

/** Clear the DIM cache so next request fetches fresh data from Dicoogle */
export function clearDimCache(): void {
  dimCache = null;
  sopFilePathMap.clear();
  dicomTagCache.clear();
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

    const studyUID = ds.string("x0020000d") ?? "";
    const seriesUID = ds.string("x0020000e") ?? "";
    const sopUID = ds.string("x00080018") ?? "";
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

function findDicomFilesRecursive(dir: string, maxDepth = 3, depth = 0): string[] {
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

/** Locate a stored DICOM by basename under the full storage tree (patient/tenant subfolders). */
function findStoredFileByBasename(filename: string): string | null {
  if (!filename) return null;
  if (!storedBasenameToPathCache) {
    storedBasenameToPathCache = new Map<string, string>();
    for (const p of findDicomFilesRecursive(DICOOGLE_STORAGE_DIR, 16)) {
      storedBasenameToPathCache.set(path.basename(p), p);
    }
  }
  return storedBasenameToPathCache.get(filename) ?? null;
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

function scanStorageForDIM(): DicoogleDIMPatient[] {
  const patientMap = new Map<string, DicoogleDIMPatient>();
  const dicomFiles = findDicomFilesRecursive(DICOOGLE_STORAGE_DIR);

  for (const filePath of dicomFiles) {
    const ds = parseDicomHeaderFromFile(filePath);
    if (!ds) continue;

    const studyUID = ds.string("x0020000d");
    const seriesUID = ds.string("x0020000e");
    const sopUID = ds.string("x00080018")?.trim() ?? "";
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
  const endpoints = Array.from(
    new Set(
      [
        env.DICOOGLE_BASE_URL,
        env.DICOOGLE_FALLBACK_BASE_URL,
        "http://tdairad-dicoogle.internal",
        "http://tdairad-dicoogle.flycast",
        "https://tdairad-dicoogle.fly.dev",
      ].filter(Boolean),
    ),
  );

  let authHeaders: Record<string, string> = {};
  try {
    authHeaders = await getDicoogleAuthHeaders();
  } catch {
    authHeaders = {};
  }

  const endpointErrors: string[] = [];
  let querySucceeded = false;
  let noDimProvidersAvailable = false;
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
        if (axios.isAxiosError(error) && error.response?.status === 400) {
          const payload = error.response.data as { error?: unknown } | undefined;
          const apiError = typeof payload?.error === "string" ? payload.error : "";
          if (/no valid dim providers supplied/i.test(apiError)) {
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

  if (!querySucceeded) {
    if (noDimProvidersAvailable) {
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

  const tenantStorageDir = path.join(DICOOGLE_STORAGE_DIR, tenantSlug);
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

    const studyUID = ds.string("x0020000d");
    const seriesUID = ds.string("x0020000e");
    const sopUID = ds.string("x00080018")?.trim() ?? "";
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

function fileUriToPath(uri: string): string {
  // Convert file:///C:/... to C:\...
  return uri.replace(/^file:\/\/\//, "").replace(/\//g, "\\");
}

/** Resolve DIM image to a readable local path (upload layout uses nested patient directories). */
function resolveExistingImagePath(image: DicoogleDIMImage): string | null {
  if (image.rawPath && fs.existsSync(image.rawPath)) {
    return image.rawPath;
  }
  let filePath = fileUriToPath(image.uri);
  if (fs.existsSync(filePath)) return filePath;
  const flat = path.join(DICOOGLE_STORAGE_DIR, image.filename);
  if (fs.existsSync(flat)) return flat;
  return findStoredFileByBasename(image.filename);
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

function getRequestOrigin(req: Request): string | null {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!host) return null;
  return `${forwardedProto || req.protocol}://${host}`;
}

function getDicomwebBaseUrl(req: Request): string {
  return `${getRequestOrigin(req) ?? env.FRONTEND_URL.replace(/\/+$/, "")}${req.baseUrl}`;
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

export async function validateStudyAvailability({
  studyInstanceUID,
  dicomwebBaseUrl,
  tenantId,
  maxAttempts = 3,
  retryDelayMs = 2000,
}: {
  studyInstanceUID: string;
  dicomwebBaseUrl: string;
  tenantId?: string;
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        clearDimCache();
      }

      const patients = await queryDicoogleDIM();
      let matchedStudy: DicoogleDIMStudy | null = null;

      for (const patient of patients) {
        const foundStudy = patient.studies.find((study) => study.studyInstanceUID === studyInstanceUID);
        if (foundStudy) {
          matchedStudy = foundStudy;
          break;
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
          const seriesWithInstances = matchedStudy.series.find((series) => series.images.length > 0) ?? null;

          endpointUrls.qidoInstances = `${baseUrl}/studies/${studyInstanceUID}/series/${
            seriesWithInstances?.serieInstanceUID ?? matchedStudy.series[0].serieInstanceUID
          }/instances`;
          responseStatus.qidoInstances = 200;
          logger.info({
            message: "DICOMWeb validation QIDO instances check",
            studyInstanceUID,
            tenantId: tenantId ?? null,
            endpointUrl: endpointUrls.qidoInstances,
            responseStatus: 200,
            resultCount: seriesWithInstances?.images.length ?? 0,
            attempt,
          });

          if (!seriesWithInstances) {
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
            const firstInstance = seriesWithInstances.images[0];
            endpointUrls.wadoFrame =
              `${baseUrl}/studies/${studyInstanceUID}/series/${seriesWithInstances.serieInstanceUID}` +
              `/instances/${firstInstance.sopInstanceUID}/frames/1`;
            const filePath = resolveFilePath(firstInstance.sopInstanceUID);
            const frameReadable = !!(filePath && hasReadableFirstFrame(filePath));
            responseStatus.wadoFrame = frameReadable ? 200 : 404;

            logger.info({
              message: "DICOMWeb validation WADO frame check",
              studyInstanceUID,
              tenantId: tenantId ?? null,
              endpointUrl: endpointUrls.wadoFrame,
              responseStatus: responseStatus.wadoFrame,
              attempt,
            });

            if (!frameReadable) {
              lastFailure = {
                studyInstanceUID,
                isValid: false,
                reason: "WADO_FRAME_UNAVAILABLE",
                message: validationMessageFromReason("WADO_FRAME_UNAVAILABLE"),
                attempts: attempt,
                endpointUrls,
                responseStatus,
                seriesInstanceUID: seriesWithInstances.serieInstanceUID,
                sopInstanceUID: firstInstance.sopInstanceUID,
              };
            } else {
              return {
                studyInstanceUID,
                isValid: true,
                message: "Study, series, instances, and WADO frame retrieval validated",
                attempts: attempt,
                endpointUrls,
                responseStatus,
                seriesInstanceUID: seriesWithInstances.serieInstanceUID,
                sopInstanceUID: firstInstance.sopInstanceUID,
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
    (req as Record<string, unknown>).weasisStudyUID = tokenResult.studyUID;
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
    };

    dicomTagCache.set(filePath, tags);
    return tags;
  } catch {
    return {};
  }
}

/** Resolve a SOP Instance UID to a DICOM file path via Dicoogle DIM data */
function resolveFilePathFromDIM(image: DicoogleDIMImage): string | null {
  return resolveExistingImagePath(image);
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
  // Try to read actual tags from the DICOM file
  let tags: Record<string, unknown> = {};
  if (image) {
    const filePath = resolveFilePathFromDIM(image);
    if (filePath) tags = parseDicomTags(filePath);
  }

  return {
    // SOP Class UID
    "00080016": { vr: "UI", Value: [tags.sopClassUID || "1.2.840.10008.5.1.4.1.1.4"] },
    // SOP Instance UID
    "00080018": { vr: "UI", Value: [sopUID] },
    // Modality
    "00080060": { vr: "CS", Value: [modality || "OT"] },
    // Instance Number
    "00200013": { vr: "IS", Value: [tags.instanceNumber || "1"] },
    // Series Description
    "0008103E": { vr: "LO", Value: [tags.seriesDescription || ""] },
    // Study Instance UID
    "0020000D": { vr: "UI", Value: [studyUID] },
    // Series Instance UID
    "0020000E": { vr: "UI", Value: [seriesUID] },
    // Patient Name
    "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
    // Patient ID
    "00100020": { vr: "LO", Value: [patient.id || ""] },
    // Transfer Syntax UID
    "00020010": { vr: "UI", Value: [tags.transferSyntaxUID || "1.2.840.10008.1.2.1"] },
    // SamplesPerPixel
    "00280002": { vr: "US", Value: [tags.samplesPerPixel ?? 1] },
    // PhotometricInterpretation
    "00280004": { vr: "CS", Value: [tags.photometricInterpretation || "MONOCHROME2"] },
    // NumberOfFrames
    "00280008": { vr: "IS", Value: [tags.numberOfFrames || "1"] },
    // Rows
    "00280010": { vr: "US", Value: [tags.rows ?? 256] },
    // Columns
    "00280011": { vr: "US", Value: [tags.columns ?? 256] },
    // BitsAllocated
    "00280100": { vr: "US", Value: [tags.bitsAllocated ?? 16] },
    // BitsStored
    "00280101": { vr: "US", Value: [tags.bitsStored ?? 16] },
    // HighBit
    "00280102": { vr: "US", Value: [tags.highBit ?? 15] },
    // PixelRepresentation (unsigned)
    "00280103": { vr: "US", Value: [tags.pixelRepresentation ?? 0] },
    // WindowCenter
    "00281050": { vr: "DS", Value: [tags.windowCenter || "2048"] },
    // WindowWidth
    "00281051": { vr: "DS", Value: [tags.windowWidth || "4096"] },
    // Pixel Data
    "7FE00010": { vr: "OW", BulkDataURI: bulkDataURI },
  };
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
      res.setHeader("Content-Type", "application/dicom");
      res.setHeader("Cache-Control", "public, max-age=3600");
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
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

      const weasisStudyUID = (req as Record<string, unknown>).weasisStudyUID as string | undefined;
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

      for (const patient of patients) {
        if (filterPatientID && patient.id !== filterPatientID) continue;
        if (filterPatientName) {
          const pattern = filterPatientName.replace(/\*/g, "");
          if (pattern && !patient.name.toLowerCase().includes(pattern.toLowerCase())) continue;
        }

        for (const study of patient.studies) {
          if (filterStudyUIDs.length > 0 && !filterStudyUIDs.includes(study.studyInstanceUID)) continue;
          if (filterStudyDate && study.studyDate !== filterStudyDate) continue;
          const modalities = study.series.map((s) => s.serieModality).filter(Boolean);
          if (filterModality && !modalities.includes(filterModality)) continue;

          const instanceCount = study.series.reduce((sum, s) => sum + s.images.length, 0);

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
            "0020000D": { vr: "UI", Value: [study.studyInstanceUID] },
            "00200010": { vr: "SH", Value: [""] },
            "00201206": { vr: "IS", Value: [study.series.length] },
            "00201208": { vr: "IS", Value: [instanceCount] },
          });
        }
      }

      const paged = limit ? studies.slice(offset, offset + limit) : studies.slice(offset);
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

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (seen.has(series.serieInstanceUID)) continue;
            seen.add(series.serieInstanceUID);
            seriesList.push({
              "00080060": { vr: "CS", Value: [series.serieModality || ""] },
              "0008103E": { vr: "LO", Value: [series.serieDescription || ""] },
              "00200011": { vr: "IS", Value: [series.serieNumber] },
              "0020000D": { vr: "UI", Value: [studyUID] },
              "0020000E": { vr: "UI", Value: [series.serieInstanceUID] },
              "00201209": { vr: "IS", Value: [series.images.length] },
            });
          }
        }
      }

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

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const imgFilePath = resolveFilePathFast(image.sopInstanceUID) || resolveFilePathFromDIM(image);
              const imgTags = imgFilePath ? parseDicomTags(imgFilePath) : {};
              instances.push({
                "00080016": { vr: "UI", Value: [(imgTags.sopClassUID as string) || "1.2.840.10008.5.1.4.1.1.7"] },
                "00080018": { vr: "UI", Value: [image.sopInstanceUID] },
                "0020000D": { vr: "UI", Value: [studyUID] },
                "0020000E": { vr: "UI", Value: [seriesUID] },
                "00200013": { vr: "IS", Value: [(imgTags.instanceNumber as string) || "1"] },
                "00280010": { vr: "US", Value: [(imgTags.rows as number) ?? 512] },
                "00280011": { vr: "US", Value: [(imgTags.columns as number) ?? 512] },
              });
            }
          }
        }
      }

      res.json(instances);
    } catch (err) {
      console.error("QIDO-RS instances error:", err);
      res.json([]);
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

        const dicomBuffer = fs.readFileSync(filePath);
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

        // Extract pixel data from the DICOM file
        const pixelDataElement = dataSet.elements["x7fe00010"];
        if (!pixelDataElement) {
          res.status(404).json({ error: "No pixel data in DICOM file" });
          return;
        }

        let pixelData: Buffer;

        if (pixelDataElement.encapsulatedPixelData) {
          // Compressed (encapsulated) pixel data — extract the requested frame fragment
          const frameIndex = Math.max(0, parseInt(req.params.frameNumbers as string, 10) - 1);
          const fragments = pixelDataElement.fragments;
          if (!fragments || frameIndex >= fragments.length) {
            res.status(404).json({ error: `Frame ${frameIndex + 1} not found` });
            return;
          }
          const fragment = fragments[frameIndex];
          // Use fragment.position (absolute byte offset in file), not fragment.offset
          pixelData = Buffer.from(byteArray.buffer, byteArray.byteOffset + fragment.position, fragment.length);
        } else {
          // Uncompressed pixel data — return raw bytes
          pixelData = Buffer.from(byteArray.buffer, byteArray.byteOffset + pixelDataElement.dataOffset, pixelDataElement.length);
        }

        const acceptHeader = (req.headers.accept || "").toLowerCase();
        res.setHeader("Cache-Control", "public, max-age=3600");

        if (acceptHeader.includes("multipart")) {
          const boundary = "dicoogle-boundary";
          res.setHeader(
            "Content-Type",
            `multipart/related; type=application/octet-stream; boundary=${boundary}`,
          );
          const header = Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
          const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
          res.write(header);
          res.write(pixelData);
          res.end(footer);
        } else {
          // Singlepart — return raw pixel data directly
          res.setHeader("Content-Type", "application/octet-stream");
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
      const boundary = "dicoogle-boundary";
      const parts: Buffer[] = [];

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              let filePath = fileUriToPath(image.uri);
              if (!fs.existsSync(filePath)) {
                filePath = path.join(DICOOGLE_STORAGE_DIR, image.filename);
              }
              if (fs.existsSync(filePath)) {
                const dicomBuffer = fs.readFileSync(filePath);
                parts.push(
                  Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`),
                );
                parts.push(dicomBuffer);
                parts.push(Buffer.from("\r\n"));
              }
            }
          }
        }
      }

      if (parts.length === 0) {
        res.status(404).json({ error: "No DICOM files found for this study" });
        return;
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      res.setHeader(
        "Content-Type",
        `multipart/related; type="application/dicom"; boundary=${boundary}`,
      );
      for (const part of parts) {
        res.write(part);
      }
      res.end();
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
