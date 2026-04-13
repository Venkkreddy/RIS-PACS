import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatIsoDateDisplay } from "../lib/dateDisplay";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Patient, Gender, RadiologyOrder } from "@medical-report-system/shared";

type CheckInStatus = "waiting" | "checked-in" | "in-exam" | "completed";

interface CheckInEntry {
  patient: Patient;
  status: CheckInStatus;
  checkInTime: string;
  appointmentOrder?: RadiologyOrder;
}

const statusStyle: Record<CheckInStatus, string> = {
  waiting: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  "checked-in": "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  "in-exam": "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

const statusLabel: Record<CheckInStatus, string> = {
  waiting: "Waiting",
  "checked-in": "Checked In",
  "in-exam": "In Exam",
  completed: "Completed",
};

export function ReceptionistDashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M" as Gender, phone: "", email: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"patients" | "today">("today");
  const [checkIns, setCheckIns] = useState<CheckInEntry[]>([]);

  const patientsQuery = useQuery({
    queryKey: ["patients", debouncedSearch],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients", { params: debouncedSearch ? { search: debouncedSearch } : {} });
      return res.data;
    },
    staleTime: 5000,
    retry: 1,
  });

  const ordersQuery = useQuery({
    queryKey: ["orders-today"],
    queryFn: async () => {
      const res = await api.get<RadiologyOrder[]>("/orders", { params: { status: "scheduled" } });
      return res.data;
    },
    staleTime: 10000,
    retry: 1,
  });

  const patients = patientsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => new Date(o.scheduledDate).toISOString().slice(0, 10) === todayStr);

  useEffect(() => {
    if (patients.length > 0 && todayOrders.length > 0) {
      setCheckIns((prev) => {
        const existing = new Map(prev.map((c) => [c.patient.id, c]));
        const updated: CheckInEntry[] = [];
        for (const order of todayOrders) {
          const patient = patients.find((p) => p.id === order.patientId || p.patientId === order.patientId);
          if (patient && !existing.has(patient.id)) {
            updated.push({
              patient,
              status: "waiting",
              checkInTime: order.scheduledDate,
              appointmentOrder: order,
            });
          }
        }
        return [...prev, ...updated];
      });
    }
  }, [patients, todayOrders]);

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
    setActiveTab("patients");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editId) {
        await api.patch(`/patients/${editId}`, form);
      } else {
        await api.post("/patients", form);
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["patients"] });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? "Failed");
    }
  }

  function updateCheckInStatus(patientId: string, status: CheckInStatus) {
    setCheckIns((prev) =>
      prev.map((c) => (c.patient.id === patientId ? { ...c, status } : c)),
    );
  }

  function quickCheckIn(patient: Patient) {
    setCheckIns((prev) => {
      if (prev.some((c) => c.patient.id === patient.id)) {
        return prev.map((c) =>
          c.patient.id === patient.id ? { ...c, status: "checked-in" as CheckInStatus } : c,
        );
      }
      return [
        ...prev,
        { patient, status: "checked-in" as CheckInStatus, checkInTime: new Date().toISOString() },
      ];
    });
  }

  const waitingCount = checkIns.filter((c) => c.status === "waiting").length;
  const checkedInCount = checkIns.filter((c) => c.status === "checked-in" || c.status === "in-exam").length;
  const completedCount = checkIns.filter((c) => c.status === "completed").length;

  return (
    <div className="min-h-screen bg-tdai-background">
      {/* Title bar */}
      <div className="bg-gradient-to-r from-tdai-navy-800 to-tdai-navy-700 px-6 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10">
            <svg className="h-3.5 w-3.5 text-tdai-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="text-sm font-bold tracking-wider text-white">RECEPTION DESK</span>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* KPI row */}
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="card-hover px-5 py-4 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-navy-50 text-tdai-navy-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <div>
              <p className="text-2xl font-semibold text-tdai-text">{patients.length}</p>
              <p className="text-xs text-tdai-muted">Total Patients</p>
            </div>
          </div>
          <div className="card-hover px-5 py-4 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-2xl font-semibold text-amber-600">{waitingCount}</p>
              <p className="text-xs text-tdai-muted">Waiting</p>
            </div>
          </div>
          <div className="card-hover px-5 py-4 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-teal-50 text-tdai-teal-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <p className="text-2xl font-semibold text-tdai-teal-600">{checkedInCount}</p>
              <p className="text-xs text-tdai-muted">Checked In</p>
            </div>
          </div>
          <div className="card-hover px-5 py-4 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-2xl font-semibold text-emerald-600">{completedCount}</p>
              <p className="text-xs text-tdai-muted">Completed</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex items-center gap-2">
          <button
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${activeTab === "today" ? "bg-tdai-navy-700 text-white" : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt"}`}
            onClick={() => setActiveTab("today")}
          >
            Today's Queue
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">{checkIns.length}</span>
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${activeTab === "patients" ? "bg-tdai-navy-700 text-white" : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt"}`}
            onClick={() => setActiveTab("patients")}
          >
            Patient Registry
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">{patients.length}</span>
          </button>
          <div className="flex-1" />
          <button className="btn-primary !rounded-lg !px-4 !py-2 text-xs" onClick={() => { resetForm(); setShowForm(true); setActiveTab("patients"); }}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Patient
          </button>
          <button className="btn-secondary !rounded-lg !px-4 !py-2 text-xs" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["patients"] }); void queryClient.invalidateQueries({ queryKey: ["orders-today"] }); }}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
        </div>

        {/* Today's Queue Tab */}
        {activeTab === "today" && (
          <div className="space-y-4">
            {/* Quick search for walk-in check-in */}
            <div className="card p-4">
              <label className="mb-2 block text-xs font-semibold text-tdai-secondary uppercase tracking-wider">Quick Check-In (Walk-In)</label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input
                    className="input-field pl-10"
                    placeholder="Search patient by name or MRN to check in..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              {search && patients.length > 0 && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-tdai-border bg-white">
                  {patients.slice(0, 8).map((p) => (
                    <div key={p.id} className="flex items-center justify-between border-b border-tdai-border-light px-4 py-2.5 last:border-b-0 hover:bg-tdai-surface-alt transition-colors">
                      <div>
                        <p className="text-sm font-medium text-tdai-text">{p.firstName} {p.lastName}</p>
                        <p className="text-xs text-tdai-muted">MRN: {p.patientId} &middot; DOB: {formatIsoDateDisplay(p.dateOfBirth)} &middot; {p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"}</p>
                      </div>
                      <button
                        className="btn-primary !rounded-lg !px-3 !py-1.5 text-xs"
                        onClick={() => { quickCheckIn(p); setSearch(""); }}
                      >
                        Check In
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Queue list */}
            {checkIns.length === 0 && (
              <div className="card py-16 text-center">
                <svg className="mx-auto mb-3 h-10 w-10 text-tdai-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <p className="text-sm font-medium text-tdai-secondary">No patients in queue</p>
                <p className="text-xs text-tdai-muted mt-1">Use quick check-in above or wait for scheduled patients</p>
              </div>
            )}

            {checkIns.length > 0 && (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="table-header">
                      <tr>
                        <th className="px-4 py-3.5">MRN</th>
                        <th className="px-4 py-3.5">Patient Name</th>
                        <th className="px-4 py-3.5">DOB</th>
                        <th className="px-4 py-3.5">Gender</th>
                        <th className="px-4 py-3.5">Phone</th>
                        <th className="px-4 py-3.5">Appointment</th>
                        <th className="px-4 py-3.5">Status</th>
                        <th className="px-4 py-3.5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkIns.map((entry) => (
                        <tr key={entry.patient.id} className="table-row-hover">
                          <td className="table-cell font-mono text-xs text-tdai-accent">{entry.patient.patientId}</td>
                          <td className="table-cell font-medium">{entry.patient.firstName} {entry.patient.lastName}</td>
                          <td className="table-cell text-tdai-secondary">{formatIsoDateDisplay(entry.patient.dateOfBirth)}</td>
                          <td className="table-cell">
                            <span className="badge bg-slate-100 text-slate-600">{entry.patient.gender === "M" ? "Male" : entry.patient.gender === "F" ? "Female" : "Other"}</span>
                          </td>
                          <td className="table-cell text-tdai-secondary">{entry.patient.phone ?? "—"}</td>
                          <td className="table-cell text-xs text-tdai-secondary">
                            {entry.appointmentOrder
                              ? `${entry.appointmentOrder.modality} - ${entry.appointmentOrder.bodyPart}`
                              : "Walk-in"}
                          </td>
                          <td className="table-cell">
                            <span className={`badge ${statusStyle[entry.status]}`}>{statusLabel[entry.status]}</span>
                          </td>
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5">
                              {entry.status === "waiting" && (
                                <button className="btn-primary !rounded-lg !px-3 !py-1.5 text-xs" onClick={() => updateCheckInStatus(entry.patient.id, "checked-in")}>
                                  Check In
                                </button>
                              )}
                              {entry.status === "checked-in" && (
                                <button className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm" onClick={() => updateCheckInStatus(entry.patient.id, "in-exam")}>
                                  Start Exam
                                </button>
                              )}
                              {entry.status === "in-exam" && (
                                <button className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm" onClick={() => updateCheckInStatus(entry.patient.id, "completed")}>
                                  Complete
                                </button>
                              )}
                              {entry.status === "completed" && (
                                <span className="flex items-center gap-1 text-xs text-emerald-600">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                  Done
                                </span>
                              )}
                              <button
                                className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm"
                                onClick={() => startEdit(entry.patient)}
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Patient Registry Tab */}
        {activeTab === "patients" && (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tdai-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input className="input-field pl-10" placeholder="Search by name or MRN..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            {/* Form */}
            {showForm && (
              <div className="card animate-slide-up">
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
                      <input className="input-field input-date" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-tdai-secondary">Phone</label>
                      <input className="input-field" placeholder="Phone number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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

            {/* Stats */}
            <div className="flex items-center gap-3 text-sm text-tdai-secondary">
              <span className="badge bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200">{patients.length} patients</span>
              {patientsQuery.isFetching && <span className="text-xs text-tdai-muted">Searching...</span>}
            </div>

            {patientsQuery.error && <p className="rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2.5 text-sm text-tdai-red-700">Failed to load patients. Please try again.</p>}

            {/* Patient table */}
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
                          <span className="badge bg-slate-100 text-slate-600">{p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"}</span>
                        </td>
                        <td className="table-cell text-tdai-secondary">{p.phone ?? "—"}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <button
                              className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm"
                              onClick={() => startEdit(p)}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              Edit
                            </button>
                            <button
                              className="btn-primary !rounded-lg !px-3 !py-1.5 text-xs"
                              onClick={() => quickCheckIn(p)}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              Check In
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {patients.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-16 text-center">
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
          </div>
        )}
      </div>
    </div>
  );
}
