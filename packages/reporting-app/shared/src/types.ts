// --------------- Multi-Tenant Types ---------------

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  aeTitle: string;
  institutionName?: string;
  domain?: string;
  storagePath?: string;
  s3Bucket?: string;
  s3Prefix?: string;
  config: Record<string, unknown>;
  isActive: boolean;
  maxUsers: number;
  maxStorageGb: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDicomConfig {
  id: string;
  tenantId: string;
  aeTitle: string;
  callingAeTitles: string[];
  institutionName?: string;
  storagePath?: string;
  orthancPeerName?: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// --------------- RBAC Types ---------------

export type UserRole =
  | "super_admin"
  | "admin"
  | "developer"
  | "radiologist"
  | "radiographer"
  | "billing"
  | "referring"
  | "receptionist"
  | "viewer";

export type PermissionModule =
  | "platform"
  | "dashboard"
  | "patients"
  | "orders"
  | "scans"
  | "scheduling"
  | "worklist"
  | "reports"
  | "templates"
  | "billing"
  | "referring_physicians"
  | "dicom"
  | "ai"
  | "voice"
  | "admin"
  | "developer";

export type PermissionAction = string;
export type Permission = `${PermissionModule}:${PermissionAction}`;

export const ALL_PERMISSIONS: readonly Permission[] = [
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
] as const;

export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
  isCustomized: boolean;
  updatedAt: string;
  updatedBy: string;
}

// --------------- Report Types ---------------

export type ReportVersionType = "initial" | "addendum" | "voice-transcript" | "attachment" | "share" | "status-change" | "edit" | "sign";

export interface AuditVersion {
  id: string;
  type: ReportVersionType;
  content: string;
  authorId: string;
  createdAt: string;
}

export type ReportStatus = "draft" | "preliminary" | "final" | "amended" | "cancelled";

export type CriticalPriority = "routine" | "urgent" | "critical";

export interface ReportSection {
  key: string;
  title: string;
  content: string;
}

export interface Template {
  id: string;
  name: string;
  content: string;
  category?: string;
  modality?: string;
  bodyPart?: string;
  sections?: ReportSection[];
  isSystem?: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RadiologyTranscript {
  findings: string;
  impression: string;
  corrections_applied?: string[];
}

export interface ReportVoice {
  audioUrl: string;
  transcript: string;
  radiologyReport?: RadiologyTranscript;
  rawTranscript?: string;
  confidence?: number;
  modelUsed?: string;
}

export interface Report {
  id: string;
  studyId: string;
  templateId?: string;
  content: string;
  sections?: ReportSection[];
  status: ReportStatus;
  priority?: CriticalPriority;
  signedBy?: string;
  signedAt?: string;
  ownerId: string;
  metadata?: Record<string, unknown>;
  versions: AuditVersion[];
  attachments: string[];
  voice?: ReportVoice;
  createdAt: string;
  updatedAt: string;
}

// --------------- RIS Types ---------------

export type Gender = "M" | "F" | "O";

export interface Patient {
  id: string;
  patientId: string; // MRN / hospital ID
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date
  gender: Gender;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferringPhysician {
  id: string;
  name: string;
  specialty?: string;
  phone?: string;
  email?: string;
  hospital?: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = "scheduled" | "in-progress" | "completed" | "cancelled";
export type OrderPriority = "routine" | "urgent" | "stat";
export type Modality = "CR" | "CT" | "MR" | "US" | "XR" | "MG" | "NM" | "PT" | "DX" | "OT";

export interface RadiologyOrder {
  id: string;
  patientId: string;
  patientName: string; // denormalized for listing
  referringPhysicianId?: string;
  referringPhysicianName?: string;
  modality: Modality;
  bodyPart: string;
  clinicalHistory?: string;
  priority: OrderPriority;
  status: OrderStatus;
  scheduledDate: string; // ISO datetime
  completedDate?: string;
  studyId?: string; // linked DICOM study after acquisition
  reportId?: string; // linked report after reporting
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// --------------- RIS: Scans ---------------

export type ScanType = "X-Ray" | "CT" | "MRI" | "Ultrasound" | "Mammogram" | "Fluoroscopy" | "PET" | "Nuclear" | "Other";
export type ScanStatus = "scheduled" | "in-progress" | "completed" | "failed" | "cancelled";

export interface Scan {
  id: string;
  patientId: string;
  patientName: string;
  orderId?: string;
  scanType: ScanType;
  modality: Modality;
  bodyPart: string;
  scanDate: string;
  status: ScanStatus;
  technician?: string;
  radiologist?: string;
  findings?: string;
  imageCount?: number;
  contrastUsed?: boolean;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type BillingStatus = "pending" | "invoiced" | "paid" | "cancelled";

export interface BillingRecord {
  id: string;
  orderId?: string;
  patientId: string;
  patientName: string;
  description: string;
  modality?: Modality;
  bodyPart?: string;
  amount: number;
  status: BillingStatus;
  invoiceNumber?: string;
  paidDate?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
