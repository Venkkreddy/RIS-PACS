import { writeFileSync } from "fs";

const code = `import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Zap, Mic, MicOff, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, AlertTriangle, Edit3, Volume2, Plus, X,
} from "lucide-react";
import { api } from "../api/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ICD10 { code: string; description: string; confidence: number; }
interface QuestionOption {
  label: string; value: string;
  icon?: string; sublabel?: string;
}
interface FollowUpQuestion {
  id: string; question: string;
  type: "single_select" | "multi_select";
  required: boolean;
  options: QuestionOption[];
}
export interface IntakeResult {
  body_part_examined: string;
  laterality: string | null;
  study_description: string;
  view_positions: string[];
  series_descriptions: string[];
  reason_for_exam: string;
  icd10_codes: ICD10[];
  urgency: "routine" | "urgent" | "stat";
  ambiguities: FollowUpQuestion[];
  follow_up_needed: boolean;
  follow_up_question: string | null;
  ai_notes: string | null;
  confidence: number;
  source: string;
  is_pediatric?: boolean;
}
interface RadiologyOrder {
  id: string; patientName?: string; patientId?: string;
  clinicalHistory?: string; status?: string;
}

type Screen = "input" | "questioning" | "results";

// ─── Frontend instant rule-based (shows result before API returns) ────────────

function instantAnalyze(complaint: string, age?: number): Partial<IntakeResult> {
  const t = complaint.toLowerCase();
  const sides: Record<string,string|null> = { right:"R", left:"L", bilateral:"B", both:"B" };
  let laterality: string|null = null;
  for (const [kw, v] of Object.entries(sides)) {
    if (t.includes(kw)) { laterality = v; break; }
  }
  const PARTS: Record<string,[string,string[]]> = {
    knee:    ["KNEE",     ["AP","LATERAL"]],
    ankle:   ["ANKLE",    ["AP","LATERAL","MORTISE"]],
    wrist:   ["WRIST",    ["PA","LATERAL"]],
    elbow:   ["ELBOW",    ["AP","LATERAL"]],
    shoulder:["SHOULDER", ["AP","AXIAL"]],
    hip:     ["HIP",      ["AP","LATERAL"]],
    foot:    ["FOOT",     ["AP","LATERAL","OBLIQUE"]],
    hand:    ["HAND",     ["PA","OBLIQUE"]],
    chest:   ["CHEST",    ["PA","LATERAL"]],
    spine:   ["LSPINE",   ["AP","LATERAL"]],
    back:    ["LSPINE",   ["AP","LATERAL"]],
    neck:    ["CSPINE",   ["AP","LATERAL"]],
    skull:   ["SKULL",    ["PA","LATERAL"]],
  };
  let body = "CHEST", views = ["PA","LATERAL"];
  for (const [kw,[bp,vws]] of Object.entries(PARTS)) {
    if (t.includes(kw)) { body = bp; views = vws; break; }
  }
  // Cycle/bike + unable to walk → KNEE region
  if ((t.includes("cycle")||t.includes("bike")) && (t.includes("walk")||t.includes("leg"))) {
    body = "KNEE"; views = ["AP","LATERAL"];
  }
  const urgency: "routine"|"urgent"|"stat" =
    t.includes("road accident")||t.includes("rta")||t.includes("unconscious") ? "stat"
    : t.includes("unable to walk")||t.includes("not able to walk")||t.includes("fell")||
      t.includes("fracture")||t.includes("swelling")||t.includes("severe") ? "urgent"
    : "routine";
  const side = laterality==="R"?"RIGHT ":laterality==="L"?"LEFT ":laterality==="B"?"BILATERAL ":"";
  return {
    body_part_examined: body, laterality,
    study_description: side+body+" X-RAY",
    view_positions: views,
    series_descriptions: views.map(v => side+body+" "+v),
    reason_for_exam: complaint,
    urgency, icd10_codes: [], ai_notes: null,
    ambiguities: [], follow_up_needed: false, confidence: 0.6,
    source: "instant", is_pediatric: age !== undefined && age < 16,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface SmartIntakeProps { orderId?: string; onComplete?: (data: IntakeResult) => void; onClose?: () => void; }

export const SmartIntake: React.FC<SmartIntakeProps> = ({ orderId, onComplete, onClose }) => {
  // Patient info
  const [patientName, setPatientName]   = useState("");
  const [patientId,   setPatientId]     = useState(orderId || "");
  const [patientAge,  setPatientAge]    = useState("");
  const [patientSex,  setPatientSex]    = useState<"M"|"F"|"O">("M");
  const [complaint,   setComplaint]     = useState("");

  // Patient lookup
  const [nameMatches,       setNameMatches]       = useState<RadiologyOrder[]>([]);
  const [showNameDropdown,  setShowNameDropdown]  = useState(false);
  const [nameSearching,     setNameSearching]     = useState(false);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  // Voice
  const [recording,    setRecording]    = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRef  = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Screen & results
  const [screen,  setScreen]  = useState<Screen>("input");
  const [result,  setResult]  = useState<IntakeResult|null>(null);
  const [aiToast, setAiToast] = useState<string|null>(null);
  const [aiRefining, setAiRefining] = useState(false);
  const aiAbortRef = useRef<AbortController|null>(null);

  // Follow-up Q&A
  const [currentQIdx, setCurrentQIdx]   = useState(0);
  const [answers,     setAnswers]       = useState<Record<string,string|string[]>>({});
  const [multiSel,    setMultiSel]      = useState<string[]>([]);
  const questions = result?.ambiguities ?? [];

  // Edit mode (results screen)
  const [editingField,    setEditingField]    = useState<string|null>(null);
  const [editBodyPart,    setEditBodyPart]    = useState("");
  const [editLaterality,  setEditLaterality]  = useState<"R"|"L"|"B"|"">("");
  const [editUrgency,     setEditUrgency]     = useState<"routine"|"urgent"|"stat">("routine");
  const [editViews,       setEditViews]       = useState<string[]>([]);
  const [editNewView,     setEditNewView]     = useState("");
  const [saving,          setSaving]          = useState(false);
  const [saveError,       setSaveError]       = useState<string|null>(null);

  useEffect(() => {
    if (result) {
      setEditBodyPart(result.body_part_examined);
      setEditLaterality((result.laterality as "R"|"L"|"B"|"") ?? "");
      setEditUrgency(result.urgency);
      setEditViews([...result.view_positions]);
    }
  }, [result]);

  // ── Patient name search ────────────────────────────────────────────────────

  const searchPatients = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setNameMatches([]); setShowNameDropdown(false); return; }
    setNameSearching(true);
    try {
      const resp = await api.get<any>("/orders?patientName="+encodeURIComponent(q)+"&status=scheduled&limit=5");
      const orders: RadiologyOrder[] = resp.data?.orders ?? resp.data?.data ?? (Array.isArray(resp.data)?resp.data:[]);
      setNameMatches(orders.slice(0,5));
      setShowNameDropdown(orders.length > 0);
    } catch { setNameMatches([]); } finally { setNameSearching(false); }
  }, []);

  const handleNameChange = useCallback((v: string) => {
    setPatientName(v);
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => searchPatients(v), 500);
  }, [searchPatients]);

  const selectPatient = useCallback((o: RadiologyOrder) => {
    setPatientName(o.patientName ?? "");
    setPatientId(o.patientId ?? "");
    if (o.clinicalHistory) setComplaint(o.clinicalHistory);
    setShowNameDropdown(false);
  }, []);

  // ── Analyze ────────────────────────────────────────────────────────────────

  const analyze = useCallback(async (complaintText: string, clarAnswers?: Record<string,string>) => {
    if (aiAbortRef.current) { aiAbortRef.current.abort(); }
    setAiToast(null);
    const clean = complaintText.replace(/<\\/s>/gi,"").trim();
    const age   = patientAge ? parseInt(patientAge,10) : undefined;

    // Show instant result
    const instant = instantAnalyze(clean, age) as IntakeResult;
    instant.ambiguities = instant.ambiguities || [];
    setResult(instant);
    setCurrentQIdx(0);
    setAnswers({});
    setMultiSel([]);

    if (instant.ambiguities.length > 0) {
      setScreen("questioning");
    } else {
      setScreen("results");
    }

    // Background AI call
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    setAiRefining(true);
    try {
      const resp = await api.post<IntakeResult>("/intake/analyze", {
        complaint: clean,
        patient_age: age,
        patient_sex: patientSex,
        clarification_answers: clarAnswers && Object.keys(clarAnswers).length > 0 ? clarAnswers : undefined,
      }, { signal: ctrl.signal });
      const data = resp.data;
      if (!data.ambiguities) data.ambiguities = [];
      setResult(data);
      if (data.ambiguities.length > 0 && !clarAnswers) {
        setCurrentQIdx(0);
        setScreen("questioning");
      } else {
        setScreen("results");
      }
      const changed = data.body_part_examined !== instant.body_part_examined || data.laterality !== instant.laterality;
      if (data.source === "ai") {
        setAiToast(changed
          ? \`✨ AI refined: \${data.body_part_examined}\${data.laterality ? " ("+{R:"RIGHT",L:"LEFT",B:"BILATERAL"}[data.laterality]+")" : ""}\`
          : "✨ AI confirmed result"
        );
        setTimeout(() => setAiToast(null), 3500);
      }
    } catch { /* Silently keep instant result */ }
    finally { setAiRefining(false); aiAbortRef.current = null; }
  }, [patientAge, patientSex]);

  // ── Follow-up question navigation ─────────────────────────────────────────

  const handleSingleAnswer = useCallback((qid: string, value: string) => {
    const newAnswers = { ...answers, [qid]: value };
    setAnswers(newAnswers);

    if (currentQIdx + 1 < questions.length) {
      setCurrentQIdx(currentQIdx + 1);
      setMultiSel([]);
    } else {
      // All questions answered — refine
      const stringAnswers: Record<string,string> = {};
      for (const [k,v] of Object.entries(newAnswers)) {
        if (typeof v === "string") stringAnswers[k] = v;
        else if (Array.isArray(v)) stringAnswers[k] = v.join(",");
      }
      submitAnswers(stringAnswers);
    }
  }, [answers, currentQIdx, questions]);

  const handleMultiAnswer = useCallback((value: string) => {
    if (value === "NONE") {
      setMultiSel(["NONE"]);
    } else {
      setMultiSel(prev =>
        prev.includes(value) ? prev.filter(v=>v!==value) : [...prev.filter(v=>v!=="NONE"), value]
      );
    }
  }, []);

  const submitMulti = useCallback(() => {
    const q = questions[currentQIdx];
    if (!q) return;
    handleSingleAnswer(q.id, multiSel.join(","));
    setMultiSel([]);
  }, [currentQIdx, questions, multiSel, handleSingleAnswer]);

  const goBack = useCallback(() => {
    if (currentQIdx > 0) {
      setCurrentQIdx(currentQIdx - 1);
    } else {
      setScreen("input");
    }
  }, [currentQIdx]);

  const submitAnswers = useCallback(async (finalAnswers: Record<string,string>) => {
    setScreen("results"); // Show results immediately while refining
    setAiRefining(true);
    try {
      const resp = await api.post<IntakeResult>("/intake/refine", {
        original_complaint: complaint.replace(/<\\/s>/gi,"").trim(),
        answers: finalAnswers,
        patient_age: patientAge ? parseInt(patientAge,10) : undefined,
        patient_sex: patientSex,
      });
      const data = resp.data;
      if (!data.ambiguities) data.ambiguities = [];
      setResult(data);
      setAiToast("✅ Analysis updated with your answers");
      setTimeout(() => setAiToast(null), 3000);
    } catch {
      // keep existing result
    } finally { setAiRefining(false); }
  }, [complaint, patientAge, patientSex]);

  // ── Voice recording ────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        setVoiceLoading(true);
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const resp = await api.post<{ transcript?: string; raw_transcript?: string }>("/voice/transcribe", fd, {
            headers: { "Content-Type": "multipart/form-data" }
          });
          const text = (resp.data.transcript || resp.data.raw_transcript || "").replace(/<\\/s>/gi,"").trim();
          if (text) setComplaint(text);
        } catch { } finally { setVoiceLoading(false); }
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {}
  }, []);

  const stopRecording = useCallback(() => {
    mediaRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Save order ─────────────────────────────────────────────────────────────

  const saveOrder = useCallback(async () => {
    if (!result) return;
    setSaving(true); setSaveError(null);
    try {
      const side = editLaterality==="R"?"RIGHT ":editLaterality==="L"?"LEFT ":editLaterality==="B"?"BILATERAL ":"";
      const updated: IntakeResult = {
        ...result,
        body_part_examined: editBodyPart,
        laterality: editLaterality || null,
        urgency: editUrgency,
        view_positions: editViews,
        series_descriptions: editViews.map(v => side+editBodyPart+" "+v),
        study_description: side+editBodyPart+" X-RAY",
      };
      const targetId = existingOrder?.id || patientId;
      if (targetId) {
        await api.patch("/orders/" + targetId, {
          bodyPart: updated.body_part_examined,
          laterality: updated.laterality,
          priority: updated.urgency,
          clinicalHistory: updated.reason_for_exam,
          viewPositions: updated.view_positions,
          studyDescription: updated.study_description,
        });
      }
      onConfirmed?.(updated, targetId);
    } catch (e: any) {
      setSaveError(e?.response?.data?.message || e?.message || "Failed to save order");
    } finally { setSaving(false); }
  }, [result, editBodyPart, editLaterality, editUrgency, editViews, patientId, existingOrder, onConfirmed]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const urgencyColor = (u: string) =>
    u === "stat" ? "bg-red-100 text-red-700 border-red-300"
    : u === "urgent" ? "bg-amber-100 text-amber-700 border-amber-300"
    : "bg-emerald-100 text-emerald-700 border-emerald-300";

  const confidenceBadge = (c: number) => {
    const pct = Math.round(c * 100);
    const cls = c >= 0.8 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : c >= 0.6 ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-red-50 text-red-700 border-red-200";
    return <span className={\`rounded-full border px-2 py-0.5 text-[10px] font-bold \${cls}\`}>{pct}% confidence</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{maxHeight:"90vh"}} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-tdai-teal-800 to-tdai-teal-600">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
          <Zap className="h-5 w-5 text-white"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Smart Patient Intake</p>
          <p className="text-[11px] text-tdai-teal-200 leading-tight">AI-powered DICOM tag generator</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors">
            <X className="h-4 w-4"/>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── SCREEN: Input ───────────────────────────────────────────────── */}
        {screen === "input" && (
          <div className="p-5 space-y-4">
            {/* Patient name */}
            <div className="relative">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Patient Name</label>
              <div className="relative">
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="Search patient name…"
                  value={patientName}
                  onChange={e => handleNameChange(e.target.value)}
                  onBlur={() => setTimeout(() => setShowNameDropdown(false), 200)}
                />
                {nameSearching && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-tdai-teal-500"/>}
              </div>
              {showNameDropdown && nameMatches.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                  {nameMatches.map(o => (
                    <button key={o.id} onMouseDown={() => selectPatient(o)}
                      className="w-full text-left px-4 py-2.5 hover:bg-tdai-teal-50 transition-colors border-b border-slate-100 last:border-0">
                      <p className="text-sm font-semibold text-slate-800">{o.patientName}</p>
                      {o.patientId && <p className="text-xs text-slate-500">ID: {o.patientId}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Age + Sex */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Age</label>
                <input type="number" min={0} max={130}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition"
                  placeholder="Age" value={patientAge} onChange={e => setPatientAge(e.target.value)}/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sex</label>
                <div className="flex gap-2">
                  {(["M","F","O"] as const).map(s => (
                    <button key={s} onClick={() => setPatientSex(s)}
                      className={"flex-1 rounded-xl border py-2.5 text-xs font-bold transition-all "+(patientSex===s?"border-tdai-teal-500 bg-tdai-teal-50 text-tdai-teal-700":"border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300")}>
                      {s==="M"?"Male":s==="F"?"Female":"Other"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Complaint */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Chief Complaint / Clinical Indication</label>
              <div className="relative">
                <textarea
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 focus:border-tdai-teal-500 focus:ring-2 focus:ring-tdai-teal-500/20 outline-none transition resize-none"
                  rows={3} placeholder="Type or speak the patient complaint…"
                  value={complaint} onChange={e => setComplaint(e.target.value)}/>
                <button
                  className={"absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg transition-all "+(recording?"bg-red-500 text-white animate-pulse":voiceLoading?"bg-slate-200 text-slate-400":"bg-tdai-teal-600 text-white hover:bg-tdai-teal-500")}
                  onClick={recording ? stopRecording : startRecording} disabled={voiceLoading}>
                  {voiceLoading?<Loader2 className="h-4 w-4 animate-spin"/>:recording?<MicOff className="h-4 w-4"/>:<Mic className="h-4 w-4"/>}
                </button>
              </div>
              {voiceLoading && <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5"><Volume2 className="h-3 w-3 animate-pulse text-tdai-teal-600"/>Transcribing speech…</p>}
              {recording && <p className="mt-1.5 text-[11px] text-red-500 flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse"/>Recording… click mic to stop</p>}
            </div>

            {/* Quick examples */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">Quick Examples</p>
              <div className="flex flex-wrap gap-2">
                {["right knee pain after fall","chest pain shortness of breath","left wrist fracture","back pain lower","fell from cycle not able to walk"].map(ex => (
                  <button key={ex} onClick={() => setComplaint(ex)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 hover:border-tdai-teal-400 hover:text-tdai-teal-700 transition-colors">
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => { if (complaint.trim().length >= 3) analyze(complaint); }}
              disabled={complaint.trim().length < 3}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-tdai-teal-600 py-3.5 text-sm font-bold text-white hover:bg-tdai-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]">
              <Zap className="h-4 w-4"/>Analyze Complaint<ChevronRight className="h-4 w-4"/>
            </button>
          </div>
        )}

        {/* ── SCREEN: Follow-up questions (ONE AT A TIME) ─────────────────── */}
        {screen === "questioning" && result && questions.length > 0 && (
          <div className="p-5 space-y-5">
            {/* Progress */}
            <div className="flex items-center gap-3">
              <button onClick={goBack} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                <ChevronLeft className="h-4 w-4"/>Back
              </button>
              <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                <div className="bg-tdai-teal-500 h-1.5 rounded-full transition-all duration-300"
                  style={{width: \`\${((currentQIdx+1)/questions.length)*100}%\`}}/>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {currentQIdx+1} / {questions.length}
              </span>
            </div>

            {/* Question banner */}
            {(() => {
              const q = questions[currentQIdx];
              if (!q) return null;
              return (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-tdai-teal-200 bg-tdai-teal-50 px-5 py-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-4 w-4 text-tdai-teal-600"/>
                      <span className="text-xs font-bold text-tdai-teal-700 uppercase tracking-wider">Quick question</span>
                    </div>
                    <p className="text-base font-bold text-slate-800">{q.question}</p>
                  </div>

                  {/* Single select options */}
                  {q.type === "single_select" && (
                    <div className="grid grid-cols-2 gap-3">
                      {q.options.map(opt => (
                        <button key={opt.value}
                          onClick={() => handleSingleAnswer(q.id, opt.value)}
                          style={{minHeight:"70px"}}
                          className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-slate-200 bg-white px-3 py-4 text-center hover:border-tdai-teal-400 hover:bg-tdai-teal-50 active:scale-95 transition-all shadow-sm hover:shadow-md">
                          {opt.icon && <span className="text-2xl leading-none">{opt.icon}</span>}
                          <span className="text-sm font-bold text-slate-800 leading-tight">{opt.label}</span>
                          {opt.sublabel && <span className="text-[10px] text-slate-500 leading-tight">{opt.sublabel}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Multi select options */}
                  {q.type === "multi_select" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {q.options.map(opt => {
                          const sel = multiSel.includes(opt.value);
                          return (
                            <button key={opt.value}
                              onClick={() => handleMultiAnswer(opt.value)}
                              className={\`w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all \${sel?"border-tdai-teal-500 bg-tdai-teal-50":"border-slate-200 bg-white hover:border-tdai-teal-300"}\`}>
                              {opt.icon && <span className="text-xl">{opt.icon}</span>}
                              <span className={\`text-sm font-semibold \${sel?"text-tdai-teal-700":"text-slate-700"}\`}>{opt.label}</span>
                              {sel && <CheckCircle2 className="ml-auto h-4 w-4 text-tdai-teal-600"/>}
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={submitMulti} disabled={multiSel.length === 0}
                        className="w-full rounded-xl bg-tdai-teal-600 py-3 text-sm font-bold text-white hover:bg-tdai-teal-500 disabled:opacity-40 transition-all">
                        Continue <ChevronRight className="inline h-4 w-4"/>
                      </button>
                    </div>
                  )}

                  {/* Skip */}
                  <button onClick={() => handleSingleAnswer(q.id, "UNSURE")}
                    className="w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors py-1">
                    Not sure — use best guess →
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SCREEN: Results (inline editable) ──────────────────────────── */}
        {screen === "results" && result && (
          <div className="p-5 space-y-4">
            {/* STAT banner */}
            {editUrgency === "stat" && (
              <div className="rounded-2xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
                <span className="text-2xl">🔴</span>
                <div>
                  <p className="text-sm font-bold text-red-800">STAT — URGENT STUDY</p>
                  <p className="text-xs text-red-600 mt-0.5">Radiologist will be notified immediately on upload.</p>
                </div>
              </div>
            )}

            {/* Pediatric warning */}
            {result.is_pediatric && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0"/>
                <p className="text-xs text-amber-800 font-semibold">
                  ⚠ Pediatric patient — growth plate injury possible. Use appropriate technique and radiation protection.
                </p>
              </div>
            )}

            {/* Status row */}
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0"/>
              <span className="text-sm font-bold text-slate-800">Result Ready</span>
              {result.source==="instant" && !aiRefining && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">INSTANT</span>}
              {result.source==="ai" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ AI</span>}
              {result.confidence !== undefined && confidenceBadge(result.confidence)}
              {aiRefining && (
                <span className="flex items-center gap-1.5 rounded-full bg-tdai-teal-50 border border-tdai-teal-200 px-2.5 py-0.5 text-[10px] font-semibold text-tdai-teal-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-tdai-teal-500 animate-pulse"/>AI refining…
                </span>
              )}
              {aiToast && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {aiToast}
                </span>
              )}
              <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1">
                <Edit3 className="h-3 w-3"/>Click to edit
              </span>
            </div>

            {/* Result card */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Body part */}
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Body Part</span>
                  {editingField==="bodyPart" ? (
                    <input autoFocus className="mt-1 w-full rounded-xl border border-tdai-teal-400 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none"
                      value={editBodyPart} onChange={e=>setEditBodyPart(e.target.value.toUpperCase())}
                      onBlur={()=>setEditingField(null)}/>
                  ) : (
                    <button onClick={()=>setEditingField("bodyPart")}
                      className="mt-1 flex items-center gap-2 text-base font-bold text-slate-800 hover:text-tdai-teal-600 transition-colors">
                      {editBodyPart || "—"}<Edit3 className="h-3.5 w-3.5 text-slate-400"/>
                    </button>
                  )}
                </div>

                {/* Laterality */}
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Laterality</span>
                  <div className="mt-1 flex gap-1.5">
                    {(["L","R","B",""] as const).map(l => (
                      <button key={l} onClick={()=>setEditLaterality(l)}
                        className={"rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all "+(editLaterality===l?"border-tdai-teal-500 bg-tdai-teal-500 text-white":"border-slate-200 bg-white text-slate-500 hover:border-tdai-teal-300")}>
                        {l===""?"—":l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Urgency */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Urgency</span>
                <div className="mt-2 flex gap-2">
                  {(["routine","urgent","stat"] as const).map(u => (
                    <button key={u} onClick={()=>setEditUrgency(u)}
                      className={\`flex-1 rounded-xl border py-2.5 text-xs font-bold uppercase tracking-wide transition-all \${editUrgency===u?urgencyColor(u)+" border-current":"border-slate-200 bg-white text-slate-400 hover:border-slate-300"}\`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reason for Exam</span>
                <p className="mt-1 text-sm text-slate-700">{result.reason_for_exam}</p>
              </div>
            </div>

            {/* Views */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Views to Take</span>
              <div className="space-y-1.5">
                {editViews.map((v,i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0"/>
                    <span className="text-sm font-semibold text-slate-700 flex-1">
                      {(editLaterality==="R"?"RIGHT ":editLaterality==="L"?"LEFT ":editLaterality==="B"?"BILATERAL ":"")}{editBodyPart} {v}
                    </span>
                    <button onClick={()=>setEditViews(prev=>prev.filter((_,j)=>j!==i))}
                      className="text-slate-300 hover:text-red-400 transition-colors"><X className="h-3.5 w-3.5"/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-tdai-teal-400"
                  placeholder="Add view (e.g. SKYLINE)" value={editNewView}
                  onChange={e=>setEditNewView(e.target.value.toUpperCase())}
                  onKeyDown={e=>{ if(e.key==="Enter"&&editNewView.trim()){setEditViews(p=>[...p,editNewView.trim()]);setEditNewView(""); } }}/>
                <button onClick={()=>{ if(editNewView.trim()){setEditViews(p=>[...p,editNewView.trim()]);setEditNewView(""); } }}
                  className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  <Plus className="h-3.5 w-3.5"/>Add
                </button>
              </div>
            </div>

            {/* ICD-10 */}
            {result.icd10_codes.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">ICD-10 Codes</span>
                <div className="mt-2 space-y-1.5">
                  {result.icd10_codes.slice(0,2).map((c,i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-xs font-mono font-bold text-tdai-teal-700">{c.code}</span>
                      <span className="text-xs text-slate-600">{c.description}</span>
                      <span className="ml-auto text-[10px] text-slate-400">{Math.round(c.confidence*100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Protocol Note */}
            {result.ai_notes && (
              <div className="rounded-2xl border border-tdai-teal-100 bg-tdai-teal-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-tdai-teal-600 mb-1">AI Protocol Note</p>
                <p className="text-xs text-tdai-teal-800">{result.ai_notes}</p>
              </div>
            )}

            {/* Low confidence warning */}
            {result.confidence !== undefined && result.confidence < 0.6 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0"/>
                <p className="text-xs text-amber-800">
                  <strong>AI confidence: {Math.round(result.confidence*100)}%</strong> — please verify body part and views before scanning.
                </p>
              </div>
            )}

            {saveError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{saveError}</div>}

            {/* Actions */}
            <div className="flex gap-3 pb-2">
              <button onClick={()=>setScreen("input")}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5"/>Back
              </button>
              <button onClick={saveOrder} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-tdai-teal-600 py-2.5 text-sm font-bold text-white hover:bg-tdai-teal-500 disabled:opacity-60 transition-colors">
                {saving?<Loader2 className="h-4 w-4 animate-spin"/>:<CheckCircle2 className="h-4 w-4"/>}
                {saving?"Saving…":"Confirm & Update Order"}
              </button>
            </div>
          </div>
        )}

      </div>
      </div>
    </div>
  );
};

export default SmartIntake;
`;

writeFileSync(
  "d:/TDAI/ris-pacs/metupalle-jpg/tdai/packages/reporting-app/frontend/src/components/SmartIntake.tsx",
  code, "utf-8"
);
console.log("SmartIntake.tsx written OK");
