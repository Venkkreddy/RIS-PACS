import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Report, ReportStatus, CriticalPriority } from "@medical-report-system/shared";
import { api } from "../api/client";

const STATUS_BADGE: Record<ReportStatus, { bg: string; dot: string }> = {
  draft: {
    bg: "bg-tdai-gray-100 text-tdai-gray-600 dark:bg-tdai-gray-800/50 dark:text-tdai-gray-400",
    dot: "bg-tdai-gray-400 dark:bg-tdai-gray-500",
  },
  preliminary: {
    bg: "bg-tdai-navy-50 text-tdai-navy-600 dark:bg-tdai-navy-900/30 dark:text-tdai-gray-300",
    dot: "bg-tdai-navy-400 dark:bg-tdai-navy-400",
  },
  final: {
    bg: "bg-tdai-teal-50 text-tdai-teal-700 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300",
    dot: "bg-tdai-teal-500 dark:bg-tdai-teal-400",
  },
  amended: {
    bg: "bg-tdai-navy-100 text-tdai-navy-700 dark:bg-tdai-navy-900/40 dark:text-tdai-gray-100",
    dot: "bg-tdai-navy-500 dark:bg-tdai-navy-400",
  },
  cancelled: {
    bg: "bg-tdai-red-50 text-tdai-red-600 dark:bg-tdai-red-900/20 dark:text-tdai-red-400",
    dot: "bg-tdai-red-400 dark:bg-tdai-red-500",
  },
};

const PRIORITY_DOT: Record<CriticalPriority, string> = {
  routine: "bg-tdai-gray-300 dark:bg-tdai-gray-500",
  urgent: "bg-tdai-navy-400 dark:bg-tdai-navy-300",
  critical: "bg-tdai-red-500 animate-pulse dark:bg-tdai-red-400",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sectionPreview(report: Report): string {
  if (!report.sections) return "";
  const findings = report.sections.find(s => s.key === "findings")?.content ?? "";
  const plain = findings.replace(/<[^>]*>/g, "").trim();
  if (plain.length > 120) return plain.slice(0, 120) + "...";
  return plain;
}

export function ReportList() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void loadReports();
  }, []);

  async function loadReports() {
    setLoading(true);
    try {
      const response = await api.get<Report[]>("/reports");
      setReports(response.data);
    } catch { /* empty */ }
    setLoading(false);
  }

  async function createNewReport() {
    setCreating(true);
    try {
      const studyId = `STUDY-${Date.now().toString(36).toUpperCase()}`;
      const res = await api.post<Report>("/reports", {
        studyId,
        content: "",
        priority: "routine",
      });
      navigate(`/reports/${res.data.id}`);
    } catch {
      setCreating(false);
    }
  }

  const drafts = reports.filter(r => r.status === "draft").length;
  const finals = reports.filter(r => r.status === "final").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="page-header">Reports</h2>
          <p className="page-subheader mt-1">
            {reports.length} {reports.length === 1 ? "report" : "reports"}
            {drafts > 0 && (
              <span className="ml-2 text-tdai-navy-400 dark:text-tdai-navy-300">
                ({drafts} draft{drafts > 1 ? "s" : ""})
              </span>
            )}
            {finals > 0 && (
              <span className="ml-2 text-tdai-teal-500 dark:text-tdai-teal-400">({finals} finalized)</span>
            )}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => void createNewReport()}
          disabled={creating}
        >
          {creating ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating...
            </span>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Report
            </>
          )}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card p-10 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-tdai-gray-200 border-t-tdai-teal-500 dark:border-white/[0.08] dark:border-t-tdai-teal-500" />
            <span className="text-sm text-tdai-gray-500 dark:text-tdai-gray-400">Loading reports...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && reports.length === 0 && (
        <div className="card py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
            <svg className="h-8 w-8 text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-semibold text-tdai-navy-700 dark:text-tdai-gray-100">No reports yet</p>
          <p className="mt-1 text-xs text-tdai-gray-400 dark:text-tdai-gray-500">
            Create your first report to get started with radiology templates
          </p>
          <button className="btn-primary mt-5" onClick={() => void createNewReport()} disabled={creating}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create First Report
          </button>
        </div>
      )}

      {/* Report list */}
      {!loading && reports.length > 0 && (
        <div className="space-y-2">
          {reports.map(report => {
            const status = report.status ?? "draft";
            const badge = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
            const priority = report.priority ?? "routine";
            const preview = sectionPreview(report);
            const sectionCount = report.sections?.filter(s => s.content.replace(/<[^>]*>/g, "").trim()).length ?? 0;
            const totalSections = report.sections?.length ?? 0;

            return (
              <Link
                key={report.id}
                className="card-hover group flex items-start gap-4 px-5 py-4"
                to={`/reports/${report.id}`}
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tdai-navy-50 transition-colors group-hover:bg-tdai-teal-50 dark:bg-white/[0.05] dark:group-hover:bg-tdai-teal-900/20">
                  <svg
                    className="h-5 w-5 text-tdai-navy-500 transition-colors group-hover:text-tdai-teal-600 dark:text-tdai-gray-300 dark:group-hover:text-tdai-teal-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.75}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-tdai-navy-800 group-hover:text-tdai-teal-700 transition-colors dark:text-white dark:group-hover:text-tdai-teal-400 truncate">
                      Study {report.studyId}
                    </p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.bg}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {status.toUpperCase()}
                    </span>
                    {priority !== "routine" && (
                      <span className="flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[priority]}`} />
                        <span className="text-[10px] font-medium text-tdai-gray-500 dark:text-tdai-gray-400">{priority}</span>
                      </span>
                    )}
                  </div>

                  {preview && (
                    <p className="mt-1 text-xs text-tdai-gray-500 dark:text-tdai-gray-400 leading-relaxed truncate">{preview}</p>
                  )}

                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-tdai-gray-400 dark:text-tdai-gray-500">
                    <span>{timeAgo(report.updatedAt)}</span>
                    {totalSections > 0 && (
                      <span className="flex items-center gap-1">
                        <span
                          className={`h-1 w-1 rounded-full ${
                            sectionCount === totalSections
                              ? "bg-tdai-teal-400 dark:bg-tdai-teal-400"
                              : "bg-tdai-gray-300 dark:bg-tdai-gray-500"
                          }`}
                        />
                        {sectionCount}/{totalSections} sections
                      </span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <svg
                  className="mt-2 h-4 w-4 shrink-0 text-tdai-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-tdai-teal-500 dark:text-tdai-gray-500 dark:group-hover:text-tdai-teal-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
