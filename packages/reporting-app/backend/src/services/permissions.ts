import type { UserRole, Permission, RolePermissions } from "@medical-report-system/shared";

export const DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    "platform:view_overview",
    "platform:manage_hospitals",
    "platform:assign_pacs",
    "platform:manage_hospital_admins",
    "platform:view_monitoring",
    "dashboard:view",
    "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scans:view", "scans:create", "scans:edit", "scans:delete",
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
    "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create",
    "scans:view",
    "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view",
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
    "scans:view",
    "scheduling:view",
    "worklist:view",
    "reports:view",
    "billing:view",
    "referring_physicians:view",
  ],
};

/**
 * Resolve effective permissions for a role.
 *
 * When an admin has customised the role permissions we take the **union** of the
 * stored override and the current defaults.  This guarantees that newly-added
 * default permissions (e.g. granting radiologists `patients:create`) are always
 * available even when the Firestore override was saved before the default was
 * introduced.  An admin can still *add* extra permissions via the override; to
 * truly revoke a default permission a future "denied" mechanism would be needed.
 */
export function resolvePermissions(
  role: UserRole,
  override?: RolePermissions | null,
): Permission[] {
  const defaults = DEFAULT_PERMISSIONS[role] ?? [];
  if (override?.isCustomized) {
    const merged = new Set<Permission>([...defaults, ...override.permissions]);
    return [...merged];
  }
  return defaults;
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
