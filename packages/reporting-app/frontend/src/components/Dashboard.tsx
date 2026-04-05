import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { motion, type Variants } from "framer-motion";
import { Building2, Upload, Clock, AlertCircle, RefreshCw, Send, TrendingUp, BarChart3 } from "lucide-react";

interface AnalyticsResponse {
  centers: Array<{ name: string; uploads: number }>;
  totalUploads: number;
  radiologists: Array<{ userId: string; name: string; assignedCount: number }>;
  pendingReports: Array<{ studyId: string; patientName?: string; assignedTo?: string; currentTatHours: number }>;
  longestTat: Array<{ studyId: string; patientName?: string; tatHours?: number; assignedTo?: string }>;
}

const PIE_COLORS = ["#00B4A6", "#1A2B56", "#3B82F6", "#8B5CF6", "#F59E0B", "#E03C31", "#10B981", "#06B6D4"];

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
};

export function Dashboard() {
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const analyticsQuery = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const response = await api.get<AnalyticsResponse>("/analytics");
      return response.data;
    },
  });

  async function sendReminder(studyId: string) {
    await api.post("/admin/reminder", { studyId });
    setReminderStatus(`Reminder sent for study ${studyId}`);
    setTimeout(() => setReminderStatus(null), 3000);
  }

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-4 w-24 mb-3" />
              <div className="skeleton h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5"><div className="skeleton h-56 w-full" /></div>
          <div className="card p-5"><div className="skeleton h-56 w-full" /></div>
        </div>
      </div>
    );
  }

  if (analyticsQuery.error || !analyticsQuery.data) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card px-6 py-16 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tdai-red-50 dark:bg-tdai-red-950/30">
          <AlertCircle className="h-7 w-7 text-tdai-red-500" />
        </div>
        <p className="mt-4 text-sm font-semibold text-tdai-navy-800 dark:text-tdai-gray-100">Failed to load analytics</p>
        <p className="mt-1 text-xs text-tdai-gray-500 dark:text-tdai-gray-400">Please check your connection and try again.</p>
        <button className="btn-primary mt-5 !text-xs" onClick={() => analyticsQuery.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </motion.div>
    );
  }

  const data = analyticsQuery.data;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* KPI Cards */}
      <motion.div variants={item} className="grid gap-4 md:grid-cols-3">
        <motion.div whileHover={{ y: -3, transition: { duration: 0.2 } }} className="group card-hover px-5 py-5 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-tdai-navy-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-tdai-secondary">Centers</p>
              <motion.p
                key={data.centers.length}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-1.5 text-3xl font-extrabold text-tdai-text"
              >
                {data.centers.length}
              </motion.p>
              <p className="mt-1 text-[10px] text-tdai-muted flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" /> Active locations
              </p>
            </div>
            <div className="icon-box h-12 w-12 rounded-2xl bg-tdai-navy-50 group-hover:bg-tdai-navy-100 transition-colors dark:bg-tdai-navy-900/30 dark:group-hover:bg-tdai-navy-800/40">
              <Building2 className="h-5 w-5 text-tdai-navy-500" />
            </div>
          </div>
        </motion.div>

        <motion.div whileHover={{ y: -3, transition: { duration: 0.2 } }} className="group card-hover px-5 py-5 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-tdai-teal-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-tdai-secondary">Total Uploads</p>
              <motion.p
                key={data.totalUploads}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-1.5 text-3xl font-extrabold text-tdai-text"
              >
                {data.totalUploads.toLocaleString()}
              </motion.p>
              <p className="mt-1 text-[10px] text-tdai-muted flex items-center gap-1">
                <Upload className="h-3 w-3 text-tdai-teal-500" /> DICOM studies
              </p>
            </div>
            <div className="icon-box h-12 w-12 rounded-2xl bg-tdai-teal-50 group-hover:bg-tdai-teal-100 transition-colors dark:bg-tdai-teal-900/20 dark:group-hover:bg-tdai-teal-900/30">
              <Upload className="h-5 w-5 text-tdai-teal-500" />
            </div>
          </div>
        </motion.div>

        <motion.div whileHover={{ y: -3, transition: { duration: 0.2 } }} className="group card-hover px-5 py-5 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-tdai-red-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between relative">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-tdai-secondary">Pending Reports</p>
              <motion.p
                key={data.pendingReports.length}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-1.5 text-3xl font-extrabold text-tdai-red-500"
              >
                {data.pendingReports.length}
              </motion.p>
              <p className="mt-1 text-[10px] text-tdai-muted flex items-center gap-1">
                <Clock className="h-3 w-3 text-tdai-red-400" /> Awaiting completion
              </p>
            </div>
            <div className="icon-box h-12 w-12 rounded-2xl bg-tdai-red-50 group-hover:bg-tdai-red-100 transition-colors dark:bg-tdai-red-950/30 dark:group-hover:bg-tdai-red-900/30">
              <Clock className="h-5 w-5 text-tdai-red-500" />
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Charts */}
      <motion.div variants={item} className="grid gap-6 lg:grid-cols-2">
        <motion.div whileHover={{ y: -2 }} className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
              <BarChart3 className="h-4 w-4 text-tdai-teal-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-tdai-text">Uploads by Center</h3>
              <p className="text-[10px] text-tdai-muted">Distribution across imaging centers</p>
            </div>
          </div>
          <div className="p-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.centers}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: "0.75rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)", fontSize: "12px" }}
                    cursor={{ fill: "rgba(0,180,166,0.06)" }}
                  />
                  <Bar dataKey="uploads" fill="url(#tealGradient)" radius={[8, 8, 0, 0]} />
                  <defs>
                    <linearGradient id="tealGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00B4A6" />
                      <stop offset="100%" stopColor="#009488" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        <motion.div whileHover={{ y: -2 }} className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-navy-50 dark:bg-tdai-navy-900/30">
              <BarChart3 className="h-4 w-4 text-tdai-navy-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-tdai-text">Assigned Studies by Radiologist</h3>
              <p className="text-[10px] text-tdai-muted">Workload distribution overview</p>
            </div>
          </div>
          <div className="p-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.radiologists} dataKey="assignedCount" nameKey="name" outerRadius={90} innerRadius={40} label={{ fontSize: 11 }} paddingAngle={2}>
                    {data.radiologists.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)", fontSize: "12px" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Pending Reports Table */}
      <motion.div variants={item} className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-red-50 dark:bg-tdai-red-950/30">
              <Clock className="h-4 w-4 text-tdai-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-tdai-text">Pending Reports</h3>
              <p className="text-[10px] text-tdai-muted">Sorted by highest turnaround time</p>
            </div>
          </div>
          <span className="badge bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200 text-[10px] dark:bg-tdai-red-950/30 dark:text-tdai-red-300 dark:ring-tdai-red-800/50">
            {data.pendingReports.length} pending
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3 text-left">Study ID</th>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">TAT (h)</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tdai-border-light">
              {data.pendingReports.slice(0, 20).map((study, i) => (
                <motion.tr
                  key={study.studyId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25 }}
                  className="table-row-hover"
                >
                  <td className="table-cell font-mono text-xs">{study.studyId.slice(0, 12)}</td>
                  <td className="table-cell font-medium">{study.patientName ?? "—"}</td>
                  <td className="table-cell">
                    <span className={`badge ${study.currentTatHours > 24 ? "bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200 dark:bg-tdai-red-950/30 dark:text-tdai-red-300 dark:ring-tdai-red-800/50" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/50"}`}>
                      {study.currentTatHours.toFixed(2)}h
                    </span>
                  </td>
                  <td className="table-cell">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="btn-primary !px-3 !py-1.5 text-xs"
                      type="button"
                      onClick={() => void sendReminder(study.studyId)}
                    >
                      <Send className="h-3 w-3" />
                      Send reminder
                    </motion.button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {reminderStatus && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border-t border-emerald-200 bg-emerald-50 px-5 py-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300"
          >
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </div>
              {reminderStatus}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Longest TAT Table */}
      <motion.div variants={item} className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-gray-100 dark:bg-white/[0.06]">
            <TrendingUp className="h-4 w-4 text-tdai-gray-500 dark:text-tdai-gray-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-tdai-text">Longest TAT (Reported)</h3>
            <p className="text-[10px] text-tdai-muted">Historical turnaround time analysis</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3 text-left">Study ID</th>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">TAT (h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tdai-border-light">
              {data.longestTat.map((study, i) => (
                <motion.tr
                  key={study.studyId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25 }}
                  className="table-row-hover"
                >
                  <td className="table-cell font-mono text-xs">{study.studyId.slice(0, 12)}</td>
                  <td className="table-cell font-medium">{study.patientName ?? "—"}</td>
                  <td className="table-cell">
                    <span className="badge bg-tdai-surface-alt text-tdai-secondary">{(study.tatHours ?? 0).toFixed(2)}h</span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}
