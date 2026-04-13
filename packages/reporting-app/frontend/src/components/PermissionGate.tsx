import { Navigate } from "react-router-dom";
import { PropsWithChildren } from "react";
import { useAuthRole, type Role } from "../hooks/useAuthRole";
import type { Permission } from "@medical-report-system/shared";

const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    "platform:view_overview", "platform:manage_hospitals", "platform:assign_pacs",
    "platform:manage_hospital_admins", "platform:view_monitoring",
    "dashboard:view", "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scans:view", "scans:create", "scans:edit", "scans:delete",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share", "reports:delete",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit", "referring_physicians:delete",
    "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "admin:manage_users", "admin:manage_roles", "admin:view_analytics", "admin:manage_invites",
    "developer:toggle_services", "developer:view_health",
  ],
  admin: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scans:view", "scans:create", "scans:edit", "scans:delete",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share", "reports:delete",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit", "referring_physicians:delete",
    "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "admin:manage_users", "admin:manage_roles", "admin:view_analytics", "admin:manage_invites",
    "developer:toggle_services", "developer:view_health",
  ],
  developer: [
    "dashboard:view", "patients:view", "worklist:view", "reports:view",
    "dicom:view", "ai:analyze", "ai:view_results",
    "admin:manage_users", "developer:toggle_services", "developer:view_health",
  ],
  radiologist: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create", "scans:view", "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "referring_physicians:view",
  ],
  radiographer: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create", "orders:edit", "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "dicom:upload", "dicom:view", "referring_physicians:view",
  ],
  billing: [
    "dashboard:view", "patients:view", "orders:view", "reports:view",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view",
  ],
  referring: [
    "dashboard:view", "patients:view", "orders:view", "orders:create",
    "reports:view", "scheduling:view",
  ],
  receptionist: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit",
  ],
  viewer: [
    "dashboard:view", "patients:view", "orders:view", "scans:view", "scheduling:view",
    "worklist:view", "reports:view", "billing:view", "referring_physicians:view",
  ],
};

interface PermissionGateProps {
  /** User must hold at least one of these permissions to access children */
  require: Permission[];
  /** Where to redirect if the user lacks the permission (defaults to /home) */
  fallback?: string;
}

export function PermissionGate({
  require,
  fallback = "/home",
  children,
}: PropsWithChildren<PermissionGateProps>) {
  const auth = useAuthRole();

  if (auth.loading) {
    return <div className="p-6">Checking access...</div>;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!auth.approved) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (auth.role === "admin" || auth.role === "super_admin") {
    return <>{children}</>;
  }

  if (auth.hasAnyPermission(require)) {
    return <>{children}</>;
  }

  if (auth.permissions.length === 0) {
    const roleDefaults = ROLE_DEFAULT_PERMISSIONS[auth.role] ?? [];
    if (require.some((p) => roleDefaults.includes(p))) {
      return <>{children}</>;
    }
  }

  return <Navigate to={fallback} replace />;
}
