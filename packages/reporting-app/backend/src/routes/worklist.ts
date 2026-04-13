import { Request, Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import type { GatewayRequest } from "../middleware/apiGateway";
import { DicoogleService } from "../services/dicoogleService";
import { logger } from "../services/logger";
import { StoreService, StudyRecord, StudyStatus } from "../services/store";
import type { Patient } from "@medical-report-system/shared";
import { TenantScopedStore, type StudyRow } from "../services/tenantScopedStore";
import { createWeasisAccessToken } from "../services/weasisAccess";
import { validateStudyAvailability, getStudyUidsForSamePatient, buildPatientStudyGroupMap } from "./dicomweb";

function extractString(study: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = study[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeStudyDate(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return raw;
}

function parseStudyDateSortValue(rawDate: string | undefined): number {
  const normalized = normalizeStudyDate(rawDate);
  if (!normalized) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function parseTimestampSortValue(rawTimestamp: string | undefined): number {
  if (!rawTimestamp?.trim()) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(rawTimestamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function pickPreferredStudyRecord(
  current: StudyRecord,
  candidate: StudyRecord,
  canonicalStudyId: string,
): StudyRecord {
  const currentCanonical = current.studyId === canonicalStudyId;
  const candidateCanonical = candidate.studyId === canonicalStudyId;
  if (candidateCanonical && !currentCanonical) return candidate;
  if (currentCanonical && !candidateCanonical) return current;

  const candidateStudyDate = parseStudyDateSortValue(candidate.studyDate);
  const currentStudyDate = parseStudyDateSortValue(current.studyDate);
  if (candidateStudyDate !== currentStudyDate) {
    return candidateStudyDate > currentStudyDate ? candidate : current;
  }

  const candidateUpdatedAt = parseTimestampSortValue(candidate.updatedAt);
  const currentUpdatedAt = parseTimestampSortValue(current.updatedAt);
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }

  const candidateMetaKeys = Object.keys((candidate.metadata as Record<string, unknown> | undefined) ?? {}).length;
  const currentMetaKeys = Object.keys((current.metadata as Record<string, unknown> | undefined) ?? {}).length;
  if (candidateMetaKeys !== currentMetaKeys) {
    return candidateMetaKeys > currentMetaKeys ? candidate : current;
  }

  return current;
}

function sortStudyRecordsByDateDesc(left: StudyRecord, right: StudyRecord): number {
  const rightStudyDate = parseStudyDateSortValue(right.studyDate);
  const leftStudyDate = parseStudyDateSortValue(left.studyDate);
  if (rightStudyDate !== leftStudyDate) {
    return rightStudyDate - leftStudyDate;
  }
  return parseTimestampSortValue(right.updatedAt) - parseTimestampSortValue(left.updatedAt);
}

function dedupeStudyRecordsByCanonicalUid(records: StudyRecord[]): StudyRecord[] {
  const deduped = new Map<string, StudyRecord>();
  for (const record of records) {
    const canonicalStudyId = resolveStudyInstanceUid(record) ?? record.studyId;
    const existing = deduped.get(canonicalStudyId);
    if (!existing) {
      deduped.set(canonicalStudyId, record);
      continue;
    }
    deduped.set(canonicalStudyId, pickPreferredStudyRecord(existing, record, canonicalStudyId));
  }
  return Array.from(deduped.values()).sort(sortStudyRecordsByDateDesc);
}

function toStudyRecordPatch(study: Record<string, unknown>): Partial<StudyRecord> {
  return {
    patientName: extractString(study, ["patientName", "PatientName", "00100010"]),
    studyDate: normalizeStudyDate(extractString(study, ["studyDate", "StudyDate", "00080020"])),
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

const PATIENT_ID_METADATA_KEYS = [
  "patientId",
  "PatientID",
  "patientID",
  "PatientId",
  "patient_id",
  "mrn",
  "MRN",
  "00100020",
  "x00100020",
  "(0010,0020)",
] as const;

const PLACEHOLDER_PATIENT_IDENTIFIERS = new Set(["", "UNKNOWN", "ANON", "ANONYMOUS", "NONE", "NA", "N/A", "UNSPECIFIED"]);
const PLACEHOLDER_PATIENT_NAMES = ["unknown", "anonymous", "anon", "not provided", "n/a", "na"];

function isUsablePatientMrn(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  // Do not use looksLikeDicomUid() here — its type predicate narrows `trimmed` incorrectly in TS.
  if (/^\d+(?:\.\d+)+$/.test(trimmed)) return false;
  if (/^UPL-[A-Z0-9]+$/i.test(trimmed)) return false;
  const normalized = trimmed.toUpperCase();
  if (PLACEHOLDER_PATIENT_IDENTIFIERS.has(normalized)) return false;
  return normalized.length > 1;
}

function isUsablePatientName(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replace(/\^+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return false;
  return !PLACEHOLDER_PATIENT_NAMES.includes(normalized);
}

function resolvePatientMrn(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  for (const key of PATIENT_ID_METADATA_KEYS) {
    const candidate = getStringFromUnknown(metadata[key]);
    if (isUsablePatientMrn(candidate?.trim())) {
      return candidate.trim();
    }
  }
  return undefined;
}

function resolveStudyInstanceUid(record: StudyRecord): string | null {
  const metadata = record.metadata as Record<string, unknown> | undefined;
  return resolveStudyInstanceUidFromCandidate(record.studyId, metadata);
}

function resolveStudyInstanceUidFromCandidate(
  studyId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): string | null {
  const candidates = [
    studyId,
    getStringFromUnknown(metadata?.studyInstanceUid),
    getStringFromUnknown(metadata?.studyInstanceUID),
    getStringFromUnknown(metadata?.StudyInstanceUID),
    getStringFromUnknown(metadata?.["0020000D"]),
    getStringFromUnknown(metadata?.["0020000d"]),
    getStringFromUnknown(metadata?.["(0020,000D)"]),
    getStringFromUnknown(metadata?.studyUid),
    getStringFromUnknown(metadata?.studyUID),
    getStringFromUnknown(metadata?.study_uid),
  ];

  const uid = candidates.find(looksLikeDicomUid);
  return uid ?? null;
}

function resolveTenantStudyInstanceUid(study: StudyRow): string | null {
  const metadata = study.metadata as Record<string, unknown> | undefined;
  return resolveStudyInstanceUidFromCandidate(study.study_instance_uid, metadata);
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
  // Use a single comma-separated value; repeating the same key can make some
  // OHIF builds pick only the first UID.
  const joinedUids = normalizedUids.join(",");
  ohifUrl.searchParams.set("StudyInstanceUIDs", joinedUids);
  // Keep lowercase alias for compatibility with callers that read either key.
  ohifUrl.searchParams.set("studyInstanceUIDs", joinedUids);
  ohifUrl.searchParams.set("datasources", dataSourceName);
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
      const rawStudyId = extractString(study, ["studyId", "StudyInstanceUID", "0020000D"]);
      const canonicalStudyId = resolveStudyInstanceUidFromCandidate(rawStudyId, study) ?? rawStudyId;
      if (!canonicalStudyId) return;
      upsertedStudyIds.push(canonicalStudyId);

      const existingCanonical = await store.getStudyRecord(canonicalStudyId);
      const existingAlias = rawStudyId && rawStudyId !== canonicalStudyId
        ? await store.getStudyRecord(rawStudyId)
        : null;
      const existing = existingCanonical ?? existingAlias;
      const patch = toStudyRecordPatch(study);
      const resolvedStudyUid = resolveStudyInstanceUidFromCandidate(rawStudyId, study);
      if (resolvedStudyUid) {
        patch.metadata = {
          ...(patch.metadata as Record<string, unknown> | undefined),
          StudyInstanceUID: resolvedStudyUid,
          studyInstanceUid: resolvedStudyUid,
        };
      }

      // Preserve patient name and MRN that were explicitly set during
      // upload so that Dicoogle sync (which reads raw DICOM headers)
      // doesn't overwrite with stale or mismatched values.
      if (existing?.patientName) {
        delete patch.patientName;
      }
      if (existing?.metadata) {
        const existingMeta = existing.metadata as Record<string, unknown>;
        if (existingMeta.patientId) {
          patch.metadata = {
            ...(patch.metadata as Record<string, unknown> | undefined),
            patientId: existingMeta.patientId,
          };
        }
      }

      if (!existingCanonical && existingAlias) {
        patch.status = patch.status ?? existingAlias.status;
        patch.assignedTo = patch.assignedTo ?? existingAlias.assignedTo;
        patch.assignedAt = patch.assignedAt ?? existingAlias.assignedAt;
        patch.reportedAt = patch.reportedAt ?? existingAlias.reportedAt;
        patch.tatHours = patch.tatHours ?? existingAlias.tatHours;
        patch.uploaderId = patch.uploaderId ?? existingAlias.uploaderId;
        patch.studyDate = patch.studyDate ?? existingAlias.studyDate;
        patch.location = patch.location ?? existingAlias.location;
        patch.metadata = {
          ...((existingAlias.metadata as Record<string, unknown> | undefined) ?? {}),
          ...((patch.metadata as Record<string, unknown> | undefined) ?? {}),
        };
      }

      if (!patch.studyDate && existing?.studyDate) {
        patch.studyDate = existing.studyDate;
      }
      if (!patch.location && existing?.location) {
        patch.location = existing.location;
      }
      if (!patch.patientName && existing?.patientName) {
        patch.patientName = existing.patientName;
      }
      if (existing?.metadata) {
        patch.metadata = {
          ...(existing.metadata as Record<string, unknown>),
          ...((patch.metadata as Record<string, unknown> | undefined) ?? {}),
        };
      }
      await store.upsertStudyRecord(canonicalStudyId, patch);
      if (rawStudyId && rawStudyId !== canonicalStudyId) {
        const aliasRecord = await store.getStudyRecord(rawStudyId);
        if (aliasRecord) {
          const aliasMeta = (aliasRecord.metadata as Record<string, unknown> | undefined) ?? {};
          if (aliasMeta.canonicalStudyId !== canonicalStudyId || aliasMeta.deprecatedAlias !== true) {
            await store.upsertStudyRecord(rawStudyId, {
              metadata: {
                ...aliasMeta,
                canonicalStudyId,
                deprecatedAlias: true,
                aliasedAt: new Date().toISOString(),
              },
            });
          }
        }
      }
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
        const mrn = resolvePatientMrn(meta);
        if (mrn) {
          const list = patientStudyUidsMt.get(mrn) ?? [];
          if (!list.includes(uid)) list.push(uid);
          patientStudyUidsMt.set(mrn, list);
        }
      }

      const dimGroupMapMt = await buildPatientStudyGroupMap();
      const patientCacheByMrnMt = new Map<string, Awaited<ReturnType<TenantScopedStore["getPatientByMrn"]>>>();
      const resolveTenantPatientByMrn = async (mrn: string | undefined) => {
        const key = mrn?.trim().toUpperCase();
        if (!key) return null;
        if (!patientCacheByMrnMt.has(key)) {
          patientCacheByMrnMt.set(key, await tenantStore.getPatientByMrn(tenantId, key));
        }
        return patientCacheByMrnMt.get(key) ?? null;
      };

      const data = (await Promise.all(studies.map(async (study) => {
        const studyUid = study.study_instance_uid?.trim();
        const hasUid = Boolean(studyUid && looksLikeDicomUid(studyUid));
        const meta = study.metadata as Record<string, unknown> | undefined;
        const mrn = resolvePatientMrn(meta);
        const registryPatient = await resolveTenantPatientByMrn(mrn);
        const mrnGroup = mrn ? patientStudyUidsMt.get(mrn) : undefined;
        let viewerUids: string[];

        if (mrnGroup && mrnGroup.length > 0) {
          viewerUids = mrnGroup;
        } else if (hasUid && studyUid) {
          const dimGroup = dimGroupMapMt.get(studyUid);
          viewerUids = dimGroup && dimGroup.length > 0 ? dimGroup : [studyUid];
        } else {
          viewerUids = [];
        }

        const viewerUrl = viewerUids.length > 0 ? buildViewerUrl(viewerUids) : null;
        const weasisStudyUid = hasUid ? studyUid! : null;

        return {
          studyId: study.id,
          patientName: study.patient_name ?? "Unknown",
          studyDate: normalizeStudyDate(study.study_date) ?? "",
          modality: study.modality ?? "OT",
          description: study.description ?? "",
          location: study.location ?? "",
          status: study.status ?? "unassigned",
          assignedTo: study.assigned_to,
          assignedAt: study.assigned_at,
          reportedAt: study.reported_at,
          tatHours: study.tat_hours,
          uploaderId: study.uploader_id,
          metadata: {
            ...study.metadata,
            ...(mrn ? { patientId: mrn } : {}),
            ...(registryPatient
              ? {
                  patientRegistryId: registryPatient.id,
                  patientDateOfBirth: registryPatient.date_of_birth,
                  ...(registryPatient.phone ? { patientPhone: registryPatient.phone } : {}),
                  ...(registryPatient.email ? { patientEmail: registryPatient.email } : {}),
                  ...(registryPatient.address ? { patientAddress: registryPatient.address } : {}),
                }
              : {}),
          },
          viewerUrl,
          weasisUrl: weasisStudyUid
            ? `weasis://?%24dicom%3Ars%20--url%20%22${encodeURIComponent(getWeasisBaseUrl(req, weasisStudyUid, tenantSlug))}%22%20-r%20%22studyUID%3D${encodeURIComponent(weasisStudyUid)}%22`
            : null,
          reportUrl: `/reports/study/${encodeURIComponent(study.id)}`,
        };
      }))).sort((left, right) => parseStudyDateSortValue(right.studyDate) - parseStudyDateSortValue(left.studyDate));

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

    let records: StudyRecord[] = [];
    try {
      records = await store.listStudyRecords({
        name: query.name,
        date: query.date,
        location: query.location,
        status: query.status as StudyStatus | undefined,
        assignedTo: query.assignedTo,
        uploaderId: query.uploaderId,
      });
      records = dedupeStudyRecordsByCanonicalUid(records);
    } catch (error) {
      logger.warn({
        message: "Primary study store unavailable; falling back to direct Dicoogle worklist view",
        error: String(error),
      });

      let remoteStudies: Array<Record<string, unknown>> = [];
      try {
        const searchText = query.search ?? query.name;
        remoteStudies = await dicoogle.searchStudies(searchText);
      } catch (searchError) {
        logger.warn({
          message: "Fallback Dicoogle worklist search failed",
          error: String(searchError),
        });
      }

      const nameTokens = (query.name ?? "")
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
      const locationNeedle = query.location?.trim().toLowerCase() ?? "";
      const dateNeedle = query.date?.trim() ?? "";

      const fallbackData = remoteStudies
        .map((study) => {
          const studyId = extractString(study, ["studyId", "StudyInstanceUID", "0020000D"]);
          if (!studyId) return null;

          const patientName = extractString(study, ["patientName", "PatientName", "00100010"]) ?? "Unknown";
          const studyDate = normalizeStudyDate(extractString(study, ["studyDate", "StudyDate", "00080020"])) ?? "";
          const location = extractString(study, ["location", "uploadingLocation", "InstitutionName", "00080080"]) ?? "";
          const studyInstanceUid = resolveStudyInstanceUidFromCandidate(studyId, study);
          const viewerUrl = studyInstanceUid ? buildViewerUrl(studyInstanceUid) : null;

          return {
            studyId,
            patientName,
            studyDate,
            modality: extractString(study, ["modality", "Modality", "00080060"]) ?? "OT",
            description: extractString(study, ["description", "StudyDescription", "00081030"]) ?? "",
            location,
            status: "unassigned" as const,
            assignedTo: undefined,
            assignedAt: undefined,
            reportedAt: undefined,
            tatHours: undefined,
            metadata: study,
            viewerUrl,
            weasisUrl: studyInstanceUid
              ? `weasis://?%24dicom%3Ars%20--url%20%22${encodeURIComponent(getWeasisBaseUrl(req, studyInstanceUid))}%22%20-r%20%22studyUID%3D${encodeURIComponent(studyInstanceUid)}%22`
              : null,
            reportUrl: `/reports/study/${encodeURIComponent(studyId)}`,
            viewerValidation: null,
          };
        })
        .filter((entry): entry is {
          studyId: string;
          patientName: string;
          studyDate: string;
          modality: string;
          description: string;
          location: string;
          status: "unassigned";
          assignedTo: undefined;
          assignedAt: undefined;
          reportedAt: undefined;
          tatHours: undefined;
          metadata: Record<string, unknown>;
          viewerUrl: string | null;
          weasisUrl: string | null;
          reportUrl: string;
          viewerValidation: null;
        } => entry !== null)
        .filter((entry) => {
          if (nameTokens.length > 0) {
            const nameLower = entry.patientName.toLowerCase();
            const matchesAllTokens = nameTokens.every((token) => nameLower.includes(token));
            if (!matchesAllTokens) return false;
          }
          if (dateNeedle && !entry.studyDate.startsWith(dateNeedle)) return false;
          if (locationNeedle && !entry.location.toLowerCase().includes(locationNeedle)) return false;
          if (query.status && query.status !== "unassigned") return false;
          if (query.assignedTo) return false;
          if (query.uploaderId) {
            const uploaderId = extractString(entry.metadata, ["uploaderId", "uploadedBy", "userId"]);
            if (uploaderId !== query.uploaderId) return false;
          }
          return true;
        })
        .sort((a, b) => parseStudyDateSortValue(b.studyDate) - parseStudyDateSortValue(a.studyDate));

      res.json(fallbackData);
      return;
    }

    // Group resolved UIDs by patient MRN so the viewer URL can include
    // every study that belongs to the same patient.
    const patientStudyUids = new Map<string, string[]>();
    const recordUidMap = new Map<string, string>();
    for (const record of records) {
      const uid = resolveStudyInstanceUid(record);
      if (!uid) continue;
      recordUidMap.set(record.studyId, uid);
      const meta = record.metadata as Record<string, unknown> | undefined;
      const mrn = resolvePatientMrn(meta);
      if (mrn) {
        const list = patientStudyUids.get(mrn) ?? [];
        if (!list.includes(uid)) list.push(uid);
        patientStudyUids.set(mrn, list);
      }
    }

    // Supplement with DIM-based patient grouping (reads PatientID directly
    // from DICOM headers) so studies whose Firestore metadata lacks a
    // recognisable MRN field are still grouped correctly.
    const dimGroupMap = await buildPatientStudyGroupMap();
    const patientCacheByMrn = new Map<string, Awaited<ReturnType<StoreService["getPatientByMrn"]>>>();
    const resolvePatientByMrn = async (mrn: string | undefined) => {
      const key = mrn?.trim().toUpperCase();
      if (!key) return null;
      if (!patientCacheByMrn.has(key)) {
        patientCacheByMrn.set(key, await store.getPatientByMrn(key));
      }
      return patientCacheByMrn.get(key) ?? null;
    };

    let allPatientsCache: Awaited<ReturnType<StoreService["listPatients"]>> | null = null;
    const patientByNameCache = new Map<string, Patient>();
    const resolvePatientByName = async (name: string | undefined) => {
      const normalized = name?.replace(/[\^,]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalized) return null;
      if (patientByNameCache.has(normalized)) return patientByNameCache.get(normalized) ?? null;
      if (!allPatientsCache) {
        allPatientsCache = await store.listPatients();
      }
      const match = allPatientsCache.find(
        (p) => `${p.firstName} ${p.lastName}`.toLowerCase() === normalized,
      ) ?? null;
      patientByNameCache.set(normalized, match!);
      return match;
    };

    const data = await Promise.all(records.map(async (record) => {
      const studyInstanceUid = recordUidMap.get(record.studyId) ?? null;
      const hasDicom = studyInstanceUid !== null;

      const meta = record.metadata as Record<string, unknown> | undefined;
      let mrn = resolvePatientMrn(meta);
      let registryPatient = await resolvePatientByMrn(mrn);

      if (!registryPatient && record.patientName) {
        registryPatient = await resolvePatientByName(record.patientName);
        if (registryPatient) {
          mrn = registryPatient.patientId;
        }
      }
      let viewerUids: string[];

      const mrnGroup = mrn ? patientStudyUids.get(mrn) : undefined;
      if (mrnGroup && mrnGroup.length > 0) {
        viewerUids = mrnGroup;
      } else if (studyInstanceUid) {
        const dimGroup = dimGroupMap.get(studyInstanceUid);
        viewerUids = dimGroup && dimGroup.length > 0 ? dimGroup : [studyInstanceUid];
      } else {
        viewerUids = [];
      }

      const viewerUrl = viewerUids.length > 0 ? buildViewerUrl(viewerUids) : null;
      const metadata = {
        ...(meta ?? {}),
        ...(mrn ? { patientId: mrn } : {}),
        ...(registryPatient
          ? {
              patientRegistryId: registryPatient.id,
              patientDateOfBirth: registryPatient.dateOfBirth,
              ...(registryPatient.phone ? { patientPhone: registryPatient.phone } : {}),
              ...(registryPatient.email ? { patientEmail: registryPatient.email } : {}),
              ...(registryPatient.address ? { patientAddress: registryPatient.address } : {}),
            }
          : {}),
      };

      return {
        ...record,
        metadata,
        viewerUrl,
        weasisUrl: hasDicom && studyInstanceUid
          ? `weasis://?%24dicom%3Ars%20--url%20%22${encodeURIComponent(getWeasisBaseUrl(req, studyInstanceUid))}%22%20-r%20%22studyUID%3D${encodeURIComponent(studyInstanceUid)}%22`
          : null,
        reportUrl: `/reports/study/${encodeURIComponent(record.studyId)}`,
        viewerValidation: (metadata as Record<string, unknown>).dicomValidation ?? null,
      };
    }));

    res.json(data);
  }));

  router.get(
    "/worklist/:studyId/viewer-access",
    ensureAuthenticated,
    ensurePermission(store, "worklist:view"),
    asyncHandler(async (req, res) => {
      const studyId = String(req.params.studyId ?? "");
      const gwReq = req as GatewayRequest;
      const tenantId = (gwReq.tenantId ?? req.get("x-tenant-id")?.trim()) || undefined;
      const isTenantScoped = Boolean(env.MULTI_TENANT_ENABLED && tenantId && tenantStore);

      const record = !isTenantScoped ? await store.getStudyRecord(studyId) : null;
      const tenantRecord = isTenantScoped && tenantId && tenantStore
        ? (await tenantStore.getStudy(tenantId, studyId)
          ?? (looksLikeDicomUid(studyId) ? await tenantStore.getStudyByUid(tenantId, studyId) : null))
        : null;

      if (!record && !tenantRecord) {
        res.status(404).json({ allowed: false, message: "Study not found in RIS" });
        return;
      }

      const recordMetadata = (record?.metadata as Record<string, unknown> | undefined)
        ?? (tenantRecord?.metadata as Record<string, unknown> | undefined)
        ?? {};
      const studyInstanceUid = record
        ? resolveStudyInstanceUid(record)
        : tenantRecord
          ? resolveTenantStudyInstanceUid(tenantRecord)
          : null;
      if (!studyInstanceUid) {
        res.status(409).json({
          allowed: false,
          message: "Study does not have a valid StudyInstanceUID",
        });
        return;
      }

      if (record && record.studyId !== studyInstanceUid) {
        logger.warn({
          message: "RIS/Dicoogle StudyInstanceUID mismatch detected",
          risStudyId: record.studyId,
          pacsStudyInstanceUID: studyInstanceUid,
        });
      }

      const patientId = (recordMetadata.patientId as string | undefined) ?? undefined;
      const validation = await validateStudyAvailability({
        studyInstanceUID: studyInstanceUid,
        dicomwebBaseUrl: getDicomwebValidationBaseUrl(req),
        tenantId,
        patientId,
        maxAttempts: 3,
        retryDelayMs: 2000,
      });
      const dicomValidationMetadata = {
        state: validation.isValid ? "valid" : "invalid",
        reason: validation.reason ?? null,
        message: validation.message,
        validatedAt: new Date().toISOString(),
        attempts: validation.attempts,
        endpointUrls: validation.endpointUrls,
        responseStatus: validation.responseStatus,
      };
      if (record) {
        await store.upsertStudyRecord(record.studyId, {
          metadata: {
            ...recordMetadata,
            dicomValidation: dicomValidationMetadata,
          },
        });
      } else if (tenantRecord && tenantStore && tenantId) {
        await tenantStore.upsertStudy(tenantId, {
          studyInstanceUid: tenantRecord.study_instance_uid,
          patientName: tenantRecord.patient_name,
          studyDate: tenantRecord.study_date,
          modality: tenantRecord.modality,
          description: tenantRecord.description,
          status: tenantRecord.status,
          uploaderId: tenantRecord.uploader_id,
          metadata: {
            ...recordMetadata,
            dicomValidation: dicomValidationMetadata,
          },
        });
      }

      if (!validation.isValid) {
        logger.warn({
          message: "Viewer launch blocked by Dicoogle validation",
          studyId: record?.studyId ?? tenantRecord?.id ?? studyId,
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
      const mrn = resolvePatientMrn(recordMetadata);
      const candidatePatientName = (record?.patientName ?? tenantRecord?.patient_name ?? "").trim();
      const normalizedPatientName = isUsablePatientName(candidatePatientName)
        ? candidatePatientName.toLowerCase()
        : "";

      const allUids: string[] = [studyInstanceUid];
      let metadataSiblingCount = allUids.length;
      let dimSiblingCount = 0;
      let sameMrnRecordCount = 0;
      let sameMrnValidUidCount = 0;
      let sameMrnInvalidUidCount = 0;
      let samePatientNameRecordCount = 0;
      let samePatientNameValidUidCount = 0;
      let usedPatientNameFallback = false;
      const samePatientNameUids: string[] = [];

      if (isTenantScoped && tenantStore && tenantId && (mrn || normalizedPatientName)) {
        const allTenantStudies = await tenantStore.listStudies(tenantId, {});
        for (const tenantStudy of allTenantStudies) {
          const tenantMeta = tenantStudy.metadata as Record<string, unknown> | undefined;
          const tenantMrn = resolvePatientMrn(tenantMeta);
          const tenantRawName = (tenantStudy.patient_name ?? "").trim();
          const tenantPatientName = isUsablePatientName(tenantRawName) ? tenantRawName.toLowerCase() : "";
          const tenantUid = resolveTenantStudyInstanceUid(tenantStudy);

          if (normalizedPatientName && tenantPatientName === normalizedPatientName) {
            samePatientNameRecordCount += 1;
            if (tenantUid) {
              samePatientNameValidUidCount += 1;
              if (!samePatientNameUids.includes(tenantUid)) {
                samePatientNameUids.push(tenantUid);
              }
            }
          }

          if (mrn && tenantMrn === mrn) {
            sameMrnRecordCount += 1;
            if (tenantUid) {
              sameMrnValidUidCount += 1;
              if (!allUids.includes(tenantUid)) {
                allUids.push(tenantUid);
              }
            } else {
              sameMrnInvalidUidCount += 1;
            }
          }
        }
      } else if (mrn || normalizedPatientName) {
        const allRecords = await store.listStudyRecords({});
        for (const r of allRecords) {
          const rMeta = r.metadata as Record<string, unknown> | undefined;
          const rMrn = resolvePatientMrn(rMeta);
          const rawRecordPatientName = (r.patientName ?? "").trim();
          const recordPatientName = isUsablePatientName(rawRecordPatientName) ? rawRecordPatientName.toLowerCase() : "";
          const rUid = resolveStudyInstanceUid(r);

          if (normalizedPatientName && recordPatientName === normalizedPatientName) {
            samePatientNameRecordCount += 1;
            if (rUid) {
              samePatientNameValidUidCount += 1;
              if (!samePatientNameUids.includes(rUid)) {
                samePatientNameUids.push(rUid);
              }
            }
          }

          if (mrn && rMrn === mrn) {
            sameMrnRecordCount += 1;
            if (rUid) {
              sameMrnValidUidCount += 1;
              if (!allUids.includes(rUid)) {
                allUids.push(rUid);
              }
            } else {
              sameMrnInvalidUidCount += 1;
            }
          }
        }
      }

      // If MRN is missing (or only matches the current study), fall back to
      // patient-name grouping to keep multi-upload studies visible in OHIF.
      const shouldUsePatientNameFallback =
        samePatientNameValidUidCount > 1 && (!mrn || sameMrnValidUidCount <= 1);
      if (shouldUsePatientNameFallback) {
        usedPatientNameFallback = true;
        for (const uid of samePatientNameUids) {
          if (!allUids.includes(uid)) {
            allUids.push(uid);
          }
        }
      }

      metadataSiblingCount = allUids.length;

      // Fallback: use DIM-based patient grouping (reads PatientID from
      // DICOM headers) when the metadata-based MRN grouping above didn't
      // find any sibling studies.
      if (allUids.length <= 1) {
        const dimSiblings = await getStudyUidsForSamePatient(studyInstanceUid, {
          patientIdHint: mrn,
          patientNameHint: normalizedPatientName,
        });
        dimSiblingCount = dimSiblings.length;
        for (const uid of dimSiblings) {
          if (!allUids.includes(uid)) {
            allUids.push(uid);
          }
        }
      }

      // Filter out sibling UIDs whose DICOM data is not actually available
      if (allUids.length > 1) {
        const siblingValidationPromises = allUids.slice(1).map(async (uid) => {
          try {
            const v = await validateStudyAvailability({
              studyInstanceUID: uid,
              dicomwebBaseUrl: getDicomwebValidationBaseUrl(req),
              tenantId,
              maxAttempts: 1,
              retryDelayMs: 0,
            });
            return { uid, valid: v.isValid };
          } catch {
            return { uid, valid: false };
          }
        });
        const siblingResults = await Promise.all(siblingValidationPromises);
        const invalidSiblings = siblingResults.filter((r) => !r.valid).map((r) => r.uid);
        if (invalidSiblings.length > 0) {
          logger.info({
            message: "Removed sibling UIDs without available DICOM data",
            removedUids: invalidSiblings,
            studyInstanceUID: studyInstanceUid,
          });
          for (const badUid of invalidSiblings) {
            const idx = allUids.indexOf(badUid);
            if (idx > 0) allUids.splice(idx, 1);
          }
        }
      }

      logger.info({
        message: "Viewer access sibling lookup summary",
        studyId: record?.studyId ?? tenantRecord?.id ?? studyId,
        studyInstanceUID: studyInstanceUid,
        tenantId: tenantId ?? null,
        isTenantScoped,
        mrnPresent: Boolean(mrn),
        metadataSiblingCount,
        dimSiblingCount,
        finalUidCount: allUids.length,
        sameMrnRecordCount,
        sameMrnValidUidCount,
        sameMrnInvalidUidCount,
        samePatientNameRecordCount,
        samePatientNameValidUidCount,
        usedPatientNameFallback,
        usedDimFallback: metadataSiblingCount <= 1,
      });

      const viewerUrl = buildViewerUrl(allUids);
      if (!viewerUrl) {
        logger.warn({
          message: "Viewer launch blocked: no valid StudyInstanceUIDs available for URL generation",
          studyId: record?.studyId ?? tenantRecord?.id ?? studyId,
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
        studyId: record?.studyId ?? tenantRecord?.id ?? studyId,
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
