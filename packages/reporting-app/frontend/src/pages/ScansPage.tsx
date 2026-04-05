import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Scan, ScanType, ScanStatus, Modality, Patient } from "@medical-report-system/shared";

const SCAN_TYPES: ScanType[] = ["X-Ray", "CT", "MRI", "Ultrasound", "Mammogram", "Fluoroscopy", "PET", "Nuclear", "Other"];
const MODALITIES: Modality[] = ["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"];
const STATUSES: ScanStatus[] = ["scheduled", "in-progress", "completed", "failed", "cancelled"];

const scanTypeToModality: Partial<Record<ScanType, Modality>> = {
  "X-Ray": "XR",
  CT: "CT",
  MRI: "MR",
  Ultrasound: "US",
  Mammogram: "MG",
  PET: "PT",
  Nuclear: "NM",
};

const statusStyle: Record<ScanStatus, string> = {
  scheduled: "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
  "in-progress": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-1 ring-red-200",
  cancelled: "bg-slate-100 text-slate-500",
};

const scanTypeStyle: Record<ScanType, string> = {
  "X-Ray": "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  CT: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  MRI: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  Ultrasound: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  Mammogram: "bg-pink-50 text-pink-700 ring-1 ring-pink-200",
  Fluoroscopy: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  PET: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  Nuclear: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  Other: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
};

export function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    patientId: "",
    scanType: "X-Ray" as ScanType,
    modality: "XR" as Modality,
    bodyPart: "",
    scanDate: "",
    technician: "",
    radiologist: "",
    contrastUsed: false,
    notes: "",
  });

  async function load() {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (typeFilter) params.scanType = typeFilter;
    if (search) params.search = search;
    const [scansRes, patientsRes] = await Promise.all([
      api.get<Scan[]>("/scans", { params }),
      api.get<Patient[]>("/patients"),
    ]);
    setScans(scansRes.data);
    setPatients(patientsRes.data);
  }

  useEffect(() => { void load(); }, [statusFilter, typeFilter, search]);

  function resetForm() {
    setForm({ patientId: "", scanType: "X-Ray", modality: "XR", bodyPart: "", scanDate: "", technician: "", radiologist: "", contrastUsed: false, notes: "" });
    setShowForm(false);
    setError(null);
  }

  function handleScanTypeChange(scanType: ScanType) {
    const autoModality = scanTypeToModality[scanType];
    setForm({ ...form, scanType, modality: autoModality ?? form.modality });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const patient = patients.find((p) => p.id === form.patientId);
    if (!patient) { setError("Select a patient"); return; }
    try {
      await api.post("/scans", {
        ...form,
        patientName: `${patient.firstName} ${patient.lastName}`,
        status: "scheduled",
      });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed");
    }
  }

  async function updateStatus(scanId: string, status: ScanStatus) {
    await api.patch(`/scans/${scanId}`, { status });
    await load();
  }

  const scheduled = scans.filter((s) => s.status === "scheduled").length;
  const inProgress = scans.filter((s) => s.status === "in-progress").length;
  const completed = scans.filter((s) => s.status === "completed").length;
  const totalImages = scans.reduce((sum, s) => sum + (s.imageCount ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="page-header">Scans &amp; Imaging</h1>
          <p className="page-subheader mt-1">Manage X-rays, CTs, MRIs and all imaging procedures</p>
        </div>
        <button className="btn-primary !rounded-lg !px-5 !py-2.5" onClick={() => { resetForm(); setShowForm(true); }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Scan
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <div className="card-hover px-5 py-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tdai-text">{totalImages}</p>
            <p className="text-xs text-tdai-muted">Total Images</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input className="input-field pl-10" placeholder="Search patient, body part, technician..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select-field" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All scan types</option>
          {SCAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="select-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* New Scan Form */}
      {showForm && (
        <div className="card mb-6 animate-slide-up">
          <div className="border-b border-tdai-border px-6 py-4">
            <h2 className="text-lg font-semibold text-tdai-text">New Scan</h2>
            <p className="text-xs text-tdai-muted mt-0.5">Schedule a new imaging procedure</p>
          </div>
          <form className="p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Patient *</label>
                <select className="select-field w-full" value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} required>
                  <option value="">Select Patient</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.patientId} — {p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Scan Type *</label>
                <select className="select-field w-full" value={form.scanType} onChange={(e) => handleScanTypeChange(e.target.value as ScanType)}>
                  {SCAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
                <input className="input-field" placeholder="e.g. Chest, Left Knee, Abdomen" value={form.bodyPart} onChange={(e) => setForm({ ...form, bodyPart: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Scan Date &amp; Time *</label>
                <input className="input-field" type="datetime-local" value={form.scanDate} onChange={(e) => setForm({ ...form, scanDate: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Technician</label>
                <input className="input-field" placeholder="Technician name" value={form.technician} onChange={(e) => setForm({ ...form, technician: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Radiologist</label>
                <input className="input-field" placeholder="Assigned radiologist" value={form.radiologist} onChange={(e) => setForm({ ...form, radiologist: e.target.value })} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded border-tdai-gray-300 text-tdai-teal-600 focus:ring-tdai-teal-500" checked={form.contrastUsed} onChange={(e) => setForm({ ...form, contrastUsed: e.target.checked })} />
                  <span className="text-xs font-medium text-tdai-secondary">Contrast Used</span>
                </label>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Notes</label>
                <textarea className="input-field" rows={2} placeholder="Additional notes or instructions" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{error}</p>}
            <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
              <button className="btn-primary !rounded-lg !px-5 !py-2.5" type="submit">Schedule Scan</button>
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
                <th className="px-4 py-3.5">Scan Type</th>
                <th className="px-4 py-3.5">Body Part</th>
                <th className="px-4 py-3.5">Modality</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Technician</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <>
                  <tr key={s.id} className="table-row-hover cursor-pointer" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-tdai-text">{s.patientName}</p>
                        <p className="font-mono text-[10px] text-tdai-accent">{s.patientId}</p>
                      </div>
                    </td>
                    <td className="table-cell"><span className={`badge ${scanTypeStyle[s.scanType]}`}>{s.scanType}</span></td>
                    <td className="table-cell">{s.bodyPart}</td>
                    <td className="table-cell"><span className="badge bg-tdai-navy-50 text-tdai-navy-700 font-mono ring-1 ring-tdai-navy-200">{s.modality}</span></td>
                    <td className="table-cell text-xs text-tdai-secondary">{new Date(s.scanDate).toLocaleString()}</td>
                    <td className="table-cell text-xs text-tdai-secondary">{s.technician ?? "—"}</td>
                    <td className="table-cell"><span className={`badge ${statusStyle[s.status]}`}>{s.status}</span></td>
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <select className="select-field !py-1.5 !px-2 text-xs" value={s.status} onChange={(e) => void updateStatus(s.id, e.target.value as ScanStatus)}>
                        {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr key={`${s.id}-detail`} className="bg-tdai-gray-50/50">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                          <div>
                            <p className="font-medium text-tdai-secondary mb-1">Radiologist</p>
                            <p className="text-tdai-text">{s.radiologist || "Not assigned"}</p>
                          </div>
                          <div>
                            <p className="font-medium text-tdai-secondary mb-1">Image Count</p>
                            <p className="text-tdai-text">{s.imageCount ?? "—"}</p>
                          </div>
                          <div>
                            <p className="font-medium text-tdai-secondary mb-1">Contrast</p>
                            <p className="text-tdai-text">{s.contrastUsed ? "Yes" : "No"}</p>
                          </div>
                          <div>
                            <p className="font-medium text-tdai-secondary mb-1">Order ID</p>
                            <p className="text-tdai-text font-mono">{s.orderId || "—"}</p>
                          </div>
                          {s.findings && (
                            <div className="col-span-2 sm:col-span-4">
                              <p className="font-medium text-tdai-secondary mb-1">Findings</p>
                              <p className="text-tdai-text whitespace-pre-wrap">{s.findings}</p>
                            </div>
                          )}
                          {s.notes && (
                            <div className="col-span-2 sm:col-span-4">
                              <p className="font-medium text-tdai-secondary mb-1">Notes</p>
                              <p className="text-tdai-text whitespace-pre-wrap">{s.notes}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {scans.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <p className="text-sm font-medium text-tdai-secondary">No scans yet</p>
                    <p className="text-xs text-tdai-muted mt-1">Schedule a new scan to get started</p>
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
