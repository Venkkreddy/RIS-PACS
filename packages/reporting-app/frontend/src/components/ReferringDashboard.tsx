import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuthRole } from "../hooks/useAuthRole";
import { motion } from "framer-motion";
import type { Modality, RadiologyOrder } from "@medical-report-system/shared";

const MODALITIES: Modality[] = ["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"];

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [modality, setModality] = useState<Modality>("CT");
  const [bodyPart, setBodyPart] = useState("");
  const [priority, setPriority] = useState<"routine" | "urgent" | "stat">("routine");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/orders", {
        patientId,
        patientName,
        modality,
        bodyPart,
        priority,
        status: "scheduled",
        scheduledDate,
        clinicalHistory: clinicalHistory || undefined,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="card w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-tdai-text dark:text-tdai-gray-100">New Imaging Order</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input className="input-field" placeholder="Patient ID" value={patientId} onChange={(e) => setPatientId(e.target.value)} required />
            <input className="input-field" placeholder="Patient Name" value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className="input-field" value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
              {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input className="input-field" placeholder="Body Part" value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="stat">STAT</option>
            </select>
            <input className="input-field" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required />
          </div>
          <textarea
            className="input-field"
            placeholder="Clinical history (optional)"
            value={clinicalHistory}
            onChange={(e) => setClinicalHistory(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary !rounded-lg !px-4 !py-2 text-xs" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary !rounded-lg !px-4 !py-2 text-xs">
              {submitting ? "Creating..." : "Create Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const statusBadge: Record<string, string> = {
  scheduled:
    "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/50",
  "in-progress":
    "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50",
  completed:
    "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:ring-tdai-teal-700/50",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400",
};

export function ReferringDashboard() {
  const auth = useAuthRole();
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNewOrder, setShowNewOrder] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get<RadiologyOrder[]>("/orders");
    setOrders(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = search
    ? orders.filter((o) => o.patientName?.toLowerCase().includes(search.toLowerCase()))
    : orders;

  const totalOrders = orders.length;
  const pendingResults = orders.filter((o) => o.status !== "completed").length;
  const reportsReady = orders.filter((o) => o.reportId || o.status === "completed").length;

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
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10">
            <svg className="h-3.5 w-3.5 text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <span className="text-sm font-bold tracking-wider text-white">MY PATIENTS &amp; RESULTS</span>
        </div>
      </div>

      <div className="dashboard-inner">
        {/* ── Welcome banner ────────── */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-tdai-navy-700 to-tdai-navy-500 p-6 text-white dark:from-tdai-navy-800 dark:to-tdai-navy-600 dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]">
          <h1 className="text-xl font-bold">Welcome, Dr. {auth.email?.split("@")[0] ?? "Physician"}</h1>
          <p className="mt-1 text-sm text-white/70">View your patients' imaging results and order status</p>
        </div>

        {/* ── KPI cards ──────────────── */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="card-hover px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Total Orders</p>
                <p className="mt-1 text-3xl font-bold text-tdai-text dark:text-tdai-gray-100">{totalOrders}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-navy-50 dark:bg-white/[0.06]">
                <svg className="h-5 w-5 text-tdai-navy-500 dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
            </div>
          </div>
          <div className="card-hover px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Pending Results</p>
                <p className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">{pendingResults}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
                <svg className="h-5 w-5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
            </div>
          </div>
          <div className="card-hover px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Reports Ready</p>
                <p className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{reportsReady}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                <svg className="h-5 w-5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
            </div>
          </div>
        </div>

        {/* ── Search bar ──────────────── */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              className="input-field !pl-10"
              placeholder="Search by patient name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-secondary !rounded-lg !px-4 !py-2.5 text-xs" onClick={() => void load()}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
          {auth.hasPermission("orders:create") && (
            <button className="btn-primary !rounded-lg !px-4 !py-2.5 text-xs" onClick={() => setShowNewOrder(true)}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Order
            </button>
          )}
        </div>

        {showNewOrder && (
          <NewOrderModal onClose={() => setShowNewOrder(false)} onCreated={() => void load()} />
        )}

        {/* ── Loading ─────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-tdai-gray-700 dark:border-t-tdai-teal-400" />
          </div>
        )}

        {/* ── Empty state ─────────────── */}
        {!loading && filtered.length === 0 && (
          <div className="card py-16 text-center">
            <svg className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">No orders found</p>
          </div>
        )}

        {/* ── Orders list — clean card layout ── */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((order) => {
              const date = new Date(order.scheduledDate);
              const isReady = order.status === "completed";
              return (
                <div
                  key={order.id}
                  className={`card flex items-center gap-5 px-5 py-4 transition-all hover:shadow-card-hover dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_28px_-8px_rgba(0,0,0,0.55)] ${
                    isReady ? "border-l-4 border-l-emerald-500 dark:border-l-emerald-400" : ""
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tdai-navy-100 text-sm font-semibold text-tdai-navy-700 dark:bg-tdai-navy-800/60 dark:text-tdai-gray-100">
                    {(order.patientName ?? "?")?.[0]?.toUpperCase()}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-tdai-text dark:text-tdai-gray-100">{order.patientName ?? "Unknown"}</p>
                      <span className={`badge text-[10px] ${statusBadge[order.status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300"}`}>
                        {order.status.replace("-", " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-tdai-secondary dark:text-tdai-gray-400">
                      <span className="font-mono text-[10px] text-tdai-muted">{order.patientId}</span>
                      <span className="rounded bg-tdai-navy-50 px-1.5 py-0.5 text-[10px] font-bold text-tdai-navy-700 dark:bg-white/[0.06] dark:text-tdai-gray-200">{order.modality}</span>
                      {order.bodyPart && <span>{order.bodyPart}</span>}
                      <span>{date.toLocaleDateString()}</span>
                      {order.referringPhysicianName && <span>Ref: {order.referringPhysicianName}</span>}
                    </div>
                  </div>

                  {isReady ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm dark:border-tdai-teal-600 dark:bg-tdai-teal-800/30 dark:text-tdai-teal-300 dark:hover:bg-tdai-teal-700/40"
                      onClick={() => {
                        if (order.reportId) window.open(`/reports/${order.reportId}`, "_blank");
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      View Report
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Awaiting results
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
