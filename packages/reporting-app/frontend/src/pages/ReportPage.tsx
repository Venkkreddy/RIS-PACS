import { useParams, Link } from "react-router-dom";
import { ReportEditor } from "../components/ReportEditor";
import { useReport } from "../hooks/useReport";
import { motion } from "framer-motion";

export function ReportPage() {
  const { id } = useParams();
  const { report, loading, error, refresh } = useReport(id);

  if (loading) return (
    <div className="flex min-h-[60vh] items-center justify-center animate-fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-tdai-gray-200 dark:border-white/[0.08]" />
          <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-tdai-teal-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-tdai-navy-700 dark:text-white">Loading report...</p>
          <p className="mt-0.5 text-xs text-tdai-gray-400 dark:text-tdai-gray-500">Fetching study data</p>
        </div>
      </div>
    </div>
  );

  if (error) return (
    <div className="page-container">
      <div className="mx-auto max-w-lg">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tdai-red-50 dark:bg-red-950/30">
            <svg className="h-6 w-6 text-tdai-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86A2 2 0 0021 17.1L13.07 3.9a2 2 0 00-3.14 0L2 17.1A2 2 0 005.07 19z"/>
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-tdai-red-600 dark:text-red-400">{error}</p>
          <Link to="/reports" className="btn-secondary mt-4 inline-flex">Back to Reports</Link>
        </div>
      </div>
    </div>
  );

  if (!report) return (
    <div className="page-container">
      <div className="mx-auto max-w-lg">
        <div className="card p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-tdai-gray-300 dark:text-tdai-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-tdai-gray-500 dark:text-tdai-gray-400">Report not found</p>
          <Link to="/reports" className="btn-secondary mt-4 inline-flex">Back to Reports</Link>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-5xl px-6 py-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Link to="/reports" className="flex items-center gap-1 text-xs font-medium text-tdai-gray-400 transition-colors hover:text-tdai-teal-600 dark:text-tdai-gray-500 dark:hover:text-tdai-teal-400">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Reports
        </Link>
        <svg className="h-3 w-3 text-tdai-gray-300 dark:text-tdai-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-medium text-tdai-navy-600 truncate max-w-[200px] dark:text-tdai-gray-100">{report.id}</span>
      </div>
      <ReportEditor report={report} onRefresh={() => void refresh()} />
    </motion.div>
  );
}
