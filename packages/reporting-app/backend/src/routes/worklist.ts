import { Request, Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import type { GatewayRequest } from "../middleware/apiGateway";
import { DicoogleService } from "../services/dicoogleService";
import { logger } from "../services/logger";
import { StoreService, StudyRecord, StudyStatus } from "../services/store";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { createWeasisAccessToken } from "../services/weasisAccess";
import { validateStudyAvailability } from "./dicomweb";

function extractString(study: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = study[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function toStudyRecordPatch(study: Record<string, unknown>): Partial<StudyRecord> {
  return {
    patientName: extractString(study, ["patientName", "PatientName", "00100010"]),
    studyDate: extractString(study, ["studyDate", "StudyDate", "00080020"]),
    location: extractString(study, ["location", "uploadingLocation", "InstitutionName", "00080080"]),
    metadata: study,
  };
}

function getRequestOrigin(req: Request): string | null {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!host) return null;
  return `${forwardedProto || req.protocol}://${host}`;
}

function getWeasisBaseUrl(req: Request, studyId: string, tenantSlug?: string): string {
  const configuredBaseUrl = env.WEASIS_BASE_URL?.replace(/\/+$/, "");
  const normalizedConfiguredBaseUrl = configuredBaseUrl?.replace(/\/dicomweb$/i, "/dicom-web");
  const requestOrigin = getRequestOrigin(req);
  const dicomwebBaseUrl =
    normalizedConfiguredBaseUrl ||
    (requestOrigin ? `${requestOrigin}/dicom-web` : `${env.FRONTEND_URL.replace(/\/+$/, "")}/dicom-web`);
  const accessToken = createWeasisAccessToken(studyId, undefined, tenantSlug);
  return `${dicomwebBaseUrl}/weasis/${encodeURIComponent(accessToken)}`;
}

function getDicomwebValidationBaseUrl(req: Request): string {
  const requestOrigin = getRequestOrigin(req);
  return requestOrigin ? `${requestOrigin}/dicom-web` : `${env.FRONTEND_URL.replace(/\/+$/, "")}/dicom-web`;
}

function looksLikeDicomUid(value: string | undefined): value is string {
  return Boolean(value && /^\d+(?:\.\d+)+$/.test(value));
}

function getStringFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = getStringFromUnknown(item);
      if (nested) return nested;
    }
  }
  if (value && typeof value === "object" && "Value" in (value as Record<string, unknown>)) {
    return getStringFromUnknown((value as Record<string, unknown>).Value);
  }
  return undefined;
}

function resolveStudyInstanceUid(record: StudyRecord): string | null {
  const metadata = record.metadata as Record<string, unknown> | undefined;

  const candidates = [
    record.studyId,
    getStringFromUnknown(metadata?.studyInstanceUid),
    getStringFromUnknown(metadata?.studyInstanceUID),
    getStringFromUnknown(metadata?.StudyInstanceUID),
    getStringFromUnknown(metadata?.["0020000D"]),
  ];

  const uid = candidates.find(looksLikeDicomUid);
  return uid ?? null;
}

function buildViewerUrl(studyInstanceUids: string | string[]): string | null {
  const rawUids = Array.isArray(studyInstanceUids) ? studyInstanceUids : [studyInstanceUids];
  const normalizedUids = Array.from(
    new Set(
      rawUids
        .map((uid) => uid.trim())
        .filter(looksLikeDicomUid),
    ),
  );
  if (normalizedUids.length === 0) {
    return null;
  }
  const ohifUrl = new URL(env.OHIF_PUBLIC_BASE_URL);
  const rawSegments = ohifUrl.pathname.split("/").filter(Boolean);

  // Guard against accidental microscopy bundle paths in env config.
  const microscopySegmentIndex = rawSegments.findIndex((segment) =>
    segment.toLowerCase() === "dicom-microscopy-viewer",
  );
  const normalizedSegments =
    microscopySegmentIndex >= 0 ? rawSegments.slice(0, microscopySegmentIndex) : rawSegments;

  const viewerSegmentIndex = normalizedSegments.findIndex((segment) => segment.toLowerCase() === "viewer");
  const prefixSegments = viewerSegmentIndex >= 0 ? normalizedSegments.slice(0, viewerSegmentIndex) : normalizedSegments;
  const explicitDataSource =
    viewerSegmentIndex >= 0 && normalizedSegments[viewerSegmentIndex + 1]
      ? normalizedSegments[viewerSegmentIndex + 1]
      : null;
  const dataSourceName = explicitDataSource || "dicoogle";

  ohifUrl.pathname = `/${[...prefixSegments, "viewer", dataSourceName].join("/")}`;
  ohifUrl.search = "";
  ohifUrl.hash = "";
  for (const uid of normalizedUids) {
    ohifUrl.searchParams.append("StudyInstanceUIDs", uid);
  }
  // Keep lowercase alias for compatibility with callers that read either key.
  ohifUrl.searchParams.set("studyInstanceUIDs", normalizedUids.join(","));
  ohifUrl.searchParams.set("datasources", dataSourceName);
  const launchParamCount = ohifUrl.searchParams.getAll("StudyInstanceUIDs").length;
  // #region agent log
  void fetch("http://127.0.0.1:7526/ingest/cd2ccaa8-51d1-4291-bf05-faef93098c97", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6646bc" },
    body: JSON.stringify({
      sessionId: "6646bc",
      runId: "initial",
      hypothesisId: "H1",
      location: "backend/routes/worklist.ts:buildViewerUrl",
      message: "Generated OHIF launch URL",
      data: {
        inputUidCount: rawUids.length,
        normalizedUidCount: normalizedUids.length,
        launchParamCount,
        hasLowercaseAlias: Boolean(ohifUrl.searchParams.get("studyInstanceUIDs")),
        dataSourceName,
        path: ohifUrl.pathname,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return ohifUrl.toString();
}

export async function syncStudiesFromDicoogle(
  store: StoreService,
  dicoogle: DicoogleService,
  searchText?: string,
): Promise<{ remoteStudies: Array<Record<string, unknown>>; upsertedStudyIds: string[] }> {
  const remoteStudies = await dicoogle.searchStudies(searchText);
  const upsertedStudyIds: string[] = [];

  await Promise.all(
    remoteStudies.map(async (study) => {
      const studyId = extractString(study, ["studyId", "StudyInstanceUID", "0020000D"]);
      if (!studyId) return;
      upsertedStudyIds.push(studyId);

      const existing = await store.getStudyRecord(studyId);
      const patch = toStudyRecordPatch(study);

      // Preserve patient name and MRN that were explicitly set during
      // upload so that Dicoogle sync (which reads raw DICOM headers)
      // doesn't overwrite with stale or mismatched values.
      if (existing?.patientName) {
        delete patch.patientName;
      }
      if (existing?.metadata) {
        const existingMeta = existing.metadata as Record<string, unknown>;
        if (existingMeta.patientId) {
          patch.metadata = { ...patch.metadata, patientId: existingMeta.patientId };
        }
      }

      await store.upsertStudyRecord(studyId, patch);
    }),
  );

  return { remoteStudies, upsertedStudyIds };
}

const listQuerySchema = z.object({
  search: z.string().optional(),
  name: z.string().optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(["unassigned", "assigned", "reported"]).optional(),
  assignedTo: z.string().optional(),
  uploaderId: z.string().optional(),
});

const assignSchema = z.object({
  studyIds: z.array(z.string()).min(1),
  radiologistId: z.string().min(1),
});

const updateStatusSchema = z.object({
  studyId: z.string().min(1),
  status: z.enum(["unassigned", "assigned", "reported"]),
});

export function worklistRouter(
  store: StoreService,
  dicoogle: DicoogleService,
  tenantStore?: TenantScopedStore,
): Router {
  const router = Router();

  router.get("/worklist", ensureAuthenticated, ensurePermission(store, "worklist:view"), asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const gwReq = req as GatewayRequest;
    const tenantId = gwReq.tenantId;
    const tenantSlug = gwReq.tenantSlug;

    // ── Multi-tenant path: query PostgreSQL directly ──
    if (env.MULTI_TENANT_ENABLED && tenantId && tenantStore) {
      const studies = await tenantStore.listStudies(tenantId, {
        name: query.name,
        status: query.status,
        assignedTo: query.assignedTo,
      });

      // Same patient → multiple StudyInstanceUIDs in OHIF (multiple uploads or distinct studies).
      const patientStudyUidsMt = new Map<string, string[]>();
      for (const study of studies) {
        const uid = study.study_instance_uid?.trim();
        if (!uid || !looksLikeDicomUid(uid)) continue;
        const meta = study.metadata as Record<string, unknown> | undefined;
        const mrn = (
          getStringFromUnknown(meta?.patientId) ??
          getStringFromUnknown(meta?.PatientID) ??
          getStringFromUnknown(meta?.["00100020"])
        )?.trim();
        if (mrn) {
          const list = patientStudyUidsMt.get(mrn) ?? [];
          if (!list.includes(uid)) list.push(uid);
          patientStudyUidsMt.set(mrn, list);
        }
      }

      const data = studies.map((study) => {
        const studyUid = study.study_instance_uid?.trim();
        const hasUid = Boolean(studyUid && looksLikeDicomUid(studyUid));
        const meta = study.metadata as Record<string, unknown> | undefined;
        const mrn = (
          getStringFromUnknown(meta?.patientId) ??
          getStringFromUnknown(meta?.PatientID) ??
          getStringFromUnknown(meta?.["00100020"])
        )?.trim();
        const allForPatient = mrn ? patientStudyUidsMt.get(mrn) : undefined;
        const viewerUids =
          allForPatient && allForPatient.length > 0 ? allForPatient : hasUid && studyUid ? [studyUid] : [];
        const viewerUrl = viewerUids.length > 0 ? buildViewerUrl(viewerUids) : null;
        const weasisStudyUid = hasUid ? studyUid! : null;

        return {
          studyId: study.id,
          patientName: study.patient_name ?? "Unknown",
          studyDate: study.study_date ?? "",
          modality: study.modality ?? "OT",
          description: study.description ?? "",
          location: study.location ?? "",
          status: study.status ?? "unassigned",
          assignedTo: study.assigned_to,
          assignedAt: study.assigned_at,
          reportedAt: study.reported_at,
          tatHours: study.tat_hours,
          uploaderId: study.uploader_id,
          metadata: { ...study.metadata, patientId: study.metadata?.patientId ?? study.patient_name },
          viewerUrl,
          weasisUrl: weasisStudyUid
            ? `weasis://?%24dicom%3Ars%20--url%20%22${encodeURIComponent(getWeasisBaseUrl(req, weasisStudyUid, tenantSlug))}%22%20-r%20%22studyUID%3D${encodeURIComponent(weasisStudyUid)}%22`
            : null,
          reportUrl: `/reports/study/${encodeURIComponent(study.id)}`,
        };
      });

      res.json(data);
      return;
    }

    // ── Single-tenant path: in-memory / Firestore store ──
    // Fire-and-forget Dicoogle sync — never block the response.
    // The sync updates local records in the background; the user sees
    // whatever is already cached and gets fresh data on next poll.
    if (env.ENABLE_AUTH) {
      const searchText = query.search ?? query.name;
      syncStudiesFromDicoogle(store, dicoogle, searchText).catch((err) => {
        logger.warn({ message: "Background Dicoogle sync failed", error: String(err) });
      });
    }

    const records = await store.listStudyRecords({
      name: query.name,
      date: query.date,
      location: query.location,
      status: query.status as StudyStatus | undefined,
      assignedTo: query.assignedTo,
      uploaderId: query.uploaderId,
    });

    // Group resolved UIDs by patient MRN so the viewer URL can include
    // every study that belongs to the same patient.
    const patientStudyUids = new Map<string, string[]>();
    const recordUidMap = new Map<string, string>();
    for (const record of records) {
      const uid = resolveStudyInstanceUid(record);
      if (!uid) continue;
      recordUidMap.set(record.studyId, uid);
      const meta = record.metadata as Record<string, unknown> | undefined;
      const mrn = (
        getStringFromUnknown(meta?.patientId) ??
        getStringFromUnknown(meta?.PatientID) ??
        getStringFromUnknown(meta?.["00100020"])
      )?.trim();
      if (mrn) {
        const list = patientStudyUids.get(mrn) ?? [];
        if (!list.includes(uid)) list.push(uid);
        patientStudyUids.set(mrn, list);
      }
    }

    const data = records.map((record) => {
      const studyInstanceUid = recordUidMap.get(record.studyId) ?? null;
      const hasDicom = studyInstanceUid !== null;

      // Collect all study UIDs for this patient so OHIF shows every study
      const meta = record.metadata as Record<string, unknown> | undefined;
      const mrn = (
        getStringFromUnknown(meta?.patientId) ??
        getStringFromUnknown(meta?.PatientID) ??
        getStringFromUnknown(meta?.["00100020"])
      )?.trim();
      const allUidsForPatient = mrn ? patientStudyUids.get(mrn) : undefined;
      const viewerUids = allUidsForPatient && allUidsForPatient.length > 0
        ? allUidsForPatient
        : studyInstanceUid ? [studyInstanceUid] : [];

      const viewerUrl = viewerUids.length > 0 ? buildViewerUrl(viewerUids) : null;

      return {
        ...record,
        viewerUrl,
        weasisUrl: hasDicom && studyInstanceUid
          ? `weasis://?%24dicom%3Ars%20--url%20%22${encodeURIComponent(getWeasisBaseUrl(req, studyInstanceUid))}%22%20-r%20%22studyUID%3D${encodeURIComponent(studyInstanceUid)}%22`
          : null,
        reportUrl: `/reports/study/${encodeURIComponent(record.studyId)}`,
        viewerValidation: (record.metadata as Record<string, unknown> | undefined)?.dicomValidation ?? null,
      };
    });

    res.json(data);
  }));

  router.get(
    "/worklist/:studyId/viewer-access",
    ensureAuthenticated,
    ensurePermission(store, "worklist:view"),
    asyncHandler(async (req, res) => {
      const studyId = String(req.params.studyId ?? "");
      const record = await store.getStudyRecord(studyId);

      if (!record) {
        res.status(404).json({ allowed: false, message: "Study not found in RIS" });
        return;
      }

      const studyInstanceUid = resolveStudyInstanceUid(record);
      if (!studyInstanceUid) {
        res.status(409).json({
          allowed: false,
          message: "Study does not have a valid StudyInstanceUID",
        });
        return;
      }

      if (record.studyId !== studyInstanceUid) {
        logger.warn({
          message: "RIS/Dicoogle StudyInstanceUID mismatch detected",
          risStudyId: record.studyId,
          pacsStudyInstanceUID: studyInstanceUid,
        });
      }

      const tenantId = req.get("x-tenant-id")?.trim() || undefined;
      // #region agent log
      void fetch("http://127.0.0.1:7526/ingest/cd2ccaa8-51d1-4291-bf05-faef93098c97", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6646bc" },
        body: JSON.stringify({
          sessionId: "6646bc",
          runId: "initial",
          hypothesisId: "H2",
          location: "backend/routes/worklist.ts:viewer-access:pre-validation",
          message: "Viewer access requested",
          data: {
            hasRecord: true,
            hasStudyInstanceUid: Boolean(studyInstanceUid),
            risIdMatchesUid: record.studyId === studyInstanceUid,
            tenantProvided: Boolean(tenantId),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const validation = await validateStudyAvailability({
        studyInstanceUID: studyInstanceUid,
        dicomwebBaseUrl: getDicomwebValidationBaseUrl(req),
        tenantId,
        maxAttempts: 3,
        retryDelayMs: 2000,
      });
      // #region agent log
      void fetch("http://127.0.0.1:7526/ingest/cd2ccaa8-51d1-4291-bf05-faef93098c97", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6646bc" },
        body: JSON.stringify({
          sessionId: "6646bc",
          runId: "initial",
          hypothesisId: "H2",
          location: "backend/routes/worklist.ts:viewer-access:post-validation",
          message: "Viewer access validation completed",
          data: {
            isValid: validation.isValid,
            reason: validation.reason ?? null,
            attempts: validation.attempts ?? null,
            responseStatus: validation.responseStatus ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      const existingMetadata = (record.metadata as Record<string, unknown> | undefined) ?? {};
      const dicomValidationMetadata = {
        state: validation.isValid ? "valid" : "invalid",
        reason: validation.reason ?? null,
        message: validation.message,
        validatedAt: new Date().toISOString(),
        attempts: validation.attempts,
        endpointUrls: validation.endpointUrls,
        responseStatus: validation.responseStatus,
      };
      await store.upsertStudyRecord(record.studyId, {
        metadata: {
          ...existingMetadata,
          dicomValidation: dicomValidationMetadata,
        },
      });

      if (!validation.isValid) {
        logger.warn({
          message: "Viewer launch blocked by Dicoogle validation",
          studyId: record.studyId,
          studyInstanceUID: studyInstanceUid,
          tenantId: tenantId ?? null,
          validation,
        });
        const statusCode = validation.reason === "STUDY_NOT_FOUND" ? 404 : 409;
        res.status(statusCode).json({
          allowed: false,
          viewerUrl: null,
          message: validation.message,
          validation,
        });
        return;
      }

      // Include all studies for the same patient so OHIF shows everything
      const allRecords = await store.listStudyRecords({});
      const meta = (record.metadata as Record<string, unknown> | undefined);
      const mrn = (
        getStringFromUnknown(meta?.patientId) ??
        getStringFromUnknown(meta?.PatientID) ??
        getStringFromUnknown(meta?.["00100020"])
      )?.trim();

      const allUids: string[] = [studyInstanceUid];
      if (mrn) {
        for (const r of allRecords) {
          const rMeta = r.metadata as Record<string, unknown> | undefined;
          const rMrn = (
            getStringFromUnknown(rMeta?.patientId) ??
            getStringFromUnknown(rMeta?.PatientID) ??
            getStringFromUnknown(rMeta?.["00100020"])
          )?.trim();
          if (rMrn === mrn) {
            const rUid = resolveStudyInstanceUid(r);
            if (rUid && !allUids.includes(rUid)) {
              allUids.push(rUid);
            }
          }
        }
      }

      const viewerUrl = buildViewerUrl(allUids);
      if (!viewerUrl) {
        logger.warn({
          message: "Viewer launch blocked: no valid StudyInstanceUIDs available for URL generation",
          studyId: record.studyId,
          studyInstanceUID: studyInstanceUid,
          tenantId: tenantId ?? null,
          allUidsCount: allUids.length,
        });
        res.status(409).json({
          allowed: false,
          viewerUrl: null,
          message: "Study exists but viewer launch URL could not be generated",
        });
        return;
      }
      logger.info({
        message: "Viewer launch allowed by Dicoogle validation",
        studyId: record.studyId,
        studyInstanceUID: studyInstanceUid,
        tenantId: tenantId ?? null,
        viewerUrl,
        validation,
      });

      res.json({
        allowed: true,
        viewerUrl,
        message: "Study validated and ready for viewer",
        validation,
      });
    }),
  );

  router.post("/assign", ensureAuthenticated, ensurePermission(store, "worklist:assign"), asyncHandler(async (req, res) => {
    const body = assignSchema.parse(req.body);
    const gwReq = req as GatewayRequest;
    const tenantId = gwReq.tenantId;

    if (env.MULTI_TENANT_ENABLED && tenantId && tenantStore) {
      const updated = await tenantStore.assignStudies(tenantId, body.studyIds, body.radiologistId);
      res.json({ updatedCount: updated.length, studies: updated });
      return;
    }

    const updated = await store.assignStudies(body.studyIds, body.radiologistId);
    res.json({ updatedCount: updated.length, studies: updated });
  }));

  router.post("/update-status", ensureAuthenticated, ensurePermission(store, "worklist:update_status"), asyncHandler(async (req, res) => {
    const body = updateStatusSchema.parse(req.body);
    const gwReq = req as GatewayRequest;
    const tenantId = gwReq.tenantId;

    if (env.MULTI_TENANT_ENABLED && tenantId && tenantStore) {
      const { getFirestore } = await import("../services/firebaseAdmin");
      const db = getFirestore();
      const studyRef = db.collection("tenants").doc(tenantId).collection("studies").doc(body.studyId);
      const now = new Date().toISOString();

      if (body.status === "reported") {
        const studyDoc = await studyRef.get();
        const studyData = studyDoc.data();
        const assignedAt = studyData?.assigned_at ? new Date(studyData.assigned_at).getTime() : Date.now();
        const tatHours = Number(((Date.now() - assignedAt) / (1000 * 60 * 60)).toFixed(2));
        await studyRef.update({ status: "reported", reported_at: now, tat_hours: tatHours, updated_at: now });
        const updated = await studyRef.get();
        res.json(updated.exists ? { id: updated.id, ...updated.data() } : { studyId: body.studyId, status: body.status });
      } else {
        await studyRef.update({ status: body.status, updated_at: now });
        const updated = await studyRef.get();
        res.json(updated.exists ? { id: updated.id, ...updated.data() } : { studyId: body.studyId, status: body.status });
      }
      return;
    }

    if (body.status === "reported") {
      const updated = await store.markStudyReported(body.studyId);
      res.json(updated);
      return;
    }

    const updated = await store.upsertStudyRecord(body.studyId, { status: body.status });
    res.json(updated);
  }));

  return router;
}
