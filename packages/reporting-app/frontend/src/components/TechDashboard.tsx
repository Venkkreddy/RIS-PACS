import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { RadiologyOrder, OrderStatus, Patient } from "@medical-report-system/shared";
import { useAuthRole } from "../hooks/useAuthRole";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatIsoDateDisplay } from "../lib/dateDisplay";
import { Worklist } from "./Worklist";
import { motion, AnimatePresence, animate } from "framer-motion";
import { Calendar, CheckCircle2, Zap, User, Trash2, Search, Users } from "lucide-react";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  },
};

const tabPanelTransition = {
  duration: 0.35,
  ease: [0.16, 1, 0.3, 1] as const,
};

function AnimatedCounter({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const isFirst = useRef(true);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = isFirst.current ? 0 : prev.current;
    isFirst.current = false;
    prev.current = value;
    const controls = animate(from, value, {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

const statusStyle: Record<OrderStatus, string> = {
  scheduled: "bg-status-scheduled text-white",
  "in-progress": "bg-status-in-progress text-white",
  completed: "bg-status-completed text-white",
  cancelled: "bg-slate-400 text-white",
};

const statusLabel: Record<OrderStatus, string> = {
  scheduled: "Scheduled",
  "in-progress": "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function toTimeStr(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TechDashboard() {
  const auth = useAuthRole();
  const queryClient = useQueryClient();
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"today" | "upcoming" | "worklist" | "patients">("today");
  const [patientSearch, setPatientSearch] = useState("");
  const debouncedPatientSearch = useDebouncedValue(patientSearch, 400);
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin = auth.role === "admin" || auth.role === "super_admin";
  const canDelete = isAdmin || auth.hasPermission("patients:delete");

  const patientsQuery = useQuery({
    queryKey: ["patients", debouncedPatientSearch],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients", { params: debouncedPatientSearch ? { search: debouncedPatientSearch } : {} });
      return res.data;
    },
    enabled: tab === "patients",
    staleTime: 5000,
    retry: 1,
  });

  const patients = patientsQuery.data ?? [];

  async function handleDeletePatient() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/patients/${deleteTarget.id}`);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
      await queryClient.invalidateQueries({ queryKey: ["worklist"] });
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error ?? err.message ?? "Failed to delete patient");
    } finally {
      setDeleting(false);
    }
  }

  async function load() {
    setLoading(true);
    const res = await api.get<RadiologyOrder[]>("/orders", { params: { status: "scheduled" } });
    setOrders(res.data);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const todayOrders = orders.filter((o) => new Date(o.scheduledDate).toISOString().slice(0, 10) === todayStr);
  const upcomingOrders = orders.filter((o) => new Date(o.scheduledDate).toISOString().slice(0, 10) > todayStr);

  const displayOrders = tab === "today" ? todayOrders : tab === "upcoming" ? upcomingOrders : [];

  /* Sort by time */
  const sorted = [...displayOrders].sort(
    (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(),
  );

  /* Next patient */
  const nextPatient = todayOrders.find(
    (o) => new Date(o.scheduledDate).getTime() > now.getTime() && o.status === "scheduled",
  );

  /* Stats */
  const totalToday = todayOrders.length;
  const completedToday = todayOrders.filter((o) => o.status === "completed").length;
  const inProgress = todayOrders.filter((o) => o.status === "in-progress").length;

  async function checkIn(orderId: string) {
    await api.patch(`/orders/${encodeURIComponent(orderId)}`, { status: "in-progress" as OrderStatus });
    await load();
  }

  async function markComplete(orderId: string) {
    await api.patch(`/orders/${encodeURIComponent(orderId)}`, { status: "completed" as OrderStatus });
    await load();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-tdai-background dark:bg-tdai-gray-950"
    >
      {/* ── Title bar ─────────────── */}
      <div className="bg-gradient-to-r from-tdai-navy-800 to-tdai-navy-700 px-6 py-2.5 dark:from-tdai-navy-900 dark:to-tdai-navy-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 dark:bg-white/[0.08]">
            <svg
              className="h-3.5 w-3.5 text-tdai-teal-400 dark:text-tdai-teal-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <span className="text-sm font-bold tracking-wider text-white">TECHNOLOGIST CONSOLE</span>
        </div>
      </div>

      <div className="dashboard-inner">
        {/* ── KPI summary ────────────── */}
        <motion.div
          className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {/* Today's total */}
          <motion.div
            variants={item}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden card-hover px-5 py-5"
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tdai-teal-500/10 via-tdai-teal-400/5 to-tdai-navy-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-teal-500/5 dark:via-tdai-teal-400/[0.03] dark:to-tdai-navy-600/5" />
            <div className="relative z-10 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">
                  Today's Exams
                </p>
                <p className="mt-1 text-3xl font-bold text-tdai-text dark:text-tdai-gray-100">
                  <AnimatedCounter value={totalToday} />
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
                <Calendar className="h-5 w-5 text-tdai-teal-500 dark:text-tdai-teal-400" strokeWidth={1.75} />
              </div>
            </div>
          </motion.div>
          {/* Completed */}
          <motion.div
            variants={item}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden card-hover px-5 py-5"
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-emerald-400/5 to-tdai-navy-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-emerald-500/5 dark:via-emerald-400/[0.03] dark:to-tdai-navy-600/5" />
            <div className="relative z-10 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Completed</p>
                <p className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  <AnimatedCounter value={completedToday} />
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 dark:text-emerald-400" strokeWidth={1.75} />
              </div>
            </div>
          </motion.div>
          {/* In progress */}
          <motion.div
            variants={item}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden card-hover px-5 py-5"
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-tdai-navy-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-amber-500/5 dark:via-amber-400/[0.03] dark:to-tdai-navy-600/5" />
            <div className="relative z-10 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">In Progress</p>
                <p className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">
                  <AnimatedCounter value={inProgress} />
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
                <Zap className="h-5 w-5 text-amber-500 dark:text-amber-400" strokeWidth={1.75} />
              </div>
            </div>
          </motion.div>
          {/* Next patient */}
          <motion.div
            variants={item}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="group relative overflow-hidden card-hover border-l-4 border-l-tdai-teal-500 px-5 py-5 dark:border-l-tdai-teal-400"
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tdai-teal-500/10 via-transparent to-tdai-navy-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-teal-500/5 dark:to-tdai-navy-600/5" />
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Next Patient</p>
                <User className="h-4 w-4 shrink-0 text-tdai-teal-500 dark:text-tdai-teal-400" strokeWidth={1.75} />
              </div>
              {nextPatient ? (
                <>
                  <p className="mt-1 text-lg font-bold text-tdai-text dark:text-tdai-gray-100">{nextPatient.patientName ?? "Unknown"}</p>
                  <p className="mt-0.5 text-xs font-medium text-tdai-teal-600 dark:text-tdai-teal-400">
                    {toTimeStr(new Date(nextPatient.scheduledDate))} — {nextPatient.modality}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-tdai-muted dark:text-tdai-gray-400">No more patients today</p>
              )}
            </div>
          </motion.div>
        </motion.div>

        {/* ── Tab toggle ─────────────── */}
        <div className="mb-4 flex items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
            onClick={() => setTab("today")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
              tab === "today"
                ? "bg-tdai-navy-700 text-white dark:bg-tdai-navy-600"
                : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt dark:border-white/[0.08] dark:bg-tdai-gray-900 dark:text-tdai-gray-400 dark:hover:bg-white/[0.06]"
            }`}
          >
            Today's Schedule
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] dark:bg-white/20">
              {totalToday}
            </span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
            onClick={() => setTab("upcoming")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
              tab === "upcoming"
                ? "bg-tdai-navy-700 text-white dark:bg-tdai-navy-600"
                : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt dark:border-white/[0.08] dark:bg-tdai-gray-900 dark:text-tdai-gray-400 dark:hover:bg-white/[0.06]"
            }`}
          >
            Upcoming
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] dark:bg-white/20">
              {upcomingOrders.length}
            </span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
            onClick={() => setTab("worklist")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
              tab === "worklist"
                ? "bg-tdai-navy-700 text-white dark:bg-tdai-navy-600"
                : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt dark:border-white/[0.08] dark:bg-tdai-gray-900 dark:text-tdai-gray-400 dark:hover:bg-white/[0.06]"
            }`}
          >
            Study Worklist
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
            onClick={() => setTab("patients")}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
              tab === "patients"
                ? "bg-tdai-navy-700 text-white dark:bg-tdai-navy-600"
                : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt dark:border-white/[0.08] dark:bg-tdai-gray-900 dark:text-tdai-gray-400 dark:hover:bg-white/[0.06]"
            }`}
          >
            <Users className="mr-1 inline h-3.5 w-3.5" />
            Patients
            {patients.length > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] dark:bg-white/20">
                {patients.length}
              </span>
            )}
          </motion.button>
          <div className="flex-1" />
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="btn-ghost !py-1.5 text-xs"
            onClick={() => void load()}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </motion.button>
        </div>

        {/* ── Tab panels (layout + height-friendly transitions) ─ */}
        <motion.div
          layout
          className="overflow-hidden"
          transition={{ layout: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {tab === "worklist" && (
              <motion.div
                key="worklist"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={tabPanelTransition}
              >
                <Worklist hideAssignment />
              </motion.div>
            )}

            {tab === "patients" && (
              <motion.div
                key="patients"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={tabPanelTransition}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-tdai-text dark:text-tdai-gray-100">Patient Registry</h2>
                      <p className="text-xs text-tdai-secondary dark:text-tdai-gray-400 mt-0.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-tdai-teal-50 px-2 py-0.5 text-tdai-teal-700 ring-1 ring-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:ring-tdai-teal-700/50">
                          {patients.length} patients
                        </span>
                        {patientsQuery.isFetching && <span className="ml-2 text-tdai-muted">Searching…</span>}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted dark:text-tdai-gray-400" />
                    <input
                      className="input-field pl-10"
                      placeholder="Search by name or MRN..."
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                    />
                  </div>

                  {patientsQuery.isLoading && (
                    <div className="flex items-center justify-center py-16">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-tdai-gray-700 dark:border-t-tdai-teal-400" />
                    </div>
                  )}

                  {patientsQuery.error && (
                    <div className="rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-3 text-sm text-tdai-red-700 dark:border-tdai-red-800/50 dark:bg-tdai-red-900/20 dark:text-tdai-red-300">
                      Failed to load patients. Please try again.
                    </div>
                  )}

                  {!patientsQuery.isLoading && !patientsQuery.error && (
                    <div className="card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="table-header">
                            <tr>
                              <th className="px-4 py-3.5">MRN</th>
                              <th className="px-4 py-3.5">Patient Name</th>
                              <th className="px-4 py-3.5">Date of Birth</th>
                              <th className="px-4 py-3.5">Gender</th>
                              <th className="px-4 py-3.5">Phone</th>
                              <th className="px-4 py-3.5">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {patients.map((p) => (
                              <tr key={p.id} className="table-row-hover">
                                <td className="table-cell font-mono text-xs text-tdai-accent">{p.patientId}</td>
                                <td className="table-cell font-medium">{p.firstName} {p.lastName}</td>
                                <td className="table-cell text-tdai-secondary">{formatIsoDateDisplay(p.dateOfBirth)}</td>
                                <td className="table-cell">
                                  <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    {p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"}
                                  </span>
                                </td>
                                <td className="table-cell text-tdai-secondary">{p.phone ?? "—"}</td>
                                <td className="table-cell">
                                  {canDelete && (
                                    <button
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-all duration-150 hover:bg-red-100 hover:border-red-300 hover:shadow-sm dark:border-red-600 dark:bg-red-800/30 dark:text-red-300 dark:hover:bg-red-700/40"
                                      onClick={() => { setDeleteError(null); setDeleteTarget(p); }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Delete
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {patients.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-4 py-16 text-center">
                                  <Users className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50 dark:text-tdai-gray-500" />
                                  <p className="text-sm font-medium text-tdai-secondary dark:text-tdai-gray-300">No patients found</p>
                                  <p className="text-xs text-tdai-muted dark:text-tdai-gray-400 mt-1">
                                    {patientSearch ? "Try a different search term" : "No patients registered yet"}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {tab !== "worklist" && tab !== "patients" && loading && (
              <motion.div
                key="loading"
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={tabPanelTransition}
                className="flex items-center justify-center overflow-hidden py-20"
              >
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-tdai-gray-700 dark:border-t-tdai-teal-400" />
              </motion.div>
            )}

            {tab !== "worklist" && tab !== "patients" && !loading && sorted.length === 0 && (
              <motion.div
                key="empty"
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={tabPanelTransition}
                className="overflow-hidden"
              >
                <div className="card py-16 text-center">
                  <Calendar className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" strokeWidth={1} />
                  <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">
                    No {tab === "today" ? "exams scheduled today" : "upcoming exams"}
                  </p>
                </div>
              </motion.div>
            )}

            {tab !== "worklist" && tab !== "patients" && !loading && sorted.length > 0 && (
              <motion.div
                key={`list-${tab}`}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={tabPanelTransition}
                className="overflow-hidden"
              >
                <motion.div
                  key={tab}
                  className="space-y-3"
                  variants={container}
                  initial="hidden"
                  animate="show"
                >
                  {sorted.map((order) => {
                    const time = new Date(order.scheduledDate);
                    const isNow = order.status === "in-progress";
                    const isDone = order.status === "completed";
                    return (
                      <motion.div
                        key={order.id}
                        variants={item}
                        layout
                        className={`group relative overflow-hidden card flex items-center gap-5 px-5 py-4 transition-all ${
                          isNow
                            ? "border-l-4 border-l-amber-500 bg-amber-50/30 dark:border-l-amber-400 dark:bg-amber-900/20"
                            : isDone
                              ? "opacity-60"
                              : "hover:shadow-card-hover dark:hover:shadow-[0_10px_25px_-5px_rgba(0,0,0,0.35),0_4px_6px_-2px_rgba(0,0,0,0.2)]"
                        }`}
                      >
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-tdai-navy-700/0 via-tdai-teal-500/5 to-tdai-navy-700/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:via-tdai-teal-500/10" />
                        <div className="relative z-10 flex w-full items-center gap-5">
                          {/* Time */}
                          <div className="w-16 text-center">
                            <p className="text-lg font-bold text-tdai-navy-700 dark:text-tdai-gray-100">{toTimeStr(time)}</p>
                          </div>

                          <div className="h-10 w-px bg-tdai-border dark:bg-white/10" />

                          {/* Patient info */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-tdai-text dark:text-tdai-gray-100">
                                {order.patientName ?? "Unknown"}
                              </p>
                              <span className={`badge text-[10px] ${statusStyle[order.status]}`}>
                                {statusLabel[order.status]}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-tdai-secondary dark:text-tdai-gray-400">
                              <span className="flex items-center gap-1">
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                  />
                                </svg>
                                {order.id.slice(0, 10)}
                              </span>
                              <span className="rounded bg-tdai-navy-50 px-1.5 py-0.5 text-[10px] font-bold text-tdai-navy-700 dark:bg-tdai-navy-900/50 dark:text-tdai-gray-200">
                                {order.modality}
                              </span>
                              {order.bodyPart && <span>{order.bodyPart}</span>}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            {order.status === "scheduled" && (
                              <motion.button
                                type="button"
                                whileTap={{ scale: 0.97 }}
                                transition={{ duration: 0.15 }}
                                className="btn-primary !py-1.5 text-xs"
                                onClick={() => void checkIn(order.id)}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Check In
                              </motion.button>
                            )}
                            {order.status === "in-progress" && (
                              <motion.button
                                type="button"
                                whileTap={{ scale: 0.97 }}
                                transition={{ duration: 0.15 }}
                                className="btn-primary !bg-emerald-600 !py-1.5 text-xs hover:!bg-emerald-700 dark:!bg-emerald-700 dark:hover:!bg-emerald-600"
                                onClick={() => void markComplete(order.id)}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                Mark Complete
                              </motion.button>
                            )}
                            {order.status === "completed" && (
                              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Done
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl animate-slide-up dark:bg-tdai-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-tdai-text dark:text-tdai-gray-100">Delete Patient</h3>
                  <p className="mt-1 text-sm text-tdai-secondary dark:text-tdai-gray-400">
                    Are you sure you want to delete{" "}
                    <span className="font-medium text-tdai-text dark:text-tdai-gray-100">
                      {deleteTarget.firstName} {deleteTarget.lastName}
                    </span>{" "}
                    (MRN: {deleteTarget.patientId})? This action cannot be undone.
                  </p>
                </div>
              </div>
              {deleteError && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-tdai-border px-6 py-4 dark:border-white/10">
              <button
                className="btn-secondary !rounded-lg !px-4 !py-2"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                onClick={handleDeletePatient}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete Patient"}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
