import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RadiologyOrder, OrderStatus, Patient, Modality } from "@medical-report-system/shared";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, X, Clock, Plus, User, FileText, Check } from "lucide-react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16, scale: 0.97 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } };

const statusStyle: Record<OrderStatus, string> = {
  scheduled: "bg-sky-500 hover:bg-sky-600",
  "in-progress": "bg-amber-500 hover:bg-amber-600",
  completed: "bg-emerald-500 hover:bg-emerald-600",
  cancelled: "bg-slate-400 hover:bg-slate-500",
};

const statusBorder: Record<OrderStatus, string> = {
  scheduled: "border-sky-200",
  "in-progress": "border-amber-200",
  completed: "border-emerald-200",
  cancelled: "border-slate-200",
};

function getWeekDates(offset: number): Date[] {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7);

export function SchedulePage() {
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);

  // Modals & form state
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<RadiologyOrder | null>(null);

  // Search patients
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Form states
  const [modality, setModality] = useState<Modality>("XR");
  const [bodyPart, setBodyPart] = useState("Chest");
  const [priority, setPriority] = useState<"routine" | "urgent" | "stat">("routine");
  const [notes, setNotes] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleHour, setRescheduleHour] = useState(8);

  const weekDates = getWeekDates(weekOffset);

  async function load() {
    try {
      const res = await api.get<RadiologyOrder[]>("/orders");
      setOrders(res.data);
    } catch (err) {
      console.error("Failed to load orders:", err);
    }
  }

  useEffect(() => { void load(); }, []);

  // Search patients when input changes
  useEffect(() => {
    if (!patientSearch.trim()) {
      setPatients([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<Patient[]>("/patients", { params: { search: patientSearch } });
        setPatients(res.data);
      } catch (err) {
        console.error("Failed to find patients:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  function ordersForSlot(date: Date, hour: number) {
    const dateStr = toDateStr(date);
    return orders.filter((o) => {
      const d = new Date(o.scheduledDate);
      return toDateStr(d) === dateStr && d.getHours() === hour;
    });
  }

  const todayStr = toDateStr(new Date());

  // Click slot cell
  function handleCellClick(date: Date, hour: number) {
    setSelectedSlot({ date, hour });
    setSelectedPatient(null);
    setPatientSearch("");
    setModality("XR");
    setBodyPart("Chest");
    setPriority("routine");
    setNotes("");
    setClinicalHistory("");
  }

  // Click order pill
  function handleOrderClick(order: RadiologyOrder, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedOrder(order);
    const orderDate = new Date(order.scheduledDate);
    setRescheduleDate(toDateStr(orderDate));
    setRescheduleHour(orderDate.getHours());
    setModality(order.modality);
    setBodyPart(order.bodyPart);
    setPriority(order.priority);
    setNotes(order.notes ?? "");
    setClinicalHistory(order.clinicalHistory ?? "");
  }

  // Book appointment submit
  async function handleBookSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot || !selectedPatient) return;

    try {
      const scheduledDate = new Date(selectedSlot.date);
      scheduledDate.setHours(selectedSlot.hour, 0, 0, 0);

      await api.post("/orders", {
        patientId: selectedPatient.patientId,
        patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
        modality,
        bodyPart,
        priority,
        status: "scheduled",
        scheduledDate: scheduledDate.toISOString(),
        notes,
        clinicalHistory,
      });

      setSelectedSlot(null);
      await load();
    } catch (err) {
      console.error("Failed to book appointment:", err);
    }
  }

  // Update / Reschedule order submit
  async function handleUpdateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      const scheduledDate = new Date(rescheduleDate);
      scheduledDate.setHours(rescheduleHour, 0, 0, 0);

      await api.patch(`/orders/${selectedOrder.id}`, {
        scheduledDate: scheduledDate.toISOString(),
        modality,
        bodyPart,
        priority,
        notes,
        clinicalHistory,
      });

      setSelectedOrder(null);
      await load();
    } catch (err) {
      console.error("Failed to update appointment:", err);
    }
  }

  // Cancel order submit
  async function handleCancelOrder() {
    if (!selectedOrder) return;
    if (!window.confirm("Are you sure you want to cancel this appointment?")) return;

    try {
      await api.patch(`/orders/${selectedOrder.id}`, {
        status: "cancelled",
      });
      setSelectedOrder(null);
      await load();
    } catch (err) {
      console.error("Failed to cancel appointment:", err);
    }
  }

  return (
    <motion.div className="page-container" variants={container} initial="hidden" animate="show">
      {/* Header */}
      <motion.div variants={item} className="page-intro mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tdai-teal-50 text-tdai-teal-600 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-400">
            <Calendar className="h-5 w-5" strokeWidth={2} aria-hidden />
          </div>
          <div>
            <h1 className="page-header">Schedule</h1>
            <p className="page-subheader mt-1">Interactive weekly slot booking and scheduler dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.button type="button" className="btn-ghost !px-3 !py-2" whileTap={{ scale: 0.97 }} onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          </motion.button>
          <motion.button type="button" className="btn-secondary !px-4 !py-2 text-xs font-medium" whileTap={{ scale: 0.97 }} onClick={() => setWeekOffset(0)}>
            Today
          </motion.button>
          <motion.button type="button" className="btn-ghost !px-3 !py-2" whileTap={{ scale: 0.97 }} onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
            <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
          </motion.button>
        </div>
      </motion.div>

      {/* Calendar grid */}
      <motion.div variants={item} className="table-wrap">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-xs select-none">
            <thead>
              <tr className="table-header">
                <th className="w-20 border-r border-tdai-border px-3 py-3.5 text-left dark:border-white/[0.08]">Time</th>
                {weekDates.map((d) => {
                  const isToday = toDateStr(d) === todayStr;
                  return (
                    <th key={toDateStr(d)} className={`border-r border-tdai-border px-3 py-3.5 text-center dark:border-white/[0.08] ${isToday ? "!bg-tdai-accent/5" : ""}`}>
                      <span className={`text-[10px] uppercase tracking-widest ${isToday ? "text-tdai-accent" : "text-tdai-muted"}`}>
                        {d.toLocaleDateString("en-US", { weekday: "short" })}
                      </span>
                      <span className={`mt-0.5 block text-base font-semibold ${isToday ? "text-tdai-accent" : "text-tdai-text"}`}>
                        {d.getDate()}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour) => (
                <tr key={hour} className="border-b border-tdai-border-light dark:border-white/[0.08]">
                  <td className="border-r border-tdai-border-light px-3 py-3 text-right text-tdai-muted font-medium dark:border-white/[0.08]">
                    {hour > 12 ? hour - 12 : hour}:00 {hour >= 12 ? "PM" : "AM"}
                  </td>
                  {weekDates.map((d) => {
                    const slot = ordersForSlot(d, hour);
                    const isToday = toDateStr(d) === todayStr;
                    return (
                      <td
                        key={`${toDateStr(d)}-${hour}`}
                        className={`border-r border-tdai-border-light px-1.5 py-1.5 align-top transition-all duration-150 cursor-cell hover:bg-tdai-accent/5 dark:border-white/[0.08] ${isToday ? "bg-tdai-accent/[0.02]" : ""}`}
                        style={{ minHeight: 64, height: 72 }}
                        onClick={() => handleCellClick(d, hour)}
                      >
                        <div className="flex h-full flex-col justify-between">
                          <div className="space-y-1">
                            {slot.map((o) => (
                              <div
                                key={o.id}
                                className={`group relative rounded-lg px-2.5 py-2 text-white shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md ${statusStyle[o.status]}`}
                                onClick={(e) => handleOrderClick(o, e)}
                              >
                                <div className="font-semibold leading-tight pr-4 truncate">{o.patientName}</div>
                                <div className="mt-0.5 text-[9px] opacity-90 truncate">{o.modality} · {o.bodyPart}</div>
                                <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white border ${statusBorder[o.status]}`}>
                                  {o.priority}
                                </span>
                              </div>
                            ))}
                          </div>
                          {slot.length === 0 && (
                            <div className="flex h-full items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                              <span className="inline-flex items-center gap-1 rounded bg-tdai-teal-50 px-1.5 py-0.5 text-[9px] font-semibold text-tdai-teal-600 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-400">
                                <Plus className="h-2.5 w-2.5" /> Book
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Legend */}
      <motion.div variants={item} className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-tdai-secondary">
        <span className="font-medium text-tdai-muted">Legend:</span>
        {Object.entries(statusStyle).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${color.split(" ")[0]}`} />
            <span className="capitalize">{status.replace("-", " ")}</span>
          </div>
        ))}
      </motion.div>

      {/* ── Modal Dialogs ── */}
      <AnimatePresence>
        {/* Book Appointment Modal */}
        {selectedSlot && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setSelectedSlot(null)}
          >
            <div
              className="w-full max-w-lg mx-4 rounded-xl bg-white p-6 shadow-2xl animate-slide-up dark:bg-slate-900 border dark:border-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-tdai-border-light pb-3.5 dark:border-slate-800">
                <div className="flex items-center gap-2 text-tdai-navy-800 dark:text-white">
                  <Plus className="h-5 w-5 text-tdai-teal-500" />
                  <h3 className="text-base font-bold">Book Radiology Appointment</h3>
                </div>
                <button type="button" onClick={() => setSelectedSlot(null)} className="text-tdai-muted hover:text-tdai-text">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Selected date / hour summary */}
              <div className="mt-4 flex items-center gap-4 rounded-lg bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800/40">
                <div className="flex items-center gap-1.5 font-medium text-tdai-secondary dark:text-slate-300">
                  <Calendar className="h-3.5 w-3.5 text-tdai-teal-500" />
                  {selectedSlot.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </div>
                <div className="flex items-center gap-1.5 font-medium text-tdai-secondary dark:text-slate-300">
                  <Clock className="h-3.5 w-3.5 text-tdai-teal-500" />
                  {selectedSlot.hour > 12 ? selectedSlot.hour - 12 : selectedSlot.hour}:00 {selectedSlot.hour >= 12 ? "PM" : "AM"}
                </div>
              </div>

              <form onSubmit={handleBookSubmit} className="mt-4 space-y-4 text-xs">
                {/* Search Patient */}
                <div>
                  <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Search Patient (Name or MRN)</label>
                  {!selectedPatient ? (
                    <div className="relative mt-1">
                      <input
                        type="text"
                        className="input-field animate-fade-in"
                        placeholder="Type name or MRN to look up..."
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        required
                      />
                      {patients.length > 0 && (
                        <div className="absolute left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-tdai-border bg-white shadow-lg dark:bg-slate-900 dark:border-slate-800">
                          {patients.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="flex w-full flex-col px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              onClick={() => {
                                setSelectedPatient(p);
                                setPatientSearch("");
                                setPatients([]);
                              }}
                            >
                              <span className="font-semibold text-tdai-text dark:text-slate-100">{p.firstName} {p.lastName}</span>
                              <span className="text-[10px] text-tdai-muted">MRN: {p.patientId} &middot; DOB: {p.dateOfBirth}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center justify-between rounded-lg border border-tdai-teal-200 bg-tdai-teal-50/40 px-3 py-2 dark:bg-teal-950/20 dark:border-teal-900">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-tdai-teal-500" />
                        <div>
                          <p className="font-semibold text-tdai-teal-900 dark:text-teal-400">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                          <p className="text-[10px] text-tdai-teal-600">MRN: {selectedPatient.patientId}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedPatient(null)}
                        className="rounded-full p-1 text-tdai-teal-600 hover:bg-tdai-teal-100 dark:hover:bg-teal-900/50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Modality</label>
                    <select
                      className="select-field mt-1 w-full"
                      value={modality}
                      onChange={(e) => setModality(e.target.value as Modality)}
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
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Body Part</label>
                    <input
                      type="text"
                      className="input-field mt-1"
                      placeholder="e.g. Chest, Abdomen"
                      value={bodyPart}
                      onChange={(e) => setBodyPart(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Priority</label>
                    <select
                      className="select-field mt-1 w-full"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as any)}
                    >
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                      <option value="stat">STAT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Clinical History</label>
                    <input
                      type="text"
                      className="input-field mt-1"
                      placeholder="Symptoms, query..."
                      value={clinicalHistory}
                      onChange={(e) => setClinicalHistory(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Notes / Instructions</label>
                  <textarea
                    rows={2}
                    className="input-field mt-1 resize-none"
                    placeholder="Check-in note, scan details..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 border-t border-tdai-border pt-4 dark:border-slate-800">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setSelectedSlot(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedPatient}
                    className="btn-primary text-xs"
                  >
                    Confirm & Book
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* View / Reschedule Order Modal */}
        {selectedOrder && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setSelectedOrder(null)}
          >
            <div
              className="w-full max-w-lg mx-4 rounded-xl bg-white p-6 shadow-2xl animate-slide-up dark:bg-slate-900 border dark:border-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-tdai-border-light pb-3.5 dark:border-slate-800">
                <div className="flex items-center gap-2 text-tdai-navy-800 dark:text-white">
                  <FileText className="h-5 w-5 text-tdai-teal-500" />
                  <h3 className="text-base font-bold">Reschedule / Edit Appointment</h3>
                </div>
                <button type="button" onClick={() => setSelectedOrder(null)} className="text-tdai-muted hover:text-tdai-text">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Order patient header */}
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <User className="h-8 w-8 text-tdai-teal-600" />
                <div>
                  <p className="font-bold text-sm text-tdai-text dark:text-slate-100">{selectedOrder.patientName}</p>
                  <p className="text-[10px] text-tdai-muted">MRN: {selectedOrder.patientId}</p>
                </div>
              </div>

              <form onSubmit={handleUpdateSubmit} className="mt-4 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Appointment Date</label>
                    <input
                      type="date"
                      className="input-field mt-1"
                      value={rescheduleDate}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Appointment Hour</label>
                    <select
                      className="select-field mt-1 w-full"
                      value={rescheduleHour}
                      onChange={(e) => setRescheduleHour(Number(e.target.value))}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h > 12 ? h - 12 : h}:00 {h >= 12 ? "PM" : "AM"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Modality</label>
                    <select
                      className="select-field mt-1 w-full"
                      value={modality}
                      onChange={(e) => setModality(e.target.value as Modality)}
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
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Body Part</label>
                    <input
                      type="text"
                      className="input-field mt-1"
                      placeholder="e.g. Chest, Abdomen"
                      value={bodyPart}
                      onChange={(e) => setBodyPart(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Priority</label>
                    <select
                      className="select-field mt-1 w-full"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as any)}
                    >
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                      <option value="stat">STAT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Clinical History</label>
                    <input
                      type="text"
                      className="input-field mt-1"
                      value={clinicalHistory}
                      onChange={(e) => setClinicalHistory(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-tdai-secondary dark:text-slate-300">Notes / Instructions</label>
                  <textarea
                    rows={2}
                    className="input-field mt-1 resize-none"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="flex justify-between items-center border-t border-tdai-border pt-4 dark:border-slate-800">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                    onClick={handleCancelOrder}
                  >
                    Cancel Appointment
                  </button>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setSelectedOrder(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary text-xs"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
