import { FormEvent, useEffect, useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import axios from "axios";
import { api } from "../api/client";
import { firebaseAuth, firebaseConfigIssues, firebaseConfigReady, googleProvider } from "../lib/firebase";
import { markExplicitSession } from "../hooks/useAuthRole";

function debugLoginLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = "run-1",
) {
  fetch("http://127.0.0.1:7829/ingest/0823df88-6411-4f3d-9920-ebf0779efd31", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b161f5",
    },
    body: JSON.stringify({
      sessionId: "b161f5",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // #region agent log
    debugLoginLog("H7", "LoginPage.tsx:mount", "login page mounted", {
      path: typeof window !== "undefined" ? window.location.pathname : "unknown",
    });
    // #endregion
  }, []);

  function redirectAfterLogin() {
    markExplicitSession();
    window.location.replace("/home");
  }

  function toErrorMessage(value: unknown): string {
    if (axios.isAxiosError(value)) {
      const data = value.response?.data as { message?: unknown; error?: unknown } | undefined;
      if (typeof data?.message === "string" && data.message.trim().length > 0) {
        return data.message;
      }
      if (typeof data?.error === "string" && data.error.trim().length > 0) {
        return data.error;
      }
    }
    if (typeof value === "object" && value !== null) {
      const maybeMessage = "message" in value ? value.message : undefined;
      if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;
    }
    return "Authentication failed. Please try again.";
  }

  async function syncSessionFromFirebaseUser() {
    if (!firebaseAuth) throw new Error("Firebase auth is unavailable");
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error("No authenticated user");
    const idToken = await user.getIdToken();
    await api.post("/auth/firebase-login", { idToken });
  }

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    if (!firebaseConfigReady || !firebaseAuth) {
      setError(`Firebase config missing: ${firebaseConfigIssues.join(", ")}`);
      setLoading(false);
      return;
    }

    try {
      if (mode === "register") {
        await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await syncSessionFromFirebaseUser();
        try {
          await api.post("/auth/register-request", { role: "radiographer" });
        } catch {
          // Account is still usable; this request only marks the email for admin review.
        }
        setMessage("Account created. Admin can assign role access for this email.");
        redirectAfterLogin();
        return;
      }

      await signInWithEmailAndPassword(firebaseAuth, email, password);
      await syncSessionFromFirebaseUser();
      redirectAfterLogin();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loginWithGoogle() {
    setError(null);
    setMessage(null);
    setLoading(true);

    if (!firebaseConfigReady || !firebaseAuth) {
      setError(`Firebase config missing: ${firebaseConfigIssues.join(", ")}`);
      setLoading(false);
      return;
    }

    try {
      await signInWithPopup(firebaseAuth, googleProvider);
      await syncSessionFromFirebaseUser();
      redirectAfterLogin();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const features = [
    { text: "DICOM-native PACS integration", icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" },
    { text: "AI-assisted structured reporting", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { text: "End-to-end billing & scheduling", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  ];

  const stats = [
    { value: "50K+", label: "Reports generated" },
    { value: "99.9%", label: "Platform uptime" },
    { value: "<15m", label: "Avg. turnaround" },
  ];

  const complianceBadges = ["DICOM", "HL7 FHIR", "HIPAA"];

  return (
    <div className="flex min-h-screen bg-white">
      {/* ─── Left Brand Panel ─── */}
      <div
        className="relative hidden w-[52%] flex-col overflow-hidden lg:flex"
        style={{ background: "linear-gradient(160deg, #050912 0%, #0A1125 30%, #1A2B56 65%, #111D3B 100%)" }}
      >
        {/* Animated gradient orbs */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute -left-36 -top-36 h-[550px] w-[550px] rounded-full opacity-[0.18] orb-drift"
            style={{ background: "radial-gradient(circle, #00B4A6 0%, transparent 65%)" }}
          />
          <div
            className="absolute -bottom-52 -right-52 h-[650px] w-[650px] rounded-full opacity-[0.09] orb-drift-delay"
            style={{ background: "radial-gradient(circle, #E03C31 0%, transparent 60%)" }}
          />
          <div
            className="absolute left-[35%] top-[20%] h-[320px] w-[320px] rounded-full opacity-[0.06] orb-drift-slow"
            style={{ background: "radial-gradient(circle, #00B4A6 0%, transparent 70%)" }}
          />
        </div>

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.035]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }} />

        {/* ECG heartbeat line */}
        <div className="absolute left-0 right-0 top-[42%] opacity-[0.10]">
          <svg viewBox="0 0 1200 80" className="w-full" preserveAspectRatio="none">
            <path
              d="M0,40 L180,40 L198,40 L208,16 L218,64 L228,6 L238,74 L248,40 L266,40 L450,40 L468,40 L478,18 L488,62 L498,8 L508,72 L518,40 L536,40 L720,40 L738,40 L748,16 L758,64 L768,6 L778,74 L788,40 L806,40 L990,40 L1008,40 L1018,18 L1028,62 L1038,8 L1048,72 L1058,40 L1076,40 L1200,40"
              fill="none"
              stroke="#00B4A6"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ecg-heartbeat"
            />
          </svg>
        </div>

        {/* Scan sweep line */}
        <div
          className="absolute left-0 right-0 h-px scan-line-sweep"
          style={{ background: "linear-gradient(90deg, transparent 0%, rgba(0,180,166,0.35) 30%, rgba(0,180,166,0.5) 50%, rgba(0,180,166,0.35) 70%, transparent 100%)" }}
        />

        {/* RIS/PACS medical imaging illustration */}
        <div className="absolute right-6 top-[15%] opacity-[0.07] xl:right-10 2xl:right-14 pacs-float" aria-hidden="true">
          <svg width="320" height="360" viewBox="0 0 320 360" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Monitor frame */}
            <rect x="30" y="20" width="260" height="200" rx="14" stroke="white" strokeWidth="2" />
            <rect x="30" y="20" width="260" height="200" rx="14" fill="white" fillOpacity="0.03" />
            <rect x="38" y="28" width="244" height="175" rx="8" stroke="white" strokeWidth="1" strokeOpacity="0.5" />

            {/* Monitor stand */}
            <path d="M130 220 L130 260 L100 280 L220 280 L190 260 L190 220" stroke="white" strokeWidth="1.5" fill="none" />
            <line x1="100" y1="280" x2="220" y2="280" stroke="white" strokeWidth="2" strokeLinecap="round" />

            {/* Chest X-ray silhouette inside monitor */}
            {/* Ribcage outline */}
            <path d="M160 60 C160 60 125 75 120 110 C118 130 125 160 135 175 L160 185 L185 175 C195 160 202 130 200 110 C195 75 160 60 160 60Z" stroke="white" strokeWidth="1.2" fill="white" fillOpacity="0.04" />
            {/* Spine */}
            <line x1="160" y1="65" x2="160" y2="190" stroke="white" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="4 3" />
            {/* Left ribs */}
            <path d="M157 80 C145 83 130 92 126 100" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M157 92 C145 95 128 103 124 112" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M157 104 C145 107 127 115 123 124" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M157 116 C145 119 127 127 124 136" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M157 128 C145 131 128 139 126 148" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M157 140 C147 143 133 149 130 157" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            {/* Right ribs */}
            <path d="M163 80 C175 83 190 92 194 100" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M163 92 C175 95 192 103 196 112" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M163 104 C175 107 193 115 197 124" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M163 116 C175 119 193 127 196 136" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M163 128 C175 131 192 139 194 148" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M163 140 C173 143 187 149 190 157" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
            {/* Heart silhouette */}
            <ellipse cx="150" cy="120" rx="18" ry="24" stroke="white" strokeWidth="0.8" strokeOpacity="0.4" fill="white" fillOpacity="0.02" />
            {/* Lung fields */}
            <ellipse cx="133" cy="115" rx="22" ry="38" stroke="white" strokeWidth="0.6" strokeOpacity="0.25" fill="none" />
            <ellipse cx="187" cy="115" rx="22" ry="38" stroke="white" strokeWidth="0.6" strokeOpacity="0.25" fill="none" />

            {/* DICOM overlay labels */}
            <text x="44" y="44" fill="white" fillOpacity="0.5" fontSize="7" fontFamily="monospace">PA CHEST</text>
            <text x="44" y="54" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace">W: 2000 L: 400</text>
            <text x="230" y="44" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="end">512 x 512</text>
            <text x="230" y="54" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="end">DICOM 3.0</text>
            <text x="44" y="192" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace">1.2.840.10008</text>
            <text x="230" y="192" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="end">IMG: 1/48</text>

            {/* Measurement line across lung */}
            <line x1="120" y1="100" x2="200" y2="100" stroke="#00B4A6" strokeWidth="0.7" strokeOpacity="0.5" strokeDasharray="3 2" />
            <circle cx="120" cy="100" r="2" fill="#00B4A6" fillOpacity="0.5" />
            <circle cx="200" cy="100" r="2" fill="#00B4A6" fillOpacity="0.5" />
            <text x="155" y="96" fill="#00B4A6" fillOpacity="0.6" fontSize="6" fontFamily="monospace" textAnchor="middle">12.4 cm</text>

            {/* Floating PACS thumbnails */}
            <rect x="0" y="300" width="52" height="42" rx="5" stroke="white" strokeWidth="1" strokeOpacity="0.5" fill="white" fillOpacity="0.03" />
            <text x="26" y="325" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="middle">SAG</text>
            <rect x="62" y="300" width="52" height="42" rx="5" stroke="#00B4A6" strokeWidth="1.2" strokeOpacity="0.5" fill="#00B4A6" fillOpacity="0.04" />
            <text x="88" y="325" fill="#00B4A6" fillOpacity="0.5" fontSize="6" fontFamily="monospace" textAnchor="middle">COR</text>
            <rect x="124" y="300" width="52" height="42" rx="5" stroke="white" strokeWidth="1" strokeOpacity="0.5" fill="white" fillOpacity="0.03" />
            <text x="150" y="325" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="middle">AXL</text>
            <rect x="186" y="300" width="52" height="42" rx="5" stroke="white" strokeWidth="1" strokeOpacity="0.5" fill="white" fillOpacity="0.03" />
            <text x="212" y="325" fill="white" fillOpacity="0.35" fontSize="6" fontFamily="monospace" textAnchor="middle">3D</text>

            {/* Crosshair on scan */}
            <line x1="160" y1="105" x2="160" y2="135" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.35" />
            <line x1="145" y1="120" x2="175" y2="120" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.35" />
            <circle cx="160" cy="120" r="8" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.3" fill="none" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-1 flex-col justify-between px-12 py-12 xl:px-16 2xl:px-20">
          {/* Logo */}
          <div>
            <div className="inline-flex items-center rounded-2xl bg-white/95 px-6 py-3.5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-sm">
              <img
                src="/tdai-logo.png"
                alt="TD|ai"
                className="h-11 w-auto select-none object-contain xl:h-13"
                draggable={false}
                loading="eager"
                decoding="async"
              />
            </div>
          </div>

          {/* Hero text + stats */}
          <div className="animate-fade-in-up">
            <div className="mb-5 flex items-center gap-3">
              <div className="h-[2px] w-12 rounded-full" style={{ background: "#00B4A6" }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: "#00B4A6" }}>
                RIS / PACS Platform
              </span>
            </div>

            <h1 className="text-[2.75rem] font-extrabold leading-[1.08] tracking-tight text-white xl:text-[3.15rem]">
              Smart radiology,{" "}
              <span className="relative inline-block">
                <span style={{ color: "#00B4A6" }}>simplified</span>
                <span
                  className="absolute -bottom-1.5 left-0 right-0 h-[3px] rounded-full"
                  style={{ background: "linear-gradient(90deg, #00B4A6, transparent)" }}
                />
              </span>
            </h1>

            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
              Complete diagnostic imaging platform — from patient registration through final reporting, purpose-built for standalone radiology centers.
            </p>

            {/* Live stats */}
            <div className="mt-8 flex items-center gap-0">
              {stats.map((stat, i) => (
                <div key={stat.label} className="flex items-center gap-0">
                  <div className="animate-fade-in-up" style={{ animationDelay: `${200 + i * 150}ms` }}>
                    <p className="text-[1.55rem] font-bold tracking-tight text-white">{stat.value}</p>
                    <p className="text-[11px] text-white/35 mt-0.5">{stat.label}</p>
                  </div>
                  {i < stats.length - 1 && <div className="mx-5 h-10 w-px bg-white/10 xl:mx-6" />}
                </div>
              ))}
            </div>
          </div>

          {/* Features + compliance */}
          <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
            {features.map((feature) => (
              <div key={feature.text} className="group flex items-center gap-4">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-105"
                  style={{ background: "rgba(0,180,166,0.10)", border: "1px solid rgba(0,180,166,0.20)" }}
                >
                  <svg className="h-[18px] w-[18px]" style={{ color: "#00B4A6" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                  </svg>
                </div>
                <span className="text-[13px] font-medium text-white/65 transition-colors group-hover:text-white/80">{feature.text}</span>
              </div>
            ))}

            {/* Compliance badges */}
            <div className="flex flex-wrap items-center gap-2.5 pt-5">
              {complianceBadges.map((badge) => (
                <div
                  key={badge}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all duration-300 hover:bg-white/[0.08]"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <svg className="h-3 w-3 shrink-0" style={{ color: "#00B4A6" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="text-[10px] font-semibold tracking-wide text-white/45">{badge}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-3">
              <div className="h-px flex-1 bg-white/[0.06]" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20">Powered by Trivitron Healthcare</p>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right Form Panel ─── */}
      <div className="relative flex w-full flex-1 flex-col items-center justify-center px-6 py-10 sm:px-10 lg:w-[48%]"
        style={{ background: "linear-gradient(165deg, #FFFFFF 0%, #F8FAFB 40%, #F0F6F5 100%)" }}
      >
        {/* Subtle dot pattern */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: "radial-gradient(circle, #1A2B56 0.6px, transparent 0.6px)",
          backgroundSize: "36px 36px",
        }} />

        <div className="relative z-10 w-full max-w-[440px] animate-fade-in">
          {/* Logo + badge header */}
          <div className="mb-10 flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-[0_2px_12px_-4px_rgba(26,43,86,0.08)]">
              <img
                src="/tdai-logo.png"
                alt="TD|ai"
                className="h-9 w-auto select-none object-contain"
                draggable={false}
                loading="eager"
                decoding="async"
              />
              <div className="hidden h-6 w-px bg-slate-200 sm:block" />
              <span className="hidden text-[11px] font-bold uppercase tracking-[0.15em] text-slate-800 sm:block">
                Radiology Platform
              </span>
            </div>
          </div>

          {/* Header */}
          <div className="mb-8">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" style={{ backgroundColor: "#EDFAF9" }}>
              <div className="h-1.5 w-1.5 rounded-full animate-pulse-subtle" style={{ backgroundColor: "#00B4A6" }} />
              <span className="text-xs font-semibold" style={{ color: "#00736A" }}>
                {mode === "login" ? "Secure login" : "New account"}
              </span>
            </div>
            <h2 className="text-[1.75rem] font-extrabold tracking-tight" style={{ color: "#1A2B56" }}>
              {mode === "login" ? "Welcome back" : "Request access"}
            </h2>
            <p className="mt-2 text-sm font-medium" style={{ color: "#475569" }}>
              {mode === "login" ? "Sign in to your diagnostic workspace" : "Create an account to get started"}
            </p>
          </div>

          {/* Form */}
          <form className="space-y-5" onSubmit={handleEmailAuth}>
            {/* Email */}
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em]" style={{ color: "#1A2B56" }} htmlFor="email">
                <svg className="h-3.5 w-3.5" style={{ color: "#64748B" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </label>
              <div className="relative">
                <input
                  id="email"
                  className="login-input w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-4 pr-4 text-sm font-medium shadow-[0_1px_3px_rgba(26,43,86,0.04)] outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#00B4A6] focus:shadow-[0_0_0_3px_rgba(0,180,166,0.1)] focus:ring-0"
                  style={{ color: "#1A2B56" }}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em]" style={{ color: "#1A2B56" }} htmlFor="password">
                <svg className="h-3.5 w-3.5" style={{ color: "#64748B" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="login-input w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-4 pr-12 text-sm font-medium shadow-[0_1px_3px_rgba(26,43,86,0.04)] outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#00B4A6] focus:shadow-[0_0_0_3px_rgba(0,180,166,0.1)] focus:ring-0"
                  style={{ color: "#1A2B56" }}
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-4 transition-colors hover:text-slate-700"
                  style={{ color: "#64748B" }}
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password */}
            {mode === "login" && (
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex cursor-pointer items-center gap-2.5 select-none group">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-[5px] border-slate-300 accent-[#00B4A6] transition-colors focus:ring-[#00B4A6]/20"
                  />
                  <span className="text-[13px] font-medium transition-colors group-hover:text-slate-800" style={{ color: "#334155" }}>Remember me</span>
                </label>
                <button
                  type="button"
                  className="text-[13px] font-semibold transition-colors hover:underline underline-offset-2"
                  style={{ color: "#009488" }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Submit button */}
            <button
              className="login-submit-btn group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl py-4 text-[15px] font-bold text-white shadow-[0_2px_8px_-2px_rgba(0,180,166,0.4),0_8px_24px_-8px_rgba(0,180,166,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_-2px_rgba(0,180,166,0.45),0_12px_28px_-8px_rgba(0,180,166,0.35)] active:translate-y-0 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none"
              style={{ background: "linear-gradient(135deg, #00C4B4 0%, #00B4A6 40%, #009488 100%)" }}
              type="submit"
              disabled={loading}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/[0.08] to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
              {loading ? (
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              )}
              {mode === "login" ? "Sign in" : "Request access"}
            </button>
          </form>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748B" }}>or</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
          </div>

          {/* Google */}
          <button
            className="group flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white py-3.5 text-sm font-semibold shadow-[0_1px_3px_rgba(26,43,86,0.04)] transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 hover:shadow-[0_2px_8px_-2px_rgba(26,43,86,0.08)] hover:-translate-y-px active:translate-y-0"
            style={{ color: "#1A2B56" }}
            type="button"
            onClick={() => void loginWithGoogle()}
            disabled={loading}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </button>

          {/* Toggle mode */}
          <p className="mt-8 text-center text-sm" style={{ color: "#475569" }}>
            {mode === "login" ? "Don\u2019t have an account? " : "Already have an account? "}
            <button
              className="font-bold transition-colors hover:underline underline-offset-2"
              style={{ color: "#009488" }}
              type="button"
              onClick={() => { setMode((c) => (c === "login" ? "register" : "login")); setError(null); setMessage(null); }}
            >
              {mode === "login" ? "Request access" : "Sign in"}
            </button>
          </p>

          {/* Success message */}
          {message ? (
            <div className="mt-5 animate-slide-up rounded-xl border px-4 py-3.5 text-sm font-medium" style={{ borderColor: "#A3E9E3", backgroundColor: "#EDFAF9", color: "#00534D" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "#D1F4F1" }}>
                  <svg className="h-3.5 w-3.5" style={{ color: "#009488" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                {message}
              </div>
            </div>
          ) : null}

          {/* Error message */}
          {error ? (
            <div className="mt-5 animate-slide-up rounded-xl border px-4 py-3.5 text-sm font-medium" style={{ borderColor: "#FBC7C3", backgroundColor: "#FEF2F1", color: "#A4231B" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "#FDE3E1" }}>
                  <svg className="h-3.5 w-3.5" style={{ color: "#E03C31" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
                {error}
              </div>
            </div>
          ) : null}

          {/* Security trust footer */}
          <div className="mt-10 flex items-center justify-center gap-6">
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#64748B" }}>
              <svg className="h-3.5 w-3.5" style={{ color: "#94A3B8" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              256-bit SSL
            </span>
            <span className="h-3 w-px bg-slate-300" />
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#64748B" }}>
              <svg className="h-3.5 w-3.5" style={{ color: "#94A3B8" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              SOC 2
            </span>
            <span className="h-3 w-px bg-slate-300" />
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#64748B" }}>
              <svg className="h-3.5 w-3.5" style={{ color: "#94A3B8" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              HIPAA
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
