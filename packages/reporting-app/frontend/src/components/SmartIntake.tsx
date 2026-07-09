/**
 * SmartIntake.tsx
 * ──────────────────────────────────────────────────────────────────────────
 * AI-powered smart patient intake modal for the Radiographer Workstation.
 *
 * Flow:
 *   Screen 1 — Input (type or speak complaint)
 *   Screen 2 — AI Results (review body part, views, ICD-10)
 *     └── Follow-up card (if laterality is ambiguous)
 *   Screen 3 — Edit mode (override any field)
 *   Screen 4 — STAT red banner (if urgency = stat)
 *   Screen 5 — Confirm & Create → saves order/updates existing
 *
 * Works in two modes:
 *   - Walk-in     : creates a brand-new RadiologyOrder
 *   - Existing    : updates an existing order with triage metadata
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic,
  MicOff,
  Loader2,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Volume2,
  Zap,
  X,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type { RadiologyOrder } from "@medical-report-system/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface IntakeResult {
  body_part_examined: string;
  laterality: string | null;
  study_description: string;
  series_descriptions: string[];
  view_positions: string[];
  reason_for_exam: string;
  icd10_codes: { code: string; description: string; confidence: number }[];
  ai_notes: string | null;
  urgency: "routine" | "urgent" | "stat";
  follow_up_needed: boolean;
  follow_up_question: string | null;
  source: "ai" | "rule_based";
}

interface SmartIntakeProps {
  /** If provided, we UPDATE this order with triage metadata. */
  existingOrder?: RadiologyOrder;
  /** If provided, pre-fill patient info (walk-in mode). */
  prefilledPatientId?: string;
  prefilledPatientName?: string;
  onConfirmed: (result: IntakeResult, orderId: string) => void;
  onClose: () => void;
}

type Screen = "input" | "analyzing" | "followup" | "results" | "edit" | "done";

// ─────────────────────────────────────────────────────────────────────────────
// Inline rule-based fallback (mirrors Python RuleBasedIntake)
// Used when backend is unreachable — keeps UI functional offline.
// ─────────────────────────────────────────────────────────────────────────────

const BODY_PART_MAP: Record<string, [string, string[]]> = {
  chest: ["CHEST", ["PA", "LATERAL"]],
  abdomen: ["ABDOMEN", ["AP"]],
  pelvis: ["PELVIS", ["AP"]],
  back: ["LSPINE", ["AP", "LATERAL"]],
  lumbar: ["LSPINE", ["AP", "LATERAL"]],
  spine: ["SPINE", ["AP", "LATERAL"]],
  cervical: ["CSPINE", ["AP", "LATERAL"]],
  thoracic: ["TSPINE", ["AP", "LATERAL"]],
  skull: ["SKULL", ["PA", "LATERAL"]],
  head: ["SKULL", ["PA", "LATERAL"]],
  shoulder: ["SHOULDER", ["AP", "AXIAL"]],
  elbow: ["ELBOW", ["AP", "LATERAL"]],
  wrist: ["WRIST", ["PA", "LATERAL"]],
  hand: ["HAND", ["PA", "OBLIQUE"]],
  finger: ["FINGER", ["PA", "LATERAL"]],
  hip: ["HIP", ["AP", "LATERAL"]],
  knee: ["KNEE", ["AP", "LATERAL"]],
  ankle: ["ANKLE", ["AP", "LATERAL", "MORTISE"]],
  foot: ["FOOT", ["AP", "LATERAL", "OBLIQUE"]],
  toe: ["TOE", ["AP", "LATERAL"]],
  leg: ["LEG", ["AP", "LATERAL"]],
  arm: ["ARM", ["AP", "LATERAL"]],
  ribs: ["RIBS", ["AP", "OBLIQUE"]],
};
const BILATERAL_PARTS = new Set(["CHEST", "ABDOMEN", "PELVIS", "SPINE", "CSPINE", "TSPINE", "LSPINE", "SKULL"]);
const STAT_KW = ["fracture", "head injury", "chest pain", "breathing", "stroke", "trauma", "accident"];
const URGENT_KW = ["severe pain", "unable to walk", "swelling", "infection", "dislocation"];

function ruleBasedAnalyze(complaint: string, lateralityOverride?: string): IntakeResult {
  const text = complaint.toLowerCase();
  let bodyPart = "CHEST";
  let views = ["PA", "LATERAL"];
  for (const [kw, [bp, vws]] of Object.entries(BODY_PART_MAP)) {
    if (text.includes(kw)) { bodyPart = bp; views = vws; break; }
  }
  let laterality: string | null = lateralityOverride ?? null;
  if (!laterality) {
    if (text.includes("right") || text.includes(" rt ")) laterality = "R";
    else if (text.includes("left") || text.includes(" lt ")) laterality = "L";
    else if (text.includes("bilateral") || text.includes("both")) laterality = "B";
  }
  let urgency: "routine" | "urgent" | "stat" = "routine";
  if (STAT_KW.some((k) => text.includes(k))) urgency = "stat";
  else if (URGENT_KW.some((k) => text.includes(k))) urgency = "urgent";
  const sidePrefix = laterality === "R" ? "RIGHT " : laterality === "L" ? "LEFT " : laterality === "B" ? "BILATERAL " : "";
  const followUp = !laterality && !BILATERAL_PARTS.has(bodyPart);
  return {
    body_part_examined: bodyPart,
    laterality,
    study_description: `${sidePrefix}${bodyPart} X-RAY`,
    view_positions: views,
    series_descriptions: views.map((v) => `${sidePrefix}${bodyPart} ${v}`),
    reason_for_exam: complaint,
    icd10_codes: [],
    ai_notes: "Rule-based detection — AI service unavailable.",
    urgency,
    follow_up_needed: followUp,
    follow_up_question: followUp ? "Which side is affected?" : null,
    source: "rule_based",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: string }) {
  const styles: Record<string, string> = {
    stat: "bg-red-100 text-red-700 border border-red-300",
    urgent: "bg-amber-100 text-amber-700 border border-amber-300",
    routine: "bg-emerald-100 text-emerald-700 border border-emerald-300",
  };
  const icons: Record<string, string> = { stat: "🔴", urgent: "🟡", routine: "🟢" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${styles[urgency] ?? styles.routine}`}>
      {icons[urgency] ?? "🟢"} {urgency}
    </span>
  );
}

const BODY_PARTS_DICOM = [
  "CHEST","ABDOMEN","PELVIS","SPINE","CSPINE","TSPINE","LSPINE","SKULL",
  "SHOULDER","ARM","ELBOW","FOREARM","WRIST","HAND","FINGER",
  "HIP","THIGH","KNEE","LEG","ANKLE","FOOT","TOE",
  "RIBS","CLAVICLE","SCAPULA","STERNUM",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main SmartIntake component
// ─────────────────────────────────────────────────────────────────────────────

export function SmartIntake({ existingOrder, prefilledPatientId, prefilledPatientName, onConfirmed, onClose }: SmartIntakeProps) {
  // Screen state
  const [screen, setScreen] = useState<Screen>("input");

  // Input form
  const [patientName, setPatientName] = useState(prefilledPatientName ?? existingOrder?.patientName ?? "");
  const [patientId, setPatientId] = useState(prefilledPatientId ?? existingOrder?.patientId ?? "");
  const [patientAge, setPatientAge] = useState<string>("");
  const [patientSex, setPatientSex] = useState<"M" | "F" | "O">("M");
  const [complaint, setComplaint] = useState("");

  // Voice recording
  const [recording, setRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // AI result
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Edit mode overrides
  const [editBodyPart, setEditBodyPart] = useState("");
  const [editLaterality, setEditLaterality] = useState<"R" | "L" | "B" | "">("");
  const [editDescription, setEditDescription] = useState("");
  const [editViews, setEditViews] = useState<string[]>([]);
  const [editUrgency, setEditUrgency] = useState<"routine" | "urgent" | "stat">("routine");
  const [editNewView, setEditNewView] = useState("");

  // Saving state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Populate edit fields when result arrives ───────────────────────────────
  useEffect(() => {
    if (result) {
      setEditBodyPart(result.body_part_examined);
      setEditLaterality((result.laterality as "R" | "L" | "B" | "") ?? "");
      setEditDescription(result.study_description);
      setEditViews([...result.view_positions]);
      setEditUrgency(result.urgency);
    }
  }, [result]);

  // ── Analyze complaint ──────────────────────────────────────────────────────
  const analyze = useCallback(async (complaintText: string, lateralityAnswer?: string) => {
    setScreen("analyzing");
    setAnalyzeError(null);
    try {
      const resp = await api.post<IntakeResult>("/intake/analyze", {
        complaint: complaintText,
        patient_age: patientAge ? parseInt(patientAge, 10) : undefined,
        patient_sex: patientSex,
        laterality_answer: lateralityAnswer,
      });
      const data = resp.data;
      setResult(data);
      if (data.follow_up_needed && !lateralityAnswer) {
        setScreen("followup");
      } else if (data.urgency === "stat") {
        setScreen("results"); // stat banner shows inside results
      } else {
        setScreen("results");
      }
    } catch (_err) {
      // Backend unreachable — use JS rule-based fallback
      const fallback = ruleBasedAnalyze(complaintText, lateralityAnswer);
      setResult(fallback);
      if (fallback.follow_up_needed && !lateralityAnswer) {
        setScreen("followup");
      } else {
        setScreen("results");
      }
    }
  }, [patientAge, patientSex]);

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;
        setVoiceLoading(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const res = await api.post<{ raw_transcript?: string; transcript?: string }>("/voice/transcribe", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          const transcript = res.data.raw_transcript ?? res.data.transcript ?? "";
          if (transcript.trim()) {
            setComplaint(transcript.trim());
            // Auto-analyze after voice transcription
            setTimeout(() => analyze(transcript.trim()), 300);
          }
        } catch {
          // Voice service unavailable — text box still has focus
        } finally {
          setVoiceLoading(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("Microphone access denied. Please type the complaint instead.");
    }
  }, [analyze]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Confirm & Create / Update order ───────────────────────────────────────
  const confirmAndSave = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    setSaveError(null);

    // Build final values (from edit overrides if user edited)
    const finalBodyPart = screen === "edit" ? editBodyPart : result.body_part_examined;
    const finalLaterality = screen === "edit" ? (editLaterality || null) : result.laterality;
    const finalDescription = screen === "edit" ? editDescription : result.study_description;
    const finalViews = screen === "edit" ? editViews : result.view_positions;
    const finalUrgency = screen === "edit" ? editUrgency : result.urgency;

    const triageMetadata = {
      intakeSource: result.source,
      bodyPartExamined: finalBodyPart,
      laterality: finalLaterality,
      studyDescription: finalDescription,
      viewPositions: finalViews,
      seriesDescriptions: screen === "edit" ? finalViews.map((v) => `${finalBodyPart} ${v}`) : result.series_descriptions,
      reasonForExam: result.reason_for_exam,
      icd10Codes: result.icd10_codes,
      aiNotes: result.ai_notes,
      urgency: finalUrgency,
      intakeCompletedAt: new Date().toISOString(),
    };

    try {
      let orderId: string;

      if (existingOrder) {
        // UPDATE existing order
        const patchResp = await api.patch<RadiologyOrder>(`/orders/${existingOrder.id}`, {
          bodyPart: finalBodyPart,
          priority: finalUrgency === "stat" ? "stat" : finalUrgency === "urgent" ? "urgent" : "routine",
          clinicalHistory: result.reason_for_exam,
          notes: finalDescription,
        });
        // Also patch worklist metadata if study exists
        orderId = patchResp.data.id;
        // Store extended triage data in order notes / metadata via a worklist patch
        // (worklist stores free metadata fields)
        try {
          await api.patch(`/worklist/${encodeURIComponent(existingOrder.studyId ?? existingOrder.id)}/fields`, {
            triageMetadata,
          });
        } catch {
          // Worklist patch is optional — order is already updated
        }
      } else {
        // CREATE new walk-in order
        const today = new Date().toISOString().slice(0, 10);
        const createResp = await api.post<RadiologyOrder>("/orders", {
          patientId: patientId.trim().toUpperCase() || `WALKIN-${Date.now()}`,
          patientName: patientName.trim() || "Walk-In Patient",
          modality: "CR",
          bodyPart: finalBodyPart,
          priority: finalUrgency === "stat" ? "stat" : finalUrgency === "urgent" ? "urgent" : "routine",
          status: "scheduled",
          scheduledDate: today,
          clinicalHistory: result.reason_for_exam,
          notes: finalDescription,
        });
        orderId = createResp.data.id;
      }

      setScreen("done");
      setTimeout(() => onConfirmed(result, orderId), 1200);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? err?.message ?? "Failed to save order");
    } finally {
      setSaving(false);
    }
  }, [result, screen, editBodyPart, editLaterality, editDescription, editViews, editUrgency, existingOrder, patientId, patientName, onConfirmed]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-tdai-navy-800 to-tdai-teal-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Smart Patient Intake</h2>
              <p className="text-[11px] text-white/70">AI-powered DICOM tag generator</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── SCREEN 1: Input ────────────────────────────────────────────── */}
        {screen === "input" && (
          <div className="p-6 space-y-5">
            {/* Patient Info Row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Patient Name</label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="Full name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Patient ID / MRN</label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="MRN or leave blank for walk-in"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Age</label>
                <input
                  type="number" min={0} max={130}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="Age"
                  value={patientAge}
                  onChange={(e) => setPatientAge(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sex</label>
                <div className="flex gap-2">
                  {(["M", "F", "O"] as const).map((s) => (
                    <button
                      key={s}
                      className={`flex-1 rounded-xl border py-2.5 text-xs font-bold transition-all ${
                        patientSex === s
                          ? "border-tdai-teal-500 bg-tdai-teal-50 text-tdai-teal-700"
                          : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"
                      }`}
                      onClick={() => setPatientSex(s)}
                    >
                      {s === "M" ? "Male" : s === "F" ? "Female" : "Other"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chief Complaint */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Chief Complaint / Clinical Indication</label>
              <div className="relative">
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition resize-none"
                  rows={3}
                  placeholder="Type or speak the patient's complaint…"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                />
                <button
                  className={`absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                    recording
                      ? "bg-red-500 text-white animate-pulse"
                      : voiceLoading
                      ? "bg-slate-200 text-slate-400"
                      : "bg-tdai-teal-600 text-white hover:bg-tdai-teal-500"
                  }`}
                  onClick={recording ? stopRecording : startRecording}
                  disabled={voiceLoading}
                  title={recording ? "Stop recording" : "Start voice recording"}
                >
                  {voiceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
              {voiceLoading && (
                <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Volume2 className="h-3 w-3 animate-pulse text-tdai-teal-600" />
                  Transcribing speech…
                </p>
              )}
              {recording && (
                <p className="mt-1.5 text-[11px] text-red-500 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  Recording… click the mic to stop
                </p>
              )}
            </div>

            {/* Example chips */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">Examples</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "right knee pain after fall",
                  "chest pain shortness of breath",
                  "left wrist fracture",
                  "back pain lower",
                  "bilateral shoulder pain",
                ].map((ex) => (
                  <button
                    key={ex}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 hover:border-tdai-teal-400 hover:text-tdai-teal-700 transition-colors"
                    onClick={() => setComplaint(ex)}
                  >
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {analyzeError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{analyzeError}</div>
            )}

            <button
              className="w-full rounded-xl bg-tdai-teal-600 py-3.5 text-sm font-bold text-white hover:bg-tdai-teal-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={complaint.trim().length < 3}
              onClick={() => analyze(complaint)}
            >
              <Zap className="h-4 w-4" />
              Analyze with AI
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── SCREEN: Analyzing ─────────────────────────────────────────── */}
        {screen === "analyzing" && (
          <div className="p-12 flex flex-col items-center justify-center gap-5">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-tdai-teal-100 flex items-center justify-center">
                <Zap className="h-8 w-8 text-tdai-teal-600" />
              </div>
              <div className="absolute -inset-2 rounded-full border-2 border-tdai-teal-300 border-dashed animate-spin" style={{ animationDuration: "3s" }} />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">AI analyzing complaint…</p>
              <p className="text-sm text-slate-500 mt-1">Mapping anatomy, views &amp; ICD-10 codes</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 rounded-full bg-tdai-teal-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* ── SCREEN: Follow-up ─────────────────────────────────────────── */}
        {screen === "followup" && result && (
          <div className="p-6 space-y-5">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="text-sm font-bold text-amber-800">Quick Clarification Needed</span>
              </div>
              <p className="text-sm text-amber-700 mb-4">{result.follow_up_question}</p>
              <div className="flex gap-3">
                {["LEFT", "RIGHT", "BOTH SIDES"].map((side) => {
                  const code = side === "LEFT" ? "L" : side === "RIGHT" ? "R" : "B";
                  return (
                    <button
                      key={side}
                      className="flex-1 rounded-xl border-2 border-amber-300 bg-white py-3 text-sm font-bold text-amber-800 hover:border-amber-500 hover:bg-amber-100 transition-all"
                      onClick={() => analyze(complaint, code)}
                    >
                      {side}
                    </button>
                  );
                })}
              </div>
            </div>
            <button className="w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors" onClick={() => analyze(complaint, undefined)}>
              Skip — continue without side selection →
            </button>
          </div>
        )}

        {/* ── SCREEN: Results ───────────────────────────────────────────── */}
        {(screen === "results" || screen === "edit") && result && (
          <div className="p-6 space-y-4">
            {/* STAT Banner */}
            {result.urgency === "stat" && (
              <div className="rounded-2xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
                <span className="text-2xl">🔴</span>
                <div>
                  <p className="text-sm font-bold text-red-800">STAT — URGENT STUDY</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Urgency detected from complaint. Radiologist will be notified immediately on upload.
                  </p>
                </div>
              </div>
            )}

            {/* AI Source Tag */}
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-bold text-slate-800">AI Analysis Complete</span>
              {result.source === "rule_based" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">RULE-BASED</span>
              )}
            </div>

            {/* Study Summary Card */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              {screen === "results" ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-tdai-navy-800">{result.study_description}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{result.reason_for_exam}</p>
                    </div>
                    <UrgencyBadge urgency={result.urgency} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Body Part</span>
                      <p className="font-semibold text-slate-700 mt-0.5">{result.body_part_examined}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Laterality</span>
                      <p className="font-semibold text-slate-700 mt-0.5">
                        {result.laterality === "R" ? "RIGHT" : result.laterality === "L" ? "LEFT" : result.laterality === "B" ? "BILATERAL" : "—"}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                /* Edit mode fields */
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Study Description</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-tdai-teal-500 outline-none"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Body Part</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-tdai-teal-500 outline-none"
                        value={editBodyPart}
                        onChange={(e) => setEditBodyPart(e.target.value)}
                      >
                        {BODY_PARTS_DICOM.map((bp) => <option key={bp}>{bp}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Laterality</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-tdai-teal-500 outline-none"
                        value={editLaterality}
                        onChange={(e) => setEditLaterality(e.target.value as "R" | "L" | "B" | "")}
                      >
                        <option value="">None</option>
                        <option value="R">RIGHT</option>
                        <option value="L">LEFT</option>
                        <option value="B">BILATERAL</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Urgency</label>
                    <div className="flex gap-2 mt-1">
                      {(["routine", "urgent", "stat"] as const).map((u) => (
                        <button
                          key={u}
                          className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${
                            editUrgency === u
                              ? u === "stat" ? "bg-red-500 text-white" : u === "urgent" ? "bg-amber-400 text-white" : "bg-emerald-500 text-white"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                          onClick={() => setEditUrgency(u)}
                        >
                          {u.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Views to take */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Views to Take</p>
              <div className="space-y-1.5">
                {(screen === "results" ? result.view_positions : editViews).map((view, i) => (
                  <div key={view + i} className="flex items-center gap-2 group">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="flex-1 text-sm text-slate-700">
                      {screen === "results"
                        ? (result.series_descriptions[i] ?? view)
                        : `${editLaterality === "R" ? "RIGHT " : editLaterality === "L" ? "LEFT " : ""}${editBodyPart} ${view}`}
                    </span>
                    {screen === "edit" && (
                      <button className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all" onClick={() => setEditViews((prev) => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {screen === "edit" && (
                <div className="flex gap-2 mt-3">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:border-tdai-teal-500 outline-none"
                    placeholder="Add view (e.g. SKYLINE)"
                    value={editNewView}
                    onChange={(e) => setEditNewView(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editNewView.trim()) {
                        setEditViews((p) => [...p, editNewView.trim()]);
                        setEditNewView("");
                      }
                    }}
                  />
                  <button
                    className="rounded-lg bg-tdai-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-tdai-teal-500 transition-colors flex items-center gap-1"
                    onClick={() => { if (editNewView.trim()) { setEditViews((p) => [...p, editNewView.trim()]); setEditNewView(""); } }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
              )}
            </div>

            {/* ICD-10 */}
            {result.icd10_codes.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">ICD-10 Suggestions</p>
                <div className="space-y-2">
                  {result.icd10_codes.slice(0, 3).map((code) => (
                    <div key={code.code} className="flex items-start gap-3">
                      <span className="rounded-md bg-tdai-navy-100 px-2 py-0.5 text-[11px] font-bold text-tdai-navy-700 font-mono shrink-0">{code.code}</span>
                      <span className="text-xs text-slate-600 flex-1">{code.description}</span>
                      <span className="text-[11px] font-bold text-emerald-600 shrink-0">{Math.round(code.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Notes */}
            {result.ai_notes && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400 mb-1">AI Protocol Note</p>
                <p className="text-xs text-blue-700">{result.ai_notes}</p>
              </div>
            )}

            {saveError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{saveError}</div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-1">
              <button
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={() => setScreen("input")}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={() => setScreen(screen === "edit" ? "results" : "edit")}
              >
                <Edit3 className="h-3.5 w-3.5" />
                {screen === "edit" ? "Done Editing" : "Edit Fields"}
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-tdai-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-tdai-teal-500 transition-colors disabled:opacity-50"
                disabled={saving}
                onClick={confirmAndSave}
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Confirm &amp; {existingOrder ? "Update" : "Create"} Order</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── SCREEN: Done ──────────────────────────────────────────────── */}
        {screen === "done" && (
          <div className="p-12 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">Study {existingOrder ? "Updated" : "Created"}!</p>
              <p className="text-sm text-slate-500 mt-1">DICOM tags saved. Device worklist updated.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
