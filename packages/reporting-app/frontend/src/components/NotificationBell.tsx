import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "../api/client";

interface NotificationRecord {
  id: string;
  type: string;
  report_id: string;
  patient_name: string;
  radiologist_name: string;
  study_type: string;
  created_at: string;
  read: boolean;
  target_roles: string[];
}

/** Notification bell for admin/radiologist roles — polls for critical-finding alerts. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<NotificationRecord[]>("/notifications")).data,
    refetchInterval: 30_000,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function openNotification(n: NotificationRecord) {
    setOpen(false);
    if (!n.read) {
      await api.patch(`/notifications/${encodeURIComponent(n.id)}/read`).catch(() => undefined);
      queryClient.setQueryData<NotificationRecord[]>(["notifications"], (prev) =>
        (prev ?? []).map((item) => (item.id === n.id ? { ...item, read: true } : item)),
      );
    }
    navigate(`/reports/${n.report_id}`);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        title="Notifications"
        className="relative flex flex-shrink-0 items-center justify-center rounded-lg p-2 text-tdai-gray-500 transition-all duration-200 hover:bg-tdai-gray-50 hover:text-tdai-navy-700"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-tdai-red-600 px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-tdai-gray-200 bg-white shadow-xl">
          <div className="border-b border-tdai-gray-100 px-4 py-2.5">
            <p className="text-xs font-semibold text-tdai-navy-800">Notifications</p>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-tdai-gray-400">No notifications</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openNotification(n)}
                  className={`flex w-full flex-col gap-0.5 border-b border-tdai-gray-100 px-4 py-3 text-left text-xs transition-colors hover:bg-tdai-gray-50 ${
                    n.read ? "opacity-60" : "bg-tdai-red-50/40"
                  }`}
                >
                  <span className="font-medium text-tdai-navy-800">
                    ⚠️ Critical Finding — {n.patient_name} — {n.study_type}
                  </span>
                  <span className="text-[10px] text-tdai-gray-400">{new Date(n.created_at).toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
