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
import { logger } from "../services/logger";
import { clearDimCache } from "./dicomweb";

/**
 * Dicoogle ingests DICOM files from the filesystem, not via a REST upload
 * endpoint. The flow is:
 *   1. Write .dcm files to Dicoogle's storage directory.
 *   2. POST /management/tasks/index?uri=<dir> to trigger indexing.
 */
const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");

const STORAGE_ROOT = path.resolve(DICOOGLE_STORAGE_DIR);

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

export function dicomUploadRouter(store: StoreService): Router {
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
      const formPatientId = typeof req.body?.patientId === "string" ? req.body.patientId.trim() : undefined;
      const formPatientName = typeof req.body?.patientName === "string" ? req.body.patientName : undefined;
      const storedCount = results.filter((r) => r.status === "stored").length;

      // Resolve tenant-specific storage root when multi-tenant is enabled.
      const gwReq = req as GatewayRequest;
      const tenantSlug = gwReq.tenantSlug;
      const effectiveStorageRoot = (env.MULTI_TENANT_ENABLED && tenantSlug)
        ? path.join(STORAGE_ROOT, tenantSlug)
        : STORAGE_ROOT;

      if (env.MULTI_TENANT_ENABLED && tenantSlug) {
        fs.mkdirSync(effectiveStorageRoot, { recursive: true });
        logger.info({
          message: "Tenant-scoped DICOM upload",
          tenantSlug,
          storageRoot: effectiveStorageRoot,
          fileCount: files.length,
        });
      }

      // Always merge multi-file uploads into one study+series so OHIF loads a single stack.
      // (When headers already share one study, we still rewrite series so partial/metadata cases stay consistent.)
      const multipartUnify = storedCount > 1;
      const batchStudyUid = multipartUnify ? newDicomUid() : undefined;
      const batchSeriesUid = multipartUnify ? newDicomUid() : undefined;
      if (multipartUnify) {
        logger.info({
          message: "DICOM multipart upload: assigning shared Study/Series UIDs for OHIF",
          fileCount: storedCount,
        });
      }

      for (let i = 0; i < files.length; i++) {
        if (results[i]?.status !== "stored") continue;
        const file = files[i];
        if (!file.path || !fs.existsSync(file.path)) continue;
        rewriteDicomUploadTags(file.path, {
          ...(formPatientId ? { patientId: formPatientId, patientName: formPatientName ?? undefined } : {}),
          sopInstanceUid: newSopInstanceUid(),
          ...(batchStudyUid && batchSeriesUid
            ? { studyInstanceUid: batchStudyUid, seriesInstanceUid: batchSeriesUid }
            : {}),
        });
      }

      const studyMap = new Map<
        string,
        { patientName?: string; modality?: string; description?: string; studyDate?: string; fileCount: number }
      >();
      for (let i = 0; i < files.length; i++) {
        if (results[i]?.status !== "stored") continue;
        const file = files[i];
        if (!file.path || !fs.existsSync(file.path)) continue;
        const dataSet = readDicomHeaderDataSet(file.path);
        if (!dataSet) continue;
        const studyUID = dataSet.string("x0020000d");
        if (!studyUID) continue;
        const existing = studyMap.get(studyUID);
        if (existing) {
          existing.fileCount++;
        } else {
          studyMap.set(studyUID, {
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
      for (const file of files) {
        if (!file.path || !fs.existsSync(file.path)) continue;
        const pid = formPatientId || filePatientIds.get(file.path);
        if (!pid) {
          // Even without a patient ID, move to tenant directory
          if (env.MULTI_TENANT_ENABLED && tenantSlug && effectiveStorageRoot !== STORAGE_ROOT) {
            const newPath = path.join(effectiveStorageRoot, path.basename(file.path));
            if (newPath !== file.path) {
              try { fs.renameSync(file.path, newPath); } catch { /* stays in flat dir */ }
            }
          }
          continue;
        }
        const safePid = pid.replace(/[^a-zA-Z0-9._-]/g, "_");
        const patientDir = path.join(effectiveStorageRoot, safePid);
        fs.mkdirSync(patientDir, { recursive: true });
        const newPath = path.join(patientDir, path.basename(file.path));
        if (newPath !== file.path) {
          try {
            fs.renameSync(file.path, newPath);
          } catch {
            // File stays in flat directory — still visible to filesystem scanner
          }
        }
      }

      // Trigger Dicoogle re-indexing. URI must match Dicoogle’s configured root-dir
      // (see packages/dicoogle-server/config/filestorage.xml), not necessarily the
      // path where this Node process writes when using split containers + bind mounts.
      const dicoogleBase = env.DICOOGLE_BASE_URL;
      const indexUri = (env.MULTI_TENANT_ENABLED && tenantSlug)
        ? `file:///var/dicoogle/storage/${tenantSlug}`
        : env.DICOOGLE_INDEX_URI?.trim() || storageDirToDefaultFileUri(STORAGE_ROOT);
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

      // Auto-create or reuse the patient registry entry so the Patients
      // page never shows duplicates after a DICOM upload.
      if (formPatientId && formPatientName) {
        const existing = await store.getPatientByMrn(formPatientId);
        if (!existing) {
          const nameParts = formPatientName.trim().split(/\s+/);
          const firstName = nameParts[0] ?? formPatientName;
          const lastName = nameParts.slice(1).join(" ") || firstName;
          try {
            await store.createPatient({
              patientId: formPatientId,
              firstName,
              lastName,
              dateOfBirth: "1900-01-01",
              gender: "O",
            });
          } catch {
            // Ignore if race-condition duplicate or other error
          }
        }
      }

      // Create study records using real StudyInstanceUIDs from DICOM headers
      const createdStudyIds: string[] = [];
      if (studyMap.size > 0) {
        for (const [studyUID, info] of studyMap) {
          await store.upsertStudyRecord(studyUID, {
            patientName: formPatientName ?? info.patientName ?? formPatientId ?? "Unknown",
            studyDate: info.studyDate
              ? `${info.studyDate.slice(0, 4)}-${info.studyDate.slice(4, 6)}-${info.studyDate.slice(6, 8)}`
              : new Date().toISOString().slice(0, 10),
            modality: info.modality ?? "OT",
            description: info.description ?? `DICOM Upload (${info.fileCount} image${info.fileCount > 1 ? "s" : ""})`,
            status: "unassigned",
            uploaderId,
            metadata: { patientId: formPatientId, fileCount: info.fileCount },
          });
          createdStudyIds.push(studyUID);
        }
      } else if (storedCount > 0) {
        // Fallback: no StudyInstanceUID readable after processing (rare if batch UIDs were written).
        // Prefer the unified batch UID when present so OHIF still gets a valid launch id.
        const studyId =
          batchStudyUid ??
          (formPatientId
            ? `patient-study-${formPatientId}`
            : `upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
        await store.upsertStudyRecord(studyId, {
          patientName: formPatientName ?? formPatientId ?? "Unknown",
          studyDate: new Date().toISOString().slice(0, 10),
          modality: "OT",
          description: `DICOM Upload (${storedCount} file${storedCount > 1 ? "s" : ""})`,
          status: "unassigned",
          uploaderId,
          metadata: {
            patientId: formPatientId,
            fileCount: storedCount,
            syntheticStudy: !batchStudyUid,
            ...(batchStudyUid ? { StudyInstanceUID: batchStudyUid } : {}),
          },
        });
        createdStudyIds.push(studyId);
      }

      res.json({
        message: `${storedCount}/${files.length} files uploaded to Dicoogle`,
        results,
        uploaderId,
        studyIds: createdStudyIds,
        ...(formPatientId ? { patientId: formPatientId } : {}),
      });
    }),
  );

  return router;
}
