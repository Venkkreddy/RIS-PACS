import { Router, Request, Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import dicomParser from "dicom-parser";
import { env } from "../config/env";
import { JwtService } from "../services/jwtService";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { tenantContextMiddleware, TenantRequest } from "../middleware/tenantContext";
import { validateStudyAccess } from "../middleware/tenantGuard";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../services/logger";
import type { DicomwebStudyValidationResult } from "./dicomweb";

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");
const TENANT_STORAGE_ROOT = env.TENANT_STORAGE_ROOT || DICOOGLE_STORAGE_DIR;

const useOrthanc = !!env.ORTHANC_BASE_URL;
const orthancBase = env.ORTHANC_BASE_URL || "http://orthanc:8042";
const orthancAuth = env.ORTHANC_AUTH
  ? { Authorization: `Basic ${Buffer.from(env.ORTHANC_AUTH).toString("base64")}` }
  : {};

interface DIMPatient {
  id: string;
  name: string;
  studies: DIMStudy[];
}

interface DIMStudy {
  studyInstanceUID: string;
  studyDate: string;
  studyDescription: string;
  modalities: string;
  series: DIMSeries[];
}

interface DIMSeries {
  serieNumber: number;
  serieInstanceUID: string;
  serieDescription: string;
  serieModality: string;
  images: DIMImage[];
}

interface DIMImage {
  sopInstanceUID: string;
  rawPath: string;
  uri: string;
  filename: string;
}

const tenantDimCaches = new Map<string, { data: DIMPatient[]; ts: number }>();
const tenantSopMaps = new Map<string, Map<string, string>>();
const DIM_CACHE_TTL = 120_000;
const MAX_SCAN_HEADER_BYTES = 4 * 1024 * 1024;
const dicomTagCache = new Map<string, Record<string, unknown>>();

function shouldInspectAsDicomFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".dcm") || lower.endsWith(".dicom") || lower.endsWith(".ima") || lower.endsWith(".img") || !path.extname(lower);
}

function findDicomFilesRecursive(dir: string, maxDepth = 3, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findDicomFilesRecursive(fullPath, maxDepth, depth + 1));
      else if (entry.isFile() && shouldInspectAsDicomFile(entry.name)) results.push(fullPath);
    }
  } catch { /* skip unreadable */ }
  return results;
}

function parseDicomHeader(filePath: string): dicomParser.DataSet | null {
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
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

function scanTenantStorage(tenantSlug: string): DIMPatient[] {
  const tenantDir = path.join(TENANT_STORAGE_ROOT, tenantSlug);
  if (!fs.existsSync(tenantDir)) return [];

  const patientMap = new Map<string, DIMPatient>();
  const files = findDicomFilesRecursive(tenantDir);

  for (const filePath of files) {
    const ds = parseDicomHeader(filePath);
    if (!ds) continue;

    const studyUID = ds.string("x0020000d");
    const seriesUID = ds.string("x0020000e");
    const sopUID = ds.string("x00080018")?.trim() ?? "";
    if (!studyUID || !seriesUID) continue;

    const patientId = ds.string("x00100020") || "UNKNOWN";
    const patientName = ds.string("x00100010") || "Unknown";

    let patient = patientMap.get(patientId);
    if (!patient) {
      patient = { id: patientId, name: patientName, studies: [] };
      patientMap.set(patientId, patient);
    }

    let study = patient.studies.find((s) => s.studyInstanceUID === studyUID);
    if (!study) {
      study = {
        studyInstanceUID: studyUID,
        studyDate: ds.string("x00080020") || "",
        studyDescription: ds.string("x00081030") || "",
        modalities: ds.string("x00080060") || "OT",
        series: [],
      };
      patient.studies.push(study);
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

function queryTenantDIM(tenantSlug: string): DIMPatient[] {
  const cached = tenantDimCaches.get(tenantSlug);
  if (cached && Date.now() - cached.ts < DIM_CACHE_TTL) return cached.data;

  const data = scanTenantStorage(tenantSlug);
  const sopMap = new Map<string, string>();

  for (const patient of data) {
    for (const study of patient.studies) {
      for (const series of study.series) {
        for (const image of series.images) {
          if (image.sopInstanceUID && image.rawPath && fs.existsSync(image.rawPath)) {
            sopMap.set(image.sopInstanceUID, image.rawPath);
          }
        }
      }
    }
  }

  tenantSopMaps.set(tenantSlug, sopMap);
  tenantDimCaches.set(tenantSlug, { data, ts: Date.now() });

  logger.info({
    message: "Multi-tenant DIM scan completed",
    tenantSlug,
    patientCount: data.length,
    studyCount: data.reduce((sum, p) => sum + p.studies.length, 0),
    instanceCount: sopMap.size,
  });

  return data;
}

function clearTenantDimCache(tenantSlug?: string): void {
  if (tenantSlug) {
    tenantDimCaches.delete(tenantSlug);
    tenantSopMaps.delete(tenantSlug);
  } else {
    tenantDimCaches.clear();
    tenantSopMaps.clear();
  }
  dicomTagCache.clear();
}

function resolveTenantFilePath(tenantSlug: string, sopUID: string): string | null {
  return tenantSopMaps.get(tenantSlug)?.get(sopUID) ?? null;
}

function parseDicomTags(filePath: string): Record<string, unknown> {
  const cached = dicomTagCache.get(filePath);
  if (cached) return cached;
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
    const getString = (tag: string) => dataSet.string(tag) || undefined;
    const getUint16 = (tag: string) => { const el = dataSet.elements[tag]; return el ? dataSet.uint16(tag) : undefined; };
    const tags: Record<string, unknown> = {
      sopClassUID: getString("x00080016"), transferSyntaxUID: getString("x00020010"),
      rows: getUint16("x00280010"), columns: getUint16("x00280011"),
      bitsAllocated: getUint16("x00280100"), bitsStored: getUint16("x00280101"),
      highBit: getUint16("x00280102"), pixelRepresentation: getUint16("x00280103"),
      samplesPerPixel: getUint16("x00280002"), photometricInterpretation: getString("x00280004"),
      windowCenter: getString("x00281050"), windowWidth: getString("x00281051"),
      numberOfFrames: getString("x00280008"), instanceNumber: getString("x00200013"),
      seriesDescription: getString("x0008103e"),
    };
    dicomTagCache.set(filePath, tags);
    return tags;
  } catch { return {}; }
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

function buildInstanceMetadata(
  patient: DIMPatient, studyUID: string, seriesUID: string, sopUID: string,
  modality: string, bulkDataURI: string, filePath?: string,
): Record<string, unknown> {
  const tags = filePath ? parseDicomTags(filePath) : {};
  return {
    "00080016": { vr: "UI", Value: [tags.sopClassUID || "1.2.840.10008.5.1.4.1.1.4"] },
    "00080018": { vr: "UI", Value: [sopUID] },
    "00080060": { vr: "CS", Value: [modality || "OT"] },
    "00200013": { vr: "IS", Value: [tags.instanceNumber || "1"] },
    "0008103E": { vr: "LO", Value: [tags.seriesDescription || ""] },
    "0020000D": { vr: "UI", Value: [studyUID] },
    "0020000E": { vr: "UI", Value: [seriesUID] },
    "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
    "00100020": { vr: "LO", Value: [patient.id || ""] },
    "00020010": { vr: "UI", Value: [tags.transferSyntaxUID || "1.2.840.10008.1.2.1"] },
    "00280002": { vr: "US", Value: [tags.samplesPerPixel ?? 1] },
    "00280004": { vr: "CS", Value: [tags.photometricInterpretation || "MONOCHROME2"] },
    "00280008": { vr: "IS", Value: [tags.numberOfFrames || "1"] },
    "00280010": { vr: "US", Value: [tags.rows ?? 256] },
    "00280011": { vr: "US", Value: [tags.columns ?? 256] },
    "00280100": { vr: "US", Value: [tags.bitsAllocated ?? 16] },
    "00280101": { vr: "US", Value: [tags.bitsStored ?? 16] },
    "00280102": { vr: "US", Value: [tags.highBit ?? 15] },
    "00280103": { vr: "US", Value: [tags.pixelRepresentation ?? 0] },
    "00281050": { vr: "DS", Value: [tags.windowCenter || "2048"] },
    "00281051": { vr: "DS", Value: [tags.windowWidth || "4096"] },
    "7FE00010": { vr: "OW", BulkDataURI: bulkDataURI },
  };
}

/**
 * Multi-tenant DICOMweb proxy: supports Dicoogle (filesystem-based) as primary
 * and Orthanc as optional backend. Tenant isolation via JWT + filesystem scoping.
 */
export function dicomwebMultiTenantRouter(
  jwtService: JwtService,
  store: TenantScopedStore,
): Router {
  const router = Router({ mergeParams: true });

  router.use(tenantContextMiddleware(jwtService));

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // QIDO-RS: Search studies — tenant-scoped
  router.get("/studies", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenant.id;
    const tenantSlug = tenantReq.tenant.slug;

    if (useOrthanc) {
      const studies = await store.listStudies(tenantId, { name: req.query.PatientName as string, status: undefined });
      const studyUIDs = studies.map((s) => s.study_instance_uid).filter(Boolean);
      if (studyUIDs.length === 0) { res.json([]); return; }
      try {
        const allResults: unknown[] = [];
        for (let i = 0; i < studyUIDs.length; i += 50) {
          const batch = studyUIDs.slice(i, i + 50);
          const promises = batch.map((uid) =>
            axios.get(`${orthancBase}/dicom-web/studies`, {
              params: { StudyInstanceUID: uid },
              headers: { ...orthancAuth, Accept: "application/dicom+json" },
              timeout: 10_000,
            }).then((r) => r.data).catch(() => []),
          );
          const results = await Promise.all(promises);
          for (const r of results) { if (Array.isArray(r)) allResults.push(...r); }
        }
        res.json(allResults);
      } catch (err) {
        logger.error({ message: "QIDO-RS studies error (Orthanc)", error: String(err) });
        res.json([]);
      }
      return;
    }

    // Dicoogle / filesystem path
    const patients = queryTenantDIM(tenantSlug);
    const filterPatientID = req.query.PatientID as string | undefined;
    const filterPatientName = req.query.PatientName as string | undefined;
    const filterStudyUID = req.query.StudyInstanceUID as string | undefined;
    const studies: Record<string, unknown>[] = [];

    for (const patient of patients) {
      if (filterPatientID && patient.id !== filterPatientID) continue;
      if (filterPatientName) {
        const pattern = filterPatientName.replace(/\*/g, "");
        if (pattern && !patient.name.toLowerCase().includes(pattern.toLowerCase())) continue;
      }
      for (const study of patient.studies) {
        if (filterStudyUID && study.studyInstanceUID !== filterStudyUID) continue;
        const modalities = study.series.map((s) => s.serieModality).filter(Boolean);
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
          "0020000D": { vr: "UI", Value: [study.studyInstanceUID] },
          "00200010": { vr: "SH", Value: [""] },
          "00201206": { vr: "IS", Value: [study.series.length] },
          "00201208": { vr: "IS", Value: [instanceCount] },
        });
      }
    }
    res.json(studies);
  }));

  // Validation endpoint
  router.get("/studies/:studyUID/validate",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const studyUID = String(req.params.studyUID ?? "");
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) clearTenantDimCache(tenantSlug);

        const patients = queryTenantDIM(tenantSlug);
        let matchedStudy: DIMStudy | undefined;
        for (const p of patients) {
          matchedStudy = p.studies.find((s) => s.studyInstanceUID === studyUID);
          if (matchedStudy) break;
        }

        if (!matchedStudy) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(404).json({
            studyInstanceUID: studyUID, isValid: false, reason: "STUDY_NOT_FOUND",
            message: "Study not found in tenant storage", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 404 },
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        const seriesWithInstances = matchedStudy.series.find((s) => s.images.length > 0);
        if (!seriesWithInstances) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(409).json({
            studyInstanceUID: studyUID, isValid: false, reason: "NO_INSTANCES",
            message: "Study exists but no images found", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 200 },
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        const firstImage = seriesWithInstances.images[0];
        const filePath = resolveTenantFilePath(tenantSlug, firstImage.sopInstanceUID) ?? firstImage.rawPath;
        if (!filePath || !fs.existsSync(filePath)) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(409).json({
            studyInstanceUID: studyUID, isValid: false, reason: "WADO_FRAME_UNAVAILABLE",
            message: "Study exists but file not accessible", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 200 },
            seriesInstanceUID: seriesWithInstances.serieInstanceUID,
            sopInstanceUID: firstImage.sopInstanceUID,
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        res.json({
          studyInstanceUID: studyUID, isValid: true,
          message: "Study, series, instances validated in tenant storage", attempts: attempt,
          endpointUrls: { qidoStudies: getDicomwebBaseUrl(req) + "/studies", qidoSeries: getDicomwebBaseUrl(req) + `/studies/${studyUID}/series` },
          responseStatus: { qidoStudies: 200, qidoSeries: 200, qidoInstances: 200 },
          seriesInstanceUID: seriesWithInstances.serieInstanceUID,
          sopInstanceUID: firstImage.sopInstanceUID,
        } satisfies DicomwebStudyValidationResult);
        return;
      }
    }),
  );

  // QIDO-RS: List series
  router.get("/studies/:studyUID/series",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const seriesList: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
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
    }),
  );

  // QIDO-RS: List instances
  router.get("/studies/:studyUID/series/:seriesUID/instances",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const instances: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const imgTags = fp ? parseDicomTags(fp) : {};
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
    }),
  );

  // WADO-RS: Retrieve DICOM instance
  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { sopUID } = req.params;

      if (useOrthanc) {
        try {
          const { studyUID, seriesUID } = req.params;
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}`,
            { headers: { ...orthancAuth, Accept: "multipart/related; type=application/dicom" }, responseType: "stream", timeout: 30_000 });
          res.setHeader("Content-Type", response.headers["content-type"] || "application/dicom");
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch { res.status(404).json({ error: "DICOM instance not found" }); }
        return;
      }

      queryTenantDIM(tenantSlug);
      const filePath = resolveTenantFilePath(tenantSlug, sopUID);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: "DICOM file not found" });
        return;
      }
      const dicomBuffer = fs.readFileSync(filePath);
      const boundary = "tenant-boundary";
      res.setHeader("Content-Type", `multipart/related; type="application/dicom"; boundary=${boundary}`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.write(Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`));
      res.write(dicomBuffer);
      res.end(Buffer.from(`\r\n--${boundary}--\r\n`));
    }),
  );

  // WADO-RS: Retrieve frames
  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID/frames/:frames",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { sopUID } = req.params;

      if (useOrthanc) {
        const { studyUID, seriesUID, frames } = req.params;
        try {
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/frames/${frames}`,
            { headers: { ...orthancAuth, Accept: req.headers.accept || "multipart/related; type=application/octet-stream" }, responseType: "stream", timeout: 30_000 });
          res.setHeader("Content-Type", response.headers["content-type"] || "application/octet-stream");
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch { res.status(404).json({ error: "Frame data not found" }); }
        return;
      }

      queryTenantDIM(tenantSlug);
      const filePath = resolveTenantFilePath(tenantSlug, sopUID);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: "DICOM file not found" });
        return;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const byteArray = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
      const dataSet = dicomParser.parseDicom(byteArray);
      const pixelDataElement = dataSet.elements["x7fe00010"];
      if (!pixelDataElement) { res.status(404).json({ error: "No pixel data" }); return; }

      let pixelData: Buffer;
      if (pixelDataElement.encapsulatedPixelData) {
        const frameIndex = Math.max(0, parseInt(req.params.frames, 10) - 1);
        const fragments = pixelDataElement.fragments;
        if (!fragments || frameIndex >= fragments.length) { res.status(404).json({ error: `Frame ${frameIndex + 1} not found` }); return; }
        const fragment = fragments[frameIndex];
        pixelData = Buffer.from(byteArray.buffer, byteArray.byteOffset + fragment.position, fragment.length);
      } else {
        pixelData = Buffer.from(byteArray.buffer, byteArray.byteOffset + pixelDataElement.dataOffset, pixelDataElement.length);
      }

      const acceptHeader = (req.headers.accept || "").toLowerCase();
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (acceptHeader.includes("multipart")) {
        const boundary = "tenant-boundary";
        res.setHeader("Content-Type", `multipart/related; type=application/octet-stream; boundary=${boundary}`);
        res.write(Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`));
        res.write(pixelData);
        res.end(Buffer.from(`\r\n--${boundary}--\r\n`));
      } else {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(pixelData);
      }
    }),
  );

  // WADO-RS: Metadata endpoints
  router.get("/studies/:studyUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/metadata`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const metadata: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${series.serieInstanceUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(buildInstanceMetadata(patient, studyUID, series.serieInstanceUID, image.sopInstanceUID, series.serieModality, bulkUri, fp));
            }
          }
        }
      }
      res.json(metadata);
    }),
  );

  router.get("/studies/:studyUID/series/:seriesUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/metadata`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const metadata: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(buildInstanceMetadata(patient, studyUID, seriesUID, image.sopInstanceUID, series.serieModality, bulkUri, fp));
            }
          }
        }
      }
      res.json(metadata);
    }),
  );

  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID, sopUID } = req.params;

      const patients = queryTenantDIM(tenantSlug);
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              if (image.sopInstanceUID !== sopUID) continue;
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/frames/1`;
              res.json([buildInstanceMetadata(patient, studyUID, seriesUID, sopUID, series.serieModality, bulkUri, fp)]);
              return;
            }
          }
        }
      }
      res.json([]);
    }),
  );

  // Cache warm endpoint
  router.post("/warm", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    clearTenantDimCache(tenantReq.tenant.slug);
    queryTenantDIM(tenantReq.tenant.slug);
    res.json({ ok: true });
  }));

  // Internal endpoint: DICOM tenant mapping
  router.get("/internal/dicom-tenant-map", asyncHandler(async (_req: Request, res: Response) => {
    const { getFirestore } = await import("../services/firebaseAdmin");
    const db = getFirestore();
    const tenantsSnapshot = await db.collection("tenants_meta").get();
    const mappings = [];

    for (const tenantDoc of tenantsSnapshot.docs) {
      const configDoc = await db.collection("tenants").doc(tenantDoc.id).collection("dicom_config").doc("default").get();
      if (configDoc.exists) {
        const data = configDoc.data()!;
        mappings.push({
          ae_title: data.ae_title,
          tenant_id: tenantDoc.id,
          institution_name: data.institution_name,
        });
      }
    }

    res.json(mappings);
  }));

  return router;
}
