import { FormEvent, useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatIsoDateDisplay } from "../lib/dateDisplay";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Patient, Gender, RadiologyOrder } from "@medical-report-system/shared";
import { useAuthRole } from "../hooks/useAuthRole";
import type { WorklistStudy } from "../types/worklist";

type WorkflowStatus =
  | "scheduled"
  | "checked-in"
  | "in-progress"
  | "images-uploaded"
  | "qc-pending"
  | "qc-passed"
  | "retake-required"
  | "ready-for-reporting";

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  scheduled: "Scheduled",
  "checked-in": "Checked In",
  "in-progress": "In Progress",
  "images-uploaded": "Images Uploaded",
  "qc-pending": "QC Pending",
  "qc-passed": "QC Passed",
  "retake-required": "Retake Required",
  "ready-for-reporting": "Ready For Reporting",
};

const WORKFLOW_BADGE: Record<WorkflowStatus, string> = {
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  "checked-in": "bg-blue-50 text-blue-700 ring-blue-200",
  "in-progress": "bg-amber-50 text-amber-700 ring-amber-200",
  "images-uploaded": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "qc-pending": "bg-orange-50 text-orange-700 ring-orange-200",
  "qc-passed": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "retake-required": "bg-red-50 text-red-700 ring-red-200",
  "ready-for-reporting": "bg-teal-50 text-teal-700 ring-teal-200",
};

interface CheckInEntry {
  patient: Patient;
  status: WorkflowStatus;
  checkInTime: string;
  appointmentOrder?: RadiologyOrder;
}

export function ReceptionistDashboard() {
  const auth = useAuthRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ patientId: "", firstName: "", lastName: "", dateOfBirth: "", gender: "M" as Gender, phone: "", email: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"patients" | "today">("today");
  const [checkingInPatient, setCheckingInPatient] = useState<Patient | null>(null);
  const [orderForm, setOrderForm] = useState({ modality: "XR", bodyPart: "Chest", priority: "routine" as "routine" | "urgent" | "stat" });

  const isAdmin = auth.role === "admin" || auth.role === "super_admin";
  const hasPatients = auth.hasPermission("patients:view") || isAdmin;
  const canCreatePatient = auth.hasPermission("patients:create") || isAdmin;
  const canEditPatient = auth.hasPermission("patients:edit") || isAdmin;

  useEffect(() => {
    if (!hasPatients && activeTab === "patients") {
      setActiveTab("today");
    }
  }, [hasPatients, activeTab]);

  const patientsQuery = useQuery({
    queryKey: ["patients", debouncedSearch],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients", { params: debouncedSearch ? { search: debouncedSearch } : {} });
      return res.data;
    },
    staleTime: 5000,
    retry: 1,
  });

  const allPatientsQuery = useQuery({
    queryKey: ["all-patients-list"],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients");
      return res.data;
    },
    staleTime: 5000,
  });

  const ordersQuery = useQuery({
    queryKey: ["orders-today"],
    queryFn: async () => {
      const res = await api.get<RadiologyOrder[]>("/orders");
      return res.data;
    },
    staleTime: 5000,
    refetchInterval: 5000,
    retry: 1,
  });

  const studiesQuery = useQuery({
    queryKey: ["receptionist", "studies"],
    queryFn: async () => {
      const res = await api.get<WorklistStudy[]>("/worklist");
      return res.data;
    },
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const patients = patientsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const studies = studiesQuery.data ?? [];

  function getStudyMrn(study?: WorklistStudy): string {
    const m = (study?.metadata as Record<string, unknown> | undefined) ?? {};
    for (const key of ["patientId", "PatientID", "mrn", "MRN", "00100020"]) {
      const value = m[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function workflowStatusFor(row: { order?: RadiologyOrder; study?: WorklistStudy }): WorkflowStatus {
    const m = (row.study?.metadata as Record<string, unknown> | undefined) ?? {};
    const explicit = m.workflowStatus;
    if (typeof explicit === "string") return explicit as WorkflowStatus;
    if (row.study?.qcStatus === "pass") return "qc-passed";
    if (row.study?.qcStatus === "fail" || row.study?.isRepeat) return "retake-required";
    if (row.study?.viewerUrl) return "images-uploaded";
    if (row.order?.status === "in-progress") return "in-progress";
    if (row.order?.status === "completed") return "ready-for-reporting";
    if (row.order?.notes === "Checked In") return "checked-in";
    return "scheduled";
  }

  const checkIns = useMemo(() => {
    const list: CheckInEntry[] = [];
    const patientsList = allPatientsQuery.data ?? [];
    const allOrders = ordersQuery.data ?? [];
    const allStudies = studiesQuery.data ?? [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const order of allOrders) {
      const orderDateStr = new Date(order.scheduledDate).toISOString().slice(0, 10);
      if (orderDateStr !== todayStr) continue;

      const patient = patientsList.find((p) => p.patientId === order.patientId || p.id === order.patientId);
      if (patient) {
        const linkedStudy = allStudies.find(
          (study) =>
            (order.studyId && study.studyId === order.studyId) ||
            getStudyMrn(study).trim().toLowerCase() === order.patientId.trim().toLowerCase()
        );

        list.push({
          patient,
          status: workflowStatusFor({ order, study: linkedStudy }),
          checkInTime: order.checkedInAt ?? order.scheduledDate,
          appointmentOrder: order,
        });
      }
    }
    return list;
  }, [allPatientsQuery.data, ordersQuery.data, studiesQuery.data]);

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
      const respError = err?.response?.data?.error;
      if (Array.isArray(respError)) {
        setError(respError.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", "));
      } else {
        setError(respError ?? err.message ?? "Failed");
      }
    }
  }

  async function handleUpdateCheckInStatus(orderId: string, status: WorkflowStatus) {
    try {
      let patchStatus: "scheduled" | "in-progress" | "completed" = "scheduled";
      let patchNotes: string | undefined;
      let checkedInAt: string | undefined;

      if (status === "checked-in") {
        patchStatus = "scheduled";
        patchNotes = "Checked In";
        checkedInAt = new Date().toISOString();
      } else if (status === "in-progress") {
        patchStatus = "in-progress";
      } else if (status === "ready-for-reporting") {
        patchStatus = "completed";
      }

      await api.patch(`/orders/${orderId}`, {
        status: patchStatus,
        ...(patchNotes ? { notes: patchNotes } : {}),
        ...(checkedInAt ? { checkedInAt } : {}),
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders-today"] }),
        queryClient.invalidateQueries({ queryKey: ["radiographer", "orders"] }),
      ]);
    } catch (err) {
      console.warn("Failed to update check-in status:", err);
    }
  }

  function quickCheckIn(patient: Patient) {
    setCheckingInPatient(patient);
  }

  async function submitQuickCheckIn(e: FormEvent) {
    e.preventDefault();
    if (!checkingInPatient) return;
    try {
      await api.post("/orders", {
        patientId: checkingInPatient.patientId,
        patientName: `${checkingInPatient.firstName} ${checkingInPatient.lastName}`,
        modality: orderForm.modality,
        bodyPart: orderForm.bodyPart,
        priority: orderForm.priority,
        status: "scheduled",
        notes: "Checked In",
        scheduledDate: new Date().toISOString(),
      });
      setCheckingInPatient(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders-today"] }),
        queryClient.invalidateQueries({ queryKey: ["radiographer", "orders"] }),
      ]);
    } catch (err) {
      console.warn("Failed to create walk-in check-in order:", err);
    }
  }

  const waitingCount = checkIns.filter((c) => c.status === "scheduled").length;
  const checkedInCount = checkIns.filter((c) => ["checked-in", "in-progress", "images-uploaded", "qc-pending", "qc-passed", "retake-required"].includes(c.status)).length;
  const completedCount = checkIns.filter((c) => c.status === "ready-for-reporting").length;

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
        <div className={`mb-6 grid gap-4 ${hasPatients ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          {hasPatients && (
            <div className="card-hover px-5 py-4 flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-navy-50 text-tdai-navy-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div>
                <p className="text-2xl font-semibold text-tdai-text">{patients.length}</p>
                <p className="text-xs text-tdai-muted">Total Patients</p>
              </div>
            </div>
          )}
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
          {hasPatients && (
            <button
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${activeTab === "patients" ? "bg-tdai-navy-700 text-white" : "border border-tdai-border bg-white text-tdai-secondary hover:bg-tdai-surface-alt"}`}
              onClick={() => setActiveTab("patients")}
            >
              Patient Registry
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">{patients.length}</span>
            </button>
          )}
          <div className="flex-1" />
          {canCreatePatient && (
            <button className="btn-primary !rounded-lg !px-4 !py-2 text-xs" onClick={() => { resetForm(); setShowForm(true); setActiveTab("patients"); }}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              New Patient
            </button>
          )}
          <button className="btn-secondary !rounded-lg !px-4 !py-2 text-xs" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["patients"] }); void queryClient.invalidateQueries({ queryKey: ["orders-today"] }); }}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
        </div>

        {/* Today's Queue Tab */}
        {activeTab === "today" && (
          <div className="space-y-4">
            {/* Quick search for walk-in check-in */}
            {hasPatients && (
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
            )}

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
                        <th className="px-4 py-3.5">Check-In Time</th>
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
                          <td className="table-cell text-xs text-tdai-secondary font-medium">
                            {entry.appointmentOrder?.checkedInAt
                              ? new Date(entry.appointmentOrder.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : "—"}
                          </td>
                          <td className="table-cell">
                            <span className={`badge ring-1 ${WORKFLOW_BADGE[entry.status]}`}>{WORKFLOW_LABEL[entry.status]}</span>
                          </td>
                          <td className="table-cell">
                            <div className="flex items-center gap-1.5">
                              {entry.status === "scheduled" && entry.appointmentOrder && (
                                <button className="btn-primary !rounded-lg !px-3 !py-1.5 text-xs" onClick={() => handleUpdateCheckInStatus(entry.appointmentOrder!.id, "checked-in")}>
                                  Check In
                                </button>
                              )}
                              {entry.status === "checked-in" && entry.appointmentOrder && (
                                <button className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-teal-200 bg-tdai-teal-50 px-3 py-1.5 text-xs font-medium text-tdai-teal-700 transition-all duration-150 hover:bg-tdai-teal-100 hover:border-tdai-teal-300 hover:shadow-sm" onClick={() => handleUpdateCheckInStatus(entry.appointmentOrder!.id, "in-progress")}>
                                  Start Exam
                                </button>
                              )}
                              {entry.status === "in-progress" && entry.appointmentOrder && (
                                <button className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm" onClick={() => handleUpdateCheckInStatus(entry.appointmentOrder!.id, "ready-for-reporting")}>
                                  Complete
                                </button>
                              )}
                              {entry.status === "ready-for-reporting" && (
                                <span className="flex items-center gap-1 text-xs text-emerald-600">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                  Done
                                </span>
                              )}
                              {canEditPatient && (
                                <button
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm"
                                  onClick={() => startEdit(entry.patient)}
                                >
                                  Edit
                                </button>
                              )}
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
                            {canEditPatient && (
                              <button
                                className="inline-flex items-center gap-1.5 rounded-lg border border-tdai-navy-200 bg-tdai-navy-50 px-3 py-1.5 text-xs font-medium text-tdai-navy-700 transition-all duration-150 hover:bg-tdai-navy-100 hover:border-tdai-navy-300 hover:shadow-sm"
                                onClick={() => startEdit(p)}
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                Edit
                              </button>
                            )}
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
      {checkingInPatient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
          onClick={() => setCheckingInPatient(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl bg-white p-6 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-tdai-navy-800">Check In Patient: {checkingInPatient.firstName} {checkingInPatient.lastName}</h3>
            <p className="mt-1 text-xs text-tdai-gray-500">Create an imaging order to send this patient to the Radiographer Workstation.</p>
            
            <form onSubmit={submitQuickCheckIn} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-tdai-gray-600">Modality</label>
                <select
                  className="select-field mt-1 w-full"
                  value={orderForm.modality}
                  onChange={(e) => setOrderForm({ ...orderForm, modality: e.target.value })}
                >
                  <option value="XR">XR - X-Ray</option>
                  <option value="CR">CR - Computed Radiography</option>
                  <option value="DX">DX - Digital Radiography</option>
                  <option value="MG">MG - Mammography</option>
                  <option value="CT">CT - Computed Tomography</option>
                  <option value="MR">MR - Magnetic Resonance</option>
                  <option value="US">US - Ultrasound</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-tdai-gray-600">Body Part</label>
                <input
                  type="text"
                  className="input-field mt-1"
                  placeholder="e.g. Chest, Abdomen, Knee"
                  value={orderForm.bodyPart}
                  onChange={(e) => setOrderForm({ ...orderForm, bodyPart: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-tdai-gray-600">Priority</label>
                <select
                  className="select-field mt-1 w-full"
                  value={orderForm.priority}
                  onChange={(e) => setOrderForm({ ...orderForm, priority: e.target.value as any })}
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-tdai-border pt-4">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setCheckingInPatient(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs"
                >
                  Confirm & Check In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
