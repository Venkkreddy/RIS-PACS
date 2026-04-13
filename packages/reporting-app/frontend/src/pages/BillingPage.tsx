import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatInr } from "../lib/currency";
import type { BillingRecord, BillingStatus, Patient } from "@medical-report-system/shared";

const statusStyle: Record<BillingStatus, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  invoiced: "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
  paid: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500",
};

export function BillingPage() {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ patientId: "", patientName: "", orderId: "", description: "", amount: "", status: "pending" as BillingStatus, selectedPatientDbId: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    const [billingRes, patientsRes] = await Promise.all([
      api.get<BillingRecord[]>("/billing", { params }),
      api.get<Patient[]>("/patients"),
    ]);
    setRecords(billingRes.data);
    setPatients(patientsRes.data);
  }

  useEffect(() => { void load(); }, [search, statusFilter]);

  function resetForm() { setForm({ patientId: "", patientName: "", orderId: "", description: "", amount: "", status: "pending", selectedPatientDbId: "" }); setEditId(null); setShowForm(false); setError(null); }

  function startEdit(r: BillingRecord) {
    const matchedPatient = patients.find((p) => p.patientId === r.patientId || p.id === r.patientId);
    setForm({ patientId: r.patientId, patientName: r.patientName ?? "", orderId: r.orderId ?? "", description: r.description, amount: String(r.amount), status: r.status, selectedPatientDbId: matchedPatient?.id ?? "" });
    setEditId(r.id);
    setShowForm(true);
  }

  function handlePatientSelect(dbId: string) {
    const patient = patients.find((p) => p.id === dbId);
    if (patient) {
      setForm({ ...form, selectedPatientDbId: dbId, patientId: patient.patientId, patientName: `${patient.firstName} ${patient.lastName}` });
    } else {
      setForm({ ...form, selectedPatientDbId: "", patientId: "", patientName: "" });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.patientId && !form.selectedPatientDbId) {
      setError("Please select a patient from the registry");
      return;
    }
    try {
      const { selectedPatientDbId: _, ...rest } = form;
      const payload = { ...rest, amount: parseFloat(rest.amount) };
      if (editId) {
        await api.patch(`/billing/${editId}`, payload);
      } else {
        await api.post("/billing", payload);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed");
    }
  }

  async function changeStatus(id: string, status: BillingStatus) {
    await api.patch(`/billing/${id}`, { status });
    await load();
  }

  const totalPending = records.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0);
  const totalPaid = records.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
  const totalInvoiced = records.filter((r) => r.status === "invoiced").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="page-header">Billing</h1>
          <p className="page-subheader mt-1">Track charges, invoices, and payments</p>
        </div>
        <button className="btn-primary !rounded-lg !px-5 !py-2.5" onClick={() => { resetForm(); setShowForm(true); }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Charge
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-hover px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-amber-600">Pending</p>
              <p className="mt-1 text-2xl font-semibold text-tdai-text">{formatInr(totalPending)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
              <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
        <div className="card-hover px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-tdai-teal-600">Invoiced</p>
              <p className="mt-1 text-2xl font-semibold text-tdai-text">{formatInr(totalInvoiced)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-teal-50">
              <svg className="h-5 w-5 text-tdai-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
          </div>
        </div>
        <div className="card-hover px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-600">Paid</p>
              <p className="mt-1 text-2xl font-semibold text-tdai-text">{formatInr(totalPaid)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input className="input-field pl-10" placeholder="Search by patient or description..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="invoiced">Invoiced</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-6 animate-slide-up">
          <div className="border-b border-tdai-border px-6 py-4">
            <h2 className="text-lg font-semibold text-tdai-text">{editId ? "Edit Charge" : "New Billing Charge"}</h2>
            <p className="text-xs text-tdai-muted mt-0.5">Enter the billing details below</p>
          </div>
          <form className="p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Patient *</label>
                <select className="select-field w-full" value={form.selectedPatientDbId} onChange={(e) => handlePatientSelect(e.target.value)} required>
                  <option value="">Select Patient from Registry</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.patientId} — {p.firstName} {p.lastName}</option>)}
                </select>
                {form.patientName && (
                  <p className="mt-1 text-xs text-tdai-muted">Selected: {form.patientName} (MRN: {form.patientId})</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Order ID</label>
                <input className="input-field" placeholder="Related order ID" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-tdai-muted" aria-hidden>₹</span>
                  <input className="input-field pl-8" type="number" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Description *</label>
                <input className="input-field" placeholder="Service description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Status</label>
                <select className="select-field w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BillingStatus })}>
                  <option value="pending">Pending</option>
                  <option value="invoiced">Invoiced</option>
                  <option value="paid">Paid</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{error}</p>}
            <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
              <button className="btn-primary !rounded-lg !px-5 !py-2.5" type="submit">{editId ? "Update Charge" : "Create Charge"}</button>
              <button className="btn-secondary !rounded-lg !px-5 !py-2.5" type="button" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3.5">Patient</th>
                <th className="px-4 py-3.5">Description</th>
                <th className="px-4 py-3.5">Amount</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="table-row-hover">
                  <td className="table-cell">
                    <div>
                      <p className="font-medium text-tdai-text">{r.patientName || "Unknown"}</p>
                      <p className="text-[10px] font-mono text-tdai-muted">{r.patientId}</p>
                    </div>
                  </td>
                  <td className="table-cell text-tdai-secondary">{r.description}</td>
                  <td className="table-cell font-semibold font-mono">{formatInr(r.amount)}</td>
                  <td className="table-cell">
                    <span className={`badge ${statusStyle[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="table-cell text-xs text-tdai-secondary">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm" onClick={() => startEdit(r)}>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Edit
                      </button>
                      {r.status === "pending" && (
                        <button className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm" onClick={() => changeStatus(r.id, "invoiced")}>Invoice</button>
                      )}
                      {r.status === "invoiced" && (
                        <button className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm" onClick={() => changeStatus(r.id, "paid")}>Mark Paid</button>
                      )}
                      {r.status !== "cancelled" && r.status !== "paid" && (
                        <button className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-all duration-150 hover:bg-red-100 hover:border-red-300 hover:shadow-sm" onClick={() => changeStatus(r.id, "cancelled")}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    <p className="text-sm font-medium text-tdai-secondary">No billing records found</p>
                    <p className="text-xs text-tdai-muted mt-1">Create a new charge to get started</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
