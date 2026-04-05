import type { UserRole, Permission, RolePermissions } from "@medical-report-system/shared";

export const DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "dashboard:view",
    "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share", "reports:delete",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit", "referring_physicians:delete",
    "dicom:upload", "dicom:view",
    "ai:analyze", "ai:view_results",
    "voice:transcribe",
    "admin:manage_users", "admin:manage_roles", "admin:view_analytics", "admin:manage_invites",
    "developer:toggle_services", "developer:view_health",
  ],

  developer: [
    "dashboard:view",
    "patients:view",
    "worklist:view",
    "reports:view",
    "dicom:view",
    "ai:analyze", "ai:view_results",
    "voice:transcribe",
    "admin:manage_users",
    "developer:toggle_services",
    "developer:view_health",
  ],

  radiologist: [
    "dashboard:view",
    "patients:view",
    "orders:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "dicom:upload", "dicom:view",
    "ai:analyze", "ai:view_results",
    "voice:transcribe",
    "referring_physicians:view",
  ],

  radiographer: [
    "dashboard:view",
    "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create", "orders:edit",
    "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "dicom:upload", "dicom:view",
    "referring_physicians:view",
  ],

  billing: [
    "dashboard:view",
    "patients:view",
    "orders:view",
    "reports:view",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view",
  ],

  referring: [
    "dashboard:view",
    "patients:view",
    "orders:view", "orders:create",
    "reports:view",
    "scheduling:view",
  ],

  receptionist: [
    "dashboard:view",
    "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit",
  ],

  viewer: [
    "dashboard:view",
    "patients:view",
    "orders:view",
    "worklist:view",
    "reports:view",
    "billing:view",
    "referring_physicians:view",
  ],
};

/**
 * Resolve effective permissions for a role by merging defaults with any
 * admin-customized overrides stored in the database.
 */
export function resolvePermissions(
  role: UserRole,
  override?: RolePermissions | null,
): Permission[] {
  if (override?.isCustomized) {
    return override.permissions;
  }
  return DEFAULT_PERMISSIONS[role] ?? [];
}

export function hasPermission(
  userPermissions: Permission[],
  required: Permission,
): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(
  userPermissions: Permission[],
  required: Permission[],
): boolean {
  return required.some((p) => userPermissions.includes(p));
}
