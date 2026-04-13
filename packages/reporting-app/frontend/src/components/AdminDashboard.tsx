import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { WorklistUser } from "../types/worklist";
import { useAuthRole } from "../hooks/useAuthRole";
import { ServiceTogglePanel } from "./ServiceTogglePanel";
import { motion } from "framer-motion";
import {
  Building2,
  Upload,
  Clock,
  Users,
  BarChart3,
  Settings,
  Shield,
  ClipboardList,
  RefreshCw,
  Check,
  X,
  Pencil,
} from "lucide-react";

const ALL_ROLES = ["admin", "developer", "radiologist", "radiographer", "referring", "billing", "receptionist", "viewer"] as const;
type UserRole = (typeof ALL_ROLES)[number];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  developer: "Developer",
  radiologist: "Dr. Portal (Radiologist)",
  radiographer: "Radiographer",
  referring: "Referring Physician",
  billing: "Billing",
  receptionist: "Receptionist",
  viewer: "Viewer",
};

const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  patients: "Patients",
  orders: "Orders",
  scans: "Scans",
  scheduling: "Scheduling",
  worklist: "Worklist",
  reports: "Reports",
  templates: "Templates",
  billing: "Billing",
  referring_physicians: "Referring Physicians",
  dicom: "DICOM",
  ai: "AI Tools",
  voice: "Voice / Dictation",
  admin: "Admin",
  developer: "Developer Tools",
  platform: "Platform",
};

const PERMISSION_ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  assign: "Assign",
  update_status: "Update Status",
  sign: "Sign",
  addendum: "Addendum",
  share: "Share",
  invoice: "Invoice",
  mark_paid: "Mark Paid",
  upload: "Upload",
  analyze: "Analyze",
  view_results: "View Results",
  transcribe: "Transcribe",
  manage_users: "Manage Users",
  manage_roles: "Manage Roles",
  view_analytics: "View Analytics",
  manage_invites: "Manage Invites",
  toggle_services: "Toggle Services",
  view_health: "View Health",
  view_overview: "View Overview",
  manage_hospitals: "Manage Hospitals",
  assign_pacs: "Assign PACS",
  manage_hospital_admins: "Manage Hospital Admins",
  view_monitoring: "View Monitoring",
};

interface RolePermissionData {
  role: string;
  permissions: string[];
  isCustomized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface PermissionsResponse {
  roles: RolePermissionData[];
  allPermissions: string[];
}

function groupPermissionsByModule(perms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    const [mod] = p.split(":");
    if (!groups[mod]) groups[mod] = [];
    groups[mod].push(p);
  }
  return groups;
}

interface AnalyticsResponse {
  centers: Array<{ name: string; uploads: number }>;
  totalUploads: number;
  radiologists: Array<{ userId: string; name: string; assignedCount: number }>;
  pendingReports: Array<{ studyId: string; patientName?: string; assignedTo?: string; currentTatHours: number }>;
  longestTat: Array<{ studyId: string; patientName?: string; tatHours?: number; assignedTo?: string }>;
}

const PIE_COLORS = ["#00B4A6", "#1A2B56", "#3B82F6", "#8B5CF6", "#F59E0B", "#E03C31", "#10B981", "#06B6D4"];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
};

type AdminTab = "overview" | "users" | "approvals" | "permissions" | "audit" | "services";

export function AdminDashboard() {
  const queryClient = useQueryClient();
  const { role } = useAuthRole();
  const [tab, setTab] = useState<AdminTab>(role === "developer" ? "services" : "overview");
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");

  const analyticsQuery = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => (await api.get<AnalyticsResponse>("/analytics")).data,
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get<WorklistUser[]>("/users")).data,
  });

  const pendingQuery = useQuery({
    queryKey: ["admin-pending"],
    queryFn: async () => (await api.get<WorklistUser[]>("/admin/user-requests")).data,
  });

  async function sendReminder(studyId: string) {
    await api.post("/admin/reminder", { studyId });
    setReminderStatus(`Reminder sent for ${studyId}`);
    setTimeout(() => setReminderStatus(null), 3000);
  }

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("viewer");
  const [approveRole, setApproveRole] = useState<Record<string, UserRole>>({});

  const [permRole, setPermRole] = useState<UserRole>("radiologist");
  const [permDraft, setPermDraft] = useState<Set<string>>(new Set());
  const [permDirty, setPermDirty] = useState(false);
  const [permSaveMsg, setPermSaveMsg] = useState<string | null>(null);

  const permissionsQuery = useQuery({
    queryKey: ["admin-permissions"],
    queryFn: async () => (await api.get<PermissionsResponse>("/permissions")).data,
    enabled: tab === "permissions",
  });

  const allPermissions = permissionsQuery.data?.allPermissions ?? [];
  const permRolesData = permissionsQuery.data?.roles ?? [];
  const currentRolePerms = permRolesData.find((r) => r.role === permRole);
  const permModules = groupPermissionsByModule(allPermissions);

  useEffect(() => {
    if (permRolesData.length > 0 && !permDirty) {
      const found = permRolesData.find((r) => r.role === permRole);
      if (found) setPermDraft(new Set(found.permissions));
    }
  }, [permRolesData, permRole, permDirty]);

  function loadPermDraft(roleKey: UserRole) {
    setPermRole(roleKey);
    const found = permRolesData.find((r) => r.role === roleKey);
    setPermDraft(new Set(found?.permissions ?? []));
    setPermDirty(false);
    setPermSaveMsg(null);
  }

  function togglePerm(perm: string) {
    setPermDraft((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return next;
    });
    setPermDirty(true);
    setPermSaveMsg(null);
  }

  function toggleModuleAll(moduleName: string) {
    const modulePerms = permModules[moduleName] ?? [];
    const allChecked = modulePerms.every((p) => permDraft.has(p));
    setPermDraft((prev) => {
      const next = new Set(prev);
      for (const p of modulePerms) {
        if (allChecked) next.delete(p); else next.add(p);
      }
      return next;
    });
    setPermDirty(true);
    setPermSaveMsg(null);
  }

  const savePermsMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/permissions/${permRole}`, { permissions: Array.from(permDraft) });
    },
    onSuccess: () => {
      setPermDirty(false);
      setPermSaveMsg("Permissions saved successfully");
      void queryClient.invalidateQueries({ queryKey: ["admin-permissions"] });
      setTimeout(() => setPermSaveMsg(null), 3000);
    },
  });

  const resetPermsMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/permissions/${permRole}/reset`);
    },
    onSuccess: () => {
      setPermDirty(false);
      setPermSaveMsg("Permissions reset to defaults");
      void queryClient.invalidateQueries({ queryKey: ["admin-permissions"] });
      setTimeout(() => setPermSaveMsg(null), 3000);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      await api.patch(`/users/${encodeURIComponent(id)}`, { role });
    },
    onSuccess: () => {
      setEditingUserId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  async function approveUser(id: string) {
    const role = approveRole[id];
    await api.post(`/admin/user-requests/${encodeURIComponent(id)}/approve`, role ? { role } : {});
    await queryClient.invalidateQueries({ queryKey: ["admin-pending"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function rejectUser(id: string) {
    await api.post(`/admin/user-requests/${encodeURIComponent(id)}/reject`);
    await queryClient.invalidateQueries({ queryKey: ["admin-pending"] });
  }

  const analytics = analyticsQuery.data;
  const users = usersQuery.data ?? [];
  const pending = pendingQuery.data ?? [];

  const filteredUsers = roleFilter ? users.filter((u) => u.role === roleFilter) : users;

  const showServices = role === "developer" || role === "admin" || role === "super_admin";

  const TABS: Array<{ key: AdminTab; label: string; icon: string; badge?: number }> = [
    { key: "overview", label: "Overview", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
    { key: "users", label: "User Management", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
    { key: "approvals", label: "Approvals", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", badge: pending.length },
    { key: "permissions", label: "Permissions", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
    { key: "audit", label: "Audit Log", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    ...(showServices ? [{ key: "services" as AdminTab, label: "Services", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" }] : []),
  ];

  const activeApprovedCount = users.filter((u) => u.approved).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-tdai-background dark:bg-tdai-gray-950"
    >
      {/* ── Title bar ─────────────── */}
      <div style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #E2E8F0" }} className="px-6 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: "#EEF1F6" }}>
            <svg className="h-3.5 w-3.5" style={{ color: "#1A2B56" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <span style={{ color: "#111D3B" }} className="text-sm font-bold tracking-wider">
            {role === "super_admin" ? "SUPER ADMIN PORTAL" : role === "developer" ? "DEVELOPER CONSOLE" : "ADMIN CONSOLE"}
          </span>
        </div>
      </div>

      {/* ── Tab navigation ────────── */}
      <div style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #E2E8F0" }} className="px-6">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <motion.button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              whileTap={{ scale: 0.97 }}
              style={{ color: tab === t.key ? "#111D3B" : "#94A3B8" }}
              className="relative flex items-center gap-2 px-4 py-3 text-xs font-medium transition-colors hover:text-tdai-navy-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
              </svg>
              {t.label}
              {(t.badge ?? 0) > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-tdai-red-500 px-1 text-[9px] font-bold text-white">
                  {t.badge}
                </span>
              )}
              {tab === t.key && (
                <motion.span
                  layoutId="admin-console-tab-underline"
                  style={{ backgroundColor: "#1A2B56" }}
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="dashboard-inner">
        {/* ════════════════════════════ OVERVIEW TAB ═══════════════════ */}
        {tab === "overview" && (
          <motion.div
            key="overview-panel"
            variants={container}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            {/* KPI cards */}
            <motion.div variants={item} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="group card-hover relative overflow-hidden px-5 py-5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-tdai-navy-500/[0.03] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-navy-400/[0.08]" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Centers</p>
                    <motion.p
                      key={analytics ? `centers-${analytics.centers.length}` : "centers-empty"}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="mt-1 text-3xl font-bold text-tdai-text dark:text-white"
                    >
                      {analytics?.centers.length ?? "—"}
                    </motion.p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-navy-50 transition-colors group-hover:bg-tdai-navy-100 dark:bg-tdai-navy-900/30 dark:group-hover:bg-tdai-navy-800/50">
                    <Building2 className="h-5 w-5 text-tdai-navy-500 dark:text-tdai-navy-300" strokeWidth={1.75} />
                  </div>
                </div>
              </motion.div>
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="group card-hover relative overflow-hidden px-5 py-5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-tdai-teal-500/[0.03] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-teal-400/[0.08]" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Total Uploads</p>
                    <motion.p
                      key={analytics ? `uploads-${analytics.totalUploads}` : "uploads-empty"}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="mt-1 text-3xl font-bold text-tdai-text dark:text-white"
                    >
                      {analytics != null ? analytics.totalUploads.toLocaleString() : "—"}
                    </motion.p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-teal-50 transition-colors group-hover:bg-tdai-teal-100 dark:bg-tdai-teal-900/20 dark:group-hover:bg-tdai-teal-900/30">
                    <Upload className="h-5 w-5 text-tdai-teal-500 dark:text-tdai-teal-400" strokeWidth={1.75} />
                  </div>
                </div>
              </motion.div>
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="group card-hover relative overflow-hidden px-5 py-5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-tdai-red-500/[0.03] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-tdai-red-400/[0.08]" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Pending Reports</p>
                    <motion.p
                      key={analytics ? `pending-${analytics.pendingReports.length}` : "pending-empty"}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="mt-1 text-3xl font-bold text-tdai-red-500 dark:text-tdai-red-400"
                    >
                      {analytics?.pendingReports.length ?? "—"}
                    </motion.p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tdai-red-50 transition-colors group-hover:bg-tdai-red-100 dark:bg-tdai-red-900/20 dark:group-hover:bg-tdai-red-900/30">
                    <Clock className="h-5 w-5 text-tdai-red-500 dark:text-tdai-red-400" strokeWidth={1.75} />
                  </div>
                </div>
              </motion.div>
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="group card-hover relative overflow-hidden px-5 py-5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.03] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-emerald-400/[0.08]" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">Active Users</p>
                    <motion.p
                      key={`active-${activeApprovedCount}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="mt-1 text-3xl font-bold text-tdai-text dark:text-white"
                    >
                      {activeApprovedCount}
                    </motion.p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-900/20 dark:group-hover:bg-emerald-900/30">
                    <Users className="h-5 w-5 text-emerald-500 dark:text-emerald-400" strokeWidth={1.75} />
                  </div>
                </div>
              </motion.div>
            </motion.div>

            {/* Charts */}
            {analytics && (
              <motion.div variants={item} className="grid gap-6 lg:grid-cols-2">
                <motion.div whileHover={{ y: -2, transition: { duration: 0.2 } }} className="group card relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-tdai-teal-500/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none dark:from-tdai-teal-400/[0.06]" />
                  <div className="relative flex items-center gap-3 border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
                      <BarChart3 className="h-4 w-4 text-tdai-teal-600 dark:text-tdai-teal-400" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-tdai-text dark:text-white">Uploads by Center</h3>
                      <p className="text-[10px] text-tdai-muted dark:text-tdai-gray-400">Distribution across imaging centers</p>
                    </div>
                  </div>
                  <div className="relative p-5">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analytics.centers}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: "0.75rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)", fontSize: "12px" }}
                            cursor={{ fill: "rgba(0,180,166,0.06)" }}
                          />
                          <Bar dataKey="uploads" fill="url(#adminBarTealGradient)" radius={[8, 8, 0, 0]} />
                          <defs>
                            <linearGradient id="adminBarTealGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#00B4A6" />
                              <stop offset="100%" stopColor="#009488" />
                            </linearGradient>
                          </defs>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
                <motion.div whileHover={{ y: -2, transition: { duration: 0.2 } }} className="group card relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-tdai-navy-500/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none dark:from-tdai-navy-400/[0.06]" />
                  <div className="relative flex items-center gap-3 border-b border-tdai-gray-100 px-5 py-4 dark:border-white/[0.08]">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-navy-50 dark:bg-tdai-navy-900/30">
                      <BarChart3 className="h-4 w-4 text-tdai-navy-600 dark:text-tdai-navy-300" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-tdai-text dark:text-white">Assigned Studies by Radiologist</h3>
                      <p className="text-[10px] text-tdai-muted dark:text-tdai-gray-400">Workload distribution overview</p>
                    </div>
                  </div>
                  <div className="relative p-5">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analytics.radiologists}
                            dataKey="assignedCount"
                            nameKey="name"
                            outerRadius={90}
                            innerRadius={40}
                            label={{ fontSize: 11 }}
                            paddingAngle={2}
                          >
                            {analytics.radiologists.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: "0.75rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)", fontSize: "12px" }}
                          />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Pending reports table */}
            {analytics && analytics.pendingReports.length > 0 && (
              <motion.div variants={item} className="group card relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-tdai-red-500/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none dark:from-tdai-red-400/[0.06]" />
                <div className="relative flex items-center gap-3 border-b border-tdai-border px-5 py-4 dark:border-white/[0.08]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tdai-red-50 dark:bg-tdai-red-900/20">
                    <Clock className="h-4 w-4 text-tdai-red-500 dark:text-tdai-red-400" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-tdai-text dark:text-white">Pending Reports — Highest TAT</h3>
                    <p className="text-[10px] text-tdai-muted dark:text-tdai-gray-400">Studies with the longest current turnaround time</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="table-header">
                      <tr>
                        <th>
                          <span className="inline-flex items-center gap-1.5">
                            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                            Study ID
                          </span>
                        </th>
                        <th>
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                            Patient
                          </span>
                        </th>
                        <th>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                            TAT (hours)
                          </span>
                        </th>
                        <th>
                          <span className="inline-flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                            Assigned To
                          </span>
                        </th>
                        <th>
                          <span className="inline-flex items-center gap-1.5">
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                            Action
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-tdai-border-light dark:divide-white/[0.06]">
                      {analytics.pendingReports.slice(0, 15).map((s, i) => (
                        <motion.tr
                          key={s.studyId}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                          className="table-row-hover"
                        >
                          <td className="table-cell font-mono text-xs">{s.studyId.slice(0, 12)}</td>
                          <td className="table-cell">{s.patientName ?? "—"}</td>
                          <td className="table-cell">
                            <span
                              className={`badge ${
                                s.currentTatHours > 24
                                  ? "bg-tdai-red-50 text-tdai-red-700 dark:bg-tdai-red-900/25 dark:text-tdai-red-300"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                              }`}
                            >
                              {s.currentTatHours.toFixed(1)}h
                            </span>
                          </td>
                          <td className="table-cell text-tdai-secondary dark:text-tdai-gray-400">{s.assignedTo ?? "Unassigned"}</td>
                          <td className="table-cell">
                            <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => void sendReminder(s.studyId)}>
                              Send Reminder
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reminderStatus && (
                  <div className="border-t border-tdai-border bg-emerald-50 px-5 py-2 text-xs text-emerald-700 dark:border-white/[0.08] dark:bg-emerald-900/20 dark:text-emerald-400">
                    {reminderStatus}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════ USERS TAB ═══════════════════ */}
        {tab === "users" && (
          <motion.div
            key="users-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-tdai-text dark:text-white">All Users</h2>
              <div className="flex items-center gap-3">
                <select className="select-field !py-1.5 text-xs" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="">All Roles</option>
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <span className="text-xs text-tdai-secondary dark:text-tdai-gray-400">{filteredUsers.length} users</span>
              </div>
            </div>
            <div className="group card relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-tdai-navy-500/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none dark:from-tdai-navy-400/[0.06]" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="table-header">
                    <tr>
                      <th>
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                          User
                        </span>
                      </th>
                      <th>
                        <span className="inline-flex items-center gap-1.5">
                          <Upload className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                          Email
                        </span>
                      </th>
                      <th>
                        <span className="inline-flex items-center gap-1.5">
                          <Shield className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                          Role
                        </span>
                      </th>
                      <th>
                        <span className="inline-flex items-center gap-1.5">
                          <Settings className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                          Status
                        </span>
                      </th>
                      <th>
                        <span className="inline-flex items-center gap-1.5">
                          <Pencil className="h-3.5 w-3.5 shrink-0 text-tdai-secondary dark:text-tdai-gray-500" strokeWidth={1.75} />
                          Actions
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tdai-border-light dark:divide-white/[0.06]">
                    {filteredUsers.map((u, i) => {
                      const isEditing = editingUserId === u.id;
                      return (
                      <motion.tr
                        key={u.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.035, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                        className="table-row-hover"
                      >
                        <td className="table-cell">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tdai-navy-100 text-xs font-semibold text-tdai-navy-700 dark:bg-tdai-navy-800 dark:text-tdai-navy-200">
                              {(u.displayName ?? u.email)?.[0]?.toUpperCase() ?? "?"}
                            </div>
                            <span className="font-medium">{u.displayName ?? u.email.split("@")[0]}</span>
                          </div>
                        </td>
                        <td className="table-cell text-tdai-secondary dark:text-tdai-gray-400">{u.email}</td>
                        <td className="table-cell">
                          {isEditing ? (
                            <select
                              className="select-field !py-1 !text-xs !min-w-[160px]"
                              value={editRole}
                              onChange={(e) => setEditRole(e.target.value as UserRole)}
                            >
                              {ALL_ROLES.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`badge ${
                                u.role === "admin"
                                  ? "bg-tdai-navy-50 text-tdai-navy-700 ring-1 ring-tdai-navy-200 dark:bg-tdai-navy-900/30 dark:text-tdai-navy-200 dark:ring-tdai-navy-600"
                                  : u.role === "super_admin"
                                    ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:ring-purple-700"
                                  : u.role === "radiologist"
                                    ? "bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:ring-tdai-teal-700"
                                    : u.role === "developer"
                                      ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:ring-violet-700"
                                      : "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-700"
                              }`}
                            >
                              {ROLE_LABELS[u.role] ?? u.role}
                            </span>
                          )}
                        </td>
                        <td className="table-cell">
                          <span
                            className={`badge ${
                              u.approved
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                                : "bg-tdai-red-50 text-tdai-red-600 dark:bg-tdai-red-900/20 dark:text-tdai-red-400"
                            }`}
                          >
                            {u.approved ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="table-cell">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400"
                                title="Save"
                                onClick={() => updateRoleMutation.mutate({ id: u.id, role: editRole })}
                                disabled={updateRoleMutation.isPending}
                              >
                                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                              </button>
                              <button
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-tdai-gray-100 text-tdai-gray-500 transition-colors hover:bg-tdai-gray-200 dark:bg-white/5 dark:text-tdai-gray-400"
                                title="Cancel"
                                onClick={() => setEditingUserId(null)}
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                              </button>
                            </div>
                          ) : u.role === "super_admin" ? (
                            <span className="badge bg-purple-50 text-purple-700 ring-1 ring-purple-200">
                              Locked
                            </span>
                          ) : (
                            <button
                              className="flex h-7 items-center gap-1.5 rounded-lg bg-tdai-navy-50 px-2.5 text-[11px] font-medium text-tdai-navy-600 transition-colors hover:bg-tdai-navy-100 dark:bg-tdai-navy-900/30 dark:text-tdai-navy-200"
                              title="Change role"
                              onClick={() => { setEditingUserId(u.id); setEditRole(u.role as UserRole); }}
                            >
                              <Pencil className="h-3 w-3" strokeWidth={2} />
                              Edit Role
                            </button>
                          )}
                        </td>
                      </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════ APPROVALS TAB ═══════════════ */}
        {tab === "approvals" && (
          <motion.div
            key="approvals-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <h2 className="text-lg font-semibold text-tdai-text dark:text-white">Pending Approvals</h2>
            {pending.length === 0 ? (
              <div className="card py-16 text-center">
                <svg className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">No pending approvals</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pending.map((u) => (
                  <motion.div
                    key={u.id}
                    whileHover={{ y: -2, scale: 1.01, transition: { duration: 0.2 } }}
                    className="card-hover p-5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tdai-teal-50 text-sm font-semibold text-tdai-teal-700 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300">
                        {(u.displayName ?? u.email)?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-tdai-text dark:text-white">{u.displayName ?? u.email.split("@")[0]}</p>
                        <p className="text-xs text-tdai-secondary dark:text-tdai-gray-400">{u.email}</p>
                        <p className="mt-1">
                          <span className="badge bg-tdai-surface-alt text-tdai-secondary dark:bg-white/[0.05] dark:text-tdai-gray-400">
                            Requested: {ROLE_LABELS[u.role] ?? u.role}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-tdai-secondary dark:text-tdai-gray-400">
                        Assign role
                      </label>
                      <select
                        className="select-field !py-1.5 !text-xs w-full"
                        value={approveRole[u.id] ?? u.role}
                        onChange={(e) => setApproveRole((prev) => ({ ...prev, [u.id]: e.target.value as UserRole }))}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary flex-1 !py-1.5 text-xs" onClick={() => void approveUser(u.id)}>Approve</button>
                      <button className="btn-danger flex-1 !py-1.5 text-xs" onClick={() => void rejectUser(u.id)}>Reject</button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════ PERMISSIONS TAB ═══════════════ */}
        {tab === "permissions" && (
          <motion.div
            key="permissions-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-tdai-text dark:text-white">Role Permissions</h2>
                <p className="mt-0.5 text-xs text-tdai-secondary dark:text-tdai-gray-400">
                  Configure granular permissions for each role. Admin always has full access.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="select-field !py-1.5 text-xs !min-w-[200px]"
                  value={permRole}
                  onChange={(e) => loadPermDraft(e.target.value as UserRole)}
                >
                  {ALL_ROLES.filter((r) => r !== "admin").map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                {currentRolePerms?.isCustomized && (
                  <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-700">
                    Customized
                  </span>
                )}
              </div>
            </div>

            {permissionsQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-white/20 dark:border-t-tdai-teal-400" />
              </div>
            ) : permRole === "admin" ? (
              <div className="card py-16 text-center">
                <Shield className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" strokeWidth={1} />
                <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">Admin role has full access to all permissions</p>
                <p className="mt-1 text-xs text-tdai-muted dark:text-tdai-gray-500">Admin permissions cannot be modified</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(permModules).map(([moduleName, modulePerms]) => {
                    const checkedCount = modulePerms.filter((p) => permDraft.has(p)).length;
                    const allChecked = checkedCount === modulePerms.length;
                    const someChecked = checkedCount > 0 && !allChecked;
                    return (
                      <motion.div
                        key={moduleName}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="card overflow-hidden"
                      >
                        <div className="flex items-center justify-between border-b border-tdai-gray-100 px-4 py-3 dark:border-white/[0.08]">
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 accent-[#00B4A6] transition-colors focus:ring-[#00B4A6]/20"
                              checked={allChecked}
                              ref={(el) => { if (el) el.indeterminate = someChecked; }}
                              onChange={() => toggleModuleAll(moduleName)}
                            />
                            <span className="text-xs font-bold uppercase tracking-wider text-tdai-text dark:text-white">
                              {PERMISSION_MODULE_LABELS[moduleName] ?? moduleName}
                            </span>
                          </label>
                          <span className="text-[10px] font-medium text-tdai-secondary dark:text-tdai-gray-400">
                            {checkedCount}/{modulePerms.length}
                          </span>
                        </div>
                        <div className="space-y-0.5 p-3">
                          {modulePerms.map((perm) => {
                            const action = perm.split(":")[1];
                            return (
                              <label
                                key={perm}
                                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-tdai-gray-50 dark:hover:bg-white/[0.04]"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 rounded border-slate-300 accent-[#00B4A6] transition-colors focus:ring-[#00B4A6]/20"
                                  checked={permDraft.has(perm)}
                                  onChange={() => togglePerm(perm)}
                                />
                                <span className="text-xs text-tdai-text dark:text-tdai-gray-300">
                                  {PERMISSION_ACTION_LABELS[action] ?? action}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Action bar */}
                <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-xl border border-tdai-gray-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur-sm dark:border-white/[0.08] dark:bg-tdai-gray-900/95">
                  <div className="flex items-center gap-3">
                    {permSaveMsg && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        {permSaveMsg}
                      </span>
                    )}
                    {permDirty && !permSaveMsg && (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="flex items-center gap-1.5 rounded-lg border border-tdai-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-tdai-secondary transition-colors hover:bg-tdai-gray-50 hover:text-tdai-red-600 dark:border-white/10 dark:bg-white/5 dark:text-tdai-gray-400 dark:hover:text-tdai-red-400"
                      onClick={() => void resetPermsMutation.mutateAsync()}
                      disabled={resetPermsMutation.isPending}
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                      Reset to Defaults
                    </button>
                    <button
                      className="btn-primary !px-4 !py-1.5 text-xs"
                      onClick={() => void savePermsMutation.mutateAsync()}
                      disabled={!permDirty || savePermsMutation.isPending}
                    >
                      {savePermsMutation.isPending ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          Saving...
                        </span>
                      ) : "Save Permissions"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════ AUDIT TAB ═══════════════════ */}
        {tab === "audit" && (
          <motion.div
            key="audit-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <h2 className="text-lg font-semibold text-tdai-text dark:text-white">Audit Log</h2>
            <div className="card py-16 text-center">
              <svg className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="mt-3 text-sm text-tdai-secondary dark:text-tdai-gray-400">Audit logging coming soon</p>
              <p className="mt-1 text-xs text-tdai-muted dark:text-tdai-gray-500">Track all user actions and system events</p>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════ SERVICES TAB ═══════════════════ */}
        {tab === "services" && showServices && (
          <motion.div
            key="services-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <ServiceTogglePanel />
          </motion.div>
        )}

        {analyticsQuery.isLoading && tab === "overview" && (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-tdai-border border-t-tdai-accent dark:border-white/20 dark:border-t-tdai-teal-400" />
          </div>
        )}
      </div>
    </motion.div>
  );
}
