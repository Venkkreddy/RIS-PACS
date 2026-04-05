import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { RadiologyOrder, Modality, OrderPriority, OrderStatus, Patient, ReferringPhysician } from "@medical-report-system/shared";

const MODALITIES: Modality[] = ["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"];
const PRIORITIES: OrderPriority[] = ["routine", "urgent", "stat"];
const STATUSES: OrderStatus[] = ["scheduled", "in-progress", "completed", "cancelled"];

const priorityStyle: Record<OrderPriority, string> = {
  routine: "bg-slate-100 text-slate-600",
  urgent: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  stat: "bg-red-50 text-red-700 ring-1 ring-red-200",
};
const statusStyle: Record<OrderStatus, string> = {
  scheduled: "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
  "in-progress": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500",
};

export function OrdersPage() {
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [physicians, setPhysicians] = useState<ReferringPhysician[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    patientId: "", referringPhysicianId: "", modality: "CR" as Modality, bodyPart: "",
    clinicalHistory: "", priority: "routine" as OrderPriority, scheduledDate: "", notes: "",
  });

  async function load() {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (search) params.search = search;
    const [ordersRes, patientsRes, physiciansRes] = await Promise.all([
      api.get<RadiologyOrder[]>("/orders", { params }),
      api.get<Patient[]>("/patients"),
      api.get<ReferringPhysician[]>("/referring-physicians"),
    ]);
    setOrders(ordersRes.data);
    setPatients(patientsRes.data);
    setPhysicians(physiciansRes.data);
  }

  useEffect(() => { void load(); }, [statusFilter, search]);

  function resetForm() {
    setForm({ patientId: "", referringPhysicianId: "", modality: "CR", bodyPart: "", clinicalHistory: "", priority: "routine", scheduledDate: "", notes: "" });
    setShowForm(false);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const patient = patients.find((p) => p.id === form.patientId);
    if (!patient) { setError("Select a patient"); return; }
    const physician = physicians.find((p) => p.id === form.referringPhysicianId);
    try {
      await api.post("/orders", {
        ...form,
        patientName: `${patient.firstName} ${patient.lastName}`,
        referringPhysicianName: physician?.name,
      });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed");
    }
  }

  async function updateStatus(orderId: string, status: OrderStatus) {
    const patch: Record<string, string> = { status };
    if (status === "completed") patch.completedDate = new Date().toISOString();
    await api.patch(`/orders/${orderId}`, patch);
    await load();
  }

  const scheduled = orders.filter(o => o.status === "scheduled").length;
  const inProgress = orders.filter(o => o.status === "in-progress").length;
  const completed = orders.filter(o => o.status === "completed").length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="page-header">Radiology Orders</h1>
          <p className="page-subheader mt-1">Create and manage imaging requests</p>
        </div>
        <button className="btn-primary !rounded-lg !px-5 !py-2.5" onClick={() => { resetForm(); setShowForm(true); }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Order
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="card-hover px-5 py-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-teal-50 text-tdai-teal-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tdai-text">{scheduled}</p>
            <p className="text-xs text-tdai-muted">Scheduled</p>
          </div>
        </div>
        <div className="card-hover px-5 py-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tdai-text">{inProgress}</p>
            <p className="text-xs text-tdai-muted">In Progress</p>
          </div>
        </div>
        <div className="card-hover px-5 py-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tdai-text">{completed}</p>
            <p className="text-xs text-tdai-muted">Completed</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input className="input-field pl-10" placeholder="Search patient, body part..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-6 animate-slide-up">
          <div className="border-b border-tdai-border px-6 py-4">
            <h2 className="text-lg font-semibold text-tdai-text">New Radiology Order</h2>
            <p className="text-xs text-tdai-muted mt-0.5">Fill in the order details below</p>
          </div>
          <form className="p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Patient *</label>
                <select className="select-field w-full" value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} required>
                  <option value="">Select Patient</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.patientId} — {p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Referring Physician</label>
                <select className="select-field w-full" value={form.referringPhysicianId} onChange={(e) => setForm({ ...form, referringPhysicianId: e.target.value })}>
                  <option value="">Optional</option>
                  {physicians.map((p) => <option key={p.id} value={p.id}>{p.name}{p.hospital ? ` — ${p.hospital}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Modality</label>
                <select className="select-field w-full" value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value as Modality })}>
                  {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Body Part *</label>
                <input className="input-field" placeholder="e.g. Chest, Abdomen" value={form.bodyPart} onChange={(e) => setForm({ ...form, bodyPart: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Priority</label>
                <select className="select-field w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as OrderPriority })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Scheduled Date *</label>
                <input className="input-field" type="datetime-local" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} required />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Clinical History</label>
                <textarea className="input-field" rows={2} placeholder="Relevant clinical history" value={form.clinicalHistory} onChange={(e) => setForm({ ...form, clinicalHistory: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Notes</label>
                <textarea className="input-field" rows={2} placeholder="Additional notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{error}</p>}
            <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
              <button className="btn-primary !rounded-lg !px-5 !py-2.5" type="submit">Create Order</button>
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
                <th className="px-4 py-3.5">Modality</th>
                <th className="px-4 py-3.5">Body Part</th>
                <th className="px-4 py-3.5">Priority</th>
                <th className="px-4 py-3.5">Scheduled</th>
                <th className="px-4 py-3.5">Ref. Physician</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="table-row-hover">
                  <td className="table-cell">
                    <div>
                      <p className="font-medium text-tdai-text">{o.patientName}</p>
                      <p className="font-mono text-[10px] text-tdai-accent">{o.patientId}</p>
                    </div>
                  </td>
                  <td className="table-cell"><span className="badge bg-tdai-navy-50 text-tdai-navy-700 font-mono ring-1 ring-tdai-navy-200">{o.modality}</span></td>
                  <td className="table-cell">{o.bodyPart}</td>
                  <td className="table-cell"><span className={`badge ${priorityStyle[o.priority]}`}>{o.priority}</span></td>
                  <td className="table-cell text-xs text-tdai-secondary">{new Date(o.scheduledDate).toLocaleString()}</td>
                  <td className="table-cell text-xs text-tdai-secondary">{o.referringPhysicianName ?? "—"}</td>
                  <td className="table-cell"><span className={`badge ${statusStyle[o.status]}`}>{o.status}</span></td>
                  <td className="table-cell">
                    <select className="select-field !py-1.5 !px-2 text-xs" value={o.status} onChange={(e) => void updateStatus(o.id, e.target.value as OrderStatus)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <p className="text-sm font-medium text-tdai-secondary">No orders yet</p>
                    <p className="text-xs text-tdai-muted mt-1">Create a new radiology order to get started</p>
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
