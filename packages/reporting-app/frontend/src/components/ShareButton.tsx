import { useState } from "react";
import { api } from "../api/client";

interface ShareButtonProps {
  reportId: string;
}

export function ShareButton({ reportId }: ShareButtonProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [expanded, setExpanded] = useState(false);

  async function share() {
    if (!email.trim()) return;
    setStatus("sending");
    try {
      await api.post(`/reports/${reportId}/share`, { email });
      setStatus("sent");
      setEmail("");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-tdai-gray-50/50 dark:hover:bg-white/[0.06]"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className="icon-box h-8 w-8 rounded-lg bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
            <svg className="h-4 w-4 text-tdai-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="text-left">
            <span className="text-sm font-semibold text-tdai-navy-800 dark:text-tdai-gray-100">Share Report</span>
            <p className="text-[11px] text-tdai-gray-400">Send report via email as PDF</p>
          </div>
        </div>
        <svg className={`h-4 w-4 text-tdai-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {expanded && (
        <div className="border-t border-tdai-gray-100 p-4 animate-slide-up dark:border-white/[0.08]">
          <div className="flex items-center gap-2">
            <input
              className="input-field flex-1"
              placeholder="recipient@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void share()}
            />
            <button
              className="btn-primary whitespace-nowrap"
              type="button"
              onClick={() => void share()}
              disabled={!email.trim() || status === "sending"}
            >
              {status === "sending" ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Sending...
                </span>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Share
                </>
              )}
            </button>
          </div>
          {status === "sent" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-tdai-teal-600 dark:text-tdai-teal-400 animate-slide-up">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Report shared successfully
            </p>
          )}
          {status === "error" && (
            <p className="mt-2 text-xs font-medium text-tdai-red-600 animate-slide-up">Failed to share. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
