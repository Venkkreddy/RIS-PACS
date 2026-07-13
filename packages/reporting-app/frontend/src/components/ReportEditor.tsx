import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Report, ReportSection, ReportStatus, CriticalPriority, Template } from "@medical-report-system/shared";
import { api } from "../api/client";
import { TipTapEditor } from "./TipTapEditor";
import { AddendumModal } from "./AddendumModal";
import { ShareButton } from "./ShareButton";

interface ReportEditorProps {
  report: Report;
  onRefresh: () => void;
}

const DEFAULT_SECTIONS: ReportSection[] = [
  { key: "clinical_history", title: "Clinical History", content: "" },
  { key: "comparison", title: "Comparison", content: "" },
  { key: "technique", title: "Technique", content: "" },
  { key: "findings", title: "Findings", content: "" },
  { key: "impression", title: "Impression", content: "" },
  { key: "recommendation", title: "Recommendation", content: "" },
];

const STATUS_FLOW: Record<ReportStatus, ReportStatus[]> = {
  draft: ["preliminary", "final"],
  preliminary: ["final"],
  final: ["amended"],
  amended: ["final"],
  cancelled: [],
};

const STATUS_BADGE: Record<ReportStatus, { bg: string; dot: string; ring: string }> = {
  draft: { bg: "bg-tdai-gray-100 text-tdai-gray-700 dark:bg-tdai-gray-800 dark:text-tdai-gray-100", dot: "bg-tdai-gray-400 dark:bg-tdai-gray-500", ring: "ring-tdai-gray-200 dark:ring-white/[0.08]" },
  preliminary: { bg: "bg-tdai-navy-50 text-tdai-navy-700 dark:bg-tdai-navy-900/40 dark:text-tdai-gray-100", dot: "bg-tdai-navy-400", ring: "ring-tdai-navy-200 dark:ring-tdai-navy-700" },
  final: { bg: "bg-tdai-teal-50 text-tdai-teal-800 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300", dot: "bg-tdai-teal-500", ring: "ring-tdai-teal-200 dark:ring-tdai-teal-700" },
  amended: { bg: "bg-tdai-navy-100 text-tdai-navy-800 dark:bg-tdai-navy-900/50 dark:text-tdai-gray-100", dot: "bg-tdai-navy-500", ring: "ring-tdai-navy-200 dark:ring-tdai-navy-700" },
  cancelled: { bg: "bg-tdai-red-50 text-tdai-red-700 dark:bg-tdai-red-900/20 dark:text-tdai-red-300", dot: "bg-tdai-red-400", ring: "ring-tdai-red-200 dark:ring-tdai-red-800" },
};

const PRIORITY_STYLES: Record<CriticalPriority, string> = {
  routine: "bg-tdai-gray-50 text-tdai-gray-600 border-tdai-gray-200 dark:bg-tdai-gray-800/50 dark:text-tdai-gray-300 dark:border-white/[0.08]",
  urgent: "bg-tdai-navy-50 text-tdai-navy-700 border-tdai-navy-300 dark:bg-tdai-navy-900/30 dark:text-tdai-gray-100 dark:border-tdai-navy-600",
  critical: "bg-tdai-red-50 text-tdai-red-700 border-tdai-red-300 animate-pulse-subtle dark:bg-tdai-red-900/20 dark:text-tdai-red-300 dark:border-tdai-red-700",
};

const SECTION_ICONS: Record<string, string> = {
  clinical_history: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  comparison: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  technique: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  findings: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  impression: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  recommendation: "M9 5l7 7-7 7",
};

const AUTOSAVE_DELAY = 3000;

export function ReportEditor({ report, onRefresh }: ReportEditorProps) {
  const initialSections =
    report.sections && report.sections.length > 0
      ? report.sections
      : DEFAULT_SECTIONS;

  const [sections, setSections] = useState<ReportSection[]>(initialSections);
  const [activeTab, setActiveTab] = useState<string>("findings");
  const [priority, setPriority] = useState<CriticalPriority>(report.priority ?? "routine");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateCategory, setTemplateCategory] = useState("all");

  // ── Smart Dictate — ONE button, full report ───────────────────────────────────
  const [dictatePhase, setDictatePhase] = useState<
    "idle" | "recording" | "transcribing" | "generating" | "done" | "error"
  >("idle");
  const [dictateTranscript, setDictateTranscript] = useState("");
  const [dictateError, setDictateError] = useState<string | null>(null);
  const [dictateTemplate, setDictateTemplate] = useState<string | null>(null);
  const [dictateSource, setDictateSource] = useState<string | null>(null);
  const [dictateDuration, setDictateDuration] = useState(0);
  const [dictateMeasurements, setDictateMeasurements] = useState<{ text: string }[]>([]);
  const [showFallbackInput, setShowFallbackInput] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  const dictateMediaRef = useRef<MediaRecorder | null>(null);
  const dictateChunksRef = useRef<Blob[]>([]);
  const dictateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const newSections = report.sections && report.sections.length > 0 ? report.sections : DEFAULT_SECTIONS;
    setSections(newSections);
    setPriority(report.priority ?? "routine");
    setDirty(false);
    dirtyRef.current = false;
  }, [report.id]);

  const doSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    setSaving(true);
    try {
      const content = sections.filter((s) => s.content.replace(/<[^>]*>/g, "").trim()).map((s) => `<h3>${s.title}</h3>\n${s.content}`).join("\n");
      await api.put(`/reports/${report.id}`, { sections, content, priority });
      setDirty(false);
      dirtyRef.current = false;
      setLastSaved(new Date().toLocaleTimeString());
    } catch {
      setStatusMessage("Auto-save failed.");
    }
    setSaving(false);
  }, [sections, priority, report.id]);

  function markDirty() {
    setDirty(true);
    dirtyRef.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY);
  }

  function updateSection(key: string, content: string) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)));
    markDirty();
  }

  async function manualSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaving(true);
    try {
      const content = sections.filter((s) => s.content.replace(/<[^>]*>/g, "").trim()).map((s) => `<h3>${s.title}</h3>\n${s.content}`).join("\n");
      await api.put(`/reports/${report.id}`, { sections, content, priority });
      setDirty(false);
      dirtyRef.current = false;
      setLastSaved(new Date().toLocaleTimeString());
      setStatusMessage("Report saved.");
      onRefresh();
      setTimeout(() => setStatusMessage(null), 2500);
    } catch {
      setStatusMessage("Failed to save.");
    }
    setSaving(false);
  }

  async function changeStatus(newStatus: ReportStatus) {
    if (dirty) await manualSave();
    const confirmMsg =
      newStatus === "final"
        ? "Finalize and electronically sign this report?"
        : `Change report status to "${newStatus}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      await api.patch(`/reports/${report.id}/status`, { status: newStatus });
      setStatusMessage(`Status → ${newStatus}`);
      onRefresh();
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage("Failed to change status.");
    }
  }

  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.get("/templates");
      setTemplates(res.data as Template[]);
    } catch { /* empty */ }
  }, []);

  function applyTemplate(template: Template) {
    if (template.sections && template.sections.length > 0) {
      setSections(template.sections.map((s) => ({ ...s })));
    }
    setShowTemplatePicker(false);
    markDirty();
  }

  const [attachUploading, setAttachUploading] = useState(false);

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const form = new FormData();
        form.append("file", files[i]);
        await api.post(`/reports/${report.id}/attach`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      onRefresh();
    } catch {
      setStatusMessage(`Failed to upload ${files.length > 1 ? "one or more images" : "image"}.`);
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setAttachUploading(false);
      event.target.value = "";
    }
  }

  async function markAsReported() {
    if (dirty) await manualSave();
    await api.post("/update-status", { studyId: report.studyId, status: "reported" });
    setStatusMessage("Marked as reported.");
    onRefresh();
    setTimeout(() => setStatusMessage(null), 3000);
  }

  // ── Smart Dictate Pipeline ────────────────────────────────────────────────
  // Extracts patient context from report metadata for auto-filling
  function extractPatientContext() {
    const rawMeta = report.metadata as Record<string, unknown> | undefined;
    const patient = rawMeta?.patient as Record<string, unknown> | undefined;
    return {
      bodyPart: (report as any).bodyPart ?? (report as any).body_part ?? (rawMeta?.bodyPart as string) ?? "AUTO",
      modality: (report as any).modality ?? (rawMeta?.modality as string) ?? "AUTO",
      laterality: (report as any).laterality ?? undefined,
      patientName: (patient?.patientName ?? (report as any).patientName ?? "") as string,
      patientAge: (patient?.age ?? undefined) as number | undefined,
      patientSex: (patient?.gender ?? patient?.sex ?? "") as string,
      clinicalHistory: (rawMeta?.clinicalHistory ?? "") as string,
    };
  }

  async function startFullDictation() {
    setDictatePhase("recording");
    setDictateError(null);
    setDictateDuration(0);
    setShowFallbackInput(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      dictateChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) dictateChunksRef.current.push(e.data); };
      mr.onstop = () => void processDictation(stream);
      mr.start(250); // collect chunks every 250ms
      dictateMediaRef.current = mr;
      dictateTimerRef.current = setInterval(() => setDictateDuration((d) => d + 1), 1000);
    } catch {
      setDictatePhase("error");
      setDictateError("mic_denied");
    }
  }

  function stopDictation() {
    if (dictateTimerRef.current) { clearInterval(dictateTimerRef.current); dictateTimerRef.current = null; }
    dictateMediaRef.current?.stop();
  }

  async function processDictation(stream: MediaStream) {
    stream.getTracks().forEach((t) => t.stop());
    if (dictateTimerRef.current) { clearInterval(dictateTimerRef.current); dictateTimerRef.current = null; }

    // ── Step 1: Transcribe ─────────────────────────────────────────────────
    setDictatePhase("transcribing");
    let transcript = "";
    try {
      const blob = new Blob(dictateChunksRef.current, { type: "audio/webm" });
      if (blob.size < 500) { setDictatePhase("error"); setDictateError("no_audio"); return; }
      const fd = new FormData();
      fd.append("audio", blob, "dictation.webm");
      const res = await api.post<{ raw_transcript?: string; transcript?: string }>("/voice/transcribe", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      transcript = res.data.raw_transcript ?? res.data.transcript ?? "";
    } catch {
      // MedASR unavailable → show fallback text input
      setDictatePhase("error");
      setDictateError("transcribe_failed");
      setShowFallbackInput(true);
      return;
    }

    if (!transcript.trim()) { setDictatePhase("error"); setDictateError("no_speech"); return; }
    setDictateTranscript(transcript);

    // ── Step 2: Generate report (all sections at once) ─────────────────────
    setDictatePhase("generating");
    const ctx = extractPatientContext();
    try {
      const res = await api.post("/reports/ai/structure", {
        dictation: transcript,
        body_part: ctx.bodyPart,
        modality: ctx.modality,
        laterality: ctx.laterality,
        auto_detect: true,      // backend will override body_part/modality from voice keywords if "AUTO"
        patient_name: ctx.patientName,
        patient_age: ctx.patientAge,
        patient_sex: ctx.patientSex,
        clinical_history: ctx.clinicalHistory || undefined,
      });
      const data = res.data as {
        sections: { key: string; title: string; content: string; is_signature?: boolean }[];
        template_name?: string;
        measurements_extracted?: { text: string }[];
        source?: string;
      };

      setSections((prev) =>
        prev.map((existing) => {
          const ai = data.sections?.find((s) => s.key === existing.key);
          if (ai && ai.content && !ai.is_signature) return { ...existing, content: ai.content };
          return existing;
        })
      );
      setDictateTemplate(data.template_name ?? null);
      setDictateSource(data.source ?? null);
      setDictateMeasurements(data.measurements_extracted ?? []);
      setDictatePhase("done");
      setActiveTab("findings");
      markDirty();
    } catch {
      // LLM failed → rule-based fallback: put transcript in findings
      setSections((prev) =>
        prev.map((s) => s.key === "findings" ? { ...s, content: `<p>${transcript}</p>` } : s)
      );
      setDictateTemplate("Rule-Based Fallback");
      setDictateSource("rule_based");
      setDictatePhase("done");
      setActiveTab("findings");
      markDirty();
    }
  }

  async function generateFromFallbackText() {
    if (!fallbackText.trim()) return;
    setDictateTranscript(fallbackText);
    setDictatePhase("generating");
    setShowFallbackInput(false);
    const ctx = extractPatientContext();
    try {
      const res = await api.post("/reports/ai/structure", {
        dictation: fallbackText,
        body_part: ctx.bodyPart,
        modality: ctx.modality,
        auto_detect: true,
        patient_name: ctx.patientName,
        clinical_history: ctx.clinicalHistory || undefined,
      });
      const data = res.data as {
        sections: { key: string; title: string; content: string; is_signature?: boolean }[];
        template_name?: string;
        source?: string;
      };
      setSections((prev) =>
        prev.map((existing) => {
          const ai = data.sections?.find((s) => s.key === existing.key);
          if (ai && ai.content && !ai.is_signature) return { ...existing, content: ai.content };
          return existing;
        })
      );
      setDictateTemplate(data.template_name ?? null);
      setDictateSource(data.source ?? null);
      setDictatePhase("done");
      setActiveTab("findings");
      markDirty();
    } catch {
      setSections((prev) =>
        prev.map((s) => s.key === "findings" ? { ...s, content: `<p>${fallbackText}</p>` } : s)
      );
      setDictatePhase("done");
      setActiveTab("findings");
      markDirty();
    }
  }

  function resetDictate() {
    setDictatePhase("idle");
    setDictateTranscript("");
    setDictateError(null);
    setDictateTemplate(null);
    setDictateSource(null);
    setDictateDuration(0);
    setDictateMeasurements([]);
    setShowFallbackInput(false);
    setFallbackText("");
  }

  function formatDuration(sec: number) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }


  const categories = [...new Set(templates.map((t) => t.category ?? "Other"))];
  const filteredTemplates = templateCategory === "all" ? templates : templates.filter((t) => (t.category ?? "Other") === templateCategory);
  const status = report.status ?? "draft";
  const nextStatuses = STATUS_FLOW[status] ?? [];
  const isLocked = status === "final" || status === "cancelled";
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
  const completedSections = sections.filter((s) => s.content.replace(/<[^>]*>/g, "").trim()).length;
  const completionPct = Math.round((completedSections / sections.length) * 100);
  const patientMeta = (() => {
    const rawMetadata = report.metadata as Record<string, unknown> | undefined;
    const patient = rawMetadata?.patient;
    if (!patient || typeof patient !== "object") return null;
    const data = patient as Record<string, unknown>;
    const getString = (key: string): string =>
      typeof data[key] === "string" && data[key].trim() ? data[key].trim() : "";
    const result = {
      name: getString("patientName"),
      mrn: getString("patientId"),
      registryId: getString("patientRegistryId"),
      dateOfBirth: getString("dateOfBirth"),
      phone: getString("phone"),
    };
    if (!result.name && !result.mrn && !result.registryId && !result.dateOfBirth && !result.phone) return null;
    return result;
  })();

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Header Card ──────────────────── */}
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-tdai-navy-700 via-tdai-navy-600 to-tdai-navy-700 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Radiology Report</h2>
                <p className="text-[11px] text-white/50 font-mono">Study: {report.studyId.slice(0, 40)}...</p>
                {patientMeta && (
                  <p className="text-[11px] text-white/70">
                    {patientMeta.name || "Unknown Patient"}
                    {patientMeta.mrn ? ` • MRN ${patientMeta.mrn}` : ""}
                    {patientMeta.registryId ? ` • UID ${patientMeta.registryId.slice(0, 10)}…` : ""}
                    {patientMeta.dateOfBirth ? ` • DOB ${patientMeta.dateOfBirth}` : ""}
                    {patientMeta.phone ? ` • ${patientMeta.phone}` : ""}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ring-1 ring-inset ${badge.bg} ${badge.ring}`}>
                <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
                {status.toUpperCase()}
              </span>
              <select
                value={priority}
                disabled={isLocked}
                onChange={(e) => { setPriority(e.target.value as CriticalPriority); markDirty(); }}
                className={`select-field rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${PRIORITY_STYLES[priority]}`}
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="flex items-center gap-3 border-t border-tdai-gray-100 bg-tdai-gray-50/50 px-6 py-2 dark:border-white/[0.08] dark:bg-tdai-gray-800/50">
          <div className="flex-1">
            <div className="h-1.5 rounded-full bg-tdai-gray-200 dark:bg-tdai-gray-700">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-tdai-teal-500 to-tdai-teal-400 transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] font-semibold text-tdai-teal-600 dark:text-tdai-teal-400">
            {completedSections}/{sections.length} sections
          </span>
        </div>
      </div>

      {/* ── Template Picker ──────────────── */}
      {!isLocked && (
        <div className="card overflow-hidden">
          <button
            className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-tdai-gray-50/50 dark:hover:bg-white/[0.06]"
            onClick={() => { setShowTemplatePicker(!showTemplatePicker); if (!showTemplatePicker) void loadTemplates(); }}
          >
            <div className="flex items-center gap-2.5">
              <div className="icon-box h-8 w-8 rounded-lg bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
                <svg className="h-4 w-4 text-tdai-teal-600 dark:text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <div className="text-left">
                <span className="text-sm font-semibold text-tdai-navy-800 dark:text-tdai-gray-100">Report Templates</span>
                <p className="text-[11px] text-tdai-gray-400 dark:text-tdai-gray-500">Quick-start with pre-built radiology templates</p>
              </div>
            </div>
            <svg className={`h-4 w-4 text-tdai-gray-400 transition-transform duration-200 dark:text-tdai-gray-500 ${showTemplatePicker ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {showTemplatePicker && (
            <div className="border-t border-tdai-gray-100 p-4 animate-slide-up dark:border-white/[0.08]">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {["all", ...categories].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setTemplateCategory(cat)}
                    className={`rounded-full px-3.5 py-1 text-[11px] font-medium transition-all duration-200 ${
                      templateCategory === cat ? "bg-tdai-teal-600 text-white shadow-sm" : "bg-tdai-gray-100 text-tdai-gray-500 hover:bg-tdai-gray-200 dark:bg-tdai-gray-800 dark:text-tdai-gray-400 dark:hover:bg-tdai-gray-700"
                    }`}
                  >
                    {cat === "all" ? "All" : cat}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="card-hover group p-3.5 text-left"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-sm font-semibold text-tdai-navy-800 group-hover:text-tdai-teal-700 transition-colors dark:text-tdai-gray-100 dark:group-hover:text-tdai-teal-400">{tpl.name}</span>
                      {tpl.isSystem && <span className="badge bg-tdai-teal-50 text-tdai-teal-700 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300">System</span>}
                    </div>
                    {(tpl.modality || tpl.bodyPart) && (
                      <div className="mt-1.5 flex gap-1">
                        {tpl.modality && <span className="badge bg-tdai-gray-100 text-tdai-gray-500 dark:bg-tdai-gray-800 dark:text-tdai-gray-400">{tpl.modality}</span>}
                        {tpl.bodyPart && <span className="badge bg-tdai-gray-100 text-tdai-gray-500 dark:bg-tdai-gray-800 dark:text-tdai-gray-400">{tpl.bodyPart}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Smart Dictate Control Panel ──────────────── */}
      {!isLocked && (
        <div className="card overflow-hidden border border-tdai-navy-100 bg-gradient-to-b from-tdai-navy-50/20 to-white dark:border-white/[0.08] dark:from-tdai-gray-800/10 dark:to-tdai-gray-900">
          <div className="p-5 flex flex-col md:flex-row items-center gap-6">
            {/* The Big Mic Button & Timer */}
            <div className="flex flex-col items-center justify-center">
              <button
                onClick={() => {
                  if (dictatePhase === "recording") {
                    stopDictation();
                  } else {
                    void startFullDictation();
                  }
                }}
                className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 shadow-lg ${
                  dictatePhase === "recording"
                    ? "bg-red-500 text-white hover:bg-red-600 scale-105 animate-pulse"
                    : dictatePhase === "transcribing" || dictatePhase === "generating"
                    ? "bg-tdai-teal-100 text-tdai-teal-600 pointer-events-none"
                    : "bg-gradient-to-br from-tdai-teal-500 to-tdai-navy-600 text-white hover:scale-105 hover:shadow-xl"
                }`}
                title={dictatePhase === "recording" ? "Stop dictation" : "Start dictating full report"}
              >
                {dictatePhase === "recording" ? (
                  // Stop icon
                  <svg className="h-8 w-8 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : dictatePhase === "transcribing" || dictatePhase === "generating" ? (
                  // Loading spinner
                  <svg className="h-8 w-8 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                ) : (
                  // Microphone icon
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-7a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}

                {/* Pulsing rings when recording */}
                {dictatePhase === "recording" && (
                  <>
                    <span className="absolute -inset-2 rounded-full border-2 border-red-500/30 animate-ping duration-1000" />
                    <span className="absolute -inset-4 rounded-full border-2 border-red-500/10 animate-ping duration-1000 delay-300" />
                  </>
                )}
              </button>
              
              <span className={`mt-2.5 text-xs font-mono font-bold ${dictatePhase === "recording" ? "text-red-500" : "text-tdai-gray-400"}`}>
                {dictatePhase === "recording" ? formatDuration(dictateDuration) : "0:00"}
              </span>
            </div>

            {/* SmartDictate Info & Action Steps */}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-tdai-navy-800 dark:text-tdai-gray-100 uppercase tracking-wide">
                  Smart Dictate Pipeline
                </h3>
                {dictateTemplate && (
                  <span className="rounded-full bg-tdai-teal-50 px-2.5 py-0.5 text-[10px] font-bold text-tdai-teal-700 ring-1 ring-tdai-teal-100 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300">
                    📂 {dictateTemplate}
                  </span>
                )}
                {dictateSource && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${dictateSource === "llm" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {dictateSource === "llm" ? "MedGemma Local" : "Rule-Based Fallback"}
                  </span>
                )}
              </div>

              {/* Status descriptions */}
              <div className="text-xs text-tdai-gray-500 dark:text-tdai-gray-400 min-h-[32px] flex items-center">
                {dictatePhase === "idle" && (
                  <span>Click the microphone to record your dictated findings. Speaks freely, the AI will automatically categorize findings, impression, and normal structures.</span>
                )}
                {dictatePhase === "recording" && (
                  <span className="flex items-center gap-2 text-red-500 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                    Listening... Speak findings freely. Click microphone again to stop and auto-fill report.
                  </span>
                )}
                {dictatePhase === "transcribing" && (
                  <span className="flex items-center gap-2 text-tdai-teal-600 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-600 animate-pulse" />
                    Transcribing dictation (MedASR Offline Engine)...
                  </span>
                )}
                {dictatePhase === "generating" && (
                  <span className="flex items-center gap-2 text-tdai-teal-600 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-600 animate-pulse" />
                    AI is structuring sections (MedGemma 4B via Ollama)...
                  </span>
                )}
                {dictatePhase === "done" && (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1.5">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Report structured successfully! Review the tabs below.
                  </span>
                )}
                {dictatePhase === "error" && dictateError === "mic_denied" && (
                  <span className="text-red-500 font-medium">Microphone access was denied. Please allow microphone permissions or type instead.</span>
                )}
                {dictatePhase === "error" && dictateError === "no_audio" && (
                  <span className="text-red-500 font-medium">Audio was too short. Please try dictating again.</span>
                )}
                {dictatePhase === "error" && dictateError === "transcribe_failed" && (
                  <span className="text-red-500 font-medium">Transcription failed. Please type your dictation in the fallback input box below.</span>
                )}
                {dictatePhase === "error" && dictateError === "no_speech" && (
                  <span className="text-red-500 font-medium">No speech detected. Please speak clearly into the microphone.</span>
                )}
              </div>

              {/* Display transcript preview */}
              {dictateTranscript && (
                <div className="rounded-lg bg-tdai-gray-50 p-2.5 dark:bg-tdai-gray-800 text-[11px] text-tdai-gray-600 dark:text-tdai-gray-300 font-medium max-h-[60px] overflow-y-auto">
                  <strong>Transcript Preview:</strong> "{dictateTranscript}"
                </div>
              )}

              {/* Measurements extracted */}
              {dictateMeasurements.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-tdai-gray-400">Measurements detected:</span>
                  {dictateMeasurements.map((m, i) => (
                    <span key={i} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-300">
                      📏 {m.text}
                    </span>
                  ))}
                </div>
              )}

              {/* Fallback Text Input if Speech Fails */}
              {(showFallbackInput || dictatePhase === "error") && (
                <div className="space-y-2 pt-2 border-t border-tdai-gray-100 dark:border-white/[0.08] animate-slide-up">
                  <textarea
                    rows={2}
                    className="input-field text-xs"
                    placeholder="Enter dictation text here... e.g. 'chest xray, cardiomegaly, lungs clear'"
                    value={fallbackText}
                    onChange={(e) => setFallbackText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-primary text-[10px] py-1.5"
                      onClick={() => void generateFromFallbackText()}
                      disabled={!fallbackText.trim() || dictatePhase === "generating"}
                    >
                      Process Text
                    </button>
                    <button className="btn-secondary text-[10px] py-1.5" onClick={resetDictate}>
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {dictatePhase === "done" && (
                <button onClick={resetDictate} className="text-xs text-tdai-teal-600 hover:text-tdai-teal-700 font-bold underline">
                  Dictate another study / Redo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Section Editor ───────────────── */}
      <div className={`card overflow-hidden ${expandedView ? "fixed inset-4 z-40 overflow-y-auto shadow-modal" : ""}`}>
        <div className="flex items-center border-b border-tdai-gray-100 bg-tdai-gray-50/50 dark:border-white/[0.08] dark:bg-tdai-gray-800/50">
          <div className="flex flex-1 overflow-x-auto">
            {sections.map((section) => {
              const hasContent = section.content.replace(/<[^>]*>/g, "").trim().length > 0;
              const isActive = activeTab === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setActiveTab(section.key)}
                  className={`group relative flex-shrink-0 px-4 py-3 text-[12px] font-semibold transition-all duration-200 ${
                    isActive
                      ? "text-tdai-teal-700 dark:text-tdai-teal-400"
                      : hasContent
                        ? "text-tdai-navy-600 hover:text-tdai-teal-600 dark:text-tdai-gray-300 dark:hover:text-tdai-teal-400"
                        : "text-tdai-gray-400 hover:text-tdai-gray-600 dark:text-tdai-gray-500 dark:hover:text-tdai-gray-400"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {SECTION_ICONS[section.key] && (
                      <svg className={`h-3.5 w-3.5 transition-colors ${isActive ? "text-tdai-teal-500 dark:text-tdai-teal-400" : "text-tdai-gray-300 group-hover:text-tdai-gray-400 dark:text-tdai-gray-600 dark:group-hover:text-tdai-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={SECTION_ICONS[section.key]} />
                      </svg>
                    )}
                    {hasContent && <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-400" />}
                    {section.title}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-tdai-teal-500 dark:bg-tdai-teal-400" />
                  )}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setExpandedView(!expandedView)}
            className="mr-2 rounded-lg p-1.5 text-tdai-gray-400 transition-colors hover:bg-tdai-gray-100 hover:text-tdai-navy-600 dark:text-tdai-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-tdai-gray-100"
            title={expandedView ? "Exit fullscreen" : "Expand editor"}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {expandedView
                ? <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              }
            </svg>
          </button>
        </div>

        {sections.map((section) => (
          <div key={section.key} className={activeTab === section.key ? "block" : "hidden"}>
            {/* Signature section */}
            {(section as any).is_signature ? (
              <div className="p-5 space-y-4">
                <div className="rounded-xl border border-tdai-gray-200 bg-tdai-gray-50/50 p-4 dark:border-white/[0.08] dark:bg-tdai-gray-800/50">
                  <p className="text-xs font-bold uppercase tracking-wider text-tdai-gray-400 dark:text-tdai-gray-500 mb-3">Electronic Signature</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-tdai-gray-500 dark:text-tdai-gray-400 mb-1">Radiologist Name</label>
                      <input className="input-field" placeholder="Dr. Full Name" defaultValue={(report as any).radiologistName ?? ""} disabled={isLocked} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-tdai-gray-500 dark:text-tdai-gray-400 mb-1">Qualification</label>
                      <input className="input-field" placeholder="MBBS, MD Radiology" disabled={isLocked} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-tdai-gray-500 dark:text-tdai-gray-400 mb-1">Date &amp; Time</label>
                      <input className="input-field" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} disabled={isLocked} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-tdai-gray-500 dark:text-tdai-gray-400 mb-1">Referring Physician</label>
                      <input className="input-field" placeholder="Dr. Name / Hospital" disabled={isLocked} />
                    </div>
                  </div>
                  {isLocked && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 dark:bg-emerald-900/20 dark:border-emerald-800">
                      <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Report is finalized and electronically signed.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {section.key === "impression" && (
                  <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-tdai-teal-50/60 border border-tdai-teal-200/60 px-3 py-2 dark:bg-tdai-teal-900/20 dark:border-tdai-teal-800/60">
                    <svg className="h-4 w-4 text-tdai-teal-500 dark:text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    <span className="text-[11px] font-medium text-tdai-teal-700 dark:text-tdai-teal-300">Key clinical section — this is the most important part of the report</span>
                  </div>
                )}
                {/* Per-section quick actions */}
                {!isLocked && (
                  <div className="mx-4 mt-3 flex items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-lg border border-tdai-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-tdai-gray-500 hover:border-emerald-400 hover:text-emerald-700 transition-all dark:border-white/[0.08] dark:bg-tdai-gray-800 dark:text-tdai-gray-400 dark:hover:border-emerald-600"
                      onClick={() => {
                        const normalMap: Record<string, string> = {
                          findings: "No significant abnormality identified.",
                          impression: "Normal study. No significant radiological abnormality.",
                          recommendation: "No immediate follow-up required.",
                          comparison: "No prior studies available for comparison.",
                        };
                        const text = normalMap[section.key] ?? "";
                        if (text) updateSection(section.key, `<p>${text}</p>`);
                      }}
                      title={`Insert normal ${section.title}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      Normal Preset
                    </button>
                  </div>
                )}
                <div className="p-4">
                  <TipTapEditor
                    content={section.content}
                    onChange={(html) => updateSection(section.key, html)}
                    placeholder={sectionPlaceholders[section.key] ?? `Enter ${section.title.toLowerCase()}...`}
                    editable={!isLocked}
                    autoFocus={activeTab === section.key && section.key === "findings"}
                    sectionTitle={section.title}
                    enableDictation={!isLocked}
                  />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Actions Bar ──────────────────── */}
      <div className="card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary actions */}
          {!isLocked && (
            <button
              className={`btn-primary ${!dirty ? "opacity-40 pointer-events-none shadow-none" : ""}`}
              disabled={!dirty || saving}
              onClick={() => void manualSave()}
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving...
                </span>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Save Report
                </>
              )}
            </button>
          )}

          {nextStatuses.map((ns) => (
            <button
              key={ns}
              className={ns === "final" ? "btn-navy" : "btn-secondary"}
              onClick={() => void changeStatus(ns)}
            >
              {ns === "final" ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Sign & Finalize
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {ns === "preliminary" ? "Mark Preliminary" : `Mark ${ns}`}
                </>
              )}
            </button>
          ))}
        </div>

        <div className="my-2.5 h-px bg-tdai-gray-100 dark:bg-white/[0.08]" />

        <div className="flex flex-wrap items-center gap-2">
          {/* Tools — Addendum always available; Attach only for editable reports */}
          {!isLocked && (
            <label className={`btn-secondary cursor-pointer py-2 text-xs ${attachUploading ? "opacity-50 pointer-events-none" : ""}`}>
              {attachUploading ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-tdai-gray-300 border-t-tdai-teal-500" />
                  Uploading...
                </span>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Attach Images
                </>
              )}
              <input className="hidden" type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple onChange={(e) => void uploadAttachment(e)} />
            </label>
          )}
          {status !== "cancelled" && (
            <>
              <AddendumModal reportId={report.id} onSaved={onRefresh} />
            </>
          )}

          <button
            className="btn-secondary py-2 text-xs"
            onClick={() => void markAsReported()}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Mark Reported
          </button>

          <div className="flex-1" />

          {/* Status indicators */}
          <div className="flex items-center gap-3 text-[11px]">
            {dirty && (
              <span className="flex items-center gap-1.5 text-tdai-red-500 dark:text-tdai-red-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tdai-red-400" />
                Unsaved changes
              </span>
            )}
            {lastSaved && !dirty && (
              <span className="flex items-center gap-1.5 text-tdai-teal-600 dark:text-tdai-teal-400">
                <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-400" />
                Saved {lastSaved}
              </span>
            )}
            {saving && (
              <span className="flex items-center gap-1.5 text-tdai-navy-400 dark:text-tdai-gray-400">
                <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-tdai-navy-200 border-t-tdai-navy-500 dark:border-tdai-gray-600 dark:border-t-tdai-gray-300" />
                Auto-saving
              </span>
            )}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className={`card px-5 py-3 text-sm font-medium animate-slide-up ${
          statusMessage.includes("Failed") || statusMessage.includes("failed")
            ? "bg-tdai-red-50 text-tdai-red-700 border-tdai-red-200 dark:bg-tdai-red-900/20 dark:text-tdai-red-300 dark:border-tdai-red-800"
            : "bg-tdai-teal-50 text-tdai-teal-700 border-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:border-tdai-teal-800"
        }`}>
          <span className="flex items-center gap-2">
            {statusMessage.includes("Failed") || statusMessage.includes("failed") ? (
              <svg className="h-4 w-4 text-tdai-red-500 dark:text-tdai-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            ) : (
              <svg className="h-4 w-4 text-tdai-teal-500 dark:text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
            )}
            {statusMessage}
          </span>
        </div>
      )}

      <ShareButton reportId={report.id} />

      {/* ── Audit Trail ──────────────────── */}
      <details className="card overflow-hidden">
        <summary className="cursor-pointer px-5 py-3.5 hover:bg-tdai-gray-50/50 transition-colors dark:hover:bg-white/[0.06]">
          <div className="inline-flex items-center gap-2">
            <div className="icon-box h-7 w-7 rounded-lg bg-tdai-navy-50 dark:bg-tdai-navy-900/40">
              <svg className="h-3.5 w-3.5 text-tdai-navy-500 dark:text-tdai-navy-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-bold text-tdai-navy-800 dark:text-tdai-gray-100">Audit Trail</span>
            <span className="badge bg-tdai-gray-100 text-tdai-gray-500 dark:bg-tdai-gray-800 dark:text-tdai-gray-400">{report.versions.length}</span>
          </div>
        </summary>
        <div className="border-t border-tdai-gray-100 px-5 py-3 dark:border-white/[0.08]">
          <ul className="space-y-1.5">
            {report.versions.map((v) => {
              const colors: Record<string, string> = {
                initial: "bg-tdai-teal-50 text-tdai-teal-700 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300",
                edit: "bg-tdai-navy-50 text-tdai-navy-700 dark:bg-tdai-navy-900/40 dark:text-tdai-gray-100",
                addendum: "bg-tdai-navy-100 text-tdai-navy-600 dark:bg-tdai-navy-900/50 dark:text-tdai-gray-300",
                sign: "bg-tdai-teal-100 text-tdai-teal-800 dark:bg-tdai-teal-900/30 dark:text-tdai-teal-300",
                "status-change": "bg-tdai-gray-100 text-tdai-gray-600 dark:bg-tdai-gray-800 dark:text-tdai-gray-400",
                share: "bg-tdai-teal-50 text-tdai-teal-600 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-400",
                attachment: "bg-tdai-gray-100 text-tdai-gray-600 dark:bg-tdai-gray-800 dark:text-tdai-gray-400",
              };
              return (
                <li key={v.id} className="flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-tdai-gray-50 dark:hover:bg-white/[0.06]">
                  <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${colors[v.type] ?? "bg-tdai-gray-100 text-tdai-gray-600 dark:bg-tdai-gray-800 dark:text-tdai-gray-400"}`}>
                    {v.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-tdai-navy-600 dark:text-tdai-gray-300">{v.content}</p>
                    <p className="text-[10px] text-tdai-gray-400 font-mono dark:text-tdai-gray-500">{v.createdAt}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </div>
  );
}

const sectionPlaceholders: Record<string, string> = {
  clinical_history: "e.g., 45-year-old male presenting with chest pain and shortness of breath...",
  comparison: "e.g., No prior studies available for comparison. / Compared to chest radiograph dated...",
  technique: "e.g., PA and lateral views of the chest were obtained. / CT with IV contrast...",
  findings: "Describe your findings here. Use the Macros button for quick normal-finding text...",
  impression: "Summarize the key diagnosis and clinical significance...",
  recommendation: "e.g., Recommend follow-up CT in 3 months. / Clinical correlation recommended...",
};
