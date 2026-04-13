import { v4 as uuid } from "uuid";
import {
  AuditVersion,
  BillingRecord,
  BillingStatus,
  Patient,
  RadiologyOrder,
  OrderStatus,
  ReferringPhysician,
  Report,
  ReportVoice,
  Scan,
  ScanStatus,
  Template,
  UserRole,
  Permission,
  RolePermissions,
} from "@medical-report-system/shared";
import { getFirestore } from "./firebaseAdmin";

export type StudyStatus = "unassigned" | "assigned" | "reported";

export interface StudyRecord {
  studyId: string;
  patientName?: string;
  studyDate?: string;
  modality?: string;
  description?: string;
  bodyPart?: string;
  location?: string;
  uploaderId?: string;
  status: StudyStatus;
  assignedTo?: string;
  assignedAt?: string;
  reportedAt?: string;
  tatHours?: number;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  role: "super_admin" | "admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";
  approved: boolean;
  requestStatus: "pending" | "approved" | "rejected";
  authProvider?: string;
  displayName?: string;
  phone?: string;
  department?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteRecord {
  id: string;
  email: string;
  role: "super_admin" | "admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";
  token: string;
  invitedBy: string;
  createdAt: string;
  acceptedAt?: string;
}

function getFirstStringValue(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeSearchValue(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[\^,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAllSearchTokens(source: string | undefined, rawSearch: string): boolean {
  const normalizedSource = normalizeSearchValue(source);
  const tokens = normalizeSearchValue(rawSearch).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => normalizedSource.includes(token));
}

function normalizeMrn(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class StoreService {
  private readonly firestore: FirebaseFirestore.Firestore;

  constructor(firestore?: FirebaseFirestore.Firestore) {
    this.firestore = firestore ?? getFirestore();
  }

  async createTemplate(payload: Omit<Template, "id" | "createdAt" | "updatedAt">): Promise<Template> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("templates").doc();
    const template: Template = { id: docRef.id, ...payload, createdAt: now, updatedAt: now };
    await docRef.set(template);
    return template;
  }

  async listTemplates(ownerId: string): Promise<Template[]> {
    const snapshot = await this.firestore.collection("templates").where("ownerId", "==", ownerId).get();
    return snapshot.docs.map((doc) => doc.data() as Template);
  }

  async createReport(payload: Omit<Report, "id" | "createdAt" | "updatedAt" | "versions" | "attachments">): Promise<Report> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("reports").doc();
    const initialVersion: AuditVersion = {
      id: uuid(),
      type: "initial",
      content: payload.content,
      authorId: payload.ownerId,
      createdAt: now,
    };

    const report: Report = {
      id: docRef.id,
      ...payload,
      status: payload.status ?? "draft",
      versions: [initialVersion],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(report);
    return report;
  }

  async listReports(ownerId: string): Promise<Report[]> {
    const snapshot = await this.firestore.collection("reports").where("ownerId", "==", ownerId).get();
    return snapshot.docs.map((doc) => doc.data() as Report);
  }

  async getReport(reportId: string): Promise<Report | null> {
    const doc = await this.firestore.collection("reports").doc(reportId).get();
    return doc.exists ? (doc.data() as Report) : null;
  }

  async getReportByStudyId(studyId: string): Promise<Report | null> {
    const snapshot = await this.firestore.collection("reports").where("studyId", "==", studyId).limit(1).get();
    if (!snapshot.docs.length) return null;
    return snapshot.docs[0].data() as Report;
  }

  async updateReport(reportId: string, patch: Partial<Omit<Report, "id" | "createdAt" | "versions" | "attachments">>): Promise<Report> {
    const report = await this.getReport(reportId);
    if (!report) throw new Error("Report not found");
    const updated: Report = { ...report, ...patch, updatedAt: new Date().toISOString() };
    await this.firestore.collection("reports").doc(reportId).set(updated);
    return updated;
  }

  async appendVersion(reportId: string, version: AuditVersion, newContent?: string): Promise<Report> {
    const report = await this.getReport(reportId);
    if (!report) throw new Error("Report not found");
    const updated: Report = {
      ...report,
      content: newContent ?? report.content,
      versions: [...report.versions, version],
      updatedAt: new Date().toISOString(),
    };
    await this.firestore.collection("reports").doc(reportId).set(updated);
    return updated;
  }

  async addAttachment(reportId: string, attachmentUrl: string, userId: string): Promise<Report> {
    const report = await this.getReport(reportId);
    if (!report) throw new Error("Report not found");

    const version: AuditVersion = {
      id: uuid(),
      type: "attachment",
      content: `Attached image: ${attachmentUrl}`,
      authorId: userId,
      createdAt: new Date().toISOString(),
    };

    const updated: Report = {
      ...report,
      attachments: [...report.attachments, attachmentUrl],
      versions: [...report.versions, version],
      updatedAt: new Date().toISOString(),
    };

    await this.firestore.collection("reports").doc(reportId).set(updated);
    return updated;
  }

  async setVoice(reportId: string, voice: ReportVoice, userId: string): Promise<Report> {
    const report = await this.getReport(reportId);
    if (!report) throw new Error("Report not found");

    const version: AuditVersion = {
      id: uuid(),
      type: "voice-transcript",
      content: voice.transcript,
      authorId: userId,
      createdAt: new Date().toISOString(),
    };

    const updated: Report = {
      ...report,
      voice,
      versions: [...report.versions, version],
      updatedAt: new Date().toISOString(),
    };

    await this.firestore.collection("reports").doc(reportId).set(updated);
    return updated;
  }

  async upsertStudyRecord(studyId: string, patch: Partial<StudyRecord>): Promise<StudyRecord> {
    const existing = await this.getStudyRecord(studyId);
    const now = new Date().toISOString();

    const merged: StudyRecord = {
      studyId,
      status: existing?.status ?? "unassigned",
      updatedAt: now,
      ...existing,
      ...patch,
    };

    await this.firestore.collection("studies").doc(studyId).set(merged);
    return merged;
  }

  async getStudyRecord(studyId: string): Promise<StudyRecord | null> {
    const doc = await this.firestore.collection("studies").doc(studyId).get();
    return doc.exists ? (doc.data() as StudyRecord) : null;
  }

  async listStudyRecords(filters?: {
    name?: string;
    date?: string;
    location?: string;
    status?: StudyStatus;
    assignedTo?: string;
    uploaderId?: string;
  }): Promise<StudyRecord[]> {
    let query: any = this.firestore.collection("studies");

    if (filters?.status) {
      query = query.where("status", "==", filters.status);
    }
    if (filters?.assignedTo) {
      query = query.where("assignedTo", "==", filters.assignedTo);
    }
    if (filters?.uploaderId) {
      query = query.where("uploaderId", "==", filters.uploaderId);
    }

    const snapshot = await query.get();
    let records = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as StudyRecord);

    if (filters?.name?.trim()) {
      const needle = filters.name.trim();
      records = records.filter((record: StudyRecord) => {
        const patientName =
          record.patientName ??
          getFirstStringValue(record.metadata, ["patientName", "PatientName", "00100010"]);
        return containsAllSearchTokens(patientName, needle);
      });
    }
    if (filters?.date) {
      const dateFilter = filters.date;
      records = records.filter((record: StudyRecord) => (record.studyDate ?? "").startsWith(dateFilter));
    }
    if (filters?.location) {
      const needle = filters.location.toLowerCase();
      records = records.filter((record: StudyRecord) => (record.location ?? "").toLowerCase().includes(needle));
    }

    return records.sort((a: StudyRecord, b: StudyRecord) => (a.studyDate ?? "").localeCompare(b.studyDate ?? "") * -1);
  }

  async assignStudies(studyIds: string[], radiologistId: string): Promise<StudyRecord[]> {
    const assignedAt = new Date().toISOString();
    const updates = studyIds.map((studyId) =>
      this.upsertStudyRecord(studyId, {
        status: "assigned",
        assignedTo: radiologistId,
        assignedAt,
      }),
    );
    return Promise.all(updates);
  }

  async markStudyReported(studyId: string): Promise<StudyRecord> {
    const existing = await this.getStudyRecord(studyId);
    if (!existing) {
      return this.upsertStudyRecord(studyId, { status: "reported", reportedAt: new Date().toISOString(), tatHours: 0 });
    }

    const reportedAt = new Date().toISOString();
    const assignedAt = existing.assignedAt ? new Date(existing.assignedAt).getTime() : Date.now();
    const tatHours = Number(((new Date(reportedAt).getTime() - assignedAt) / (1000 * 60 * 60)).toFixed(2));

    return this.upsertStudyRecord(studyId, {
      status: "reported",
      reportedAt,
      tatHours,
    });
  }

  async listUsers(): Promise<UserRecord[]> {
    const snapshot = await this.firestore.collection("users").get();
    return snapshot.docs.map((doc) => doc.data() as UserRecord);
  }

  async upsertUser(user: Omit<UserRecord, "createdAt" | "updatedAt">): Promise<UserRecord> {
    const now = new Date().toISOString();
    const existingDoc = await this.firestore.collection("users").doc(user.id).get();
    const existing = existingDoc.exists ? (existingDoc.data() as UserRecord) : null;
    const createdAt = existing?.createdAt ?? now;

    const merged: UserRecord = {
      ...(existing ?? {}),
      ...user,
      createdAt,
      updatedAt: now,
    };

    await this.firestore.collection("users").doc(user.id).set(merged);
    return merged;
  }

  async updateUserRole(userId: string, role: UserRecord["role"], displayName?: string): Promise<UserRecord> {
    const existing = await this.firestore.collection("users").doc(userId).get();
    if (!existing.exists) {
      throw new Error("User not found");
    }

    const data = existing.data() as UserRecord;
    const updated: UserRecord = {
      ...data,
      role,
      approved: true,
      requestStatus: "approved",
      displayName: displayName ?? data.displayName,
      updatedAt: new Date().toISOString(),
    };
    await this.firestore.collection("users").doc(userId).set(updated);
    return updated;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const doc = await this.firestore.collection("users").doc(userId).get();
    return doc.exists ? (doc.data() as UserRecord) : null;
  }

  async updateUserProfile(
    userId: string,
    patch: { displayName?: string; phone?: string; department?: string },
  ): Promise<UserRecord> {
    const existing = await this.getUserById(userId);
    if (!existing) throw new Error("User not found");

    const updated: UserRecord = {
      ...existing,
      ...(patch.displayName !== undefined && { displayName: patch.displayName }),
      ...(patch.phone !== undefined && { phone: patch.phone }),
      ...(patch.department !== undefined && { department: patch.department }),
      updatedAt: new Date().toISOString(),
    };

    await this.firestore.collection("users").doc(userId).set(updated);
    return updated;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const snapshot = await this.firestore.collection("users").where("email", "==", email.toLowerCase()).limit(1).get();
    if (!snapshot.docs.length) return null;
    return snapshot.docs[0].data() as UserRecord;
  }

  async listPendingUsers(): Promise<UserRecord[]> {
    const snapshot = await this.firestore.collection("users").where("requestStatus", "==", "pending").get();
    return snapshot.docs.map((doc) => doc.data() as UserRecord);
  }

  async updateUserApproval(
    userId: string,
    approval: "approved" | "rejected",
    role?: UserRecord["role"],
  ): Promise<UserRecord> {
    const existing = await this.getUserById(userId);
    if (!existing) throw new Error("User not found");

    const updated: UserRecord = {
      ...existing,
      role: role ?? existing.role,
      approved: approval === "approved",
      requestStatus: approval,
      updatedAt: new Date().toISOString(),
    };

    await this.firestore.collection("users").doc(userId).set(updated);
    return updated;
  }

  async createInvite(payload: Omit<InviteRecord, "id" | "createdAt">): Promise<InviteRecord> {
    const docRef = this.firestore.collection("invites").doc();
    const invite: InviteRecord = {
      id: docRef.id,
      ...payload,
      createdAt: new Date().toISOString(),
    };
    await docRef.set(invite);
    return invite;
  }

  // --------------- RIS: Patients ---------------

  async getPatientByMrn(mrn: string): Promise<Patient | null> {
    const trimmed = mrn.trim();
    if (!trimmed) return null;
    const normalized = normalizeMrn(trimmed);
    const snapshot = await this.firestore.collection("patients").where("patientId", "==", trimmed).limit(1).get();
    if (snapshot.docs.length > 0) {
      return snapshot.docs[0].data() as Patient;
    }
    const fallback = await this.firestore.collection("patients").get();
    const match = fallback.docs
      .map((doc) => doc.data() as Patient)
      .find((patient) => normalizeMrn(patient.patientId) === normalized);
    return match ?? null;
  }

  async createPatient(payload: Omit<Patient, "id" | "createdAt" | "updatedAt">): Promise<Patient> {
    const patientId = normalizeMrn(payload.patientId);
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const existing = await this.getPatientByMrn(patientId);
    if (existing) {
      throw Object.assign(new Error(`Patient with MRN "${patientId}" already exists`), { code: "DUPLICATE_MRN", existingPatient: existing });
    }
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("patients").doc();
    const patient: Patient = {
      id: docRef.id,
      ...payload,
      patientId,
      firstName,
      lastName,
      phone: normalizeOptionalText(payload.phone),
      email: normalizeOptionalText(payload.email),
      address: normalizeOptionalText(payload.address),
      createdAt: now,
      updatedAt: now,
    };
    await docRef.set(patient);
    return patient;
  }

  async getPatient(patientId: string): Promise<Patient | null> {
    const doc = await this.firestore.collection("patients").doc(patientId).get();
    return doc.exists ? (doc.data() as Patient) : null;
  }

  async updatePatient(patientId: string, patch: Partial<Omit<Patient, "id" | "createdAt">>): Promise<Patient> {
    const existing = await this.getPatient(patientId);
    if (!existing) throw new Error("Patient not found");
    const nextPatientId = patch.patientId ? normalizeMrn(patch.patientId) : existing.patientId;
    if (normalizeMrn(existing.patientId) !== nextPatientId) {
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
      phone: patch.phone !== undefined ? normalizeOptionalText(patch.phone) : existing.phone,
      email: patch.email !== undefined ? normalizeOptionalText(patch.email) : existing.email,
      address: patch.address !== undefined ? normalizeOptionalText(patch.address) : existing.address,
      updatedAt: new Date().toISOString(),
    };
    await this.firestore.collection("patients").doc(patientId).set(updated);
    return updated;
  }

  async deletePatient(patientId: string): Promise<void> {
    const existing = await this.getPatient(patientId);
    if (!existing) throw new Error("Patient not found");
    await this.firestore.collection("patients").doc(patientId).delete();
  }

  async listPatients(search?: string): Promise<Patient[]> {
    const snapshot = await this.firestore.collection("patients").get();
    let patients = snapshot.docs.map((doc) => doc.data() as Patient);
    if (search) {
      const needle = search.toLowerCase();
      patients = patients.filter(
        (p) =>
          p.firstName.toLowerCase().includes(needle) ||
          p.lastName.toLowerCase().includes(needle) ||
          p.patientId.toLowerCase().includes(needle),
      );
    }
    return patients.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // --------------- RIS: Referring Physicians ---------------

  async createReferringPhysician(
    payload: Omit<ReferringPhysician, "id" | "createdAt" | "updatedAt">,
  ): Promise<ReferringPhysician> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("referringPhysicians").doc();
    const physician: ReferringPhysician = { id: docRef.id, ...payload, createdAt: now, updatedAt: now };
    await docRef.set(physician);
    return physician;
  }

  async getReferringPhysician(id: string): Promise<ReferringPhysician | null> {
    const doc = await this.firestore.collection("referringPhysicians").doc(id).get();
    return doc.exists ? (doc.data() as ReferringPhysician) : null;
  }

  async updateReferringPhysician(
    id: string,
    patch: Partial<Omit<ReferringPhysician, "id" | "createdAt">>,
  ): Promise<ReferringPhysician> {
    const existing = await this.getReferringPhysician(id);
    if (!existing) throw new Error("Referring physician not found");
    const updated: ReferringPhysician = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.firestore.collection("referringPhysicians").doc(id).set(updated);
    return updated;
  }

  async listReferringPhysicians(search?: string): Promise<ReferringPhysician[]> {
    const snapshot = await this.firestore.collection("referringPhysicians").get();
    let physicians = snapshot.docs.map((doc) => doc.data() as ReferringPhysician);
    if (search) {
      const needle = search.toLowerCase();
      physicians = physicians.filter(
        (p) => p.name.toLowerCase().includes(needle) || (p.hospital ?? "").toLowerCase().includes(needle),
      );
    }
    return physicians.sort((a, b) => a.name.localeCompare(b.name));
  }

  // --------------- RIS: Radiology Orders ---------------

  async createOrder(payload: Omit<RadiologyOrder, "id" | "createdAt" | "updatedAt">): Promise<RadiologyOrder> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("orders").doc();
    const order: RadiologyOrder = { id: docRef.id, ...payload, createdAt: now, updatedAt: now };
    await docRef.set(order);
    return order;
  }

  async getOrder(orderId: string): Promise<RadiologyOrder | null> {
    const doc = await this.firestore.collection("orders").doc(orderId).get();
    return doc.exists ? (doc.data() as RadiologyOrder) : null;
  }

  async updateOrder(orderId: string, patch: Partial<Omit<RadiologyOrder, "id" | "createdAt">>): Promise<RadiologyOrder> {
    const existing = await this.getOrder(orderId);
    if (!existing) throw new Error("Order not found");
    const updated: RadiologyOrder = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.firestore.collection("orders").doc(orderId).set(updated);
    return updated;
  }

  async listOrders(filters?: {
    status?: OrderStatus;
    patientId?: string;
    date?: string;
    search?: string;
  }): Promise<RadiologyOrder[]> {
    let query: any = this.firestore.collection("orders");
    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.patientId) query = query.where("patientId", "==", filters.patientId);

    const snapshot = await query.get();
    let orders = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as RadiologyOrder);

    if (filters?.date) {
      orders = orders.filter((o: RadiologyOrder) => o.scheduledDate.startsWith(filters.date!));
    }
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      orders = orders.filter(
        (o: RadiologyOrder) =>
          o.patientName.toLowerCase().includes(needle) ||
          o.bodyPart.toLowerCase().includes(needle) ||
          o.modality.toLowerCase().includes(needle),
      );
    }

    return orders.sort((a: RadiologyOrder, b: RadiologyOrder) => b.scheduledDate.localeCompare(a.scheduledDate));
  }

  // --------------- RIS: Scans ---------------

  async createScan(payload: Omit<Scan, "id" | "createdAt" | "updatedAt">): Promise<Scan> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("scans").doc();
    const scan: Scan = { id: docRef.id, ...payload, createdAt: now, updatedAt: now };
    await docRef.set(scan);
    return scan;
  }

  async getScan(scanId: string): Promise<Scan | null> {
    const doc = await this.firestore.collection("scans").doc(scanId).get();
    return doc.exists ? (doc.data() as Scan) : null;
  }

  async updateScan(scanId: string, patch: Partial<Omit<Scan, "id" | "createdAt">>): Promise<Scan> {
    const existing = await this.getScan(scanId);
    if (!existing) throw new Error("Scan not found");
    const updated: Scan = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.firestore.collection("scans").doc(scanId).set(updated);
    return updated;
  }

  async listScans(filters?: {
    status?: ScanStatus;
    patientId?: string;
    scanType?: string;
    date?: string;
    search?: string;
  }): Promise<Scan[]> {
    let query: any = this.firestore.collection("scans");
    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.patientId) query = query.where("patientId", "==", filters.patientId);

    const snapshot = await query.get();
    let scans = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as Scan);

    if (filters?.scanType) {
      scans = scans.filter((s: Scan) => s.scanType === filters.scanType);
    }
    if (filters?.date) {
      scans = scans.filter((s: Scan) => s.scanDate.startsWith(filters.date!));
    }
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      scans = scans.filter(
        (s: Scan) =>
          s.patientName.toLowerCase().includes(needle) ||
          s.bodyPart.toLowerCase().includes(needle) ||
          s.scanType.toLowerCase().includes(needle) ||
          (s.technician ?? "").toLowerCase().includes(needle),
      );
    }

    return scans.sort((a: Scan, b: Scan) => b.scanDate.localeCompare(a.scanDate));
  }

  // --------------- RIS: Billing ---------------

  async createBilling(payload: Omit<BillingRecord, "id" | "createdAt" | "updatedAt">): Promise<BillingRecord> {
    const now = new Date().toISOString();
    const docRef = this.firestore.collection("billing").doc();
    const record: BillingRecord = { id: docRef.id, ...payload, createdAt: now, updatedAt: now };
    await docRef.set(record);
    return record;
  }

  async getBilling(id: string): Promise<BillingRecord | null> {
    const doc = await this.firestore.collection("billing").doc(id).get();
    return doc.exists ? (doc.data() as BillingRecord) : null;
  }

  async updateBilling(id: string, patch: Partial<Omit<BillingRecord, "id" | "createdAt">>): Promise<BillingRecord> {
    const existing = await this.getBilling(id);
    if (!existing) throw new Error("Billing record not found");
    const updated: BillingRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.firestore.collection("billing").doc(id).set(updated);
    return updated;
  }

  async listBilling(filters?: {
    status?: BillingStatus;
    patientId?: string;
    search?: string;
  }): Promise<BillingRecord[]> {
    let query: any = this.firestore.collection("billing");
    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.patientId) query = query.where("patientId", "==", filters.patientId);

    const snapshot = await query.get();
    let records = snapshot.docs.map((doc: { data: () => unknown }) => doc.data() as BillingRecord);

    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      records = records.filter(
        (r: BillingRecord) =>
          r.patientName.toLowerCase().includes(needle) ||
          (r.invoiceNumber ?? "").toLowerCase().includes(needle),
      );
    }

    return records.sort((a: BillingRecord, b: BillingRecord) => b.createdAt.localeCompare(a.createdAt));
  }

  // --------------- Role Permissions ---------------

  async getRolePermissions(role: UserRole): Promise<RolePermissions | null> {
    const doc = await this.firestore.collection("rolePermissions").doc(role).get();
    return doc.exists ? (doc.data() as RolePermissions) : null;
  }

  async getAllRolePermissions(): Promise<RolePermissions[]> {
    const snapshot = await this.firestore.collection("rolePermissions").get();
    return snapshot.docs.map((doc) => doc.data() as RolePermissions);
  }

  async setRolePermissions(
    role: UserRole,
    permissions: Permission[],
    updatedBy: string,
  ): Promise<RolePermissions> {
    const now = new Date().toISOString();
    const record: RolePermissions = {
      role,
      permissions,
      isCustomized: true,
      updatedAt: now,
      updatedBy,
    };
    await this.firestore.collection("rolePermissions").doc(role).set(record);
    return record;
  }

  async resetRolePermissions(role: UserRole): Promise<void> {
    await this.firestore.collection("rolePermissions").doc(role).delete();
  }
}
