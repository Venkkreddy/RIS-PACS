/**
 * In-memory implementation of StoreService for local development
 * without GCP credentials / Firestore emulator.
 */
import { v4 as uuid } from "uuid";
import type {
  AuditVersion,
  BillingRecord,
  BillingStatus,
  Patient,
  RadiologyOrder,
  OrderStatus,
  ReferringPhysician,
  Report,
  Scan,
  ScanStatus,
  Template,
  UserRole,
  Permission,
  RolePermissions,
} from "@medical-report-system/shared";
import type { StudyRecord, StudyStatus, UserRecord, InviteRecord } from "./store";

export class InMemoryStoreService {
  private templates = new Map<string, Template>();
  private reports = new Map<string, Report>();
  private studies = new Map<string, StudyRecord>();
  private users = new Map<string, UserRecord>();
  private invites = new Map<string, InviteRecord>();
  private patients = new Map<string, Patient>();
  private physicians = new Map<string, ReferringPhysician>();
  private kvStore = new Map<string, unknown>();
  private orders = new Map<string, RadiologyOrder>();
  private scans = new Map<string, Scan>();
  private billing = new Map<string, BillingRecord>();
  private rolePermissions = new Map<string, RolePermissions>();

  private id(): string { return uuid(); }
  private now(): string { return new Date().toISOString(); }

  // ── Templates ──────────────────────────────────────────
  async createTemplate(payload: Omit<Template, "id" | "createdAt" | "updatedAt">): Promise<Template> {
    const n = this.now();
    const t: Template = { id: this.id(), ...payload, createdAt: n, updatedAt: n };
    this.templates.set(t.id, t);
    return t;
  }

  async listTemplates(ownerId: string): Promise<Template[]> {
    return [...this.templates.values()].filter((t) => t.ownerId === ownerId);
  }

  // ── Reports ────────────────────────────────────────────
  async createReport(payload: Omit<Report, "id" | "createdAt" | "updatedAt" | "versions" | "attachments">): Promise<Report> {
    const n = this.now();
    const v: AuditVersion = { id: this.id(), type: "initial", content: payload.content, authorId: payload.ownerId, createdAt: n };
    const r: Report = {
      id: this.id(),
      ...payload,
      status: payload.status ?? "draft",
      versions: [v],
      attachments: [],
      createdAt: n,
      updatedAt: n,
    };
    this.reports.set(r.id, r);
    return r;
  }

  async updateReport(reportId: string, patch: Partial<Omit<Report, "id" | "createdAt" | "versions" | "attachments">>): Promise<Report> {
    const r = this.reports.get(reportId);
    if (!r) throw new Error("Report not found");
    const { versions: _v, attachments: _a, id: _id, createdAt: _c, ...safePatch } = patch as Record<string, unknown>;
    const updated: Report = { ...r, ...safePatch, id: r.id, createdAt: r.createdAt, versions: r.versions, attachments: r.attachments, updatedAt: this.now() };
    this.reports.set(reportId, updated);
    return updated;
  }

  async listReports(ownerId: string): Promise<Report[]> {
    return [...this.reports.values()].filter((r) => r.ownerId === ownerId);
  }

  async getReport(reportId: string): Promise<Report | null> {
    return this.reports.get(reportId) ?? null;
  }

  async getReportByStudyId(studyId: string): Promise<Report | null> {
    return [...this.reports.values()].find((r) => r.studyId === studyId) ?? null;
  }

  async appendVersion(reportId: string, version: AuditVersion, newContent?: string): Promise<Report> {
    const r = this.reports.get(reportId);
    if (!r) throw new Error("Report not found");
    const updated: Report = { ...r, content: newContent ?? r.content, versions: [...r.versions, version], updatedAt: this.now() };
    this.reports.set(reportId, updated);
    return updated;
  }

  async addAttachment(reportId: string, attachmentUrl: string, userId: string): Promise<Report> {
    const r = this.reports.get(reportId);
    if (!r) throw new Error("Report not found");
    const v: AuditVersion = { id: this.id(), type: "attachment", content: `Attached image: ${attachmentUrl}`, authorId: userId, createdAt: this.now() };
    const updated: Report = { ...r, attachments: [...r.attachments, attachmentUrl], versions: [...r.versions, v], updatedAt: this.now() };
    this.reports.set(reportId, updated);
    return updated;
  }

  // ── Studies (worklist) ─────────────────────────────────
  async upsertStudyRecord(studyId: string, patch: Partial<StudyRecord>): Promise<StudyRecord> {
    const existing = this.studies.get(studyId);
    const merged: StudyRecord = { studyId, status: existing?.status ?? "unassigned", ...existing, ...patch, updatedAt: this.now() };
    this.studies.set(studyId, merged);
    return merged;
  }

  async getStudyRecord(studyId: string): Promise<StudyRecord | null> {
    return this.studies.get(studyId) ?? null;
  }

  async listStudyRecords(filters?: { name?: string; date?: string; location?: string; status?: StudyStatus; assignedTo?: string; uploaderId?: string }): Promise<StudyRecord[]> {
    let records = [...this.studies.values()];
    if (filters?.status) records = records.filter((r) => r.status === filters.status);
    if (filters?.assignedTo) records = records.filter((r) => r.assignedTo === filters.assignedTo);
    if (filters?.uploaderId) records = records.filter((r) => r.uploaderId === filters.uploaderId);
    if (filters?.name) { const n = filters.name.toLowerCase(); records = records.filter((r) => (r.patientName ?? "").toLowerCase().includes(n)); }
    if (filters?.date) records = records.filter((r) => (r.studyDate ?? "").startsWith(filters.date!));
    if (filters?.location) { const n = filters.location.toLowerCase(); records = records.filter((r) => (r.location ?? "").toLowerCase().includes(n)); }
    return records.sort((a, b) => (a.studyDate ?? "").localeCompare(b.studyDate ?? "") * -1);
  }

  async assignStudies(studyIds: string[], radiologistId: string): Promise<StudyRecord[]> {
    const assignedAt = this.now();
    return Promise.all(studyIds.map((id) => this.upsertStudyRecord(id, { status: "assigned", assignedTo: radiologistId, assignedAt })));
  }

  async markStudyReported(studyId: string): Promise<StudyRecord> {
    const existing = this.studies.get(studyId);
    const reportedAt = this.now();
    if (!existing) return this.upsertStudyRecord(studyId, { status: "reported", reportedAt, tatHours: 0 });
    const assignedAt = existing.assignedAt ? new Date(existing.assignedAt).getTime() : Date.now();
    const tatHours = Number(((new Date(reportedAt).getTime() - assignedAt) / (1000 * 60 * 60)).toFixed(2));
    return this.upsertStudyRecord(studyId, { status: "reported", reportedAt, tatHours });
  }

  // ── Users ──────────────────────────────────────────────
  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()];
  }

  async upsertUser(user: Omit<UserRecord, "createdAt" | "updatedAt">): Promise<UserRecord> {
    const existing = this.users.get(user.id);
    const merged: UserRecord = { ...(existing ?? {}), ...user, createdAt: existing?.createdAt ?? this.now(), updatedAt: this.now() };
    this.users.set(user.id, merged);
    return merged;
  }

  async updateUserRole(userId: string, role: UserRecord["role"], displayName?: string): Promise<UserRecord> {
    const existing = this.users.get(userId);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = { ...existing, role, approved: true, requestStatus: "approved", displayName: displayName ?? existing.displayName, updatedAt: this.now() };
    this.users.set(userId, updated);
    return updated;
  }

  async updateUserProfile(
    userId: string,
    patch: { displayName?: string; phone?: string; department?: string },
  ): Promise<UserRecord> {
    const existing = this.users.get(userId);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = {
      ...existing,
      ...(patch.displayName !== undefined && { displayName: patch.displayName }),
      ...(patch.phone !== undefined && { phone: patch.phone }),
      ...(patch.department !== undefined && { department: patch.department }),
      updatedAt: this.now(),
    };
    this.users.set(userId, updated);
    return updated;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }

  async listPendingUsers(): Promise<UserRecord[]> {
    return [...this.users.values()].filter((u) => u.requestStatus === "pending");
  }

  async updateUserApproval(userId: string, approval: "approved" | "rejected", role?: UserRecord["role"]): Promise<UserRecord> {
    const existing = this.users.get(userId);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = { ...existing, role: role ?? existing.role, approved: approval === "approved", requestStatus: approval, updatedAt: this.now() };
    this.users.set(userId, updated);
    return updated;
  }

  // ── Invites ────────────────────────────────────────────
  async createInvite(payload: Omit<InviteRecord, "id" | "createdAt">): Promise<InviteRecord> {
    const invite: InviteRecord = { id: this.id(), ...payload, createdAt: this.now() };
    this.invites.set(invite.id, invite);
    return invite;
  }

  // ── Patients ───────────────────────────────────────────
  async getPatientByMrn(mrn: string): Promise<Patient | null> {
    const needle = mrn.trim().toUpperCase();
    return [...this.patients.values()].find((p) => !p.isDeleted && p.patientId.trim().toUpperCase() === needle) ?? null;
  }

  async createPatient(payload: Omit<Patient, "id" | "createdAt" | "updatedAt">): Promise<Patient> {
    const patientId = payload.patientId.trim().toUpperCase();
    const existing = await this.getPatientByMrn(patientId);
    if (existing) {
      throw Object.assign(new Error(`Patient with MRN "${patientId}" already exists`), { code: "DUPLICATE_MRN", existingPatient: existing });
    }
    const n = this.now();
    const p: Patient = {
      id: this.id(),
      ...payload,
      patientId,
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      phone: payload.phone?.trim() || undefined,
      email: payload.email?.trim() || undefined,
      address: payload.address?.trim() || undefined,
      createdAt: n,
      updatedAt: n,
    };
    this.patients.set(p.id, p);
    return p;
  }

  async getPatient(patientId: string): Promise<Patient | null> {
    return this.patients.get(patientId) ?? null;
  }

  async updatePatient(patientId: string, patch: Partial<Omit<Patient, "id" | "createdAt">>): Promise<Patient> {
    const existing = this.patients.get(patientId);
    if (!existing) throw new Error("Patient not found");
    const nextPatientId = patch.patientId ? patch.patientId.trim().toUpperCase() : existing.patientId;
    if (nextPatientId !== existing.patientId.trim().toUpperCase()) {
      const duplicate = await this.getPatientByMrn(nextPatientId);
      if (duplicate && duplicate.id !== existing.id) {
        throw Object.assign(new Error(`Patient with MRN "${nextPatientId}" already exists`), { code: "DUPLICATE_MRN", existingPatient: duplicate });
      }
    }
    const updated: Patient = {
      ...existing,
      ...patch,
      patientId: nextPatientId,
      firstName: patch.firstName?.trim() ?? existing.firstName,
      lastName: patch.lastName?.trim() ?? existing.lastName,
      phone: patch.phone !== undefined ? patch.phone.trim() || undefined : existing.phone,
      email: patch.email !== undefined ? patch.email.trim() || undefined : existing.email,
      address: patch.address !== undefined ? patch.address.trim() || undefined : existing.address,
      updatedAt: this.now(),
    };
    this.patients.set(patientId, updated);
    return updated;
  }

  async deletePatient(patientId: string): Promise<void> {
    const existing = this.patients.get(patientId);
    if (!existing) throw new Error("Patient not found");
    const now = this.now();
    this.patients.set(patientId, { ...existing, isDeleted: true, deletedAt: now, updatedAt: now });
  }

  async listPatients(search?: string): Promise<Patient[]> {
    let list = [...this.patients.values()].filter((p) => !p.isDeleted);
    if (search) {
      const needle = search.toLowerCase();
      list = list.filter((p) => p.firstName.toLowerCase().includes(needle) || p.lastName.toLowerCase().includes(needle) || p.patientId.toLowerCase().includes(needle));
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ── Referring Physicians ───────────────────────────────
  async createReferringPhysician(payload: Omit<ReferringPhysician, "id" | "createdAt" | "updatedAt">): Promise<ReferringPhysician> {
    const n = this.now();
    const p: ReferringPhysician = { id: this.id(), ...payload, createdAt: n, updatedAt: n };
    this.physicians.set(p.id, p);
    return p;
  }

  async getReferringPhysician(id: string): Promise<ReferringPhysician | null> {
    return this.physicians.get(id) ?? null;
  }

  async updateReferringPhysician(id: string, patch: Partial<Omit<ReferringPhysician, "id" | "createdAt">>): Promise<ReferringPhysician> {
    const existing = this.physicians.get(id);
    if (!existing) throw new Error("Referring physician not found");
    const updated: ReferringPhysician = { ...existing, ...patch, updatedAt: this.now() };
    this.physicians.set(id, updated);
    return updated;
  }

  async listReferringPhysicians(search?: string): Promise<ReferringPhysician[]> {
    let list = [...this.physicians.values()];
    if (search) {
      const needle = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(needle) || (p.hospital ?? "").toLowerCase().includes(needle));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Orders ─────────────────────────────────────────────
  async createOrder(payload: Omit<RadiologyOrder, "id" | "createdAt" | "updatedAt">): Promise<RadiologyOrder> {
    const n = this.now();
    const o: RadiologyOrder = { id: this.id(), ...payload, createdAt: n, updatedAt: n };
    this.orders.set(o.id, o);
    return o;
  }

  async getOrder(orderId: string): Promise<RadiologyOrder | null> {
    return this.orders.get(orderId) ?? null;
  }

  async updateOrder(orderId: string, patch: Partial<Omit<RadiologyOrder, "id" | "createdAt">>): Promise<RadiologyOrder> {
    const existing = this.orders.get(orderId);
    if (!existing) throw new Error("Order not found");
    const updated: RadiologyOrder = { ...existing, ...patch, updatedAt: this.now() };
    this.orders.set(orderId, updated);
    return updated;
  }

  async listOrders(filters?: { status?: OrderStatus; patientId?: string; date?: string; search?: string }): Promise<RadiologyOrder[]> {
    let list = [...this.orders.values()];
    if (filters?.status) list = list.filter((o) => o.status === filters.status);
    if (filters?.patientId) list = list.filter((o) => o.patientId === filters.patientId);
    if (filters?.date) list = list.filter((o) => o.scheduledDate.startsWith(filters.date!));
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      list = list.filter((o) => o.patientName.toLowerCase().includes(needle) || o.bodyPart.toLowerCase().includes(needle) || o.modality.toLowerCase().includes(needle));
    }
    return list.sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));
  }

  // ── Scans ──────────────────────────────────────────────
  async createScan(payload: Omit<Scan, "id" | "createdAt" | "updatedAt">): Promise<Scan> {
    const n = this.now();
    const s: Scan = { id: this.id(), ...payload, createdAt: n, updatedAt: n };
    this.scans.set(s.id, s);
    return s;
  }

  async getScan(scanId: string): Promise<Scan | null> {
    return this.scans.get(scanId) ?? null;
  }

  async updateScan(scanId: string, patch: Partial<Omit<Scan, "id" | "createdAt">>): Promise<Scan> {
    const existing = this.scans.get(scanId);
    if (!existing) throw new Error("Scan not found");
    const updated: Scan = { ...existing, ...patch, updatedAt: this.now() };
    this.scans.set(scanId, updated);
    return updated;
  }

  async listScans(filters?: { status?: ScanStatus; patientId?: string; scanType?: string; date?: string; search?: string }): Promise<Scan[]> {
    let list = [...this.scans.values()];
    if (filters?.status) list = list.filter((s) => s.status === filters.status);
    if (filters?.patientId) list = list.filter((s) => s.patientId === filters.patientId);
    if (filters?.scanType) list = list.filter((s) => s.scanType === filters.scanType);
    if (filters?.date) list = list.filter((s) => s.scanDate.startsWith(filters.date!));
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      list = list.filter((s) => s.patientName.toLowerCase().includes(needle) || s.bodyPart.toLowerCase().includes(needle) || s.scanType.toLowerCase().includes(needle) || (s.technician ?? "").toLowerCase().includes(needle));
    }
    return list.sort((a, b) => b.scanDate.localeCompare(a.scanDate));
  }

  // ── Billing ────────────────────────────────────────────
  async createBilling(payload: Omit<BillingRecord, "id" | "createdAt" | "updatedAt">): Promise<BillingRecord> {
    const n = this.now();
    const b: BillingRecord = { id: this.id(), ...payload, createdAt: n, updatedAt: n };
    this.billing.set(b.id, b);
    return b;
  }

  async getBilling(id: string): Promise<BillingRecord | null> {
    return this.billing.get(id) ?? null;
  }

  async updateBilling(id: string, patch: Partial<Omit<BillingRecord, "id" | "createdAt">>): Promise<BillingRecord> {
    const existing = this.billing.get(id);
    if (!existing) throw new Error("Billing record not found");
    const updated: BillingRecord = { ...existing, ...patch, updatedAt: this.now() };
    this.billing.set(id, updated);
    return updated;
  }

  async listBilling(filters?: { status?: BillingStatus; patientId?: string; search?: string }): Promise<BillingRecord[]> {
    let list = [...this.billing.values()];
    if (filters?.status) list = list.filter((r) => r.status === filters.status);
    if (filters?.patientId) list = list.filter((r) => r.patientId === filters.patientId);
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      list = list.filter((r) => r.patientName.toLowerCase().includes(needle) || (r.invoiceNumber ?? "").toLowerCase().includes(needle));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Role Permissions ───────────────────────────────────
  async getRolePermissions(role: UserRole): Promise<RolePermissions | null> {
    return this.rolePermissions.get(role) ?? null;
  }

  async getAllRolePermissions(): Promise<RolePermissions[]> {
    return [...this.rolePermissions.values()];
  }

  async setRolePermissions(role: UserRole, permissions: Permission[], updatedBy: string): Promise<RolePermissions> {
    const record: RolePermissions = { role, permissions, isCustomized: true, updatedAt: this.now(), updatedBy };
    this.rolePermissions.set(role, record);
    return record;
  }

  async resetRolePermissions(role: UserRole): Promise<void> {
    this.rolePermissions.delete(role);
  }

  // ── Generic Key-Value Store ────────────────────────────
  async getKV<T = unknown>(key: string): Promise<T | null> {
    return (this.kvStore.get(key) as T) ?? null;
  }

  async setKV<T = unknown>(key: string, value: T): Promise<void> {
    this.kvStore.set(key, value);
  }
}
