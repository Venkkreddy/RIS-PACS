
/**
 * SmartIntake.tsx
 * AI-powered smart patient intake modal for the Radiographer Workstation.
 *
 * Flow:
 *   Input -> Analyzing -> Clarify (all questions at once with option buttons, max 4) -> Results (inline editable) -> Done
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic, MicOff, Loader2, ChevronRight, ChevronLeft,
  AlertTriangle, CheckCircle2, Edit3, Volume2, Zap,
  X, Plus, Trash2, Search, User,
} from "lucide-react";
import { api } from "../api/client";
import type { RadiologyOrder } from "@medical-report-system/shared";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AmbiguityItem {
  field: string;
  question: string;
  options: string[];
}

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
  ambiguities: AmbiguityItem[];
  follow_up_needed: boolean;
  follow_up_question: string | null;
  source: "ai" | "rule_based";
}

interface SmartIntakeProps {
  existingOrder?: RadiologyOrder;
  prefilledPatientId?: string;
  prefilledPatientName?: string;
  onConfirmed: (result: IntakeResult, orderId: string) => void;
  onClose: () => void;
}

type Screen = "input" | "analyzing" | "clarify" | "results" | "done";

// ── Rule-based fallback ──────────────────────────────────────────────────

const BODY_PART_MAP: Record<string, [string, string[]]> = {
  chest: ["CHEST", ["PA", "LATERAL"]], abdomen: ["ABDOMEN", ["AP"]],
  pelvis: ["PELVIS", ["AP"]], back: ["LSPINE", ["AP", "LATERAL"]],
  lumbar: ["LSPINE", ["AP", "LATERAL"]], spine: ["SPINE", ["AP", "LATERAL"]],
  cervical: ["CSPINE", ["AP", "LATERAL"]], skull: ["SKULL", ["PA", "LATERAL"]],
  head: ["SKULL", ["PA", "LATERAL"]], shoulder: ["SHOULDER", ["AP", "AXIAL"]],
  elbow: ["ELBOW", ["AP", "LATERAL"]], wrist: ["WRIST", ["PA", "LATERAL"]],
  hand: ["HAND", ["PA", "OBLIQUE"]], hip: ["HIP", ["AP", "LATERAL"]],
  knee: ["KNEE", ["AP", "LATERAL"]], ankle: ["ANKLE", ["AP", "LATERAL", "MORTISE"]],
  foot: ["FOOT", ["AP", "LATERAL", "OBLIQUE"]], leg: ["LEG", ["AP", "LATERAL"]],
  arm: ["ARM", ["AP", "LATERAL"]], ribs: ["RIBS", ["AP", "OBLIQUE"]],
  cycle: ["KNEE", ["AP", "LATERAL"]], bike: ["KNEE", ["AP", "LATERAL"]],
};
const BILATERAL_PARTS = new Set(["CHEST","ABDOMEN","PELVIS","SPINE","CSPINE","TSPINE","LSPINE","SKULL"]);
const STAT_KW = ["fracture","head injury","chest pain","breathing","stroke","trauma","accident"];
const URGENT_KW = ["severe pain","unable to walk","not able to walk","swelling","infection"];

function ruleBasedAnalyze(complaint: string, answers: Record<string, string> = {}): IntakeResult {
  const text = complaint.toLowerCase();
  let bodyPart = "CHEST"; let views = ["PA","LATERAL"];
  for (const [kw,[bp,vws]] of Object.entries(BODY_PART_MAP)) {
    if (text.includes(kw)) { bodyPart = bp; views = vws; break; }
  }
  let laterality: string|null = answers["laterality"] ?? null;
  if (!laterality) {
    if (text.includes("right")||text.includes(" rt ")) laterality="R";
    else if (text.includes("left")||text.includes(" lt ")) laterality="L";
    else if (text.includes("bilateral")||text.includes("both")) laterality="B";
  }
  let urgency: "routine"|"urgent"|"stat" = "routine";
  if (STAT_KW.some(k=>text.includes(k))) urgency="stat";
  else if (URGENT_KW.some(k=>text.includes(k))) urgency="urgent";
  const sp = laterality==="R"?"RIGHT ":laterality==="L"?"LEFT ":laterality==="B"?"BILATERAL ":"";
  const needsLat = !laterality && !BILATERAL_PARTS.has(bodyPart);
  const bpLabel = bodyPart.charAt(0)+bodyPart.slice(1).toLowerCase();
  const ambiguities: AmbiguityItem[] = needsLat ? [{
    field:"laterality",
    question: "Which " + bpLabel + " is affected?",
    options: ["Left " + bpLabel, "Right " + bpLabel, "Both sides"],
  }] : [];
  return {
    body_part_examined: bodyPart, laterality,
    study_description: sp + bodyPart + " X-RAY",
    view_positions: views,
    series_descriptions: views.map(v => sp + bodyPart + " " + v),
    reason_for_exam: complaint, icd10_codes: [],
    ai_notes: "Rule-based detection — AI service unavailable.",
    urgency, ambiguities, follow_up_needed: ambiguities.length > 0,
    follow_up_question: ambiguities[0]?.question ?? null, source:"rule_based",
  };
}

// ── Helper components ───────────────────────────────────────────────────────

const BODY_PARTS_DICOM = [
  "CHEST","ABDOMEN","PELVIS","SPINE","CSPINE","TSPINE","LSPINE","SKULL",
  "SHOULDER","ARM","ELBOW","FOREARM","WRIST","HAND","FINGER",
  "HIP","THIGH","KNEE","LEG","ANKLE","FOOT","TOE",
  "RIBS","CLAVICLE","SCAPULA","STERNUM",
];

// ── Main component ─────────────────────────────────────────────────────────

export function SmartIntake({ existingOrder, prefilledPatientId, prefilledPatientName, onConfirmed, onClose }: SmartIntakeProps) {
  const [screen, setScreen] = useState<Screen>("input");
  const [patientName, setPatientName] = useState(prefilledPatientName ?? existingOrder?.patientName ?? "");
  const [patientId, setPatientId] = useState(prefilledPatientId ?? existingOrder?.patientId ?? "");
  const [patientAge, setPatientAge] = useState<string>("");
  const [patientSex, setPatientSex] = useState<"M"|"F"|"O">("M");
  const [complaint, setComplaint] = useState("");

  const [nameMatches, setNameMatches] = useState<RadiologyOrder[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const [recording, setRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [result, setResult] = useState<IntakeResult|null>(null);
  const [analyzeError, setAnalyzeError] = useState<string|null>(null);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string,string>>({});

  const [editingField, setEditingField] = useState<string|null>(null);
  const [editBodyPart, setEditBodyPart] = useState("");
  const [editLaterality, setEditLaterality] = useState<"R"|"L"|"B"|"">("")
  const [editUrgency, setEditUrgency] = useState<"routine"|"urgent"|"stat">("routine");
  const [editViews, setEditViews] = useState<string[]>([]);
  const [editNewView, setEditNewView] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string|null>(null);
  // Background AI refinement
  const [aiRefining, setAiRefining] = useState(false);
  const [aiToast, setAiToast] = useState<string|null>(null);
  const aiAbortRef = useRef<AbortController|null>(null);

  useEffect(() => {
    if (result) {
      setEditBodyPart(result.body_part_examined);
      setEditLaterality((result.laterality as "R"|"L"|"B"|"" ) ?? "");
      setEditUrgency(result.urgency);
      setEditViews([...result.view_positions]);
    }
  }, [result]);

  const searchPatients = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setNameMatches([]); setShowNameDropdown(false); return; }
    setNameSearching(true);
    try {
      const resp = await api.get<any>("/orders?patientName=" + encodeURIComponent(query) + "&status=scheduled&limit=5");
      const orders: RadiologyOrder[] = resp.data?.orders ?? resp.data?.data ?? (Array.isArray(resp.data) ? resp.data : []);
      setNameMatches(orders.slice(0,5));
      setShowNameDropdown(orders.length > 0);
    } catch { setNameMatches([]); } finally { setNameSearching(false); }
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setPatientName(value);
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => searchPatients(value), 600);
  }, [searchPatients]);

  const selectPatientMatch = useCallback((order: RadiologyOrder) => {
    setPatientName(order.patientName ?? "");
    setPatientId(order.patientId ?? "");
    if (order.clinicalHistory) setComplaint(order.clinicalHistory);
    setShowNameDropdown(false); setNameMatches([]);
  }, []);

  const analyze = useCallback(async (complaintText: string, answers: Record<string,string> = {}) => {
    // Cancel any in-flight background AI call
    if (aiAbortRef.current) { aiAbortRef.current.abort(); aiAbortRef.current = null; }
    setAiToast(null);

    // Clean up ASR artifacts (</s> end-of-sequence token from MedASR)
    const cleanText = complaintText.replace(/<\/s>/gi, "").trim();

    // ── STEP 1: Show rule-based result INSTANTLY (<100ms) ─────────────────
    setAnalyzeError(null); setClarifyAnswers({});
    const instant = ruleBasedAnalyze(cleanText, answers);
    setResult(instant);
    setScreen(instant.ambiguities.length > 0 ? "clarify" : "results");

    // ── STEP 2: Fire AI call in background (max 8s) ────────────────────────
    // If AI responds with better info, update the card with a toast notification.
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiRefining(true);

    const aiTimeout = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await api.post<IntakeResult>("/intake/analyze", {
        complaint: cleanText,
        patient_age: patientAge ? parseInt(patientAge,10) : undefined,
        patient_sex: patientSex,
        clarification_answers: Object.keys(answers).length > 0 ? answers : undefined,
      }, { signal: controller.signal });
      clearTimeout(aiTimeout);
      const data = resp.data;
      if (!data.ambiguities) data.ambiguities = [];

      // Only use AI result if it clearly added value (source === 'ai' and different body part or ambiguities)
      if (data.source === "ai") {
        setResult(data);
        // If we're on clarify screen, update ambiguities
        if (data.ambiguities.length > 0) setScreen("clarify");
        else setScreen("results");
        // Show a brief toast notifying the radiographer AI refined the result
        const bodyChanged = data.body_part_examined !== instant.body_part_examined;
        const latChanged = data.laterality !== instant.laterality;
        if (bodyChanged || latChanged) {
          setAiToast(`✨ AI refined: ${data.body_part_examined}${data.laterality ? ` (${data.laterality === 'R' ? 'RIGHT' : data.laterality === 'L' ? 'LEFT' : 'BILATERAL'})` : ""}`);
          setTimeout(() => setAiToast(null), 4000);
        } else {
          setAiToast("✨ AI confirmed rule-based result");
          setTimeout(() => setAiToast(null), 2500);
        }
      }
    } catch {
      clearTimeout(aiTimeout);
      // Silently keep rule-based — radiographer already has a usable result
    } finally {
      setAiRefining(false);
      aiAbortRef.current = null;
    }
  }, [patientAge, patientSex]);

  const submitClarification = useCallback(() => {
    analyze(complaint, clarifyAnswers);
  }, [analyze, complaint, clarifyAnswers]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;
        setVoiceLoading(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const res = await api.post<{raw_transcript?:string;transcript?:string}>("/voice/transcribe", fd, { headers:{"Content-Type":"multipart/form-data"} });
          const transcript = res.data.raw_transcript ?? res.data.transcript ?? "";
          if (transcript.trim()) { setComplaint(transcript.trim()); setTimeout(() => analyze(transcript.trim()), 300); }
        } catch {} finally { setVoiceLoading(false); }
      };
      mr.start(); mediaRecorderRef.current = mr; setRecording(true);
    } catch { alert("Microphone access denied."); }
  }, [analyze]);

  const stopRecording = useCallback(() => { mediaRecorderRef.current?.stop(); setRecording(false); }, []);

  const confirmAndSave = useCallback(async () => {
    if (!result) return;
    setSaving(true); setSaveError(null);
    const bp = editBodyPart || result.body_part_examined;
    const lat = editLaterality || result.laterality;
    const side = lat==="R"?"RIGHT ":lat==="L"?"LEFT ":lat==="B"?"BILATERAL ":"";
    const views = editViews.length > 0 ? editViews : result.view_positions;
    const triageMetadata = {
      intakeSource: result.source, bodyPartExamined: bp, laterality: lat,
      studyDescription: side + bp + " X-RAY", viewPositions: views,
      seriesDescriptions: views.map(v => side + bp + " " + v),
      reasonForExam: result.reason_for_exam, icd10Codes: result.icd10_codes,
      aiNotes: result.ai_notes, urgency: editUrgency,
      intakeCompletedAt: new Date().toISOString(),
    };
    try {
      let orderId: string;
      if (existingOrder) {
        const patchResp = await api.patch<RadiologyOrder>("/orders/" + existingOrder.id, {
          bodyPart: bp,
          priority: editUrgency==="stat"?"stat":editUrgency==="urgent"?"urgent":"routine",
          clinicalHistory: result.reason_for_exam, notes: triageMetadata.studyDescription,
        });
        orderId = patchResp.data.id;
        try { await api.patch("/worklist/" + encodeURIComponent(existingOrder.studyId ?? existingOrder.id) + "/fields", { triageMetadata }); } catch {}
      } else {
        const createResp = await api.post<RadiologyOrder>("/orders", {
          patientId: patientId.trim().toUpperCase() || "WALKIN-" + Date.now(),
          patientName: patientName.trim() || "Walk-In Patient",
          modality: "CR", bodyPart: bp,
          priority: editUrgency==="stat"?"stat":editUrgency==="urgent"?"urgent":"routine",
          status: "scheduled", scheduledDate: new Date().toISOString().slice(0,10),
          clinicalHistory: result.reason_for_exam, notes: triageMetadata.studyDescription,
        });
        orderId = createResp.data.id;
      }
      setScreen("done");
      setTimeout(() => onConfirmed(result, orderId), 1200);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? err?.message ?? "Failed to save order");
    } finally { setSaving(false); }
  }, [result, editBodyPart, editLaterality, editUrgency, editViews, existingOrder, patientId, patientName, onConfirmed]);

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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20"><Zap className="h-4 w-4 text-white" /></div>
            <div>
              <h2 className="text-sm font-bold text-white">Smart Patient Intake</h2>
              <p className="text-[11px] text-white/70">AI-powered DICOM tag generator</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"><X className="h-4 w-4" /></button>
        </div>

        {/* SCREEN: Input */}
        {screen === "input" && (
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Patient Name</label>
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-9 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                    placeholder="Type name to search…"
                    value={patientName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onFocus={() => { if (nameMatches.length > 0) setShowNameDropdown(true); }}
                    onBlur={() => setTimeout(() => setShowNameDropdown(false), 200)}
                    autoComplete="off"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {nameSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </div>
                </div>
                {showNameDropdown && nameMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">Matching Scheduled Orders</p>
                    {nameMatches.map((order) => (
                      <button key={order.id} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-tdai-teal-50 text-left transition-colors" onMouseDown={() => selectPatientMatch(order)}>
                        <div className="h-7 w-7 rounded-full bg-tdai-teal-100 flex items-center justify-center shrink-0"><User className="h-3.5 w-3.5 text-tdai-teal-700" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{order.patientName}</p>
                          <p className="text-[10px] text-slate-400">MRN: {order.patientId} &middot; {order.bodyPart ?? "—"}</p>
                        </div>
                        <span className={"ml-auto text-[10px] font-bold rounded-full px-2 py-0.5 " + (order.priority==="stat"?"bg-red-100 text-red-700":order.priority==="urgent"?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-500")}>
                          {order.priority ?? "routine"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Patient ID / MRN</label>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="MRN or leave blank for walk-in" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Age</label>
                <input type="number" min={0} max={130}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="Age" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sex</label>
                <div className="flex gap-2">
                  {(["M","F","O"] as const).map((s) => (
                    <button key={s} onClick={() => setPatientSex(s)}
                      className={"flex-1 rounded-xl border py-2.5 text-xs font-bold transition-all " + (patientSex===s?"border-tdai-teal-500 bg-tdai-teal-50 text-tdai-teal-700":"border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300")}>
                      {s==="M"?"Male":s==="F"?"Female":"Other"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Chief Complaint / Clinical Indication</label>
              <div className="relative">
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition resize-none"
                  rows={3} placeholder="Type or speak the patient complaint…"
                  value={complaint} onChange={(e) => setComplaint(e.target.value)}
                />
                <button
                  className={"absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg transition-all " + (recording?"bg-red-500 text-white animate-pulse":voiceLoading?"bg-slate-200 text-slate-400":"bg-tdai-teal-600 text-white hover:bg-tdai-teal-500")}
                  onClick={recording ? stopRecording : startRecording} disabled={voiceLoading}>
                  {voiceLoading?<Loader2 className="h-4 w-4 animate-spin"/>:recording?<MicOff className="h-4 w-4"/>:<Mic className="h-4 w-4"/>}
                </button>
              </div>
              {voiceLoading && <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5"><Volume2 className="h-3 w-3 animate-pulse text-tdai-teal-600"/>Transcribing speech…</p>}
              {recording && <p className="mt-1.5 text-[11px] text-red-500 flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse"/>Recording… click mic to stop</p>}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">Quick Examples</p>
              <div className="flex flex-wrap gap-2">
                {["right knee pain after fall","chest pain shortness of breath","left wrist fracture","back pain lower","fell from cycle not able to walk"].map((ex) => (
                  <button key={ex} onClick={() => setComplaint(ex)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 hover:border-tdai-teal-400 hover:text-tdai-teal-700 transition-colors">
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {analyzeError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{analyzeError}</div>}

            <button className="w-full rounded-xl bg-tdai-teal-600 py-3.5 text-sm font-bold text-white hover:bg-tdai-teal-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={complaint.trim().length < 3} onClick={() => analyze(complaint)}>
              <Zap className="h-4 w-4"/>Analyze with AI<ChevronRight className="h-4 w-4"/>
            </button>
          </div>
        )}

        {/* SCREEN: Analyzing */}
        {screen === "analyzing" && (
          <div className="p-12 flex flex-col items-center justify-center gap-5">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-tdai-teal-100 flex items-center justify-center"><Zap className="h-8 w-8 text-tdai-teal-600"/></div>
              <div className="absolute -inset-2 rounded-full border-2 border-tdai-teal-300 border-dashed animate-spin" style={{animationDuration:"3s"}}/>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">AI analyzing complaint…</p>
              <p className="text-sm text-slate-500 mt-1">Mapping anatomy, views &amp; ICD-10 codes</p>
            </div>
            <div className="flex gap-1.5">
              {[0,1,2].map(i => <span key={i} className="h-2 w-2 rounded-full bg-tdai-teal-400 animate-bounce" style={{animationDelay: i*0.15 + "s"}}/>)}
            </div>
          </div>
        )}

        {/* SCREEN: Clarify — all questions at once, option buttons */}
        {screen === "clarify" && result && result.ambiguities.length > 0 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0"/>
              <div>
                <p className="text-sm font-bold text-amber-800">A few quick questions</p>
                <p className="text-xs text-amber-600 mt-0.5">Select an answer for each — takes just seconds.</p>
              </div>
            </div>

            <div className="space-y-4">
              {result.ambiguities.map((amb, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-tdai-teal-600 text-[10px] font-bold text-white mr-2">{idx+1}</span>
                    {amb.question}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {amb.options.map((opt) => {
                      const isSelected = clarifyAnswers[amb.field] === opt;
                      return (
                        <button key={opt}
                          onClick={() => setClarifyAnswers(prev => ({...prev, [amb.field]: opt}))}
                          className={"rounded-xl px-4 py-2 text-sm font-semibold border-2 transition-all " + (isSelected
                            ?"border-tdai-teal-500 bg-tdai-teal-600 text-white shadow-md"
                            :"border-slate-200 bg-slate-50 text-slate-700 hover:border-tdai-teal-400 hover:bg-tdai-teal-50")}>
                          {isSelected && <span className="mr-1.5">✓</span>}{opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                <div className="bg-tdai-teal-500 h-1.5 rounded-full transition-all"
                  style={{width: (Object.keys(clarifyAnswers).length/result.ambiguities.length*100) + "%"}}/>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">{Object.keys(clarifyAnswers).length} / {result.ambiguities.length} answered</span>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setScreen("input")}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5"/>Back
              </button>
              <button onClick={submitClarification}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-tdai-teal-600 py-2.5 text-sm font-bold text-white hover:bg-tdai-teal-500 transition-colors">
                <Zap className="h-4 w-4"/>Confirm &amp; Analyze<ChevronRight className="h-4 w-4"/>
              </button>
            </div>
            <button onClick={() => { setResult({...result, ambiguities:[]}); setScreen("results"); }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors py-1">
              Skip questions — use AI best guess &rarr;
            </button>
          </div>
        )}

        {/* SCREEN: Results (inline-editable) */}
        {screen === "results" && result && (
          <div className="p-6 space-y-4">
            {editUrgency === "stat" && (
              <div className="rounded-2xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
                <span className="text-2xl">🔴</span>
                <div>
                  <p className="text-sm font-bold text-red-800">STAT — URGENT STUDY</p>
                  <p className="text-xs text-red-600 mt-0.5">Radiologist will be notified immediately on upload.</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0"/>
              <span className="text-sm font-bold text-slate-800">Result Ready</span>
              {result.source === "rule_based" && !aiRefining && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">RULE-BASED</span>}
              {result.source === "ai" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ AI</span>}
              {aiRefining && (
                <span className="flex items-center gap-1.5 rounded-full bg-tdai-teal-50 border border-tdai-teal-200 px-2.5 py-0.5 text-[10px] font-semibold text-tdai-teal-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-500 animate-pulse"/>
                  AI refining in background…
                </span>
              )}
              {aiToast && (
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 animate-pulse">
                  {aiToast}
                </span>
              )}
              <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1"><Edit3 className="h-3 w-3"/>Click any field to edit</span>
            </div>


            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Body Part</span>
                  {editingField === "bodyPart" ? (
                    <div className="mt-1 flex gap-1.5">
                      <select className="flex-1 rounded-lg border border-tdai-teal-400 bg-white px-2 py-1.5 text-sm focus:outline-none ring-2 ring-tdai-teal-200"
                        value={editBodyPart} onChange={(e) => setEditBodyPart(e.target.value)} autoFocus>
                        {BODY_PARTS_DICOM.map(bp => <option key={bp}>{bp}</option>)}
                      </select>
                      <button className="rounded-lg bg-tdai-teal-600 px-2.5 text-white text-sm font-bold hover:bg-tdai-teal-500" onClick={() => setEditingField(null)}>&#10003;</button>
                    </div>
                  ) : (
                    <button className="mt-0.5 flex items-center gap-1.5 group" onClick={() => setEditingField("bodyPart")}>
                      <p className="font-semibold text-slate-700 text-sm">{editBodyPart}</p>
                      <Edit3 className="h-3 w-3 text-slate-300 group-hover:text-tdai-teal-500 transition-colors"/>
                    </button>
                  )}
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Laterality</span>
                  {editingField === "laterality" ? (
                    <div className="mt-1 flex gap-1.5">
                      <select className="flex-1 rounded-lg border border-tdai-teal-400 bg-white px-2 py-1.5 text-sm focus:outline-none ring-2 ring-tdai-teal-200"
                        value={editLaterality} onChange={(e) => setEditLaterality(e.target.value as "R"|"L"|"B"|"")} autoFocus>
                        <option value="">None</option>
                        <option value="R">RIGHT</option>
                        <option value="L">LEFT</option>
                        <option value="B">BILATERAL</option>
                      </select>
                      <button className="rounded-lg bg-tdai-teal-600 px-2.5 text-white text-sm font-bold hover:bg-tdai-teal-500" onClick={() => setEditingField(null)}>&#10003;</button>
                    </div>
                  ) : (
                    <button className="mt-0.5 flex items-center gap-1.5 group" onClick={() => setEditingField("laterality")}>
                      <p className="font-semibold text-slate-700 text-sm">{editLaterality==="R"?"RIGHT":editLaterality==="L"?"LEFT":editLaterality==="B"?"BILATERAL":"—"}</p>
                      <Edit3 className="h-3 w-3 text-slate-300 group-hover:text-tdai-teal-500 transition-colors"/>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Urgency</span>
                <div className="flex gap-2 mt-1.5">
                  {(["routine","urgent","stat"] as const).map((u) => (
                    <button key={u} onClick={() => setEditUrgency(u)}
                      className={"flex-1 rounded-xl border-2 py-2 text-xs font-bold transition-all " + (editUrgency===u
                        ?u==="stat"?"border-red-500 bg-red-500 text-white":u==="urgent"?"border-amber-400 bg-amber-400 text-white":"border-emerald-500 bg-emerald-500 text-white"
                        :"border-slate-200 bg-white text-slate-400 hover:border-slate-300")}>
                      {u.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reason for Exam</span>
                <p className="text-xs text-slate-500 mt-0.5">{result.reason_for_exam}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Views to Take</p>
              <div className="space-y-1.5">
                {editViews.map((view, i) => (
                  <div key={view+i} className="flex items-center gap-2 group">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0"/>
                    <span className="flex-1 text-sm text-slate-700">
                      {(editLaterality==="R"?"RIGHT ":editLaterality==="L"?"LEFT ":editLaterality==="B"?"BILATERAL ":"")+editBodyPart+" "+view}
                    </span>
                    <button className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all"
                      onClick={() => setEditViews(prev => prev.filter((_,idx) => idx!==i))}>
                      <Trash2 className="h-3.5 w-3.5"/>
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:border-tdai-teal-500 outline-none"
                  placeholder="Add view (e.g. SKYLINE)" value={editNewView}
                  onChange={(e) => setEditNewView(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key==="Enter"&&editNewView.trim()) { setEditViews(p=>[...p,editNewView.trim()]); setEditNewView(""); } }}/>
                <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 flex items-center gap-1"
                  onClick={() => { if (editNewView.trim()) { setEditViews(p=>[...p,editNewView.trim()]); setEditNewView(""); } }}>
                  <Plus className="h-3.5 w-3.5"/>Add
                </button>
              </div>
            </div>

            {result.icd10_codes.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">ICD-10 Suggestions</p>
                <div className="space-y-2">
                  {result.icd10_codes.slice(0,3).map((code) => (
                    <div key={code.code} className="flex items-start gap-3">
                      <span className="rounded-md bg-tdai-navy-100 px-2 py-0.5 text-[11px] font-bold text-tdai-navy-700 font-mono shrink-0">{code.code}</span>
                      <span className="text-xs text-slate-600 flex-1">{code.description}</span>
                      <span className="text-[11px] font-bold text-emerald-600 shrink-0">{Math.round(code.confidence*100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.ai_notes && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400 mb-1">AI Protocol Note</p>
                <p className="text-xs text-blue-700">{result.ai_notes}</p>
              </div>
            )}

            {saveError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{saveError}</div>}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => setScreen("input")}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5"/>Back
              </button>
              <button disabled={saving} onClick={confirmAndSave}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-tdai-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-tdai-teal-500 transition-colors disabled:opacity-50">
                {saving?<><Loader2 className="h-4 w-4 animate-spin"/>Saving…</>:<><CheckCircle2 className="h-4 w-4"/>Confirm &amp; {existingOrder?"Update":"Create"} Order</>}
              </button>
            </div>
          </div>
        )}

        {/* SCREEN: Done */}
        {screen === "done" && (
          <div className="p-12 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="h-8 w-8 text-emerald-600"/>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-slate-800">Study {existingOrder?"Updated":"Created"}!</p>
              <p className="text-sm text-slate-500 mt-1">DICOM tags saved. Device worklist updated.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
