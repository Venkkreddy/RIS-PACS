import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ReferringPhysician } from "@medical-report-system/shared";

export function ReferringPhysiciansPage() {
  const [physicians, setPhysicians] = useState<ReferringPhysician[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", specialty: "", phone: "", email: "", hospital: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<ReferringPhysician[]>("/referring-physicians", { params: search ? { search } : {} });
    setPhysicians(res.data);
  }

  useEffect(() => { void load(); }, [search]);

  function resetForm() { setForm({ name: "", specialty: "", phone: "", email: "", hospital: "" }); setEditId(null); setShowForm(false); setError(null); }

  function startEdit(p: ReferringPhysician) {
    setForm({ name: p.name, specialty: p.specialty ?? "", phone: p.phone ?? "", email: p.email ?? "", hospital: p.hospital ?? "" });
    setEditId(p.id);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editId) {
        await api.patch(`/referring-physicians/${editId}`, form);
      } else {
        await api.post("/referring-physicians", form);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="page-header">Referring Physicians</h1>
          <p className="page-subheader mt-1">Manage physician directory and referral contacts</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Physician
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input className="input-field pl-10" placeholder="Search by name or hospital..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-6 animate-slide-up">
          <div className="border-b border-tdai-border px-6 py-4">
            <h2 className="text-lg font-semibold text-tdai-text">{editId ? "Edit Physician" : "Add Referring Physician"}</h2>
            <p className="text-xs text-tdai-muted mt-0.5">Enter the physician's contact details</p>
          </div>
          <form className="p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Full Name *</label>
                <input className="input-field" placeholder="Dr. John Smith" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Specialty</label>
                <input className="input-field" placeholder="e.g. Orthopedics" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Phone</label>
                <input className="input-field" placeholder="Phone number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Email</label>
                <input className="input-field" type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Hospital / Clinic</label>
                <input className="input-field" placeholder="Hospital or clinic name" value={form.hospital} onChange={(e) => setForm({ ...form, hospital: e.target.value })} />
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{error}</p>}
            <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
              <button className="btn-primary" type="submit">{editId ? "Update Physician" : "Add Physician"}</button>
              <button className="btn-secondary" type="button" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Stats */}
      <div className="mb-4 flex items-center gap-3 text-sm text-tdai-secondary">
        <span className="badge bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200">{physicians.length} physicians</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3.5">Name</th>
                <th className="px-4 py-3.5">Specialty</th>
                <th className="px-4 py-3.5">Hospital</th>
                <th className="px-4 py-3.5">Phone</th>
                <th className="px-4 py-3.5">Email</th>
                <th className="px-4 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {physicians.map((p) => (
                <tr key={p.id} className="table-row-hover">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tdai-accent/10 text-xs font-semibold text-tdai-accent">
                        {p.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="table-cell">
                    {p.specialty ? <span className="badge bg-slate-100 text-slate-600">{p.specialty}</span> : <span className="text-tdai-muted">—</span>}
                  </td>
                  <td className="table-cell text-tdai-secondary">{p.hospital ?? "—"}</td>
                  <td className="table-cell text-tdai-secondary">{p.phone ?? "—"}</td>
                  <td className="table-cell text-xs text-tdai-secondary">{p.email ?? "—"}</td>
                  <td className="table-cell">
                    <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => startEdit(p)}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {physicians.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-sm font-medium text-tdai-secondary">No referring physicians added yet</p>
                    <p className="text-xs text-tdai-muted mt-1">Click "Add Physician" to add a referral contact</p>
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
