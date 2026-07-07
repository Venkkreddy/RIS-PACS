import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  ImagePlus,
  Monitor,
  Printer,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
  X,
  Search,
  CalendarRange,
  type LucideIcon,
} from "lucide-react";
import type { OrderPriority, OrderStatus, RadiologyOrder } from "@medical-report-system/shared";
import { api } from "../api/client";
import type { QcStatus, WorklistStudy } from "../types/worklist";
import { DicomUpload } from "./DicomUpload";
import { OhifViewerEmbed } from "./OhifViewerEmbed";
import { useAuthRole } from "../hooks/useAuthRole";
import { useSearchParams } from "react-router-dom";

type WorkflowStatus =
  | "scheduled"
  | "in-progress"
  | "images-uploaded"
  | "qc-pending"
  | "qc-passed"
  | "retake-required"
  | "ready-for-reporting";

type QcChecklist = {
  patientMatch: boolean;
  correctPositioning: boolean;
  anatomyCovered: boolean;
  markerPresent: boolean;
  noMotionBlur: boolean;
  noArtifacts: boolean;
};

type WorkstationSettings = {
  printer: {
    printerName?: string;
    aeTitle?: string;
    ipAddress?: string;
    port?: number;
    filmSize?: string;
    magnification?: string;
  };
  pacs: {
    aeTitle?: string;
    ipAddress?: string;
    port?: number;
  };
  scpReceiver: {
    aeTitle?: string;
    port?: number;
    compression?: string;
  };
};

type ExamRow = {
  id: string;
  patientName: string;
  mrn: string;
  study: string;
  modality: string;
  bodyPart: string;
  priority: OrderPriority | "normal" | "emergency";
  room: string;
  status: WorkflowStatus;
  scheduledTime: string;
  order?: RadiologyOrder;
  studyRecord?: WorklistStudy;
};

const EMPTY_QC: QcChecklist = {
  patientMatch: false,
  correctPositioning: false,
  anatomyCovered: false,
  markerPresent: false,
  noMotionBlur: false,
  noArtifacts: false,
};

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  scheduled: "Scheduled",
  "in-progress": "In Progress",
  "images-uploaded": "Images Uploaded",
  "qc-pending": "QC Pending",
  "qc-passed": "QC Passed",
  "retake-required": "Retake Required",
  "ready-for-reporting": "Ready For Reporting",
};

const WORKFLOW_BADGE: Record<WorkflowStatus, string> = {
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  "in-progress": "bg-amber-50 text-amber-700 ring-amber-200",
  "images-uploaded": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "qc-pending": "bg-orange-50 text-orange-700 ring-orange-200",
  "qc-passed": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "retake-required": "bg-red-50 text-red-700 ring-red-200",
  "ready-for-reporting": "bg-teal-50 text-teal-700 ring-teal-200",
};

const PRIORITY_BADGE: Record<string, string> = {
  stat: "bg-red-50 text-red-700 ring-red-200",
  emergency: "bg-red-50 text-red-700 ring-red-200",
  urgent: "bg-orange-50 text-orange-700 ring-orange-200",
  routine: "bg-slate-50 text-slate-600 ring-slate-200",
  normal: "bg-slate-50 text-slate-600 ring-slate-200",
};

const SIDE_MARKERS = ["R", "L", "AP", "PA", "Standing", "Supine"];
const BODY_STAMPS = ["Chest", "Abdomen", "Spine", "Femur", "Foot", "Knee", "Cervical Spine"];
const RETAKE_REASONS = ["Motion Blur", "Wrong Positioning", "Anatomy Not Covered", "Artifact", "Exposure Issue", "Other"];
const REJECT_REASONS = ["Poor Image Quality", "Wrong Patient", "Wrong Body Part", "Duplicate Study", "Incomplete Study", "Motion Artifact", "Other"];

function meta(study?: WorklistStudy): Record<string, unknown> {
  return (study?.metadata as Record<string, unknown> | undefined) ?? {};
}

function stringMeta(study: WorklistStudy | undefined, keys: string[]): string {
  const m = meta(study);
  for (const key of keys) {
    const value = m[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalize(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function getStudyMrn(study?: WorklistStudy): string {
  return stringMeta(study, ["patientId", "PatientID", "mrn", "MRN", "00100020"]);
}

function workflowStatusFor(row: { order?: RadiologyOrder; study?: WorklistStudy }): WorkflowStatus {
  const explicit = meta(row.study).workflowStatus;
  if (typeof explicit === "string" && explicit in WORKFLOW_LABEL) return explicit as WorkflowStatus;
  if (row.study?.qcStatus === "pass") return "qc-passed";
  if (row.study?.qcStatus === "fail" || row.study?.isRepeat) return "retake-required";
  if (row.study?.viewerUrl) return "images-uploaded";
  if (row.order?.status === "in-progress") return "in-progress";
  if (row.order?.status === "completed") return "ready-for-reporting";
  return "scheduled";
}

function formatTime(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function orderStudyLabel(order: RadiologyOrder): string {
  return order.studyId ?? `${order.modality} ${order.bodyPart}`.trim();
}

function studyLabel(study: WorklistStudy): string {
  return study.description ?? study.studyId.slice(0, 18);
}

function buildRows(orders: RadiologyOrder[], studies: WorklistStudy[]): ExamRow[] {
  const usedStudyIds = new Set<string>();
  const rows: ExamRow[] = orders
    .filter((order) => order.status !== "cancelled")
    .map((order) => {
      const linkedStudy =
        (order.studyId ? studies.find((study) => study.studyId === order.studyId) : undefined) ??
        studies.find((study) => normalize(getStudyMrn(study)) === normalize(order.patientId));
      if (linkedStudy) usedStudyIds.add(linkedStudy.studyId);
      return {
        id: `order:${order.id}`,
        patientName: order.patientName,
        mrn: order.patientId,
        study: orderStudyLabel(order),
        modality: order.modality,
        bodyPart: order.bodyPart,
        priority: order.priority,
        room: stringMeta(linkedStudy, ["room"]) || linkedStudy?.room || "Room 1",
        status: workflowStatusFor({ order, study: linkedStudy }),
        scheduledTime: formatTime(order.scheduledDate),
        order,
        studyRecord: linkedStudy,
      };
    });

  for (const study of studies) {
    if (usedStudyIds.has(study.studyId)) continue;
    rows.push({
      id: `study:${study.studyId}`,
      patientName: study.patientName ?? "Unknown",
      mrn: getStudyMrn(study) || "-",
      study: studyLabel(study),
      modality: study.modality ?? "OT",
      bodyPart: (study.bodyPart ?? stringMeta(study, ["bodyPart", "BodyPartExamined"])) || "-",
      priority: study.priority ?? "normal",
      room: (study.room ?? stringMeta(study, ["room"])) || "Unassigned",
      status: workflowStatusFor({ study }),
      scheduledTime: study.studyDate ?? "-",
      studyRecord: study,
    });
  }

  return rows.sort((a, b) => {
    const rank = (priority: string) => priority === "stat" || priority === "emergency" ? 0 : priority === "urgent" ? 1 : 2;
    const priorityDiff = rank(a.priority) - rank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return a.scheduledTime.localeCompare(b.scheduledTime);
  });
}

function DeviceIndicator({ label, connected, icon: Icon }: { label: string; connected: boolean; icon: LucideIcon }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-tdai-gray-200 bg-white px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-tdai-navy-600" />
        <span className="text-sm font-semibold text-tdai-navy-800">{label}</span>
      </div>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

export function RadiographerWorkstation() {
  const queryClient = useQueryClient();
  const auth = useAuthRole();
  const [section, setSection] = useState<"workstation" | "settings">("workstation");
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchText, setSearchText] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const selectedRowId = searchParams.get("study") || null;
  const setSelectedRowId = (id: string | null) => {
    if (id) {
      setSearchParams({ study: id });
    } else {
      setSearchParams({});
    }
  };
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [retakeReason, setRetakeReason] = useState(RETAKE_REASONS[0]);
  const [customRetakeReason, setCustomRetakeReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [customRejectReason, setCustomRejectReason] = useState("");
  const showWorkflowPanel = false;

  const ordersQuery = useQuery({
    queryKey: ["radiographer", "orders"],
    queryFn: async () => {
      const res = await api.get<RadiologyOrder[]>("/orders");
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const worklistQuery = useQuery({
    queryKey: ["radiographer", "worklist"],
    queryFn: async () => {
      const res = await api.get<WorklistStudy[]>("/worklist");
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["radiographer", "settings"],
    queryFn: async () => {
      const res = await api.get<WorkstationSettings>("/radiographer/settings");
      return res.data;
    },
  });

  const rows = useMemo(
    () => buildRows(ordersQuery.data ?? [], worklistQuery.data ?? []),
    [ordersQuery.data, worklistQuery.data],
  );
  const selectedRow = rows.find((row) => row.id === selectedRowId) ?? null;

  const filteredRows = useMemo(() => {
    let next = rows;

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      next = next.filter((row) =>
        row.patientName.toLowerCase().includes(q) ||
        row.mrn.toLowerCase().includes(q) ||
        row.study.toLowerCase().includes(q) ||
        row.bodyPart.toLowerCase().includes(q)
      );
    }

    if (searchDateFrom) {
      next = next.filter((row) => {
        const dateStr = row.order?.scheduledDate || row.studyRecord?.studyDate || "";
        if (!dateStr) return false;
        return dateStr.slice(0, 10) >= searchDateFrom;
      });
    }

    if (searchDateTo) {
      next = next.filter((row) => {
        const dateStr = row.order?.scheduledDate || row.studyRecord?.studyDate || "";
        if (!dateStr) return false;
        return dateStr.slice(0, 10) <= searchDateTo;
      });
    }

    return next;
  }, [rows, searchText, searchDateFrom, searchDateTo]);

  const summary = useMemo(() => {
    const result: Record<WorkflowStatus, number> = {
      scheduled: 0,
      "in-progress": 0,
      "images-uploaded": 0,
      "qc-pending": 0,
      "qc-passed": 0,
      "retake-required": 0,
      "ready-for-reporting": 0,
    };
    for (const row of rows) result[row.status] += 1;
    return result;
  }, [rows]);

  const updateStudyMutation = useMutation({
    mutationFn: async ({ studyId, patch }: { studyId: string; patch: Record<string, unknown> }) => {
      const res = await api.patch(`/worklist/${encodeURIComponent(studyId)}/fields`, patch);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["radiographer", "worklist"] });
      await queryClient.invalidateQueries({ queryKey: ["worklist"] });
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, patch }: { orderId: string; patch: Partial<RadiologyOrder> }) => {
      const res = await api.patch(`/orders/${encodeURIComponent(orderId)}`, patch);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["radiographer", "orders"] });
    },
  });

  async function refreshWorkflow() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["radiographer", "orders"] }),
      queryClient.invalidateQueries({ queryKey: ["radiographer", "worklist"] }),
      queryClient.invalidateQueries({ queryKey: ["worklist"] }),
    ]);
  }

  async function startExam(row: ExamRow) {
    setSelectedRowId(row.id);
    setSection("workstation");
    if (row.order && row.order.status === "scheduled") {
      updateOrderMutation.mutate({ orderId: row.order.id, patch: { status: "in-progress" as OrderStatus } });
    }
    if (row.studyRecord) {
      updateStudyMutation.mutate({
        studyId: row.studyRecord.studyId,
        patch: { workflowStatus: row.studyRecord.viewerUrl ? "images-uploaded" : "in-progress" },
      });
    }
  }

  function patchSelectedStudy(patch: Record<string, unknown>) {
    if (!selectedRow?.studyRecord) return;
    updateStudyMutation.mutate({ studyId: selectedRow.studyRecord.studyId, patch });
  }

  function postAnnotationToIframe(text: string) {
    const iframe = document.querySelector("iframe");
    if (iframe) {
      iframe.contentWindow?.postMessage(
        {
          type: "TDAI_ADD_ANNOTATION",
          text,
        },
        "*"
      );
    }
  }

  function selectedQc(): QcChecklist {
    const raw = meta(selectedRow?.studyRecord).qcChecklist;
    if (!raw || typeof raw !== "object") return EMPTY_QC;
    return { ...EMPTY_QC, ...(raw as Partial<QcChecklist>) };
  }

  const qc = selectedQc();
  const qcPassed = Object.values(qc).every(Boolean);

  function setQcItem(key: keyof QcChecklist, value: boolean) {
    patchSelectedStudy({
      qcChecklist: { ...qc, [key]: value },
      qcStatus: "pending" satisfies QcStatus,
      workflowStatus: "qc-pending",
    });
  }

  function approveStudy() {
    patchSelectedStudy({
      qcChecklist: { ...EMPTY_QC, ...qc },
      qcStatus: "pass",
      qcResult: "approved",
      workflowStatus: "qc-passed",
    });
  }

  function rejectStudy() {
    setRejectOpen(true);
  }

  function submitReject() {
    const reason = rejectReason === "Other" ? customRejectReason.trim() : rejectReason;
    if (!reason) return;
    patchSelectedStudy({
      qcStatus: "fail",
      qcResult: "rejected",
      workflowStatus: "retake-required",
      rejectReason: reason,
      rejectEvent: {
        reason,
        timestamp: new Date().toISOString(),
        userId: auth.userId,
      },
    });
    setRejectOpen(false);
    setCustomRejectReason("");
  }

  function submitRetake() {
    const reason = retakeReason === "Other" ? customRetakeReason.trim() : retakeReason;
    if (!reason) return;
    patchSelectedStudy({
      isRepeat: true,
      repeatReason: reason,
      qcStatus: "fail",
      qcResult: "retake",
      workflowStatus: "retake-required",
      retakeEvent: {
        reason,
        timestamp: new Date().toISOString(),
        userId: auth.userId,
      },
    });
    setRetakeOpen(false);
    setCustomRetakeReason("");
  }

  function completeStudy() {
    if (selectedRow?.order) {
      updateOrderMutation.mutate({ orderId: selectedRow.order.id, patch: { status: "completed" as OrderStatus } });
    }
    patchSelectedStudy({
      qcStatus: "pass",
      qcResult: "approved",
      workflowStatus: "ready-for-reporting",
    });
  }

  function handleAction(action: string, payload?: any) {
    if (action === "approve") {
      approveStudy();
    } else if (action === "reject") {
      const reason = payload?.reason || "Poor Image Quality";
      patchSelectedStudy({
        qcStatus: "fail",
        qcResult: "rejected",
        workflowStatus: "retake-required",
        rejectReason: reason,
        rejectEvent: {
          reason,
          timestamp: new Date().toISOString(),
          userId: auth.userId,
        },
      });
    } else if (action === "retake") {
      const reason = payload?.reason || "Other";
      patchSelectedStudy({
        isRepeat: true,
        repeatReason: reason,
        qcStatus: "fail",
        qcResult: "retake",
        workflowStatus: "retake-required",
        retakeEvent: {
          reason,
          timestamp: new Date().toISOString(),
          userId: auth.userId,
        },
      });
    } else if (action === "complete") {
      completeStudy();
    }
  }

  function handleDicomUploaded() {
    void refreshWorkflow().then(() => {
      void api.post("/dicomweb/warm").catch(() => {});
    });
  }

  const viewerUrl = selectedRow?.studyRecord?.viewerUrl ?? null;
  const hasImages = Boolean(viewerUrl);
  const settings = settingsQuery.data;
  const pacsConfigured = Boolean(settings?.pacs.ipAddress && settings.pacs.port);
  const printerConfigured = Boolean(settings?.printer.ipAddress && settings.printer.port);

  function renderHeader() {
    return (
      <div className="border-b border-tdai-gray-200 bg-white px-6 py-3 shrink-0">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h1 className="text-lg font-bold text-tdai-navy-800 leading-none">Radiographer Workstation</h1>
            <div className="flex items-center gap-2.5 text-[11px] border-l border-tdai-gray-200 pl-3">
              <span className="text-tdai-gray-400 font-semibold uppercase tracking-wider">Devices:</span>
              <span className="inline-flex items-center gap-1 text-tdai-navy-700 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> X-Ray</span>
              <span className="inline-flex items-center gap-1 text-tdai-navy-700 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Detector</span>
              <span className="inline-flex items-center gap-1 text-tdai-navy-700 font-medium"><span className={`h-1.5 w-1.5 rounded-full ${pacsConfigured || !worklistQuery.error ? "bg-emerald-500" : "bg-red-500"}`} /> PACS</span>
              <span className="inline-flex items-center gap-1 text-tdai-navy-700 font-medium"><span className={`h-1.5 w-1.5 rounded-full ${printerConfigured ? "bg-emerald-500" : "bg-red-500"}`} /> Printer</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`btn-secondary !h-9 !py-1.5 text-xs ${
                section === "workstation" && !selectedRow ? "!border-tdai-teal-500 !text-tdai-teal-700" : ""
              }`}
              onClick={() => {
                setSection("workstation");
                setSelectedRowId(null);
              }}
            >
              <Monitor className="h-4 w-4" />
              Workstation
            </button>
            <button
              className={`btn-secondary !h-9 !py-1.5 text-xs ${section === "settings" ? "!border-tdai-teal-500 !text-tdai-teal-700" : ""}`}
              onClick={() => setSection("settings")}
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  let content: React.ReactNode;

  if (section === "settings") {
    content = (
      <div className="flex-1 overflow-y-auto">
        <RadiographerSettingsPanel settings={settings} onSaved={() => settingsQuery.refetch()} />
      </div>
    );
  } else if (selectedRow) {
    content = (
      <div className="w-screen h-screen flex flex-col bg-tdai-navy-950 overflow-hidden">
        <div className="flex-1 min-h-0 flex overflow-hidden bg-tdai-navy-950">
          <div className="relative flex-1 min-w-0 h-full bg-tdai-navy-950">
            <div className="absolute left-3 top-3 z-20">
              <button
                onClick={() => setSelectedRowId(null)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur hover:bg-slate-800 hover:text-white"
              >
                ← Back
              </button>
            </div>
            {hasImages && viewerUrl ? (
              <OhifViewerEmbed
                key={`${selectedRow.studyRecord?.studyId}-${viewerUrl}`}
                src={viewerUrl}
                studyRecord={selectedRow.studyRecord}
                onWorkflowPatch={patchSelectedStudy}
                onAction={handleAction}
              />
            ) : (
              <div className="absolute inset-0 overflow-y-auto bg-tdai-navy-950 p-6">
                <div className="mx-auto mt-8 max-w-xl">
                  <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    No images are available for this selected exam. Import DICOM images to refresh the viewer automatically.
                  </div>
                  <DicomUpload
                    patientId={selectedRow.mrn !== "-" ? selectedRow.mrn : undefined}
                    patientName={selectedRow.patientName}
                    onUploaded={handleDicomUploaded}
                  />
                </div>
              </div>
            )}
          </div>

          {showWorkflowPanel && (
            <aside className="w-[320px] shrink-0 border-l border-slate-800/80 bg-slate-900/90 flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/80 shrink-0">
                <span className="text-xs font-bold text-white">Workflow Panel</span>
                <button className="text-slate-500 hover:text-white transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2.5 space-y-3 custom-scrollbar">
                <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Patient / Study</p>
                  <div className="space-y-1.5 text-[11px] text-slate-200">
                    <p><span className="text-slate-400">Patient:</span> {selectedRow.patientName}</p>
                    <p><span className="text-slate-400">MRN:</span> {selectedRow.mrn}</p>
                    <p><span className="text-slate-400">Study:</span> {selectedRow.study}</p>
                    <p><span className="text-slate-400">Modality:</span> {selectedRow.modality}</p>
                    <p><span className="text-slate-400">Body Part:</span> {selectedRow.bodyPart}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 px-0.5">Side Marker</p>
                  <div className="grid grid-cols-4 gap-1">
                    {SIDE_MARKERS.map((marker) => (
                      <button
                        key={marker}
                        className="flex items-center justify-center rounded-lg bg-slate-800/50 py-1.5 text-[10px] font-bold text-slate-300 transition-all hover:bg-tdai-teal-600/20 hover:text-tdai-teal-400 ring-1 ring-transparent hover:ring-tdai-teal-500/30"
                        onClick={() => {
                          patchSelectedStudy({ sideMarker: marker });
                          postAnnotationToIframe(marker);
                        }}
                      >
                        {marker}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 px-0.5">Body Part</p>
                  <div className="grid grid-cols-2 gap-1">
                    {BODY_STAMPS.map((stamp) => (
                      <button
                        key={stamp}
                        className="flex items-center justify-center rounded-lg bg-slate-800/50 py-1.5 text-[10px] font-semibold text-slate-300 transition-all hover:bg-tdai-teal-600/20 hover:text-tdai-teal-400"
                        onClick={() => {
                          patchSelectedStudy({ bodyPartStamp: stamp });
                          postAnnotationToIframe(stamp);
                        }}
                      >
                        {stamp}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Quality Check</p>
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold ${qcPassed ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                      {qcPassed ? "PASS" : "PENDING"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {([
                      ["patientMatch", "Patient Match"],
                      ["correctPositioning", "Positioning"],
                      ["anatomyCovered", "Anatomy"],
                      ["markerPresent", "Marker"],
                      ["noMotionBlur", "No Motion Blur"],
                      ["noArtifacts", "No Artifacts"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-300 hover:text-white transition-colors">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded accent-tdai-teal-500 bg-slate-700 border-slate-600"
                          checked={qc[key]}
                          onChange={(e) => setQcItem(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 px-0.5">Actions</p>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-[10px] font-bold text-white transition-all hover:bg-emerald-500 ring-1 ring-emerald-500/20 disabled:opacity-30 cursor-pointer"
                      disabled={!selectedRow.studyRecord || !qcPassed}
                      onClick={approveStudy}
                    >
                      <Check className="h-3 w-3" /> Approve
                    </button>
                    <button
                      className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 py-2 text-[10px] font-bold text-white transition-all hover:bg-rose-500 ring-1 ring-rose-600/30 disabled:opacity-30 cursor-pointer"
                      disabled={!selectedRow.studyRecord}
                      onClick={rejectStudy}
                    >
                      <X className="h-3 w-3" /> Reject
                    </button>
                    <button
                      className="flex items-center justify-center gap-1 rounded-lg bg-amber-600 py-2 text-[10px] font-bold text-white transition-all hover:bg-amber-500 ring-1 ring-red-500/20 disabled:opacity-30 cursor-pointer"
                      disabled={!selectedRow.studyRecord}
                      onClick={() => setRetakeOpen(true)}
                    >
                      <RefreshCw className="h-3 w-3" /> Retake
                    </button>
                    <button
                      className="flex items-center justify-center gap-1 rounded-lg bg-sky-600 py-2 text-[10px] font-bold text-white transition-all hover:bg-sky-500 ring-1 ring-sky-500/20 disabled:opacity-30 cursor-pointer"
                      disabled={!selectedRow.studyRecord || !qcPassed}
                      onClick={completeStudy}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Complete
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  } else {
    content = (
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[1600px] w-full space-y-5">
          {/* Status Metrics Cards */}
          <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            {([
              ["scheduled", ClipboardCheck],
              ["in-progress", Activity],
              ["images-uploaded", ImagePlus],
              ["qc-pending", AlertTriangle],
              ["qc-passed", BadgeCheck],
              ["retake-required", X],
              ["ready-for-reporting", CheckCircle2],
            ] as const).map(([status, Icon]) => (
              <div key={status} className="rounded-xl border border-tdai-gray-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-tdai-gray-500">{WORKFLOW_LABEL[status]}</span>
                  <Icon className="h-4 w-4 text-tdai-teal-600" />
                </div>
                <p className="mt-1.5 text-2xl font-bold text-tdai-navy-800">{summary[status]}</p>
              </div>
            ))}
          </section>

          {/* Clean Unified Toolbar Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-tdai-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Box */}
              <div className="relative flex items-center rounded-xl bg-tdai-surface-alt border border-tdai-border-light px-3 py-2 w-72">
                <Search className="h-4 w-4 text-tdai-muted mr-2" />
                <input
                  className="w-full bg-transparent border-none text-xs focus:ring-0 outline-none placeholder:text-tdai-gray-400 text-tdai-navy-800"
                  placeholder="Search patient name, MRN, or study..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-2 rounded-xl bg-tdai-surface-alt border border-tdai-border-light p-1">
                <CalendarRange className="h-4 w-4 text-tdai-muted ml-2" />
                <input
                  type="date"
                  className="bg-transparent border-none text-xs focus:ring-0 py-1.5 px-2 text-tdai-navy-800"
                  value={searchDateFrom}
                  onChange={(e) => setSearchDateFrom(e.target.value)}
                  title="From date"
                />
                <span className="text-xs text-tdai-muted">to</span>
                <input
                  type="date"
                  className="bg-transparent border-none text-xs focus:ring-0 py-1.5 px-2 text-tdai-navy-800"
                  value={searchDateTo}
                  onChange={(e) => setSearchDateTo(e.target.value)}
                  title="To date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className="btn-secondary !h-9 text-xs" onClick={() => void refreshWorkflow()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          </div>

          {/* Patient Worklist Table */}
          <section className="rounded-2xl border border-tdai-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-tdai-gray-200 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-tdai-navy-800">Patient Worklist</h2>
                <p className="text-xs text-tdai-gray-500">{filteredRows.length} workflow case{filteredRows.length === 1 ? "" : "s"}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="table-header bg-tdai-gray-50/70 border-b border-tdai-gray-200">
                  <tr>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Patient Name</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">MRN</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Study</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Modality</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Body Part</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Priority</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Room</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider">Scheduled Time</th>
                    <th className="px-5 py-3.5 font-bold text-tdai-navy-800 text-xs uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tdai-gray-100">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-tdai-gray-50/50 transition-colors">
                      <td className="px-5 py-4 font-semibold text-tdai-navy-800">{row.patientName}</td>
                      <td className="px-5 py-4 font-mono text-xs text-tdai-gray-500">{row.mrn}</td>
                      <td className="px-5 py-4 text-tdai-navy-700">{row.study}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-md bg-tdai-navy-700 px-2.5 py-1 text-[10px] font-bold text-white uppercase">{row.modality}</span>
                      </td>
                      <td className="px-5 py-4 text-tdai-navy-600">{row.bodyPart}</td>
                      <td className="px-5 py-4">
                        <span className={`badge ring-1 ${PRIORITY_BADGE[row.priority] ?? PRIORITY_BADGE.normal}`}>{String(row.priority).toUpperCase()}</span>
                      </td>
                      <td className="px-5 py-4 text-tdai-navy-600">{row.room}</td>
                      <td className="px-5 py-4">
                        <span className={`badge ring-1 ${WORKFLOW_BADGE[row.status]}`}>{WORKFLOW_LABEL[row.status]}</span>
                      </td>
                      <td className="px-5 py-4 text-tdai-gray-600">{row.scheduledTime}</td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button className="btn-primary !h-8 !px-3 !py-1 text-[11px]" onClick={() => void startExam(row)}>
                            {row.status === "scheduled" ? "Start Exam" : "Resume Exam"}
                          </button>
                          <button className="btn-secondary !h-8 !px-3 !py-1 text-[11px]" onClick={() => setSelectedRowId(row.id)}>
                            <Eye className="h-3.5 w-3.5" />
                            Open Viewer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-5 py-16 text-center text-sm text-tdai-gray-500">
                        No scheduled patients or received studies are available matching the current search parameters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick Notification Tiles */}
          <section className="grid gap-3 md:grid-cols-3">
            <NotificationTile title="Retake Required" count={summary["retake-required"]} tone="red" />
            <NotificationTile title="QC Pending" count={summary["qc-pending"]} tone="amber" />
            <NotificationTile title="STAT Cases" count={rows.filter((row) => row.priority === "stat" || row.priority === "emergency").length} tone="red" />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tdai-background flex flex-col h-screen overflow-hidden">
      {!selectedRow && renderHeader()}
      {content}
      {retakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRetakeOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-tdai-navy-800">Retake Required</h3>
            <p className="mt-1 text-sm text-tdai-gray-500">Capture reason, timestamp, and user for the selected study.</p>
            <label className="mt-4 block text-xs font-semibold text-tdai-gray-600">Reason</label>
            <select className="select-field mt-1 w-full" value={retakeReason} onChange={(e) => setRetakeReason(e.target.value)}>
              {RETAKE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            {retakeReason === "Other" && (
              <input className="input-field mt-3" placeholder="Enter reason" value={customRetakeReason} onChange={(e) => setCustomRetakeReason(e.target.value)} />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRetakeOpen(false)}>Cancel</button>
              <button className="btn-danger" onClick={submitRetake}>Mark Retake Required</button>
            </div>
          </div>
        </div>
      )}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRejectOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-tdai-navy-800">Reject Study</h3>
            <p className="mt-1 text-sm text-tdai-gray-500">Capture reject reason, timestamp, and user for the selected study.</p>
            <label className="mt-4 block text-xs font-semibold text-tdai-gray-600">Reason</label>
            <select className="select-field mt-1 w-full" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {REJECT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            {rejectReason === "Other" && (
              <input className="input-field mt-3" placeholder="Enter reason" value={customRejectReason} onChange={(e) => setCustomRejectReason(e.target.value)} />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRejectOpen(false)}>Cancel</button>
              <button className="btn-danger bg-red-600 hover:bg-red-500" onClick={submitReject}>Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function NotificationTile({ title, count, tone }: { title: string; count: number; tone: "red" | "amber" }) {
  const style = tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <div className={`rounded-xl border px-4 py-3 ${style}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <AlertTriangle className="h-4 w-4" />
      </div>
      <p className="mt-1 text-2xl font-bold">{count}</p>
    </div>
  );
}

function RadiographerSettingsPanel({ settings, onSaved }: { settings?: WorkstationSettings; onSaved: () => void }) {
  const [draft, setDraft] = useState<WorkstationSettings>(settings ?? {
    printer: { printerName: "", aeTitle: "", ipAddress: "", port: 104, filmSize: "14x17", magnification: "Replicate" },
    pacs: { aeTitle: "", ipAddress: "", port: 4242 },
    scpReceiver: { aeTitle: "", port: 11112, compression: "None" },
  });
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  async function save() {
    await api.put("/radiographer/settings", draft);
    onSaved();
  }

  async function test(target: "printer" | "pacs" | "scpReceiver") {
    const res = await api.post<{ connected: boolean; message: string }>(`/radiographer/settings/${target}/test`);
    setTestMessage(`${target}: ${res.data.message}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5">
        <h2 className="page-header">Radiographer Settings</h2>
        <p className="page-subheader mt-1">Printer, PACS, and SCP receiver configuration is intentionally separate from the dashboard and viewer.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <SettingsCard title="Printer Settings" onTest={() => void test("printer")}>
          <Field label="Printer Name" value={draft.printer.printerName ?? ""} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, printerName: v } })} />
          <Field label="AE Title" value={draft.printer.aeTitle ?? ""} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, aeTitle: v } })} />
          <Field label="IP Address" value={draft.printer.ipAddress ?? ""} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, ipAddress: v } })} />
          <Field label="Port" value={String(draft.printer.port ?? "")} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, port: Number(v) } })} />
          <Field label="Film Size" value={draft.printer.filmSize ?? ""} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, filmSize: v } })} />
          <Field label="Magnification" value={draft.printer.magnification ?? ""} onChange={(v) => setDraft({ ...draft, printer: { ...draft.printer, magnification: v } })} />
        </SettingsCard>
        <SettingsCard title="PACS Settings" onTest={() => void test("pacs")}>
          <Field label="AE Title" value={draft.pacs.aeTitle ?? ""} onChange={(v) => setDraft({ ...draft, pacs: { ...draft.pacs, aeTitle: v } })} />
          <Field label="IP Address" value={draft.pacs.ipAddress ?? ""} onChange={(v) => setDraft({ ...draft, pacs: { ...draft.pacs, ipAddress: v } })} />
          <Field label="Port" value={String(draft.pacs.port ?? "")} onChange={(v) => setDraft({ ...draft, pacs: { ...draft.pacs, port: Number(v) } })} />
        </SettingsCard>
        <SettingsCard title="SCP Receiver Settings" onTest={() => void test("scpReceiver")}>
          <Field label="AE Title" value={draft.scpReceiver.aeTitle ?? ""} onChange={(v) => setDraft({ ...draft, scpReceiver: { ...draft.scpReceiver, aeTitle: v } })} />
          <Field label="Port" value={String(draft.scpReceiver.port ?? "")} onChange={(v) => setDraft({ ...draft, scpReceiver: { ...draft.scpReceiver, port: Number(v) } })} />
          <Field label="Compression" value={draft.scpReceiver.compression ?? ""} onChange={(v) => setDraft({ ...draft, scpReceiver: { ...draft.scpReceiver, compression: v } })} />
        </SettingsCard>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={() => void save()}>Save Settings</button>
        {testMessage && <span className="text-sm font-medium text-tdai-teal-700">{testMessage}</span>}
      </div>
    </div>
  );
}

function SettingsCard({ title, children, onTest }: { title: string; children: ReactNode; onTest: () => void }) {
  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-tdai-navy-800">{title}</h3>
        <button className="btn-secondary !h-8 !px-2 !py-1 text-xs" onClick={onTest}>Test Connection</button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-tdai-gray-600">{label}</span>
      <input className="input-field" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}


