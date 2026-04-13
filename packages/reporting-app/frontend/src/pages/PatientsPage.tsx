import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuthRole } from "../hooks/useAuthRole";
import { DicomUpload } from "../components/DicomUpload";
import { formatIsoDateDisplay } from "../lib/dateDisplay";
import type { Patient, Gender } from "@medical-report-system/shared";

const INDIA_PHONE_REGEX = /^(?:\+91[\s-]?)?[6-9]\d{9}$/;

function isValidDobForRegistration(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const now = new Date();
  const dob = new Date(parsed);
  if (dob > now) return false;
  const oldest = new Date();
  oldest.setFullYear(now.getFullYear() - 130);
  return dob >= oldest;
}

function normalizeIndianPhoneNumber(value: string): string | null {
  const digits = value.replace(/\D+/g, "");
  let local = "";
  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else {
    return null;
  }
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

export function PatientsPage() {
  const auth = useAuthRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M" as Gender, phone: "", email: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [uploadPatient, setUploadPatient] = useState<Patient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = auth.role === "admin" || auth.role === "super_admin";
  const canCreate = isAdmin || auth.hasPermission("patients:create");
  const canEdit = isAdmin || auth.hasPermission("patients:edit");
  const canDelete = isAdmin || auth.hasPermission("patients:delete");

  useEffect(() => {
    if (auth.loading || searchParams.get("new") !== "1") return;
    if (!canCreate) return;
    setShowForm(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [auth.loading, canCreate, searchParams, setSearchParams]);

  const patientsQuery = useQuery({
    queryKey: ["patients", debouncedSearch],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients", { params: debouncedSearch ? { search: debouncedSearch } : {} });
      return res.data;
    },
    staleTime: 5000,
    retry: 1,
  });

  const patients = patientsQuery.data ?? [];

  function resetForm() {
    setForm({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M", phone: "", email: "", address: "" });
    setEditId(null);
    setShowForm(false);
    setError(null);
  }

  function startEdit(p: Patient) {
    setForm({ patientId: p.patientId, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, gender: p.gender, phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "" });
    setEditId(p.id);
    setShowForm(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/patients/${deleteTarget.id}`);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed to delete patient");
    } finally {
      setDeleting(false);
    }
  }

  function patientPayloadFromForm() {
    const rawPhone = form.phone.trim();
    const normalizedPhone = rawPhone ? normalizeIndianPhoneNumber(rawPhone) : null;
    const base = {
      patientId: form.patientId.trim().toUpperCase(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
    };
    return base;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidDobForRegistration(form.dateOfBirth)) {
      setError("Enter a valid date of birth (past date, up to 130 years old).");
      return;
    }
    const rawPhone = form.phone.trim();
    if (rawPhone && (!INDIA_PHONE_REGEX.test(rawPhone) || !normalizeIndianPhoneNumber(rawPhone))) {
      setError("Phone must be a valid Indian number (example: +91 9876543210).");
      return;
    }
    try {
      if (editId) {
        await api.patch(`/patients/${editId}`, patientPayloadFromForm());
      } else {
        await api.post("/patients", patientPayloadFromForm());
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
    } catch (err: any) {
      const d = err?.response?.data?.error;
      const msg = Array.isArray(d)
        ? d.map((x: { message?: string }) => x.message).filter(Boolean).join("; ")
        : (typeof d === "string" ? d : err?.message ?? "Failed");
      setError(msg);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="page-header">Patient Registry</h1>
          <p className="page-subheader mt-1">Manage and search patient records</p>
        </div>
        {canCreate && (
        <button className="btn-primary !rounded-lg !px-5 !py-2.5" onClick={() => { resetForm(); setShowForm(true); }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Patient
        </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input className="input-field pl-10" placeholder="Search by name or MRN..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-6 animate-slide-up">
          <div className="border-b border-tdai-border px-6 py-4">
            <h2 className="text-lg font-semibold text-tdai-text">{editId ? "Edit Patient" : "Register New Patient"}</h2>
            <p className="text-xs text-tdai-muted mt-0.5">Fields marked with * are required</p>
          </div>
          <form className="p-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">MRN / Patient ID *</label>
                <input className="input-field" placeholder="e.g. MRN-001" value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Gender</label>
                <select className="select-field w-full" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as Gender })}>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">First Name *</label>
                <input className="input-field" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Last Name *</label>
                <input className="input-field" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Date of Birth *</label>
                <input className="input-field input-date" type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Phone</label>
                <input className="input-field" type="tel" placeholder="+91 9876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Email</label>
                <input className="input-field" type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Address</label>
                <input className="input-field" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">{error}</p>}
            <div className="mt-6 flex gap-3 border-t border-tdai-border pt-6">
              <button className="btn-primary !rounded-lg !px-5 !py-2.5" type="submit">{editId ? "Update Patient" : "Register Patient"}</button>
              <button className="btn-secondary !rounded-lg !px-5 !py-2.5" type="button" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Stats bar */}
      <div className="mb-4 flex items-center gap-3 text-sm text-tdai-secondary">
        <span className="badge bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200">{patients.length} patients</span>
        {patientsQuery.isFetching && <span className="text-xs text-tdai-muted">Searching…</span>}
      </div>

      {patientsQuery.error && <p className="mb-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">Failed to load patients. Please try again.</p>}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3.5">Registry ID</th>
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
                  <td className="table-cell font-mono text-[11px] text-tdai-secondary" title={p.id}>
                    {p.id.slice(0, 10)}…
                  </td>
                  <td className="table-cell font-mono text-xs text-tdai-accent">{p.patientId}</td>
                  <td className="table-cell font-medium">{p.firstName} {p.lastName}</td>
                  <td className="table-cell text-tdai-secondary">{formatIsoDateDisplay(p.dateOfBirth)}</td>
                  <td className="table-cell">
                    <span className="badge bg-slate-100 text-slate-600">{p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"}</span>
                  </td>
                  <td className="table-cell text-tdai-secondary">{p.phone ?? "—"}</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      {canEdit && (
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm dark:border-tdai-navy-600 dark:bg-tdai-navy-800/50 dark:text-tdai-navy-200 dark:hover:bg-tdai-navy-700/50"
                        onClick={() => startEdit(p)}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Edit
                      </button>
                      )}
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm dark:border-tdai-teal-600 dark:bg-tdai-teal-800/30 dark:text-tdai-teal-300 dark:hover:bg-tdai-teal-700/40"
                        onClick={() => setUploadPatient(p)}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                        Upload
                      </button>
                      {canDelete && (
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-all duration-150 hover:bg-red-100 hover:border-red-300 hover:shadow-sm dark:border-red-600 dark:bg-red-800/30 dark:text-red-300 dark:hover:bg-red-700/40"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Delete
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {patients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <p className="text-sm font-medium text-tdai-secondary">No patients registered yet</p>
                    <p className="text-xs text-tdai-muted mt-1">Click "New Patient" to add the first record</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {uploadPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setUploadPatient(null)}>
          <div className="w-full max-w-lg mx-4 rounded-xl bg-white shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-tdai-border px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-tdai-text">Upload DICOM for Patient</h2>
                <p className="text-xs text-tdai-muted mt-0.5">{uploadPatient.firstName} {uploadPatient.lastName} — MRN: {uploadPatient.patientId}</p>
              </div>
              <button className="btn-ghost !p-1.5" onClick={() => setUploadPatient(null)}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6">
              <DicomUpload patientId={uploadPatient.patientId} patientName={`${uploadPatient.firstName} ${uploadPatient.lastName}`} />
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-tdai-text">Delete Patient</h3>
                  <p className="mt-1 text-sm text-tdai-secondary">
                    Are you sure you want to delete <span className="font-medium text-tdai-text">{deleteTarget.firstName} {deleteTarget.lastName}</span> (MRN: {deleteTarget.patientId})? This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-tdai-border px-6 py-4">
              <button
                className="btn-secondary !rounded-lg !px-4 !py-2"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete Patient"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
