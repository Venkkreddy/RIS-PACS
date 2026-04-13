import { FormEvent, useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { api } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { StudyPriority, WorklistStudy } from "../types/worklist";
import type { Gender, Patient } from "@medical-report-system/shared";
import { useAuthRole } from "../hooks/useAuthRole";
import { useTheme } from "../hooks/useTheme";
import { DicomUpload } from "./DicomUpload";
import { OhifViewerEmbed } from "./OhifViewerEmbed";
import { LayoutGroup, motion } from "framer-motion";
import {
  ListTodo,
  AlertTriangle,
  Zap,
  Clock,
  CheckCircle2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  Activity,
  RefreshCw,
  UploadCloud,
  X,
  ExternalLink,
  Copy,
  Edit2,
  UserCircle,
  UserPlus,
  Eye,
  MonitorSmartphone,
  CalendarRange,
  ShieldAlert,
  CircleDot,
  Trash2,
} from "lucide-react";

/* ── Status filter tabs matching the screenshot ──────────── */
const STATUS_TABS = [
  { key: "all",       label: "All Cases",     icon: ListTodo },
  { key: "emergency", label: "Emergency",     icon: AlertTriangle },
  { key: "stat",      label: "Stat",          icon: Zap },
  { key: "pending",   label: "Pending",       icon: Clock },
  { key: "completed", label: "Completed",     icon: CheckCircle2 },
] as const;

/* ── Modality filter icons ────────────────────────────── */
const MODALITY_FILTERS = [
  { key: "XRAY", label: "XRAY", aliases: ["XR", "CR", "DX"] },
  { key: "MRI", label: "MRI", aliases: ["MR", "MRI"] },
  { key: "CT", label: "CT", aliases: ["CT"] },
  { key: "US", label: "US", aliases: ["US"] },
  { key: "PT", label: "PET", aliases: ["PT", "PET"] },
] as const;

type ModalityFilterKey = (typeof MODALITY_FILTERS)[number]["key"];
type SearchField = "name" | "mrn" | "accession";

const SEARCH_OPTIONS: Array<{ value: SearchField; label: string; placeholder: string }> = [
  { value: "name", label: "Name", placeholder: "Search by patient name" },
  { value: "mrn", label: "MRN", placeholder: "Search by MRN / Patient ID" },
  { value: "accession", label: "Accession", placeholder: "Search by accession / study ID" },
];

const MRN_METADATA_KEYS = ["patientId", "PatientID", "00100020", "mrn", "MRN"] as const;
const REGISTRY_ID_METADATA_KEYS = ["patientRegistryId", "patientRegistryID", "registryPatientId"] as const;
const ACCESSION_METADATA_KEYS = ["accessionNumber", "AccessionNumber", "00080050"] as const;
const INDIA_PHONE_REGEX = /^(?:\+91[\s-]?)?[6-9]\d{9}$/;

function parseStudyModalities(modality?: string): string[] {
  return (modality ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function normalizeSearchValue(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[\^,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DICOM UID pattern (numeric dotted); not a hospital MRN. */
function looksLikeDicomUidString(value: string): boolean {
  return /^\d+(?:\.\d+)+$/.test(value.trim());
}

function getStudyMetadataString(study: WorklistStudy, keys: readonly string[]): string {
  const metadata = study.metadata;
  if (!metadata) return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function getStudyRegistryPatientId(study: WorklistStudy): string {
  return getStudyMetadataString(study, REGISTRY_ID_METADATA_KEYS).trim();
}

/** Human MRN / Patient ID from metadata; excludes DICOM UID-shaped PatientID values. */
function getHumanPatientMrn(study: WorklistStudy): string {
  const raw = getStudyMetadataString(study, MRN_METADATA_KEYS).trim();
  if (!raw) return "";
  if (looksLikeDicomUidString(raw)) return "";
  if (/^UPL-[A-Z0-9]+$/i.test(raw)) return "";
  return raw;
}

function normalizeDicomPersonNameForKey(name?: string): string {
  return normalizeSearchValue(name?.replace(/\^/g, " "));
}

/**
 * Stable key for one row per patient + OHIF iframe reload bumps.
 * Prefer real MRN; if metadata only has UID-like "PatientID", group by normalized name.
 */
function stablePatientListKey(study: WorklistStudy): string {
  const registryId = getStudyRegistryPatientId(study);
  if (registryId) return `rid:${registryId.toLowerCase()}`;
  const mrn = getHumanPatientMrn(study);
  if (mrn) return `mrn:${mrn.toLowerCase()}`;
  const normalizedName = normalizeDicomPersonNameForKey(study.patientName);
  if (normalizedName) return `name:${normalizedName}`;
  return `study:${study.studyId}`;
}

function displayPatientId(study: WorklistStudy): string {
  const mrn = getHumanPatientMrn(study);
  return mrn || "—";
}

function isRegistryOnlyStudy(study: WorklistStudy): boolean {
  return (study.metadata as Record<string, unknown> | undefined)?.registryOnly === true;
}

function buildRegistryOnlyWorklistStudy(patient: Patient): WorklistStudy {
  return {
    studyId: `registry-${patient.id}`,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    studyDate: patient.updatedAt?.slice(0, 10),
    modality: "OT",
    description: "Patient registered (no DICOM uploaded yet)",
    location: "",
    status: "unassigned",
    assignedTo: undefined,
    assignedAt: undefined,
    reportedAt: undefined,
    tatHours: undefined,
    metadata: {
      registryOnly: true,
      patientId: patient.patientId,
      patientRegistryId: patient.id,
      patientDateOfBirth: patient.dateOfBirth,
      ...(patient.phone ? { patientPhone: patient.phone } : {}),
      ...(patient.email ? { patientEmail: patient.email } : {}),
      ...(patient.address ? { patientAddress: patient.address } : {}),
      updatedAt: patient.updatedAt,
    },
    viewerUrl: null,
    weasisUrl: null,
    reportUrl: "/patients",
    viewerValidation: null,
  };
}

function isValidDobForRegistration(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const now = new Date();
  const dob = new Date(parsed);
  if (dob > now) return false;
  const oldest = new Date();
  oldest.setFullYear(now.getFullYear() - 130);
  return dob >= oldest;
}

function normalizeIndianPhoneNumber(value: string): string | null {
  const digits = value.replace(/\D+/g, "");
  let local = "";
  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else {
    return null;
  }
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** Aligns with DicomUpload patient binding; returns stable list key (not study UID). */
function worklistRowPatientMrn(study: WorklistStudy): string {
  return stablePatientListKey(study);
}

function normalizeStudyDateForSort(studyDate?: string): string | undefined {
  const raw = studyDate?.trim();
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

function getStudyDateSortValue(studyDate?: string): number {
  const normalized = normalizeStudyDateForSort(studyDate);
  if (!normalized) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function getStudyUpdatedAtSortValue(study: WorklistStudy): number {
  const metadata = study.metadata as Record<string, unknown> | undefined;
  const candidates = [
    typeof metadata?.updatedAt === "string" ? metadata.updatedAt : undefined,
    typeof metadata?.receivedAt === "string" ? metadata.receivedAt : undefined,
    typeof metadata?.validatedAt === "string" ? metadata.validatedAt : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function compareStudiesByRecencyDesc(left: WorklistStudy, right: WorklistStudy): number {
  const rightStudyDate = getStudyDateSortValue(right.studyDate);
  const leftStudyDate = getStudyDateSortValue(left.studyDate);
  if (rightStudyDate !== leftStudyDate) {
    return rightStudyDate - leftStudyDate;
  }
  const rightUpdatedAt = getStudyUpdatedAtSortValue(right);
  const leftUpdatedAt = getStudyUpdatedAtSortValue(left);
  if (rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }
  return right.studyId.localeCompare(left.studyId);
}

function worklistPatientGroupKey(study: WorklistStudy): string {
  return stablePatientListKey(study);
}

function matchesSearchField(study: WorklistStudy, searchField: SearchField, rawSearch: string): boolean {
  const tokens = normalizeSearchValue(rawSearch).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  const candidatesByField: Record<SearchField, string[]> = {
    name: [study.patientName ?? ""],
    mrn: [getHumanPatientMrn(study), getStudyMetadataString(study, MRN_METADATA_KEYS), study.studyId],
    accession: [getStudyMetadataString(study, ACCESSION_METADATA_KEYS), study.studyId],
  };

  const candidates = candidatesByField[searchField]
    .map((candidate) => normalizeSearchValue(candidate))
    .filter(Boolean);

  return candidates.some((candidate) => tokens.every((token) => candidate.includes(token)));
}

function isLaunchableViewerUrl(viewerUrl: string): boolean {
  try {
    const parsed = new URL(viewerUrl);
    if (/\/dicom-microscopy-viewer(?:\/|$)/i.test(parsed.pathname)) {
      return false;
    }
    const studyUids = parsed.searchParams.get("StudyInstanceUIDs");
    const studyUidsLower = parsed.searchParams.get("studyInstanceUIDs");
    return (
      (typeof studyUids === "string" && studyUids.trim().length > 0) ||
      (typeof studyUidsLower === "string" && studyUidsLower.trim().length > 0)
    );
  } catch {
    return false;
  }
}

function resolveLaunchableViewerUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && isLaunchableViewerUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function rewriteViewerUrlForCurrentOrigin(rawViewerUrl: string): string {
  const parsed = new URL(rawViewerUrl);
  parsed.protocol = window.location.protocol;

  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (isLocalhost) {
    parsed.hostname = window.location.hostname;
  } else {
    // On VM deployments, serve OHIF through the frontend origin to avoid
    // iframe failures caused by the separate self-signed OHIF certificate.
    parsed.host = window.location.host;
  }

  return parsed.toString();
}

const isPendingStudy = (study: WorklistStudy) =>
  study.status === "assigned" || study.status === "unassigned" || (study.status as string) === "pending";

const isCompletedStudy = (study: WorklistStudy) => study.status === "reported";

/** Worklist API often omits `priority`; honor metadata from uploads / Dicoogle so Emergency & Stat tabs are usable. */
function priorityStringFromMetadata(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  const keys = [
    "priority",
    "Priority",
    "requestedProcedurePriority",
    "RequestedProcedurePriority",
    "studyPriority",
    "StudyPriority",
  ];
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeWorklistPriority(raw: string): StudyPriority | undefined {
  const n = raw.toLowerCase().replace(/\s+/g, "");
  if (n === "emergency" || n === "emer") return "emergency";
  if (n === "stat" || n === "s") return "stat";
  if (n === "urgent" || n === "u" || n === "high" || n === "asap") return "urgent";
  if (n === "routine" || n === "normal" || n === "r" || n === "low") return "normal";
  return undefined;
}

function getEffectivePriority(study: WorklistStudy): StudyPriority | undefined {
  if (study.priority) return study.priority;
  const fromMeta = priorityStringFromMetadata(study.metadata as Record<string, unknown> | undefined);
  return fromMeta ? normalizeWorklistPriority(fromMeta) : undefined;
}

const isEmergencyStudy = (study: WorklistStudy) => getEffectivePriority(study) === "emergency";
const isStatStudy = (study: WorklistStudy) => {
  const p = getEffectivePriority(study);
  return p === "stat" || p === "urgent";
};

export function RadiologistDashboard() {
  const queryClient = useQueryClient();
  const auth = useAuthRole();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("all");
  const [searchField, setSearchField] = useState<SearchField>("name");
  const [searchText, setSearchText] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchModality, setSearchModality] = useState<ModalityFilterKey | "">("");
  const [viewerStudyId, setViewerStudyId] = useState<string | null>(null);
  const [resolvedViewerUrlByStudyId, setResolvedViewerUrlByStudyId] = useState<Record<string, string>>({});
  const [viewerWarning, setViewerWarning] = useState<string | null>(null);
  const [validatingViewerStudyId, setValidatingViewerStudyId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [uploadStudy, setUploadStudy] = useState<WorklistStudy | null>(null);
  const { isDark: darkMode } = useTheme();
  const [compactMode, setCompactMode] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  /** Per-patient revision so OHIF iframe remounts after uploads without affecting other patients' viewer state. */
  const [viewerReloadByPatientMrn, setViewerReloadByPatientMrn] = useState<Record<string, number>>({});

  const [showRegisterPatient, setShowRegisterPatient] = useState(false);
  const [regForm, setRegForm] = useState({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M" as Gender, phone: "", email: "", address: "" });
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [recentlyRegisteredPatients, setRecentlyRegisteredPatients] = useState<Patient[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ studyId: string; patientName: string; patientMrn: string; registryId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const bumpOhifReloadForPatient = useCallback(
    async (patientId: string) => {
      const key = patientId.trim();
      if (!key) return;
      await queryClient.refetchQueries({
        predicate: (q) => q.queryKey[0] === "worklist",
      });
      setViewerReloadByPatientMrn((prev) => ({
        ...prev,
        [key]: (prev[key] ?? 0) + 1,
      }));
    },
    [queryClient],
  );

  const handleDicomUploadedForPatient = useCallback(
    ({ patientId }: { patientId: string }) => {
      const raw = patientId.trim();
      if (!raw) return;
      const key = looksLikeDicomUidString(raw) ? `study:${raw}` : `mrn:${raw.toLowerCase()}`;
      void bumpOhifReloadForPatient(key);
    },
    [bumpOhifReloadForPatient],
  );

  const canDicomUpload = auth.role === "admin" || auth.role === "super_admin" || auth.hasPermission("dicom:upload");
  const canDeletePatient = auth.role === "admin" || auth.role === "super_admin" || auth.hasPermission("patients:delete");

  function resetRegForm() {
    setRegForm({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M", phone: "", email: "", address: "" });
    setRegError(null);
    setRegSuccess(null);
  }

  function formatPatientApiError(err: unknown): string {
    const data = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
    const e = data?.error;
    if (Array.isArray(e)) {
      return e
        .map((item: { message?: string }) => item.message)
        .filter(Boolean)
        .join("; ");
    }
    if (typeof e === "string") return e;
    return err instanceof Error ? err.message : "Failed to register patient";
  }

  async function handleRegisterPatient(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);
    if (!isValidDobForRegistration(regForm.dateOfBirth)) {
      setRegError("Enter a valid date of birth (past date, up to 130 years old).");
      return;
    }
    const rawPhone = regForm.phone.trim();
    const normalizedPhone = rawPhone ? normalizeIndianPhoneNumber(rawPhone) : null;
    if (rawPhone && (!normalizedPhone || !INDIA_PHONE_REGEX.test(rawPhone))) {
      setRegError("Phone must be a valid Indian number (example: +91 9876543210).");
      return;
    }
    setRegSubmitting(true);
    try {
      const payload = {
        patientId: regForm.patientId.trim().toUpperCase(),
        firstName: regForm.firstName.trim(),
        lastName: regForm.lastName.trim(),
        dateOfBirth: regForm.dateOfBirth,
        gender: regForm.gender,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(regForm.email.trim() ? { email: regForm.email.trim() } : {}),
        ...(regForm.address.trim() ? { address: regForm.address.trim() } : {}),
      };
      const { data } = await api.post<Patient>("/patients", payload);
      setRecentlyRegisteredPatients((prev) => [data, ...prev.filter((patient) => patient.id !== data.id)]);
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
      await worklistQuery.refetch();
      setShowRegisterPatient(false);
      resetRegForm();
    } catch (err: unknown) {
      setRegError(formatPatientApiError(err));
    } finally {
      setRegSubmitting(false);
    }
  }

  async function handleDeletePatient() {
    if (!deleteTarget?.registryId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/patients/${deleteTarget.registryId}`);
      setRecentlyRegisteredPatients((prev) => prev.filter((p) => p.id !== deleteTarget.registryId));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
      await queryClient.invalidateQueries({ queryKey: ["worklist"] });
    } catch (err: unknown) {
      setDeleteError(formatPatientApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  const debouncedSearchText = useDebouncedValue(searchText, 400);
  const selectedSearchOption = SEARCH_OPTIONS.find((option) => option.value === searchField) ?? SEARCH_OPTIONS[0];
  const trimmedSearchText = debouncedSearchText.trim();

  const canViewPatients = auth.hasPermission("patients:view");
  const registryPatientsQuery = useQuery({
    queryKey: ["patients", "worklist"],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients");
      return res.data;
    },
    enabled: auth.isAuthenticated && auth.approved && canViewPatients,
    staleTime: 5000,
    retry: 1,
  });

  const worklistQuery = useQuery({
    queryKey: ["worklist", { searchField, searchText: debouncedSearchText, dateFrom: searchDateFrom, dateTo: searchDateTo }],
    queryFn: async () => {
      const response = await api.get<WorklistStudy[]>("/worklist", {
        params: {
          ...(trimmedSearchText
            ? searchField === "name"
              ? { name: trimmedSearchText, search: trimmedSearchText }
              : { search: trimmedSearchText }
            : {}),
          ...(searchDateFrom ? { dateFrom: searchDateFrom } : {}),
          ...(searchDateTo ? { dateTo: searchDateTo } : {}),
        },
      });
      return response.data;
    },
    enabled: auth.isAuthenticated && auth.approved,
    refetchInterval: (query) => (query.state.fetchStatus === "fetching" ? false : 10_000),
    staleTime: 5000,
    retry: 1,
  });

  const knownPatientsByMrn = useMemo(() => {
    const byMrn = new Map<string, Patient>();
    for (const patient of registryPatientsQuery.data ?? []) {
      byMrn.set(patient.patientId.trim().toLowerCase(), patient);
    }
    for (const patient of recentlyRegisteredPatients) {
      byMrn.set(patient.patientId.trim().toLowerCase(), patient);
    }
    return byMrn;
  }, [registryPatientsQuery.data, recentlyRegisteredPatients]);

  const knownPatientsByName = useMemo(() => {
    const byName = new Map<string, Patient>();
    for (const patient of registryPatientsQuery.data ?? []) {
      byName.set(`${patient.firstName} ${patient.lastName}`.trim().toLowerCase(), patient);
    }
    for (const patient of recentlyRegisteredPatients) {
      byName.set(`${patient.firstName} ${patient.lastName}`.trim().toLowerCase(), patient);
    }
    return byName;
  }, [registryPatientsQuery.data, recentlyRegisteredPatients]);

  const rawData = worklistQuery.data ?? [];
  const allRegistryPatients = registryPatientsQuery.data ?? [];
  const data = useMemo(() => {
    const latestStudyByPatient = new Map<string, WorklistStudy>();
    for (const study of rawData) {
      const key = worklistPatientGroupKey(study);
      const existing = latestStudyByPatient.get(key);
      if (!existing || compareStudiesByRecencyDesc(study, existing) < 0) {
        latestStudyByPatient.set(key, study);
      }
    }
    const merged = Array.from(latestStudyByPatient.values());
    const existingMrnKeys = new Set(
      merged
        .map((study) => getHumanPatientMrn(study).trim().toLowerCase())
        .filter(Boolean),
    );
    const existingNameKeys = new Set(
      merged
        .map((study) => (study.patientName ?? "").replace(/[\^,]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase())
        .filter(Boolean),
    );
    const addedMrnKeys = new Set<string>();
    for (const patient of allRegistryPatients) {
      const mrnKey = patient.patientId.trim().toLowerCase();
      const nameKey = `${patient.firstName} ${patient.lastName}`.trim().toLowerCase();
      if (!mrnKey || existingMrnKeys.has(mrnKey) || existingNameKeys.has(nameKey)) continue;
      addedMrnKeys.add(mrnKey);
      merged.push(buildRegistryOnlyWorklistStudy(patient));
    }
    for (const patient of recentlyRegisteredPatients) {
      const mrnKey = patient.patientId.trim().toLowerCase();
      const nameKey = `${patient.firstName} ${patient.lastName}`.trim().toLowerCase();
      if (!mrnKey || existingMrnKeys.has(mrnKey) || existingNameKeys.has(nameKey) || addedMrnKeys.has(mrnKey)) continue;
      merged.push(buildRegistryOnlyWorklistStudy(patient));
    }
    return merged.sort(compareStudiesByRecencyDesc);
  }, [rawData, allRegistryPatients, recentlyRegisteredPatients]);

  async function validateAndOpenViewer(study: WorklistStudy): Promise<void> {
    if (!study.viewerUrl) return;
    setViewerWarning(null);
    setValidatingViewerStudyId(study.studyId);
    try {
      const response = await api.get<{
        allowed: boolean;
        viewerUrl: string | null;
        message?: string;
      }>(`/worklist/${encodeURIComponent(study.studyId)}/viewer-access`);

      if (!response.data.allowed || !response.data.viewerUrl) {
        setViewerWarning(response.data.message || "Study exists but images not yet available");
        setTimeout(() => setViewerWarning(null), 6000);
        return;
      }

      const rawLaunchUrl = resolveLaunchableViewerUrl(response.data.viewerUrl, study.viewerUrl);
      if (!rawLaunchUrl) {
        setViewerWarning("OHIF launch URL is invalid (missing study parameters). Please refresh and try again.");
        setTimeout(() => setViewerWarning(null), 6000);
        return;
      }

      const launchUrl = rewriteViewerUrlForCurrentOrigin(rawLaunchUrl);

      setResolvedViewerUrlByStudyId((prev) => ({
        ...prev,
        [study.studyId]: launchUrl,
      }));
      setViewerStudyId(study.studyId);
    } catch (error) {
      let apiMessage: string | undefined;
      if (error && typeof error === "object" && "response" in error) {
        const maybeMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
        if (typeof maybeMessage === "string" && maybeMessage.trim()) {
          apiMessage = maybeMessage;
        }
      }
      setViewerWarning(apiMessage || "Unable to validate this study against Dicoogle — check if the study has been indexed");
      setTimeout(() => setViewerWarning(null), 6000);
    } finally {
      setValidatingViewerStudyId(null);
    }
  }

  /* Filter by tab (client-side — status mapping) */
  const filteredData = useMemo(() => {
    let next = data;

    if (activeTab !== "all") {
      next = next.filter((study) => !isRegistryOnlyStudy(study));
    }

    if (activeTab === "emergency") {
      next = next.filter(isEmergencyStudy);
    } else if (activeTab === "stat") {
      next = next.filter(isStatStudy);
    } else if (activeTab === "pending") {
      next = next.filter(isPendingStudy);
    } else if (activeTab === "completed") {
      next = next.filter(isCompletedStudy);
    }

    if (debouncedSearchText.trim()) {
      next = next.filter((study) => matchesSearchField(study, searchField, debouncedSearchText));
    }

    if (searchModality) {
      const selected = MODALITY_FILTERS.find((filter) => filter.key === searchModality);
      if (selected) {
        next = next.filter((study) => {
          const studyModalities = parseStudyModalities(study.modality);
          return selected.aliases.some((alias) => studyModalities.includes(alias));
        });
      }
    }

    return next;
  }, [data, activeTab, searchModality, debouncedSearchText, searchField]);

  /* Stats for tab badges */
  const counts = useMemo(() => ({
    all: data.length,
    emergency: data.filter(isEmergencyStudy).length,
    stat: data.filter(isStatStudy).length,
    pending: data.filter(isPendingStudy).length,
    completed: data.filter(isCompletedStudy).length,
  }), [data]);

  const columns = useMemo<ColumnDef<WorklistStudy>[]>(
    () => [
      {
        id: "expand",
        header: "",
        cell: ({ row }) => {
          const isExpanded = expandedRowId === row.original.studyId;
          const rowPatientKey = worklistPatientGroupKey(row.original);
          const patientStudies = rawData.filter(
            (study) => worklistPatientGroupKey(study) === rowPatientKey && study.studyId !== row.original.studyId,
          );
          return (
            <button
              className={`transition-colors rounded p-0.5 ${isExpanded ? "text-tdai-teal-600 bg-tdai-teal-50" : "text-tdai-muted hover:text-tdai-text"}`}
              onClick={() => setExpandedRowId(isExpanded ? null : row.original.studyId)}
              title={patientStudies.length > 0 ? `${patientStudies.length} prior study(s)` : "No prior studies"}
            >
              <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="h-4 w-4" />
              </motion.div>
            </button>
          );
        },
        size: 32,
      },
      {
        id: "select",
        header: () => {
          const allChecked = filteredData.length > 0 && filteredData.every((s) => selectedRows[s.studyId]);
          return (
            <input
              type="checkbox"
              className="accent-tdai-teal-500 h-3.5 w-3.5 rounded border-tdai-gray-300"
              checked={allChecked}
              onChange={(e) => {
                const next: Record<string, boolean> = {};
                if (e.target.checked) {
                  filteredData.forEach((s) => { next[s.studyId] = true; });
                }
                setSelectedRows(next);
              }}
            />
          );
        },
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="accent-tdai-teal-500 h-3.5 w-3.5 rounded border-tdai-gray-300"
            checked={!!selectedRows[row.original.studyId]}
            onChange={(e) =>
              setSelectedRows((prev) => ({ ...prev, [row.original.studyId]: e.target.checked }))
            }
          />
        ),
        size: 32,
      },
      {
        accessorKey: "patientName",
        header: "Patient",
        cell: ({ row }) => {
          const mrn = displayPatientId(row.original);
          const registryIdFromMetadata = getStudyRegistryPatientId(row.original);
          const registryIdFromMrn =
            mrn !== "—" ? (knownPatientsByMrn.get(mrn.toLowerCase())?.id ?? "") : "";
          const uniquePatientId = registryIdFromMetadata || registryIdFromMrn;
          const copyText = uniquePatientId || (mrn !== "—" ? mrn : "");
          const uniquePatientLabel = uniquePatientId
            ? `UID: ${uniquePatientId.slice(0, 12)}${uniquePatientId.length > 12 ? "…" : ""}`
            : "UID: —";
          const isCopied = copiedId === row.original.studyId;
          return (
            <div>
              <div className="flex items-center gap-1.5">
                <Link to={row.original.reportUrl} className="font-medium text-tdai-text text-sm leading-none hover:text-tdai-teal-700 hover:underline transition-colors">{row.original.patientName ?? "Unknown"}</Link>
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-tdai-teal-500 text-white">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                </span>
                <button
                  className="rounded p-0.5 text-tdai-muted hover:bg-tdai-surface-alt hover:text-tdai-text transition-colors"
                  title="Edit patient details"
                  onClick={() => setExpandedRowId(expandedRowId === row.original.studyId ? null : row.original.studyId)}
                >
                  <Edit2 className="h-3 w-3" />
                </button>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-tdai-secondary leading-none" title={uniquePatientId || "Registry unique ID not available"}>{uniquePatientLabel}</span>
                <span className="font-mono text-[11px] text-tdai-muted leading-none" title="MRN / Patient ID">{mrn !== "—" ? `MRN: ${mrn}` : "MRN: —"}</span>
                <button
                  className={`rounded p-0.5 transition-colors ${isCopied ? "text-tdai-teal-600" : "text-tdai-muted hover:bg-tdai-surface-alt hover:text-tdai-text"}`}
                  title={isCopied ? "Copied!" : copyText ? "Copy patient unique ID" : "No patient ID on file"}
                  disabled={!copyText}
                  onClick={() => {
                    if (!copyText) return;
                    void navigator.clipboard.writeText(copyText);
                    setCopiedId(row.original.studyId);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                >
                  {isCopied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>
          );
        },
      },
      {
        id: "accDiag",
        header: "Acc/Diag",
        cell: ({ row }) => {
          const acc = getStudyMetadataString(row.original, ACCESSION_METADATA_KEYS);
          return (
            <div className="text-xs text-tdai-secondary">
              <div className="font-medium truncate" title={acc || undefined}>{acc || "—"}</div>
              <div className="text-tdai-muted mt-0.5">Accession</div>
            </div>
          );
        },
      },
      {
        id: "modality",
        header: "Modality",
        cell: ({ row }) => (
          <div className="flex items-center justify-center text-center">
            <span className="inline-block rounded-md bg-tdai-navy-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white shadow-sm">{row.original.modality ?? "OT"}</span>
          </div>
        ),
      },
      {
        id: "description",
        header: "Desc / AI",
        cell: ({ row }) => (
          <div>
            <div className="text-sm text-tdai-text font-medium">{row.original.description ?? row.original.location ?? "—"}</div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Report Status",
        cell: ({ row }) => {
          const status = row.original.status;
          const styles: Record<string, string> = {
            unassigned: "bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200",
            pending:    "bg-[#FEF3C7] text-[#B45309] ring-1 ring-[#FDE68A]",
            assigned:   "bg-[#DBEAFE] text-[#1D4ED8] ring-1 ring-[#BFDBFE]",
            reported:   "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
          };
          const labels: Record<string, string> = {
            unassigned: "Unassigned",
            pending:    "Pending",
            assigned:   "Assigned",
            reported:   "Final",
          };
          return (
            <div className="flex items-center gap-2">
              <span className={`badge ${styles[status] ?? "bg-tdai-gray-100 text-tdai-gray-600 ring-1 ring-tdai-gray-200"}`}>
                {labels[status] ?? status}
              </span>
              <button className="rounded p-1 text-tdai-muted hover:bg-tdai-surface-alt hover:text-tdai-text transition-colors" title="Assign">
                <UserCircle className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
      {
        id: "priority",
        header: "Priority",
        cell: ({ row }) => {
          const priority = getEffectivePriority(row.original) ?? "normal";
          const cfg: Record<string, { label: string; cls: string; icon: typeof AlertTriangle }> = {
            emergency: { label: "Emergency", cls: "bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200", icon: ShieldAlert },
            urgent:    { label: "Urgent",    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",          icon: AlertTriangle },
            stat:      { label: "Stat",      cls: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",       icon: Zap },
            normal:    { label: "Normal",    cls: "bg-tdai-gray-50 text-tdai-gray-600 ring-1 ring-tdai-gray-200", icon: CircleDot },
          };
          const c = cfg[priority] ?? cfg.normal;
          const PIcon = c.icon;
          return (
            <span className={`badge gap-1 ${c.cls}`}>
              <PIcon className="h-3 w-3" />
              {c.label}
            </span>
          );
        },
      },
      {
        id: "scanDate",
        header: "Scan Date",
        cell: ({ row }) => (
          <span className="text-xs text-tdai-secondary">{row.original.studyDate ?? "—"}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const isRegistryOnly = isRegistryOnlyStudy(row.original);
          return (
            <div className="flex h-full w-full items-center justify-start gap-1">
            {canDicomUpload && (
              <button
                className="rounded-md p-0.5 text-amber-600 hover:bg-amber-50 transition-colors"
                onClick={() => setUploadStudy(row.original)}
                title="Upload DICOM for this patient"
              >
                <UploadCloud className="h-4 w-4" />
              </button>
            )}
            <button
              className={`rounded-md p-0.5 transition-colors ${
                !row.original.viewerUrl || isRegistryOnly
                  ? "text-tdai-gray-300 cursor-not-allowed"
                  : validatingViewerStudyId === row.original.studyId
                    ? "text-tdai-teal-500"
                  : viewerStudyId === row.original.studyId
                    ? "bg-tdai-teal-500 text-white shadow-sm"
                    : "text-tdai-teal-600 hover:bg-tdai-teal-50"
              }`}
              disabled={!row.original.viewerUrl || validatingViewerStudyId === row.original.studyId || isRegistryOnly}
              onClick={() => {
                if (!row.original.viewerUrl) return;
                if (isRegistryOnly) return;
                if (viewerStudyId === row.original.studyId) {
                  setViewerStudyId(null);
                  return;
                }
                void validateAndOpenViewer(row.original);
              }}
              title={isRegistryOnly ? "Upload DICOM to enable viewer" : row.original.viewerUrl ? "Open in OHIF Viewer" : "OHIF Viewer not available"}
            >
              {validatingViewerStudyId === row.original.studyId ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
            {row.original.weasisUrl && !isRegistryOnly && (
              <a
                className="rounded-md p-0.5 text-indigo-600 hover:bg-indigo-50 transition-colors"
                href={row.original.weasisUrl}
                title="Open in Weasis (desktop)"
              >
                <MonitorSmartphone className="h-4 w-4" />
              </a>
            )}
            {!isRegistryOnly ? (
              <Link
                className="rounded-md p-0.5 text-tdai-navy-500 hover:bg-tdai-navy-50 transition-colors"
                to={row.original.reportUrl}
                title="Open report"
              >
                <FileText className="h-4 w-4" />
              </Link>
            ) : (
              <button
                className="rounded-md p-0.5 text-tdai-gray-300 cursor-not-allowed"
                disabled
                title="Report is available after DICOM upload"
              >
                <FileText className="h-4 w-4" />
              </button>
            )}
            {canDeletePatient && (() => {
              const mrn = getHumanPatientMrn(row.original);
              const nameKey = (row.original.patientName ?? "").replace(/[\^,]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
              const registryId =
                getStudyRegistryPatientId(row.original) ||
                (mrn ? (knownPatientsByMrn.get(mrn.toLowerCase())?.id ?? "") : "") ||
                (nameKey ? (knownPatientsByName.get(nameKey)?.id ?? "") : "");
              const displayMrn = mrn || (registryId && nameKey ? (knownPatientsByName.get(nameKey)?.patientId ?? "—") : "—");
              return (
                <button
                  className={`rounded-md p-0.5 transition-colors ${registryId ? "text-red-500 hover:bg-red-50" : "text-tdai-gray-300 cursor-not-allowed"}`}
                  disabled={!registryId}
                  onClick={() => {
                    if (!registryId) return;
                    setDeleteError(null);
                    setDeleteTarget({
                      studyId: row.original.studyId,
                      patientName: row.original.patientName ?? "Unknown",
                      patientMrn: displayMrn,
                      registryId,
                    });
                  }}
                  title={registryId ? "Delete patient" : "No registry record to delete"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              );
            })()}
          </div>
        );
        },
      },
    ],
    [viewerStudyId, expandedRowId, data, rawData, copiedId, canDicomUpload, canDeletePatient, filteredData, selectedRows, navigate, validatingViewerStudyId, knownPatientsByMrn, knownPatientsByName],
  );

  const table = useReactTable({ data: filteredData, columns, getCoreRowModel: getCoreRowModel() });
  const toggleButtonClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
      active
        ? darkMode
          ? "border-tdai-teal-400/40 bg-tdai-teal-500/20 text-tdai-teal-100 shadow-sm"
          : "border-tdai-teal-200 bg-tdai-teal-50 text-tdai-teal-700 shadow-sm"
        : darkMode
          ? "border-transparent text-tdai-gray-400 hover:border-white/15 hover:bg-white/10 hover:text-white"
          : "border-transparent text-tdai-secondary hover:border-tdai-border hover:bg-white hover:text-tdai-navy-700"
    }`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-tdai-background pb-16 flex flex-col"
    >
      {/* ── Title bar ───────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-r from-tdai-navy-800 to-tdai-navy-700 px-6 py-3 shadow-sm z-10"
      >
        <div className="flex w-full max-w-[1400px] mx-auto items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 shadow-inner">
              <Activity className="h-4 w-4 text-tdai-teal-400" />
            </div>
            <span className="text-sm font-bold tracking-widest text-white">PATIENT LIST</span>
          </div>
          <button
            type="button"
            onClick={() => { resetRegForm(); setShowRegisterPatient(true); }}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-white/15"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Register Patient
          </button>
        </div>
      </motion.div>

      {/* ── Top toolbar ─────────────── */}
      <div className={`border-b border-tdai-border px-6 shadow-sm z-10 relative ${compactMode ? "py-2.5" : "py-3.5"} ${darkMode ? "bg-tdai-navy-800 border-white/10" : "bg-white"}`}>
        <div className="flex flex-wrap items-center gap-5">
          {/* Search */}
          <div className={`flex items-center gap-2 rounded-xl p-1 border ${darkMode ? "bg-tdai-navy-900 border-white/10" : "bg-tdai-surface-alt border-tdai-border-light"}`}>
            <select
              className={`bg-transparent border-none text-xs font-medium focus:ring-0 cursor-pointer pl-3 pr-8 py-1.5 ${darkMode ? "text-white" : "text-tdai-navy-700"}`}
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as SearchField)}
            >
              {SEARCH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className={`h-4 w-px ${darkMode ? "bg-white/10" : "bg-tdai-border"}`} />
            <div className="relative flex-1">
              <input
                className={`w-full bg-transparent border-none text-xs placeholder:text-tdai-gray-400 focus:ring-0 pl-2 pr-8 py-1.5 ${darkMode ? "text-white" : "text-tdai-navy-800"}`}
                placeholder={selectedSearchOption.placeholder}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <Search className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tdai-muted" />
            </div>
          </div>

          <div className={`h-8 w-px ${darkMode ? "bg-white/10" : "bg-tdai-border"}`} />

          {/* View toggles + Date range filter */}
          <div className={`flex items-center gap-1 rounded-xl p-1 border ${darkMode ? "bg-tdai-navy-900 border-white/10" : "bg-tdai-surface-alt border-tdai-border-light"}`}>
            <button className={`px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm ${darkMode ? "bg-white/10 text-white" : "bg-white text-tdai-navy-700"}`}>Single-Pane</button>
            <button
              type="button"
              aria-pressed={compactMode}
              className={toggleButtonClass(compactMode)}
              onClick={() => setCompactMode((prev) => !prev)}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${compactMode ? "bg-tdai-teal-300" : darkMode ? "bg-tdai-gray-500" : "bg-tdai-gray-400"}`} />
              <span>Compact</span>
            </button>
          </div>

          {/* Date range filter */}
          <div className={`flex items-center gap-2 rounded-xl p-1 border ${darkMode ? "bg-tdai-navy-900 border-white/10" : "bg-tdai-surface-alt border-tdai-border-light"}`}>
            <CalendarRange className={`h-3.5 w-3.5 ml-2 ${darkMode ? "text-tdai-gray-400" : "text-tdai-muted"}`} />
            <input
              type="date"
              className={`bg-transparent border-none text-xs focus:ring-0 py-1.5 px-1 ${darkMode ? "text-white [color-scheme:dark]" : "text-tdai-navy-800"}`}
              value={searchDateFrom}
              onChange={(e) => setSearchDateFrom(e.target.value)}
              title="From date"
            />
            <span className={`text-[10px] ${darkMode ? "text-tdai-gray-500" : "text-tdai-muted"}`}>to</span>
            <input
              type="date"
              className={`bg-transparent border-none text-xs focus:ring-0 py-1.5 px-1 ${darkMode ? "text-white [color-scheme:dark]" : "text-tdai-navy-800"}`}
              value={searchDateTo}
              onChange={(e) => setSearchDateTo(e.target.value)}
              title="To date"
            />
          </div>

          <div className="flex-1" />
        </div>
      </div>

      {/* ── Status tabs + Modality filters ─── */}
      <div className={`border-b px-6 z-10 relative ${compactMode ? "py-1.5" : "py-2.5"} ${darkMode ? "bg-tdai-navy-900 border-white/10" : "bg-white border-tdai-border"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <LayoutGroup id="radiologist-dashboard-status-tabs">
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = counts[tab.key as keyof typeof counts] ?? 0;
            const Icon = tab.icon;
            return (
              <motion.button
                key={tab.key}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab(tab.key)}
                className={`group relative flex flex-col items-center gap-1 rounded-xl font-semibold transition-all duration-200 ${compactMode ? "px-3 py-1.5 text-[10px]" : "px-4 py-2 text-[11px]"} ${
                  isActive
                    ? "bg-tdai-teal-50 text-tdai-teal-700 shadow-sm ring-1 ring-tdai-teal-500/10"
                    : "text-tdai-secondary hover:bg-tdai-surface-alt hover:text-tdai-navy-700"
                }`}
              >
                {count > 0 && (
                  <span className={`absolute -right-1.5 -top-1.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full px-1.5 text-[9px] font-bold text-white shadow-sm ${
                    tab.key === "emergency" ? "bg-tdai-red-500" : tab.key === "pending" ? "bg-tdai-red-500" : "bg-tdai-teal-500"
                  }`}>
                    {count}
                  </span>
                )}
                <Icon className={`${compactMode ? "h-4 w-4" : "h-4.5 w-4.5"} ${isActive ? "text-tdai-teal-600" : "text-tdai-muted group-hover:text-tdai-secondary"}`} strokeWidth={isActive ? 2.5 : 2} />
                <span>{tab.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="radiologist-tab-underline"
                    layout="position"
                    className="pointer-events-none absolute bottom-0 left-1/2 z-[1] h-0.5 w-8 -translate-x-1/2 rounded-t-full bg-tdai-teal-500"
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  />
                )}
              </motion.button>
            );
          })}
          </LayoutGroup>

          <div className="mx-3 h-10 w-px bg-tdai-border" />

          {/* Modality quick-filters */}
          <div className="flex gap-1.5">
            {MODALITY_FILTERS.map((modalityFilter) => (
              <motion.button
                key={modalityFilter.key}
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() =>
                  setSearchModality(searchModality === modalityFilter.key ? "" : modalityFilter.key)
                }
                className={`flex flex-col items-center justify-center gap-1 rounded-xl font-bold transition-all duration-200 ${compactMode ? "min-w-[44px] px-2 py-1.5 text-[9px]" : "min-w-[48px] px-2 py-2 text-[10px]"} ${
                  searchModality === modalityFilter.key
                    ? "bg-tdai-navy-700 text-white shadow-md scale-105"
                    : "bg-tdai-surface-alt text-tdai-secondary hover:bg-tdai-gray-200 hover:text-tdai-navy-700"
                }`}
              >
                <span>{modalityFilter.label}</span>
              </motion.button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2 self-center">
            {canDicomUpload ? (
              <motion.div
                className="inline-flex"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 450, damping: 28 }}
              >
                <Link
                  to="/my-uploads"
                  className="btn-primary group relative overflow-hidden !h-9 !min-h-0 !px-3.5 !py-0 text-xs font-semibold leading-none shadow-md shadow-tdai-teal-700/20 ring-1 ring-white/20 transition-[box-shadow,filter] duration-200 hover:shadow-lg hover:shadow-tdai-teal-800/25 hover:brightness-[1.03] active:brightness-[0.98]"
                  aria-label="Upload DICOM studies — open My Uploads"
                >
                  <UploadCloud
                    className="relative z-[1] h-4 w-4 shrink-0 transition-transform duration-200 ease-out group-hover:-translate-y-px"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  <span className="relative z-[1] font-semibold tracking-wide">Upload</span>
                  <span
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
              </motion.div>
            ) : null}
            <button className="btn-secondary !h-9 !px-3 !py-0 text-xs leading-none" onClick={() => worklistQuery.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Content Area ───────────────── */}
      <div className={`flex-1 overflow-auto ${darkMode ? "bg-tdai-navy-950" : "bg-white"}`}>
        {/* ── Column header filter row ──────── */}
        <div className={`border-b sticky top-0 z-10 ${darkMode ? "bg-tdai-navy-900 border-white/10" : "bg-tdai-surface-alt border-tdai-border"}`}>
          <div className={`grid grid-cols-[32px_32px_minmax(0,1.2fr)_minmax(0,0.72fr)_minmax(0,0.72fr)_minmax(0,1.28fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-0 text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-tdai-gray-400" : "text-tdai-secondary"}`}>
            <div className="px-3 py-3" />
            <div className="px-3 py-3" />
            <div className={`px-2 py-3 flex items-center justify-start gap-1 cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Patient <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-start gap-1 cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Acc/Diag <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-center gap-1 text-center cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Modality <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-start gap-1 cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Description <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-start gap-1 whitespace-nowrap cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Report Status <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-start gap-1 whitespace-nowrap cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Priority <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex items-center justify-start gap-1 whitespace-nowrap cursor-pointer ${darkMode ? "hover:text-white" : "hover:text-tdai-navy-700"}`}>Scan Date <ChevronDown className="h-3 w-3" /></div>
            <div className={`px-2 py-3 flex h-full items-center justify-start text-left whitespace-nowrap ${darkMode ? "text-tdai-gray-400" : "text-tdai-secondary"}`}>Actions</div>
          </div>
        </div>
        {/* ── Loading / Error ───────────────── */}
        {worklistQuery.isLoading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <motion.div
              className="relative"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="h-12 w-12 rounded-full border-4 border-tdai-gray-100" />
              <div className="absolute inset-0 h-12 w-12 animate-spin rounded-full border-4 border-transparent border-t-tdai-teal-500" />
            </motion.div>
            <p className="text-sm font-medium text-tdai-secondary animate-pulse">Loading patient list...</p>
          </div>
        )}
        
        {worklistQuery.error && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tdai-red-50">
              <AlertTriangle className="h-8 w-8 text-tdai-red-500" />
            </div>
            <p className="text-sm font-medium text-tdai-navy-800">Failed to load worklist</p>
            <p className="text-xs text-tdai-secondary">Please check your connection and try again.</p>
            <button className="btn-secondary mt-2" onClick={() => worklistQuery.refetch()}>Try Again</button>
          </div>
        )}

        {viewerWarning && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{viewerWarning}</span>
          </div>
        )}

        {/* ── Study rows ────────────────────── */}
        {!worklistQuery.isLoading && !worklistQuery.error && filteredData.length > 0 && (
          <div className={`divide-y ${darkMode ? "divide-white/5" : "divide-tdai-border-light"}`}>
            {table.getRowModel().rows.map((row) => {
              const isExpanded = expandedRowId === row.original.studyId;
              const rowPatientKey = worklistPatientGroupKey(row.original);
              const patientHistory = rawData
                .filter((study) => worklistPatientGroupKey(study) === rowPatientKey && study.studyId !== row.original.studyId)
                .sort(compareStudiesByRecencyDesc);
              return (
                <div key={row.id}>
                  <motion.div
                    whileHover={{ scale: 1.004 }}
                    transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("button") || target.closest("a") || target.closest("input")) return;
                      if (isRegistryOnlyStudy(row.original)) return;
                      navigate(row.original.reportUrl);
                    }}
                    className={`grid grid-cols-[32px_32px_minmax(0,1.2fr)_minmax(0,0.72fr)_minmax(0,0.72fr)_minmax(0,1.28fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)] items-center gap-0 px-0 cursor-pointer ${compactMode ? "py-2.5" : "py-3.5"} transition-all duration-200 origin-left will-change-transform transform-gpu hover:z-[1] hover:brightness-[1.02] ${
                      viewerStudyId === row.original.studyId
                        ? darkMode ? "bg-tdai-teal-900/30 shadow-[inset_4px_0_0_0_#00B4A6]" : "bg-tdai-teal-50/50 shadow-[inset_4px_0_0_0_#00B4A6]"
                        : isExpanded
                          ? darkMode ? "bg-indigo-900/20 shadow-[inset_4px_0_0_0_#4F46E5]" : "bg-tdai-navy-50/40 shadow-[inset_4px_0_0_0_#4F46E5]"
                          : darkMode ? "hover:bg-white/5 hover:shadow-[inset_4px_0_0_0_#334155]" : "hover:bg-tdai-surface-alt/80 hover:shadow-[inset_4px_0_0_0_#E2E8F0]"
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className={`${
                          cell.column.id === "patientName"
                            ? "px-2"
                            : cell.column.id === "accDiag"
                              ? "px-2"
                              : cell.column.id === "modality"
                                ? "px-2 flex items-center justify-center text-center"
                              : cell.column.id === "reportStatus"
                                ? "px-2 flex items-center justify-start text-left"
                                : cell.column.id === "priority"
                                  ? "px-2 flex items-center justify-start text-left"
                                : cell.column.id === "scanDate"
                                  ? "px-2 flex items-center justify-start text-left"
                                : cell.column.id === "actions"
                                  ? "px-2 flex items-center justify-start"
                                  : "px-2"
                        } text-sm min-w-0 ${cell.column.id === "actions" ? "" : "overflow-hidden"} ${darkMode ? "text-tdai-gray-200" : ""}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </motion.div>

                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden border-l-4 border-tdai-teal-400 bg-gradient-to-r from-tdai-teal-50/60 to-white"
                    >
                      <div className="px-8 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="h-4 w-4 text-tdai-teal-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-tdai-navy-700">
                            Patient History — {row.original.patientName}
                          </span>
                          <span className="rounded-full bg-tdai-teal-100 px-2 py-0.5 text-[10px] font-bold text-tdai-teal-700">
                            {patientHistory.length + 1} study(s) total
                          </span>
                        </div>
                        {patientHistory.length === 0 ? (
                          <p className="text-xs text-tdai-secondary italic py-2">No other studies found for this patient.</p>
                        ) : (
                          <div className="rounded-lg border border-tdai-border bg-white shadow-sm overflow-hidden">
                            <div className="grid grid-cols-[1fr_0.6fr_1.2fr_0.8fr_auto] gap-0 bg-tdai-surface-alt px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-tdai-secondary border-b border-tdai-border">
                              <div>Study Date</div>
                              <div>Modality</div>
                              <div>Description</div>
                              <div>Status</div>
                              <div className="pr-1 text-right">Actions</div>
                            </div>
                            {patientHistory.map((hist) => {
                              const hStyles: Record<string, string> = {
                                unassigned: "bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200",
                                pending:    "bg-[#FEF3C7] text-[#B45309] ring-1 ring-[#FDE68A]",
                                assigned:   "bg-[#DBEAFE] text-[#1D4ED8] ring-1 ring-[#BFDBFE]",
                                reported:   "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
                              };
                              const hLabels: Record<string, string> = {
                                unassigned: "Unassigned",
                                pending:    "Pending",
                                assigned:   "Assigned",
                                reported:   "Final",
                              };
                              return (
                                <div
                                  key={hist.studyId}
                                  className={`grid grid-cols-[1fr_0.6fr_1.2fr_0.8fr_auto] gap-0 items-center px-4 ${compactMode ? "py-2" : "py-2.5"} text-xs border-b border-tdai-border-light last:border-b-0 hover:bg-tdai-surface-alt/50 transition-colors`}
                                >
                                  <div className="font-medium text-tdai-text">{hist.studyDate ?? "—"}</div>
                                  <div>
                                    <span className="inline-block rounded-md bg-tdai-navy-700 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white">
                                      {hist.modality ?? "OT"}
                                    </span>
                                  </div>
                                  <div className="text-tdai-secondary">{hist.description ?? hist.location ?? "—"}</div>
                                  <div>
                                    <span className={`badge text-[10px] ${hStyles[hist.status] ?? "bg-tdai-gray-100 text-tdai-gray-600 ring-1 ring-tdai-gray-200"}`}>
                                      {hLabels[hist.status] ?? hist.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-end gap-0 pr-1">
                                    <Link
                                      className="rounded-md p-0.5 text-tdai-navy-500 hover:bg-tdai-navy-50 transition-colors"
                                      to={hist.reportUrl}
                                      title="View report"
                                    >
                                      <FileText className="h-3.5 w-3.5" />
                                    </Link>
                                    <button
                                      className={`rounded-md p-0.5 transition-colors ${
                                        !hist.viewerUrl
                                          ? "text-tdai-gray-300 cursor-not-allowed"
                                          : validatingViewerStudyId === hist.studyId
                                            ? "text-tdai-teal-500"
                                            : "text-tdai-teal-600 hover:bg-tdai-teal-50"
                                      }`}
                                      disabled={!hist.viewerUrl || validatingViewerStudyId === hist.studyId}
                                      onClick={() => {
                                        if (!hist.viewerUrl) return;
                                        void validateAndOpenViewer(hist);
                                      }}
                                      title={hist.viewerUrl ? "View images" : "OHIF Viewer not available"}
                                    >
                                      {validatingViewerStudyId === hist.studyId ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Eye className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* No data */}
        {!worklistQuery.isLoading && !worklistQuery.error && filteredData.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tdai-surface-alt">
              <Search className="h-8 w-8 text-tdai-muted" />
            </div>
            <p className="text-base font-medium text-tdai-navy-800">No studies found</p>
            {data.length === 0 ? (
              <p className="text-sm text-tdai-secondary max-w-md text-center">
                Your worklist is empty. Patients and studies show up here after DICOM is uploaded (or synced from PACS) for your
                organization. If you use multi-tenant login, confirm you are on the correct site; data is isolated per tenant.
              </p>
            ) : (
              <p className="text-sm text-tdai-secondary max-w-sm text-center">
                No rows match your current filters — for example, the Emergency or Stat tabs only list studies whose priority is set
                in metadata. Try &quot;All Cases&quot;, clear the search box, modality chips, and date range, or use Clear Filters
                below.
              </p>
            )}
            <button className="btn-secondary mt-2" onClick={() => {
              setActiveTab("all");
              setSearchField("name");
              setSearchText("");
              setSearchModality("");
              setSearchDateFrom("");
              setSearchDateTo("");
            }}>Clear Filters</button>
          </div>
        )}
      </div>

      {/* ── Inline OHIF Viewer Panel ──────── */}
      {viewerStudyId && (() => {
        const study = filteredData.find((s) => s.studyId === viewerStudyId);
        if (!study) return null;
        const viewerUrl = resolvedViewerUrlByStudyId[study.studyId] ?? study.viewerUrl;
        if (!viewerUrl) return (
          <div className="border-t-4 border-tdai-red-500 bg-tdai-navy-900 px-6 py-12 text-center shadow-2xl relative z-20">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-tdai-red-500/10 mb-4">
              <Eye className="h-8 w-8 text-tdai-red-400" />
            </div>
            <p className="text-lg font-semibold text-white">No DICOM images available</p>
            <p className="mt-2 text-sm text-tdai-gray-400 max-w-md mx-auto">This study does not have DICOM data uploaded. Upload DICOM files to view images in the viewer.</p>
            <button onClick={() => setViewerStudyId(null)} className="mt-6 btn-secondary bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/30">Close Viewer</button>
          </div>
        );
        return (
          <div className="border-t-4 border-tdai-teal-500 bg-tdai-navy-900 shadow-2xl relative z-20 flex flex-col" style={{ height: "60vh", minHeight: "500px" }}>
            <div className="flex items-center justify-between px-5 py-3 bg-tdai-navy-950 border-b border-white/10">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-tdai-teal-500/20">
                  <Eye className="h-4.5 w-4.5 text-tdai-teal-400" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white tracking-wide">
                      {study.patientName}
                    </span>
                    <span className="rounded bg-tdai-teal-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-tdai-teal-300 border border-tdai-teal-500/30">
                      OHIF VIEWER
                    </span>
                  </div>
                  <div className="text-xs text-tdai-gray-400 mt-0.5">
                    {getHumanPatientMrn(study)
                      ? `MRN: ${getHumanPatientMrn(study)}`
                      : `Study: ${study.studyId?.slice(0, 16) ?? "—"}…`}
                    {" "}• {study.modality} • {study.studyDate}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={viewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-tdai-gray-300 hover:bg-white/10 hover:text-white transition-all duration-200 border border-transparent hover:border-white/10"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open Full Screen</span>
                </a>
                <div className="h-5 w-px bg-white/10" />
                <button
                  onClick={() => setViewerStudyId(null)}
                  className="flex items-center justify-center h-8 w-8 rounded-lg text-tdai-gray-400 hover:bg-tdai-red-500/20 hover:text-tdai-red-400 transition-all duration-200"
                  title="Close viewer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 flex">
              <div className="flex-1 relative">
                <OhifViewerEmbed
                  key={`${study.studyId}-${viewerReloadByPatientMrn[worklistRowPatientMrn(study)] ?? 0}-${viewerUrl}`}
                  src={viewerUrl}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Upload Modal for selected patient ── */}
      {uploadStudy && (() => {
        const patientName = uploadStudy.patientName ?? "Unknown";
        const patientMrn = getHumanPatientMrn(uploadStudy);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
            onClick={() => setUploadStudy(null)}
          >
            <div
              className="w-full max-w-lg mx-4 max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-tdai-border px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-tdai-text">
                    Upload DICOM for Patient
                  </h2>
                  <p className="text-xs text-tdai-muted mt-0.5">
                    {patientName}{patientMrn ? ` — MRN: ${patientMrn}` : ""}
                  </p>
                </div>
                <button
                  className="rounded-lg p-1.5 text-tdai-muted hover:bg-tdai-surface-alt hover:text-tdai-text transition-colors"
                  onClick={() => setUploadStudy(null)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="overflow-y-auto p-6">
                <DicomUpload
                  patientId={patientMrn || undefined}
                  patientName={patientMrn ? patientName : undefined}
                  onUploaded={handleDicomUploadedForPatient}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Register Patient Modal ───────── */}
      {showRegisterPatient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
          onClick={() => { setShowRegisterPatient(false); resetRegForm(); }}
        >
          <div
            className="w-full max-w-xl mx-4 max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-tdai-border px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-tdai-text">Register New Patient</h2>
                <p className="text-xs text-tdai-muted mt-0.5">Fields marked with * are required</p>
              </div>
              <button
                className="rounded-lg p-1.5 text-tdai-muted hover:bg-tdai-surface-alt hover:text-tdai-text transition-colors"
                onClick={() => { setShowRegisterPatient(false); resetRegForm(); }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form className="overflow-y-auto p-6" onSubmit={handleRegisterPatient}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">MRN / Patient ID *</label>
                  <input className="input-field" placeholder="e.g. MRN-001" value={regForm.patientId} onChange={(e) => setRegForm({ ...regForm, patientId: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Gender</label>
                  <select className="select-field w-full" value={regForm.gender} onChange={(e) => setRegForm({ ...regForm, gender: e.target.value as Gender })}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">First Name *</label>
                  <input className="input-field" placeholder="First name" value={regForm.firstName} onChange={(e) => setRegForm({ ...regForm, firstName: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Last Name *</label>
                  <input className="input-field" placeholder="Last name" value={regForm.lastName} onChange={(e) => setRegForm({ ...regForm, lastName: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Date of Birth *</label>
                  <input className="input-field input-date" type="date" max={new Date().toISOString().slice(0, 10)} value={regForm.dateOfBirth} onChange={(e) => setRegForm({ ...regForm, dateOfBirth: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Phone</label>
                  <input className="input-field" type="tel" placeholder="+91 9876543210" value={regForm.phone} onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Email</label>
                  <input className="input-field" type="email" placeholder="Email address" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Address</label>
                  <input className="input-field" placeholder="Address" value={regForm.address} onChange={(e) => setRegForm({ ...regForm, address: e.target.value })} />
                </div>
              </div>
              {regError && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{regError}</p>}
              {regSuccess && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{regSuccess}</p>}
              <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
                <button className="btn-primary !rounded-lg !px-5 !py-2.5" type="submit" disabled={regSubmitting}>
                  {regSubmitting ? "Registering…" : "Register Patient"}
                </button>
                <button className="btn-secondary !rounded-lg !px-5 !py-2.5" type="button" onClick={() => { setShowRegisterPatient(false); resetRegForm(); }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ────── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <Trash2 className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-tdai-text">Delete Patient</h3>
                  <p className="mt-1 text-sm text-tdai-secondary">
                    Are you sure you want to delete{" "}
                    <span className="font-medium text-tdai-text">{deleteTarget.patientName}</span>
                    {deleteTarget.patientMrn !== "—" ? ` (MRN: ${deleteTarget.patientMrn})` : ""}?
                    The record will be marked as deleted and hidden from all views.
                  </p>
                </div>
              </div>
              {deleteError && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-tdai-border px-6 py-4">
              <button
                className="btn-secondary !rounded-lg !px-4 !py-2"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                onClick={handleDeletePatient}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete Patient"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer bar ────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-tdai-navy-600 bg-tdai-navy-900 px-6 py-2.5 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between text-xs text-tdai-gray-300">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 bg-tdai-navy-950 rounded-lg px-3 py-1.5 border border-white/5">
              <Clock className="h-3.5 w-3.5 text-tdai-teal-400" />
              <span className="font-mono text-[11px] font-medium tracking-wider">
                {new Date().toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-tdai-teal-500/10 rounded-lg px-3 py-1.5 border border-tdai-teal-500/20">
              <Activity className="h-3.5 w-3.5 text-tdai-teal-400" />
              <span className="font-medium text-tdai-teal-100">
                Total: {filteredData.length} Exams
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-tdai-navy-950 rounded-lg p-1 border border-white/5">
              <button className="rounded-md p-1 hover:bg-white/10 text-tdai-gray-400 hover:text-white transition-colors disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 font-medium text-white">1 of 1</span>
              <button className="rounded-md p-1 hover:bg-white/10 text-tdai-gray-400 hover:text-white transition-colors disabled:opacity-50">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <select className="bg-tdai-navy-950 border border-white/5 rounded-lg px-3 py-1.5 text-tdai-gray-300 focus:ring-1 focus:ring-tdai-teal-500 outline-none cursor-pointer">
              <option>30 Exam / page</option>
              <option>50 Exam / page</option>
              <option>100 Exam / page</option>
            </select>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
