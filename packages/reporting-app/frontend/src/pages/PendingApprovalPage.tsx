import { Link } from "react-router-dom";
import { useEffect } from "react";
import { BrandLogo } from "../components/BrandLogo";

function debugPendingLog(
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

export function PendingApprovalPage() {
  useEffect(() => {
    // #region agent log
    debugPendingLog("H7", "PendingApprovalPage.tsx:mount", "pending approval page mounted", {
      path: typeof window !== "undefined" ? window.location.pathname : "unknown",
    });
    // #endregion
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12 bg-white dark:bg-tdai-gray-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-tdai-teal-500/[0.03] blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-tdai-navy-500/[0.03] blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-tdai-gray-200 dark:border-white/[0.08] bg-white dark:bg-tdai-gray-900 shadow-card-hover animate-fade-in-up">
        <div className="h-1 bg-gradient-to-r from-tdai-teal-500 via-tdai-teal-400 to-tdai-teal-500" />

        <div className="p-10 text-center">
          <div className="mb-8 flex justify-center">
            <BrandLogo />
          </div>

          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200/50">
            <div className="relative">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
              </span>
            </div>
          </div>

          <h2 className="text-xl font-bold text-tdai-navy-800 dark:text-white">Account Pending Approval</h2>
          <p className="mt-4 text-sm text-tdai-gray-500 dark:text-tdai-gray-400 leading-relaxed">
            Your account request has been submitted successfully. A master admin will review and approve your access from{" "}
            <strong className="font-semibold text-tdai-navy-700 dark:text-tdai-gray-100">tdairad.com/admin</strong>.
          </p>

          <div className="mt-6 rounded-xl border border-tdai-gray-200 dark:border-white/[0.08] bg-tdai-gray-50 dark:bg-tdai-gray-800/50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-tdai-gray-400 mb-3">Admin contacts</p>
            <div className="space-y-2">
              {["metupalle@gmail.com", "praveenk1006@gmail.com", "gunapiano24@gmail.com"].map((email) => (
                <a
                  key={email}
                  href={`mailto:${email}`}
                  className="flex items-center justify-center gap-1.5 text-xs text-tdai-gray-500 dark:text-tdai-gray-400 transition-colors hover:text-tdai-teal-600"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  {email}
                </a>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <Link className="btn-secondary" to="/login">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" /></svg>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
