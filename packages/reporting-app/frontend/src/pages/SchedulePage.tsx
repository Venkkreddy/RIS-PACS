import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RadiologyOrder, OrderStatus } from "@medical-report-system/shared";
import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16, scale: 0.97 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } };

const statusStyle: Record<OrderStatus, string> = {
  scheduled: "bg-tdai-teal-500",
  "in-progress": "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-slate-400",
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

  const weekDates = getWeekDates(weekOffset);

  async function load() {
    const res = await api.get<RadiologyOrder[]>("/orders", { params: { status: "scheduled" } });
    setOrders(res.data);
  }

  useEffect(() => { void load(); }, []);

  function ordersForSlot(date: Date, hour: number) {
    const dateStr = toDateStr(date);
    return orders.filter((o) => {
      const d = new Date(o.scheduledDate);
      return toDateStr(d) === dateStr && d.getHours() === hour;
    });
  }

  const todayStr = toDateStr(new Date());

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
            <p className="page-subheader mt-1">Weekly appointment calendar view</p>
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
          <table className="w-full min-w-[800px] border-collapse text-xs">
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
                      <td key={`${toDateStr(d)}-${hour}`} className={`border-r border-tdai-border-light px-1.5 py-1.5 align-top dark:border-white/[0.08] ${isToday ? "bg-tdai-accent/[0.02]" : ""}`} style={{ minHeight: 52 }}>
                        {slot.map((o) => (
                          <div key={o.id} className={`mb-1.5 rounded-lg px-2.5 py-2 text-white shadow-sm ${statusStyle[o.status]}`}>
                            <div className="font-semibold leading-tight">{o.patientName}</div>
                            <div className="mt-0.5 text-[10px] opacity-80">{o.modality} · {o.bodyPart}</div>
                          </div>
                        ))}
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
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
            <span className="capitalize">{status}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
