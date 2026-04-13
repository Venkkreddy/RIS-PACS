import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Permission, UserRole } from "@medical-report-system/shared";

interface RolePermissionData {
  role: UserRole;
  permissions: Permission[];
  isCustomized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface PermissionsResponse {
  roles: RolePermissionData[];
  allPermissions: Permission[];
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  developer: "Developer",
  radiologist: "Radiologist",
  radiographer: "Radiographer",
  billing: "Billing",
  referring: "Referring",
  receptionist: "Receptionist",
  viewer: "Viewer",
};

const MODULE_LABELS: Record<string, string> = {
  platform: "Platform",
  dashboard: "Dashboard",
  patients: "Patients",
  orders: "Orders",
  scheduling: "Scheduling",
  worklist: "Worklist",
  reports: "Reports",
  templates: "Templates",
  billing: "Billing",
  referring_physicians: "Physicians",
  dicom: "DICOM",
  ai: "AI Analysis",
  voice: "Voice",
  admin: "Administration",
};

function groupByModule(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {};
  for (const perm of permissions) {
    const mod = perm.split(":")[0];
    if (!groups[mod]) groups[mod] = [];
    groups[mod].push(perm);
  }
  return groups;
}

function actionLabel(perm: Permission): string {
  const action = perm.split(":")[1];
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const EDITABLE_ROLES: UserRole[] = ["radiologist", "radiographer", "billing", "referring", "receptionist", "viewer"];

export function PermissionsManager() {
  const [data, setData] = useState<PermissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [localPerms, setLocalPerms] = useState<Record<string, Set<Permission>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<PermissionsResponse>("/permissions");
      setData(res.data);
      const permsMap: Record<string, Set<Permission>> = {};
      for (const role of res.data.roles) {
        permsMap[role.role] = new Set(role.permissions);
      }
      setLocalPerms(permsMap);
      setDirty(new Set());
    } catch {
      setMessage({ type: "error", text: "Failed to load permissions" });
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function togglePermission(role: string, perm: Permission) {
    setLocalPerms((prev) => {
      const next = { ...prev };
      const set = new Set(prev[role]);
      if (set.has(perm)) set.delete(perm);
      else set.add(perm);
      next[role] = set;
      return next;
    });
    setDirty((prev) => new Set(prev).add(role));
    setMessage(null);
  }

  async function saveRole(role: string) {
    setSaving(role);
    try {
      await api.put(`/permissions/${role}`, {
        permissions: [...(localPerms[role] ?? [])],
      });
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(role);
        return next;
      });
      setMessage({ type: "success", text: `${ROLE_LABELS[role as UserRole]} permissions saved` });
    } catch {
      setMessage({ type: "error", text: `Failed to save ${role} permissions` });
    }
    setSaving(null);
  }

  async function resetRole(role: string) {
    setSaving(role);
    try {
      const res = await api.post<{ role: string; permissions: Permission[] }>(`/permissions/${role}/reset`);
      setLocalPerms((prev) => ({ ...prev, [role]: new Set(res.data.permissions) }));
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(role);
        return next;
      });
      setMessage({ type: "success", text: `${ROLE_LABELS[role as UserRole]} reset to defaults` });
    } catch {
      setMessage({ type: "error", text: `Failed to reset ${role} permissions` });
    }
    setSaving(null);
  }

  if (loading || !data) {
    return <p className="py-8 text-center text-sm text-tdai-gray-400 dark:text-tdai-gray-500">Loading permissions...</p>;
  }

  const modules = groupByModule(data.allPermissions as Permission[]);

  return (
    <div className="space-y-4">
      {message && (
        <div className={`rounded-lg px-4 py-2 text-sm font-medium ${message.type === "success" ? "bg-green-50 text-green-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-tdai-red-950/30 dark:text-tdai-red-300"}`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-tdai-gray-200 bg-white dark:border-white/[0.08] dark:bg-tdai-gray-900">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-tdai-gray-200 bg-tdai-gray-50 dark:border-white/[0.08] dark:bg-tdai-gray-800/50">
              <th className="sticky left-0 z-10 bg-tdai-gray-50 px-3 py-2.5 font-semibold text-tdai-navy-700 dark:bg-tdai-gray-800/50 dark:text-tdai-gray-100">Permission</th>
              {EDITABLE_ROLES.map((role) => (
                <th key={role} className="px-3 py-2.5 text-center font-semibold text-tdai-navy-700 whitespace-nowrap dark:text-tdai-gray-100">
                  {ROLE_LABELS[role]}
                  {dirty.has(role) && <span className="ml-1 text-amber-500">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(modules).map(([mod, perms]) => (
              <>
                <tr key={`hdr-${mod}`} className="bg-tdai-gray-50/60">
                  <td colSpan={EDITABLE_ROLES.length + 1} className="px-3 py-2 font-semibold text-tdai-navy-600 text-[11px] uppercase tracking-wider">
                    {MODULE_LABELS[mod] ?? mod}
                  </td>
                </tr>
                {perms.map((perm) => (
                  <tr key={perm} className="border-b border-tdai-gray-100 hover:bg-tdai-gray-50/40 transition-colors dark:border-white/[0.06] dark:hover:bg-white/[0.04]">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-tdai-gray-600 whitespace-nowrap dark:bg-tdai-gray-900 dark:text-tdai-gray-300">{actionLabel(perm)}</td>
                    {EDITABLE_ROLES.map((role) => (
                      <td key={role} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={localPerms[role]?.has(perm) ?? false}
                          onChange={() => togglePermission(role, perm)}
                          className="h-3.5 w-3.5 rounded border-tdai-gray-300 text-tdai-teal-600 focus:ring-tdai-teal-500 cursor-pointer dark:border-white/[0.12]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        {EDITABLE_ROLES.filter((r) => dirty.has(r)).map((role) => (
          <div key={role} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={saving === role}
              onClick={() => void saveRole(role)}
              className="rounded-lg bg-tdai-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-tdai-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving === role ? "Saving..." : `Save ${ROLE_LABELS[role as UserRole]}`}
            </button>
            <button
              type="button"
              disabled={saving === role}
              onClick={() => void resetRole(role)}
              className="rounded-lg border border-tdai-gray-300 px-3 py-1.5 text-xs font-medium text-tdai-gray-600 hover:bg-tdai-gray-50 disabled:opacity-50 transition-colors dark:border-white/[0.08] dark:text-tdai-gray-300 dark:hover:bg-white/[0.06]"
            >
              Reset
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
