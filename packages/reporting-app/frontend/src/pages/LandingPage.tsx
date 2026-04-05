import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BrandLogo } from "../components/BrandLogo";

const summaryTiles = [
  {
    label: "Average Turnaround",
    value: "< 15 min",
    description: "From study acquisition to final report delivery",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    iconGradient: "from-tdai-teal-500 to-tdai-teal-600",
    barGradient: "from-tdai-teal-400 via-tdai-teal-500 to-tdai-teal-600",
    cardBg: "from-tdai-teal-50/50 via-white to-white",
    glow: "from-tdai-teal-200/60 to-tdai-teal-100/20",
    valueColor: "text-tdai-teal-600",
    chip: "SLA-backed workflow",
    chipTone: "bg-tdai-teal-500/10 text-tdai-teal-700 ring-tdai-teal-200/80",
    watermark: "15",
    ringColor: "text-tdai-teal-400",
    accentBorder: "from-tdai-teal-300 to-tdai-teal-500",
    icon2: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    label: "Interoperability",
    value: "FHIR + DICOM",
    description: "Standards-compliant across all systems",
    icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    iconGradient: "from-blue-500 to-indigo-600",
    barGradient: "from-blue-400 via-blue-500 to-indigo-500",
    cardBg: "from-blue-50/50 via-white to-white",
    glow: "from-blue-200/60 to-blue-100/20",
    valueColor: "text-blue-600",
    chip: "Vendor-neutral exchange",
    chipTone: "bg-blue-500/10 text-blue-700 ring-blue-200/80",
    watermark: "HL7",
    ringColor: "text-blue-400",
    accentBorder: "from-blue-300 to-indigo-500",
    icon2: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
  },
  {
    label: "Multi-center Coverage",
    value: "24 / 7 Ops",
    description: "Round-the-clock diagnostic operations",
    icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    iconGradient: "from-violet-500 to-purple-600",
    barGradient: "from-violet-400 via-purple-500 to-purple-600",
    cardBg: "from-purple-50/50 via-white to-white",
    glow: "from-purple-200/60 to-purple-100/20",
    valueColor: "text-purple-600",
    chip: "Always-on operations",
    chipTone: "bg-violet-500/10 text-violet-700 ring-violet-200/80",
    watermark: "24/7",
    ringColor: "text-violet-400",
    accentBorder: "from-violet-300 to-purple-500",
    icon2: "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636",
  },
];

const modules = [
  {
    title: "Unified Worklist",
    description: "Auto-prioritized assignment across sites with built-in status tracking and escalation workflows.",
    icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01",
    iconGradient: "from-tdai-teal-500 to-tdai-teal-600",
    borderColor: "border-l-tdai-teal-400",
    numBg: "bg-tdai-teal-500/10 text-tdai-teal-600",
    hoverBorder: "hover:border-tdai-teal-300/60",
    glowBg: "from-tdai-teal-100/40 to-transparent",
    pill: "Smart triage",
    outcome: "Distributes urgent studies first with rule-based escalation safety nets.",
  },
  {
    title: "Diagnostic Viewer",
    description: "Web-based DICOM image viewing with cross-reference context and structured workflow actions.",
    icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
    iconGradient: "from-blue-500 to-blue-600",
    borderColor: "border-l-blue-400",
    numBg: "bg-blue-500/10 text-blue-600",
    hoverBorder: "hover:border-blue-300/60",
    glowBg: "from-blue-100/40 to-transparent",
    pill: "Zero-install",
    outcome: "Provides browser-native reading tools with synchronized context and annotations.",
  },
  {
    title: "AI Reporting Studio",
    description: "Template-driven reports with assistant guidance, audit-safe revisions, and role-based approvals.",
    icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    iconGradient: "from-violet-500 to-purple-600",
    borderColor: "border-l-violet-400",
    numBg: "bg-violet-500/10 text-violet-600",
    hoverBorder: "hover:border-violet-300/60",
    glowBg: "from-violet-100/40 to-transparent",
    pill: "Structured intelligence",
    outcome: "Reduces report turnaround variance with guided templates and approval controls.",
  },
  {
    title: "Scheduling & Billing",
    description: "Linked appointment, billing, and reimbursement workflows in a single integrated dashboard.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    iconGradient: "from-amber-500 to-orange-600",
    borderColor: "border-l-amber-400",
    numBg: "bg-amber-500/10 text-amber-600",
    hoverBorder: "hover:border-amber-300/60",
    glowBg: "from-amber-100/40 to-transparent",
    pill: "Revenue-ready",
    outcome: "Connects appointment completion, billing events, and reimbursement tracking.",
  },
];

const carePath = [
  {
    label: "Acquire",
    text: "Studies are captured and synced from local imaging centers via DICOM.",
    icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
    cadence: "DICOM ingest in minutes",
  },
  {
    label: "Assign",
    text: "The platform routes each case to the right specialist automatically.",
    icon: "M13 7l5 5m0 0l-5 5m5-5H6",
    cadence: "Real-time routing rules",
  },
  {
    label: "Interpret",
    text: "Radiologists read and report in one connected diagnostic workspace.",
    icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    cadence: "Collaborative readroom flow",
  },
  {
    label: "Deliver",
    text: "Reports and status updates are shared instantly with all stakeholders.",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    cadence: "Instant downstream sync",
  },
];

const complianceBadges = [
  { label: "DICOM 3.0", icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" },
  { label: "HL7 FHIR", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { label: "HIPAA", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
  { label: "SOC 2", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { label: "256-bit TLS", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
];

const trustPillars = [
  {
    title: "Encryption by default",
    text: "All imaging and report payloads are protected in transit and at rest.",
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  },
  {
    title: "Auditable operations",
    text: "Immutable action trails track every assignment, interpretation, and sign-off.",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    title: "Role-based access",
    text: "Granular permissions enforce least-privilege access across all centers.",
    icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
  },
];

const containerVariant = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const itemVariant = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-tdai-text">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-40 border-b border-tdai-border/60 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-tdai-border/80 bg-white px-2.5 py-1.5 shadow-sm sm:px-3 sm:py-2">
              <BrandLogo compact showPoweredBy={false} />
            </div>
            <nav className="hidden items-center gap-1 md:flex">
              <a href="#modules" className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-tdai-gray-500 transition-colors hover:bg-tdai-gray-50 hover:text-tdai-navy-700">Modules</a>
              <a href="#workflow" className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-tdai-gray-500 transition-colors hover:bg-tdai-gray-50 hover:text-tdai-navy-700">Workflow</a>
              <a href="#compliance" className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-tdai-gray-500 transition-colors hover:bg-tdai-gray-50 hover:text-tdai-navy-700">Compliance</a>
            </nav>
          </div>
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link
              className="btn-secondary !px-4 !py-2 sm:text-[13px]"
              to="/login"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              Sign in
            </Link>
            <Link
              className="btn-primary !px-5 !py-2.5 sm:text-[13px]"
              to="/login"
            >
              Open Platform
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        {/* Deep navy gradient background */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #050912 0%, #0A1125 30%, #1A2B56 65%, #111D3B 100%)" }} />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full opacity-[0.16] orb-drift" style={{ background: "radial-gradient(circle, #00B4A6 0%, transparent 65%)" }} />
          <div className="absolute -bottom-32 -right-32 h-[550px] w-[550px] rounded-full opacity-[0.08] orb-drift-delay" style={{ background: "radial-gradient(circle, #E03C31 0%, transparent 60%)" }} />
          <div className="absolute left-1/3 top-1/4 h-[350px] w-[500px] rounded-full bg-tdai-navy-400/[0.15] blur-[100px]" />
          <div className="absolute right-[15%] top-[30%] h-[280px] w-[280px] rounded-full opacity-[0.06] orb-drift-slow" style={{ background: "radial-gradient(circle, #00B4A6 0%, transparent 70%)" }} />
        </div>

        {/* Grid pattern */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }} />

        {/* ECG heartbeat line */}
        <div className="pointer-events-none absolute left-0 right-0 top-[38%] opacity-[0.10]">
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

        {/* Secondary ECG line — fainter, offset */}
        <div className="pointer-events-none absolute left-0 right-0 top-[72%] opacity-[0.05]">
          <svg viewBox="0 0 1200 80" className="w-full" preserveAspectRatio="none">
            <path
              d="M0,40 L250,40 L268,40 L278,20 L288,60 L298,10 L308,70 L318,40 L336,40 L580,40 L598,40 L608,22 L618,58 L628,12 L638,68 L648,40 L666,40 L910,40 L928,40 L938,20 L948,60 L958,10 L968,70 L978,40 L996,40 L1200,40"
              fill="none"
              stroke="#00B4A6"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ecg-heartbeat-slow"
            />
          </svg>
        </div>

        {/* Scan sweep line */}
        <div
          className="pointer-events-none absolute left-0 right-0 h-px scan-line-sweep"
          style={{ background: "linear-gradient(90deg, transparent 0%, rgba(0,180,166,0.35) 30%, rgba(0,180,166,0.5) 50%, rgba(0,180,166,0.35) 70%, transparent 100%)" }}
        />

        {/* PACS viewer illustration — left */}
        <div className="pointer-events-none absolute -left-4 top-[8%] hidden opacity-[0.06] lg:block pacs-float" aria-hidden="true">
          <svg width="280" height="320" viewBox="0 0 280 320" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="15" width="240" height="185" rx="12" stroke="white" strokeWidth="1.5" />
            <rect x="20" y="15" width="240" height="185" rx="12" fill="white" fillOpacity="0.02" />
            <rect x="28" y="23" width="224" height="165" rx="7" stroke="white" strokeWidth="0.8" strokeOpacity="0.4" />

            {/* Brain CT scan silhouette */}
            <ellipse cx="140" cy="105" rx="52" ry="58" stroke="white" strokeWidth="1" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <ellipse cx="140" cy="100" rx="42" ry="48" stroke="white" strokeWidth="0.7" strokeOpacity="0.25" fill="none" />
            <path d="M140 52 C125 60 112 78 110 100 C108 122 118 142 140 155 C162 142 172 122 170 100 C168 78 155 60 140 52Z" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" fill="white" fillOpacity="0.01" />
            <line x1="140" y1="55" x2="140" y2="158" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
            <line x1="93" y1="105" x2="187" y2="105" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
            <ellipse cx="125" cy="95" rx="16" ry="22" stroke="white" strokeWidth="0.5" strokeOpacity="0.15" fill="none" />
            <ellipse cx="155" cy="95" rx="16" ry="22" stroke="white" strokeWidth="0.5" strokeOpacity="0.15" fill="none" />

            {/* DICOM labels */}
            <text x="34" y="38" fill="white" fillOpacity="0.4" fontSize="6" fontFamily="monospace">BRAIN CT AXL</text>
            <text x="34" y="47" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace">W: 80 L: 40</text>
            <text x="210" y="38" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">512 x 512</text>
            <text x="210" y="47" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">SE: 3/24</text>
            <text x="34" y="180" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace">1.2.840.10008</text>
            <text x="210" y="180" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">IMG: 14/120</text>

            {/* Crosshair */}
            <line x1="140" y1="90" x2="140" y2="120" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.35" />
            <line x1="125" y1="105" x2="155" y2="105" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.35" />
            <circle cx="140" cy="105" r="8" stroke="#00B4A6" strokeWidth="0.5" strokeOpacity="0.25" fill="none" />

            {/* Monitor stand */}
            <path d="M110 200 L110 235 L85 255 L195 255 L170 235 L170 200" stroke="white" strokeWidth="1.2" fill="none" strokeOpacity="0.4" />
            <line x1="85" y1="255" x2="195" y2="255" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4" />

            {/* Thumbnails */}
            <rect x="15" y="270" width="42" height="34" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="36" y="290" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">SAG</text>
            <rect x="65" y="270" width="42" height="34" rx="4" stroke="#00B4A6" strokeWidth="1" strokeOpacity="0.4" fill="#00B4A6" fillOpacity="0.03" />
            <text x="86" y="290" fill="#00B4A6" fillOpacity="0.4" fontSize="5" fontFamily="monospace" textAnchor="middle">AXL</text>
            <rect x="115" y="270" width="42" height="34" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="136" y="290" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">COR</text>
            <rect x="165" y="270" width="42" height="34" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="186" y="290" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">3D</text>
          </svg>
        </div>

        {/* Chest X-ray illustration — right */}
        <div className="pointer-events-none absolute -right-2 top-[6%] hidden opacity-[0.06] xl:block pacs-float" style={{ animationDelay: "3s" }} aria-hidden="true">
          <svg width="300" height="340" viewBox="0 0 300 340" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="15" width="260" height="200" rx="12" stroke="white" strokeWidth="1.5" />
            <rect x="20" y="15" width="260" height="200" rx="12" fill="white" fillOpacity="0.02" />
            <rect x="28" y="23" width="244" height="180" rx="7" stroke="white" strokeWidth="0.8" strokeOpacity="0.4" />

            {/* Chest X-ray ribcage */}
            <path d="M150 50 C150 50 115 65 110 100 C108 120 115 150 125 165 L150 175 L175 165 C185 150 192 120 190 100 C185 65 150 50 150 50Z" stroke="white" strokeWidth="1" strokeOpacity="0.3" fill="white" fillOpacity="0.02" />
            <line x1="150" y1="55" x2="150" y2="178" stroke="white" strokeWidth="0.7" strokeOpacity="0.2" strokeDasharray="4 3" />
            {/* Left ribs */}
            <path d="M147 70 C135 73 120 82 116 90" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M147 82 C135 85 118 93 114 102" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M147 94 C135 97 117 105 113 114" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M147 106 C135 109 117 117 114 126" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M147 118 C135 121 118 129 116 138" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M147 130 C137 133 123 139 120 147" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            {/* Right ribs */}
            <path d="M153 70 C165 73 180 82 184 90" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M153 82 C165 85 182 93 186 102" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M153 94 C165 97 183 105 187 114" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M153 106 C165 109 183 117 186 126" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M153 118 C165 121 182 129 184 138" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            <path d="M153 130 C163 133 177 139 180 147" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" />
            {/* Heart */}
            <ellipse cx="140" cy="110" rx="17" ry="22" stroke="white" strokeWidth="0.6" strokeOpacity="0.18" fill="white" fillOpacity="0.01" />
            {/* Lung fields */}
            <ellipse cx="123" cy="105" rx="20" ry="36" stroke="white" strokeWidth="0.5" strokeOpacity="0.12" fill="none" />
            <ellipse cx="177" cy="105" rx="20" ry="36" stroke="white" strokeWidth="0.5" strokeOpacity="0.12" fill="none" />

            {/* DICOM labels */}
            <text x="34" y="38" fill="white" fillOpacity="0.4" fontSize="6" fontFamily="monospace">PA CHEST</text>
            <text x="34" y="47" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace">W: 2000 L: 400</text>
            <text x="230" y="38" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">512 x 512</text>
            <text x="230" y="47" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">DICOM 3.0</text>
            <text x="34" y="195" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace">1.2.840.10008</text>
            <text x="230" y="195" fill="white" fillOpacity="0.28" fontSize="5.5" fontFamily="monospace" textAnchor="end">IMG: 1/48</text>

            {/* Measurement line */}
            <line x1="110" y1="90" x2="190" y2="90" stroke="#00B4A6" strokeWidth="0.6" strokeOpacity="0.4" strokeDasharray="3 2" />
            <circle cx="110" cy="90" r="1.8" fill="#00B4A6" fillOpacity="0.4" />
            <circle cx="190" cy="90" r="1.8" fill="#00B4A6" fillOpacity="0.4" />
            <text x="150" y="86" fill="#00B4A6" fillOpacity="0.5" fontSize="5.5" fontFamily="monospace" textAnchor="middle">12.4 cm</text>

            {/* Monitor stand */}
            <path d="M120 215 L120 250 L95 268 L205 268 L180 250 L180 215" stroke="white" strokeWidth="1.2" fill="none" strokeOpacity="0.4" />
            <line x1="95" y1="268" x2="205" y2="268" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4" />

            {/* Thumbnails */}
            <rect x="30" y="282" width="50" height="40" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="55" y="306" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">LAT</text>
            <rect x="90" y="282" width="50" height="40" rx="4" stroke="#00B4A6" strokeWidth="1" strokeOpacity="0.4" fill="#00B4A6" fillOpacity="0.03" />
            <text x="115" y="306" fill="#00B4A6" fillOpacity="0.4" fontSize="5" fontFamily="monospace" textAnchor="middle">PA</text>
            <rect x="150" y="282" width="50" height="40" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="175" y="306" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">OBL</text>
            <rect x="210" y="282" width="50" height="40" rx="4" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" fill="white" fillOpacity="0.02" />
            <text x="235" y="306" fill="white" fillOpacity="0.28" fontSize="5" fontFamily="monospace" textAnchor="middle">AP</text>
          </svg>
        </div>

        {/* Floating DICOM data chips */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block" aria-hidden="true">
          <motion.div
            className="absolute left-[8%] top-[72%] rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 backdrop-blur-sm"
            animate={{ y: [0, -6, 0], opacity: [0.4, 0.6, 0.4] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <span className="font-mono text-[9px] text-white/30">SOP: 1.2.840.10008.5.1.4.1.1.2</span>
          </motion.div>
          <motion.div
            className="absolute right-[10%] top-[68%] rounded-md border border-tdai-teal-400/[0.1] bg-tdai-teal-500/[0.04] px-3 py-1.5 backdrop-blur-sm"
            animate={{ y: [0, -8, 0], opacity: [0.35, 0.55, 0.35] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          >
            <span className="font-mono text-[9px] text-tdai-teal-300/40">MODALITY: CT / CR / MR</span>
          </motion.div>
          <motion.div
            className="absolute left-[22%] top-[18%] rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 backdrop-blur-sm"
            animate={{ y: [0, -5, 0], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          >
            <span className="font-mono text-[9px] text-white/25">Transfer: JPEG2000 Lossless</span>
          </motion.div>
          <motion.div
            className="absolute right-[20%] top-[22%] rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 backdrop-blur-sm"
            animate={{ y: [0, -7, 0], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 3 }}
          >
            <span className="font-mono text-[9px] text-white/25">HL7 FHIR R4 DiagnosticReport</span>
          </motion.div>
        </div>

        {/* Floating decorative shapes */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -left-16 top-20 hidden h-[360px] w-[360px] rounded-3xl border border-white/[0.04] opacity-[0.06] md:block"
            style={{ background: "linear-gradient(135deg, rgba(0,180,166,0.15) 0%, transparent 100%)" }}
            animate={{ y: [0, -12, 0], rotate: [-6, -3, -6] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -right-20 bottom-12 hidden h-[400px] w-[400px] rounded-3xl border border-white/[0.04] opacity-[0.04] lg:block"
            style={{ background: "linear-gradient(135deg, rgba(0,180,166,0.1) 0%, transparent 100%)" }}
            animate={{ y: [0, 14, 0], rotate: [4, 7, 4] }}
            transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <motion.div
          variants={containerVariant}
          initial="hidden"
          animate="show"
          className="relative mx-auto max-w-7xl px-6 pb-16 pt-14 md:pb-24 md:pt-20"
        >
          <motion.div variants={itemVariant} className="mx-auto max-w-4xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-tdai-teal-400/25 bg-tdai-teal-500/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tdai-teal-300 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tdai-teal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-tdai-teal-400" />
              </span>
              Intelligent RIS/PACS Platform
            </span>

            <h1 className="mt-7 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-[3.75rem]">
              Reimagined radiology{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-tdai-teal-400 to-tdai-teal-300 bg-clip-text text-transparent">
                  from first scan to final report
                </span>
                <motion.span
                  className="absolute -bottom-1 left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-tdai-teal-400 to-transparent"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.8, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformOrigin: "left" }}
                />
              </span>
              <br className="hidden sm:block" />
                
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-tdai-gray-300/90 md:text-lg">
              A complete diagnostic imaging platform that connects patient registration, PACS viewing,
              AI-assisted reporting, billing, and scheduling in one unified workspace.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
              <Link className="btn-primary !px-8 !py-3.5 text-base" to="/login">
                Start Platform
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                className="btn-inverse !px-7 !py-3.5"
                href="#modules"
              >
                Explore Modules
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </div>

            <motion.div
              variants={itemVariant}
              className="mt-10 flex flex-wrap items-center justify-center gap-2.5"
            >
              {["Role-aware dashboards", "AI-assisted reporting", "Secure by design", "DICOM-native"].map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.05] px-3.5 py-1.5 text-xs text-tdai-gray-300 shadow-sm backdrop-blur-sm transition-colors hover:border-tdai-teal-400/30 hover:text-tdai-teal-300"
                >
                  {tag}
                </span>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ─── Stats Tiles ─── */}
      <motion.section
        id="summary"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={containerVariant}
        className="relative z-20 mx-auto mt-10 mb-14 max-w-6xl bg-white px-4 sm:mt-12 sm:mb-20 sm:px-6 md:mt-16 md:mb-0"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6 lg:gap-8">
          {summaryTiles.map((tile, idx) => (
            <motion.article
              key={tile.label}
              variants={itemVariant}
              whileHover={{ y: -10, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
              className={`group relative overflow-hidden rounded-[2rem] border border-tdai-gray-200/60 bg-gradient-to-br ${tile.cardBg} shadow-[0_8px_30px_-12px_rgba(26,43,86,0.12)] transition-all duration-500 hover:border-tdai-gray-300/80 hover:shadow-[0_24px_56px_-14px_rgba(26,43,86,0.22)]`}
            >
              {/* Animated top gradient bar with shimmer */}
              <div className={`tile-shimmer-bar absolute inset-x-0 top-0 h-1.5 overflow-hidden bg-gradient-to-r ${tile.barGradient}`}>
                <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <div className={`h-full w-full bg-gradient-to-r ${tile.barGradient} animate-pulse`} />
                </div>
              </div>

              {/* Corner glow — larger and more dynamic */}
              <div className={`absolute -right-16 -top-16 h-52 w-52 rounded-full bg-gradient-radial ${tile.glow} blur-3xl opacity-60 transition-all duration-700 group-hover:scale-125 group-hover:opacity-90`} />
              <div className={`absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-gradient-radial ${tile.glow} blur-3xl opacity-0 transition-all duration-700 group-hover:opacity-30`} />

              {/* Glass reflection */}
              <div className="absolute inset-0 bg-[linear-gradient(165deg,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.4)_40%,rgba(255,255,255,0)_70%)] opacity-60" />

              {/* Shine sweep on hover */}
              <div className="card-shine absolute inset-0 overflow-hidden rounded-[2rem]" />

              {/* Bottom accent line */}
              <div className={`absolute inset-x-8 bottom-0 h-px bg-gradient-to-r ${tile.accentBorder} opacity-0 transition-all duration-500 group-hover:opacity-40 group-hover:inset-x-4`} />

              {/* Watermark */}
              <span className="tile-watermark" aria-hidden="true">{tile.watermark}</span>

              <div className="relative flex flex-col p-6 sm:p-8">
                <div className="mb-5">
                  <div className="relative inline-flex">
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${tile.iconGradient} shadow-lg shadow-current/10 ring-1 ring-white/50 transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 group-hover:shadow-xl`}>
                      <svg className="h-6 w-6 text-white drop-shadow-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tile.icon} />
                      </svg>
                    </div>
                    <div className={`icon-pulse-ring rounded-2xl ${tile.ringColor}`} />
                  </div>
                  <span className={`mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${tile.chipTone} shadow-sm backdrop-blur-sm transition-all duration-300 group-hover:shadow-md`}>
                    <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={tile.icon2} />
                    </svg>
                    <span className="min-w-0 text-center leading-tight">{tile.chip}</span>
                  </span>
                </div>

                <div className="mt-2 space-y-2">
                  <p className={`text-[2rem] font-black tracking-tight sm:text-4xl ${tile.valueColor} transition-transform duration-300 group-hover:scale-[1.02] origin-left`}>
                    {tile.value}
                  </p>
                  <div className="flex items-center gap-2.5">
                    <div className={`h-px flex-1 bg-gradient-to-r ${tile.accentBorder} opacity-20`} />
                    <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-tdai-navy-800/60">{tile.label}</p>
                    <div className={`h-px flex-1 bg-gradient-to-l ${tile.accentBorder} opacity-20`} />
                  </div>
                  <p className="text-[13px] leading-relaxed text-tdai-gray-500 font-medium">{tile.description}</p>
                </div>

                {/* Micro progress indicator */}
                <div className="mt-5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-tdai-gray-100">
                    <motion.div
                      className={`h-full rounded-full bg-gradient-to-r ${tile.barGradient}`}
                      initial={{ width: 0 }}
                      whileInView={{ width: idx === 0 ? "92%" : idx === 1 ? "100%" : "85%" }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.6 + idx * 0.15, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-tdai-gray-400">{idx === 0 ? "SLA" : idx === 1 ? "STD" : "OPS"}</span>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </motion.section>

      {/* ─── Modules ─── */}
      <motion.section
        id="modules"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={containerVariant}
        className="relative overflow-hidden bg-gradient-to-b from-tdai-gray-50/80 via-white to-tdai-gray-50/50 pb-32 pt-24 md:py-28"
      >
        {/* Background patterns */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle at 2px 2px, rgba(26,43,86,0.06) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }} />
        <div className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-tdai-teal-200/20 blur-[100px]" />
        <div className="pointer-events-none absolute -right-40 bottom-20 h-96 w-96 rounded-full bg-blue-200/20 blur-[100px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-200/10 blur-[120px]" />

        <div className="relative mx-auto max-w-7xl px-6">
          <motion.div variants={itemVariant} className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-tdai-teal-400/30 bg-tdai-teal-500/10 px-4 py-1.5 text-[12px] font-bold uppercase tracking-widest text-tdai-teal-600 backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tdai-teal-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-tdai-teal-500" />
              </span>
              Platform Modules
            </span>
            <h2 className="mt-6 text-4xl font-extrabold tracking-tight text-tdai-navy-900 md:text-5xl lg:text-6xl">
              Every tool your{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-tdai-teal-600 to-tdai-teal-500 bg-clip-text text-transparent">radiology center</span>
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 8" fill="none" preserveAspectRatio="none">
                  <path d="M0 6 Q50 0 100 4 Q150 8 200 2" stroke="url(#underline-grad)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                  <defs><linearGradient id="underline-grad" x1="0" y1="0" x2="200" y2="0"><stop offset="0%" stopColor="#00B4A6" stopOpacity="0.6" /><stop offset="100%" stopColor="#00B4A6" stopOpacity="0.1" /></linearGradient></defs>
                </svg>
              </span>{" "}
              needs
            </h2>
            <p className="mt-6 text-base leading-relaxed text-tdai-gray-500 md:text-lg">
              Purpose-built modules that work together seamlessly, from acquisition to delivery.
            </p>
          </motion.div>

          <motion.div variants={itemVariant} className="mt-14 grid gap-4 rounded-3xl border border-tdai-gray-200/80 bg-white/90 p-5 shadow-[0_8px_30px_-12px_rgba(26,43,86,0.15)] backdrop-blur-md sm:grid-cols-3">
            {[
              { label: "Deployment", value: "Cloud + On-prem", icon: "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" },
              { label: "Connectivity", value: "FHIR / HL7 / DICOM", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" },
              { label: "Coverage", value: "Single to multi-center", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
            ].map((item) => (
              <div key={item.label} className="group/cap flex items-center gap-4 rounded-2xl border border-tdai-gray-100 bg-tdai-gray-50/50 px-5 py-4 transition-all duration-300 hover:bg-white hover:shadow-md hover:-translate-y-0.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-tdai-teal-600 shadow-sm ring-1 ring-tdai-gray-200/80 transition-all duration-300 group-hover/cap:ring-tdai-teal-200 group-hover/cap:shadow-md">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-tdai-gray-400">{item.label}</p>
                  <p className="mt-1 text-[15px] font-bold text-tdai-navy-800">{item.value}</p>
                </div>
              </div>
            ))}
          </motion.div>

          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:gap-10">
            {modules.map((module, i) => (
              <motion.article
                key={module.title}
                variants={itemVariant}
                whileHover={{ y: -10, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
                className={`group relative overflow-hidden rounded-[2rem] border border-tdai-gray-200/70 bg-white/95 shadow-[0_12px_40px_-16px_rgba(26,43,86,0.18)] backdrop-blur-sm transition-all duration-500 ${module.hoverBorder} hover:shadow-[0_28px_64px_-20px_rgba(26,43,86,0.28)]`}
              >
                {/* Animated left accent border — thicker and gradient-animated */}
                <div className={`absolute bottom-0 left-0 top-0 w-1 bg-gradient-to-b ${module.iconGradient} transition-all duration-500 group-hover:w-1.5`} />

                {/* Background glow — dual layered */}
                <div className={`absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br ${module.glowBg} opacity-40 blur-3xl transition-all duration-700 group-hover:scale-125 group-hover:opacity-70`} />
                <div className={`absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-gradient-to-tr ${module.glowBg} opacity-0 blur-3xl transition-all duration-700 group-hover:opacity-30`} />

                {/* Module card shine sweep */}
                <div className="module-card-shine absolute inset-0 overflow-hidden rounded-[2rem]" />

                {/* Large watermark number */}
                <span className="module-watermark" aria-hidden="true">0{i + 1}</span>

                <div className="relative p-8 pl-6">
                  {/* Top row: icon + number + pill */}
                  <div className="mb-6 flex items-center justify-between gap-4 pl-2">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${module.iconGradient} shadow-lg ring-1 ring-white/50 transition-all duration-500 group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-xl`}>
                          <svg className="h-6 w-6 text-white drop-shadow-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={module.icon} />
                          </svg>
                        </div>
                        <div className={`icon-pulse-ring rounded-2xl ${module.numBg.includes("teal") ? "text-tdai-teal-400" : module.numBg.includes("blue") ? "text-blue-400" : module.numBg.includes("violet") ? "text-violet-400" : "text-amber-400"}`} />
                      </div>
                      <div className="flex flex-col">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-black ${module.numBg} ring-1 ring-inset ring-black/[0.03]`}>
                          0{i + 1}
                        </span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset shadow-sm backdrop-blur-sm ${module.numBg} transition-all duration-300 group-hover:shadow-md`}>
                      <span className={`h-1.5 w-1.5 rounded-full bg-current opacity-60`} />
                      {module.pill}
                    </span>
                  </div>

                  <div className="pl-2">
                    <h3 className="text-2xl font-bold tracking-tight text-tdai-navy-900 transition-colors duration-300 group-hover:text-tdai-navy-800">{module.title}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-tdai-gray-500">{module.description}</p>

                    {/* Enhanced outcome box */}
                    <div className="mt-6 overflow-hidden rounded-xl border border-tdai-gray-100 bg-tdai-gray-50/60 transition-all duration-500 group-hover:border-tdai-gray-200 group-hover:bg-white group-hover:shadow-sm">
                      <div className={`h-0.5 w-0 bg-gradient-to-r ${module.iconGradient} opacity-60 transition-all duration-700 group-hover:w-full`} />
                      <div className="p-4">
                        <p className="flex items-start gap-3 text-[14px] font-medium leading-relaxed text-tdai-navy-700">
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${module.iconGradient} text-white shadow-sm transition-transform duration-300 group-hover:scale-110`}>
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                          <span>{module.outcome}</span>
                        </p>
                      </div>
                    </div>

                    {/* Hover-reveal explore hint */}
                    <div className="mt-4 flex items-center gap-2 opacity-0 translate-y-2 transition-all duration-400 group-hover:opacity-100 group-hover:translate-y-0">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-tdai-gray-400">Explore module</span>
                      <svg className="h-3.5 w-3.5 text-tdai-gray-400 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ─── Care Path / Workflow ─── */}
      <motion.section
        id="workflow"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={containerVariant}
        className="relative overflow-hidden border-y border-tdai-border/60 bg-gradient-to-br from-tdai-gray-50/60 via-white to-tdai-teal-50/10"
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.45]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(26,43,86,0.05) 1px, transparent 0)",
          backgroundSize: "30px 30px",
        }} />
        <div className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full bg-tdai-teal-200/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-28 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div variants={itemVariant}>
            <span className="section-label">Diagnostic Workflow</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-tdai-navy-800 md:text-4xl">From first capture to final delivery</h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-tdai-gray-500">
              A streamlined four-step workflow keeps every team member aligned and every study on track.
            </p>

            <ol className="mt-10 space-y-4">
              {carePath.map((step, index) => (
                <li key={step.label} className="group relative flex gap-4 rounded-2xl border border-tdai-gray-200/70 bg-white/90 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-tdai-teal-200/70 hover:shadow-md">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-tdai-teal-200 bg-white text-xs font-bold text-tdai-teal-700 shadow-sm">
                    {index + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <svg className="h-4 w-4 text-tdai-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                      </svg>
                      <p className="text-sm font-bold text-tdai-navy-800">{step.label}</p>
                      <span className="inline-flex items-center rounded-full bg-tdai-teal-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-tdai-teal-700 ring-1 ring-tdai-teal-200/70">
                        {step.cadence}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-tdai-gray-500">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </motion.div>

          <motion.div variants={itemVariant} className="flex flex-col gap-5">
            {/* Feature highlight card */}
            <div className="overflow-hidden rounded-3xl border border-tdai-gray-200/80 bg-white/95 shadow-[0_12px_36px_-16px_rgba(26,43,86,0.2)]">
              <div className="h-1 bg-gradient-to-r from-tdai-teal-400 via-blue-500 to-violet-500" />
              <div className="p-7">
                <h3 className="text-2xl font-bold text-tdai-navy-800">Built for clinical-grade performance</h3>
                <p className="mt-3 text-sm leading-relaxed text-tdai-gray-500">
                  Every interaction is optimized for the speed, reliability, and precision that diagnostic imaging demands.
                </p>
                <ul className="mt-6 space-y-3 text-sm text-tdai-gray-600">
                  {[
                    "Sub-second DICOM image loading with progressive rendering",
                    "Role-based dashboards with real-time case status updates",
                    "Structured reporting with AI template suggestions",
                    "Automated audit trails for regulatory compliance",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-tdai-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Case handoff integrity", value: "100%", note: "Traceable step ownership" },
                    { label: "Reader response target", value: "< 15 min", note: "Median turnaround SLA" },
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-tdai-gray-200/70 bg-tdai-gray-50/70 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-tdai-gray-400">{metric.label}</p>
                      <p className="mt-1 text-lg font-bold text-tdai-navy-800">{metric.value}</p>
                      <p className="mt-0.5 text-[11px] text-tdai-gray-500">{metric.note}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-tdai-border/80 bg-gradient-to-r from-tdai-gray-50 to-white px-7 py-5">
                <a className="btn-primary" href="mailto:contact@trivitrondigital.ai">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Schedule a Demo
                </a>
              </div>
            </div>

            {/* Live metrics mini-card */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-tdai-gray-200/80 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-tdai-gray-400">Case Queue</p>
                <p className="mt-2 text-2xl font-bold text-tdai-navy-800">Live</p>
                <p className="mt-0.5 text-xs text-tdai-gray-400">Auto-prioritized</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-tdai-gray-100">
                  <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-tdai-teal-500 to-tdai-teal-400" />
                </div>
              </div>
              <div className="rounded-xl border border-tdai-gray-200/80 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-tdai-gray-400">Compliance</p>
                <p className="mt-2 text-2xl font-bold text-tdai-navy-800">100%</p>
                <p className="mt-0.5 text-xs text-tdai-gray-400">Audit-ready logs</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-tdai-gray-100">
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* ─── Compliance & Trust ─── */}
      <motion.section
        id="compliance"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={containerVariant}
        className="mx-auto max-w-7xl px-6 py-24"
      >
        <div className="relative overflow-hidden rounded-3xl border border-tdai-gray-200/80 bg-gradient-to-br from-white via-white to-tdai-gray-50/70 p-7 shadow-[0_16px_50px_-22px_rgba(26,43,86,0.25)] md:p-10">
          <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-tdai-teal-200/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-blue-200/20 blur-3xl" />

          <motion.div variants={itemVariant} className="relative mx-auto max-w-2xl text-center">
            <span className="section-label">Security & Compliance</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-tdai-navy-800 md:text-3xl">
              Enterprise-grade security at every layer
            </h2>
            <p className="mt-3 text-sm text-tdai-gray-500">
              Built with healthcare-grade security standards from the ground up.
            </p>
          </motion.div>

          <motion.div variants={itemVariant} className="relative mt-10 grid gap-4 md:grid-cols-3">
            {trustPillars.map((pillar) => (
              <article key={pillar.title} className="rounded-2xl border border-tdai-gray-200/70 bg-white/90 p-5 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-teal-500/10 text-tdai-teal-600 ring-1 ring-tdai-teal-200/70">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={pillar.icon} />
                  </svg>
                </div>
                <h3 className="mt-4 text-base font-semibold text-tdai-navy-800">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-tdai-gray-500">{pillar.text}</p>
              </article>
            ))}
          </motion.div>

          <motion.div variants={itemVariant} className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {complianceBadges.map((badge) => (
              <div
                key={badge.label}
                className="group flex items-center gap-3 rounded-2xl border border-tdai-gray-200/80 bg-white/95 px-4 py-3 shadow-sm transition-all duration-300 hover:border-tdai-teal-200/60 hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tdai-teal-50 transition-transform duration-300 group-hover:scale-105">
                  <svg className="h-4 w-4 text-tdai-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={badge.icon} />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-tdai-navy-700">{badge.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* ─── CTA ─── */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div
          className="relative overflow-hidden rounded-3xl px-7 py-14 shadow-[0_16px_50px_-18px_rgba(26,43,86,0.28)] md:px-12"
          style={{ background: "linear-gradient(135deg, #0A1125 0%, #1A2B56 60%, #111D3B 100%)" }}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-tdai-teal-400 via-blue-400 to-violet-400" />
          {/* Decorative elements */}
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-20" style={{ background: "radial-gradient(circle, #00B4A6, transparent 70%)" }} />
          <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #E03C31, transparent 70%)" }} />
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

          <div className="relative z-10 grid gap-10 lg:grid-cols-[1fr_0.75fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "#00B4A6" }}>Ready to start</p>
              <h3 className="mt-3 text-3xl font-bold tracking-tight text-white md:text-4xl">
                Enter your diagnostic workspace
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
                Sign in to access your role-based dashboard, reporting tools, live operational queues, and diagnostic imaging viewer.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link className="btn-primary !px-7 !py-3.5" to="/login">
                  Open Platform
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <a
                  className="btn-inverse !px-6 !py-3.5"
                  href="mailto:contact@trivitrondigital.ai"
                >
                  Speak to Sales
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-white/60">Operational confidence</p>
              <ul className="mt-3 space-y-2.5 text-sm text-white/80">
                {[
                  "Role-aware access control for every team member",
                  "End-to-end audit visibility from intake to report delivery",
                  "Designed for 24/7 multi-center diagnostic throughput",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-tdai-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-tdai-border/60 bg-tdai-gray-50/50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {/* Brand column */}
            <div className="sm:col-span-2 lg:col-span-1">
              <BrandLogo compact showPoweredBy={false} />
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-tdai-gray-400">
                Complete diagnostic imaging platform for standalone radiology centers. Built by Trivitron Healthcare.
              </p>
            </div>

            {/* Platform links */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-tdai-navy-700">Platform</p>
              <ul className="mt-3 space-y-2.5">
                {["Worklist", "Diagnostic Viewer", "AI Reporting", "Scheduling", "Billing"].map((link) => (
                  <li key={link}>
                    <a href="#modules" className="text-xs text-tdai-gray-500 transition-colors hover:text-tdai-navy-700">{link}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-tdai-navy-700">Resources</p>
              <ul className="mt-3 space-y-2.5">
                {["Documentation", "API Reference", "Release Notes", "System Status"].map((link) => (
                  <li key={link}>
                    <a href="#" className="text-xs text-tdai-gray-500 transition-colors hover:text-tdai-navy-700">{link}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-tdai-navy-700">Contact</p>
              <ul className="mt-3 space-y-2.5">
                <li>
                  <a href="mailto:contact@trivitrondigital.ai" className="text-xs text-tdai-gray-500 transition-colors hover:text-tdai-navy-700">contact@trivitrondigital.ai</a>
                </li>
                <li>
                  <a href="#" className="text-xs text-tdai-gray-500 transition-colors hover:text-tdai-navy-700">Support Portal</a>
                </li>
                <li>
                  <a href="#" className="text-xs text-tdai-gray-500 transition-colors hover:text-tdai-navy-700">Schedule a Demo</a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-tdai-border/80 pt-8 sm:flex-row">
            <p className="text-[11px] text-tdai-gray-400">
              &copy; {new Date().getFullYear()} Trivitron Healthcare. All rights reserved.
            </p>
            <div className="flex items-center gap-5 text-[11px] text-tdai-gray-400">
              <a className="transition-colors hover:text-tdai-navy-700" href="#">Privacy Policy</a>
              <a className="transition-colors hover:text-tdai-navy-700" href="#">Terms of Service</a>
              <a className="transition-colors hover:text-tdai-navy-700" href="#">Cookie Policy</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
