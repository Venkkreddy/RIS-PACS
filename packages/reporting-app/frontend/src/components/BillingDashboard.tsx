import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatInr } from "../lib/currency";
import type { BillingRecord, BillingStatus } from "@medical-report-system/shared";
import { animate, motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  FileText,
  IndianRupee,
  Tag,
} from "lucide-react";

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

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
};

const statusStyle: Record<BillingStatus, string> = {
  pending:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-700/40",
  invoiced:
    "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:ring-tdai-teal-700/30",
  paid:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-700/30",
  cancelled:
    "bg-slate-100 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400",
};

function AnimatedMoney({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const ctrl = animate(0, value, {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => ctrl.stop();
  }, [value]);

  return <span>{formatInr(display)}</span>;
}

type BillingTab = "queue" | "coded" | "submitted";

export function BillingDashboard() {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<BillingTab>("queue");
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [cptCode, setCptCode] = useState("");
  const [icdCode, setIcdCode] = useState("");

  async function load() {
    setLoading(true);
    const res = await api.get<BillingRecord[]>("/billing");
    setRecords(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  /* Categorize */
  const queue = records.filter((r) => r.status === "pending");
  const coded = records.filter((r) => r.status === "invoiced");
  const submitted = records.filter((r) => r.status === "paid");

  const displayRecords = tab === "queue" ? queue : tab === "coded" ? coded : submitted;
  const filtered = search
    ? displayRecords.filter((r) => r.patientName?.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase()))
    : displayRecords;

  /* Stats */
  const totalPending = queue.reduce((s, r) => s + r.amount, 0);
  const totalInvoiced = coded.reduce((s, r) => s + r.amount, 0);
  const totalPaid = submitted.reduce((s, r) => s + r.amount, 0);

  async function submitCode(recordId: string, e: FormEvent) {
    e.preventDefault();
    await api.patch(`/billing/${encodeURIComponent(recordId)}`, { status: "invoiced" as BillingStatus, description: `CPT: ${cptCode} | ICD: ${icdCode}` });
    setEditId(null);
    setCptCode("");
    setIcdCode("");
    await load();
  }

  async function markPaid(id: string) {
    await api.patch(`/billing/${encodeURIComponent(id)}`, { status: "paid" as BillingStatus });
    await load();
  }

  const TABS: Array<{ key: BillingTab; label: string; count: number; color: string }> = [
    { key: "queue", label: "Coding Queue", count: queue.length, color: "bg-amber-500" },
    { key: "coded", label: "Coded / Invoiced", count: coded.length, color: "bg-tdai-teal-500" },
    { key: "submitted", label: "Paid / Settled", count: submitted.length, color: "bg-emerald-500" },
  ];

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
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 dark:bg-white/[0.06]">
            <IndianRupee className="h-3.5 w-3.5 text-tdai-teal-400 dark:text-tdai-teal-300" strokeWidth={2} />
          </div>
          <span className="text-sm font-bold tracking-wider text-white">BILLING &amp; CODING</span>
        </div>
      </div>

      <div className="dashboard-inner">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          {/* ── KPI cards ──────────────── */}
          <motion.div
            variants={container}
            className="grid gap-4 sm:grid-cols-3"
          >
            <motion.div
              variants={item}
              whileHover={{ y: -3 }}
              className="group relative overflow-hidden rounded-xl card-hover px-5 py-5"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/0 via-amber-500/[0.04] to-amber-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-amber-500/0 dark:via-amber-500/[0.08] dark:to-amber-600/20"
                aria-hidden
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
                    <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Pending Coding
                    </p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">Awaiting CPT / ICD assignment</p>
                    <p className="mt-2 text-2xl font-bold text-tdai-text dark:text-tdai-gray-100">
                      <AnimatedMoney value={totalPending} />
                    </p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">{queue.length} studies</p>
                  </div>
                </div>
              </div>
            </motion.div>
            <motion.div
              variants={item}
              whileHover={{ y: -3 }}
              className="group relative overflow-hidden rounded-xl card-hover px-5 py-5"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tdai-teal-500/0 via-tdai-teal-500/[0.04] to-tdai-teal-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-teal-500/0 dark:via-tdai-teal-500/[0.08] dark:to-tdai-teal-600/20"
                aria-hidden
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
                    <FileText className="h-5 w-5 text-tdai-teal-500 dark:text-tdai-teal-400" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-teal-600 dark:text-tdai-teal-400">
                      Invoiced
                    </p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">Billed, awaiting payment</p>
                    <p className="mt-2 text-2xl font-bold text-tdai-text dark:text-tdai-gray-100">
                      <AnimatedMoney value={totalInvoiced} />
                    </p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">{coded.length} studies</p>
                  </div>
                </div>
              </div>
            </motion.div>
            <motion.div
              variants={item}
              whileHover={{ y: -3 }}
              className="group relative overflow-hidden rounded-xl card-hover px-5 py-5"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/0 via-emerald-500/[0.04] to-emerald-600/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-emerald-500/0 dark:via-emerald-500/[0.08] dark:to-emerald-600/20"
                aria-hidden
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                    <IndianRupee className="h-5 w-5 text-emerald-500 dark:text-emerald-400" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Paid</p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">Successfully settled claims</p>
                    <p className="mt-2 text-2xl font-bold text-tdai-text dark:text-tdai-gray-100">
                      <AnimatedMoney value={totalPaid} />
                    </p>
                    <p className="mt-0.5 text-xs text-tdai-muted dark:text-tdai-gray-400">{submitted.length} studies</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* ── Tab bar ──────────────────── */}
          <motion.div variants={item} className="flex items-center gap-2">
            {TABS.map((t) => (
              <motion.button
                key={t.key}
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-all ${
                  tab === t.key
                    ? "bg-tdai-navy-700 text-white dark:bg-tdai-navy-600"
                    : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt dark:border-white/[0.08] dark:bg-tdai-gray-900 dark:text-tdai-gray-300 dark:hover:bg-white/[0.06]"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${t.color}`}>{t.count}</span>
              </motion.button>
            ))}
            <div className="flex-1" />
            <div className="relative">
              <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tdai-muted dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                className="input-field !w-52 !py-1.5 !pl-9 text-xs"
                placeholder="Search patient / description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </motion.div>

          {/* ── Loading ─────────────────── */}
          {loading && (
            <motion.div variants={item} className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-white/[0.08] dark:border-t-tdai-teal-400 dark:shadow-none" />
            </motion.div>
          )}

          {/* ── Empty ───────────────────── */}
          {!loading && filtered.length === 0 && (
            <motion.div variants={item} className="card py-16 text-center">
              <IndianRupee className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" strokeWidth={1} />
              <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">No records in this category</p>
            </motion.div>
          )}

          {/* ── Records table ───────────── */}
          {!loading && filtered.length > 0 && (
            <motion.div variants={item} className="table-wrap">
              <div className="border-b border-tdai-border-light bg-tdai-surface-alt/50 px-4 py-3 dark:border-white/[0.08] dark:bg-tdai-gray-800/50">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-tdai-border-light dark:bg-tdai-gray-900 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)] dark:ring-white/[0.08]">
                    <FileText className="h-4 w-4 text-tdai-teal-600 dark:text-tdai-teal-400" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-tdai-text dark:text-tdai-gray-100">Billing records</p>
                    <p className="text-xs text-tdai-muted dark:text-tdai-gray-400">Review amounts, status, and coding actions</p>
                  </div>
                </div>
              </div>
              <table className="w-full min-w-[700px] text-sm">
                <thead className="table-header">
                  <tr>
                    <th>Patient</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tdai-border-light dark:divide-white/[0.08]">
                  {filtered.map((r, i) => (
                    <motion.tr
                      key={r.id}
                      custom={i}
                      variants={rowVariants}
                      initial="hidden"
                      animate="show"
                      className="table-row-hover"
                    >
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tdai-navy-100 text-xs font-semibold text-tdai-navy-700 dark:bg-tdai-navy-800/80 dark:text-tdai-gray-100">
                            {(r.patientName ?? "?")?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-tdai-text dark:text-tdai-gray-100">{r.patientName ?? "Unknown"}</p>
                            <p className="font-mono text-[10px] text-tdai-accent dark:text-tdai-teal-400">MRN: {r.patientId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell text-tdai-secondary dark:text-tdai-gray-400">{r.description}</td>
                      <td className="table-cell font-semibold dark:text-tdai-gray-100">
                        <AnimatedMoney value={r.amount} />
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${statusStyle[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="table-cell">
                        {/* Coding action for queue items */}
                        {r.status === "pending" && editId !== r.id && (
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm dark:border-tdai-teal-600 dark:bg-tdai-teal-800/30 dark:text-tdai-teal-300 dark:hover:bg-tdai-teal-700/40"
                            onClick={() => { setEditId(r.id); setCptCode(""); setIcdCode(""); }}
                          >
                            <Tag className="h-3.5 w-3.5" strokeWidth={2} />
                            Code &amp; Submit
                          </motion.button>
                        )}
                        {/* Inline coding form */}
                        {r.status === "pending" && editId === r.id && (
                          <form className="flex items-center gap-2" onSubmit={(e) => void submitCode(r.id, e)}>
                            <input className="input-field !w-24 !py-1 text-xs" placeholder="CPT code" value={cptCode} onChange={(e) => setCptCode(e.target.value)} required />
                            <input className="input-field !w-24 !py-1 text-xs" placeholder="ICD code" value={icdCode} onChange={(e) => setIcdCode(e.target.value)} required />
                            <motion.button type="submit" whileTap={{ scale: 0.97 }} className="btn-primary !py-1 text-xs">Submit</motion.button>
                            <motion.button type="button" whileTap={{ scale: 0.97 }} className="btn-ghost !py-1 text-xs" onClick={() => setEditId(null)}>Cancel</motion.button>
                          </form>
                        )}
                        {/* Mark as paid for invoiced items */}
                        {r.status === "invoiced" && (
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm dark:border-emerald-600 dark:bg-emerald-800/30 dark:text-emerald-300 dark:hover:bg-emerald-700/40"
                            onClick={() => void markPaid(r.id)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Mark Paid
                          </motion.button>
                        )}
                        {r.status === "paid" && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Settled
                          </span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
