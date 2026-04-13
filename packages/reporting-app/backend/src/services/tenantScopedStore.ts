import { v4 as uuid } from "uuid";
import { getFirestore } from "./firebaseAdmin";

/**
 * TenantScopedStore: All database operations are scoped by tenant_id.
 * Uses Firestore with tenant-prefixed collections for data isolation.
 * Collection naming: tenants/{tenantId}/{collectionName}/{docId}
 */
export class TenantScopedStore {
  private get db() {
    return getFirestore();
  }

  private tenantCol(tenantId: string, collection: string) {
    return this.db.collection("tenants").doc(tenantId).collection(collection);
  }

  // ===========================================================================
  // USERS
  // ===========================================================================

  async listUsers(tenantId: string): Promise<UserRow[]> {
    const snapshot = await this.tenantCol(tenantId, "users")
      .orderBy("created_at", "desc")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as UserRow);
  }

  async getUserById(tenantId: string, userId: string): Promise<UserRow | null> {
    const doc = await this.tenantCol(tenantId, "users").doc(userId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as UserRow) : null;
  }

  async getUserByEmail(tenantId: string, email: string): Promise<UserRow | null> {
    const snapshot = await this.tenantCol(tenantId, "users")
      .where("email", "==", email.toLowerCase())
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as UserRow;
  }

  async upsertUser(tenantId: string, user: UpsertUserInput): Promise<UserRow> {
    const now = new Date().toISOString();
    const existing = user.id
      ? await this.getUserById(tenantId, user.id)
      : await this.getUserByEmail(tenantId, user.email);

    if (existing) {
      const updated: Partial<UserRow> = {
        display_name: user.displayName ?? existing.display_name,
        role: user.role ?? existing.role,
        is_approved: user.isApproved ?? existing.is_approved,
        request_status: user.requestStatus ?? existing.request_status,
        auth_provider: user.authProvider ?? existing.auth_provider,
        firebase_uid: user.firebaseUid ?? existing.firebase_uid,
        password_hash: user.passwordHash ?? existing.password_hash,
        last_login_at: now,
        updated_at: now,
      };
      await this.tenantCol(tenantId, "users").doc(existing.id).update(updated);
      return { ...existing, ...updated };
    }

    const id = user.id ?? uuid();
    const newUser: UserRow = {
      id,
      tenant_id: tenantId,
      email: user.email.toLowerCase(),
      display_name: user.displayName,
      role: user.role,
      is_approved: user.isApproved ?? false,
      request_status: user.requestStatus ?? "pending",
      auth_provider: user.authProvider ?? "local",
      firebase_uid: user.firebaseUid,
      password_hash: user.passwordHash,
      last_login_at: now,
      created_at: now,
      updated_at: now,
    };
    await this.tenantCol(tenantId, "users").doc(id).set(newUser);
    return newUser;
  }

  async updateUserApproval(
    tenantId: string,
    userId: string,
    approval: "approved" | "rejected",
    role?: string,
  ): Promise<UserRow> {
    const existing = await this.getUserById(tenantId, userId);
    if (!existing) throw new Error("User not found");

    const patch: Partial<UserRow> = {
      is_approved: approval === "approved",
      request_status: approval,
      updated_at: new Date().toISOString(),
    };
    if (role) patch.role = role;

    await this.tenantCol(tenantId, "users").doc(userId).update(patch);
    return { ...existing, ...patch } as UserRow;
  }

  // ===========================================================================
  // PATIENTS
  // ===========================================================================

  async createPatient(tenantId: string, patient: CreatePatientInput): Promise<PatientRow> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "patients").doc();
    const row: PatientRow = {
      id: docRef.id,
      tenant_id: tenantId,
      patient_id: patient.patientId,
      first_name: patient.firstName,
      last_name: patient.lastName,
      date_of_birth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      email: patient.email,
      address: patient.address,
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async getPatient(tenantId: string, patientId: string): Promise<PatientRow | null> {
    const doc = await this.tenantCol(tenantId, "patients").doc(patientId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as PatientRow) : null;
  }

  async getPatientByMrn(tenantId: string, patientId: string): Promise<PatientRow | null> {
    const normalized = patientId.trim().toUpperCase();
    if (!normalized) return null;
    const snapshot = await this.tenantCol(tenantId, "patients")
      .where("patient_id", "==", normalized)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() } as PatientRow;
    }
    const fallback = await this.tenantCol(tenantId, "patients").get();
    const match = fallback.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as PatientRow))
      .find((row) => row.patient_id.trim().toUpperCase() === normalized);
    return match ?? null;
  }

  async listPatients(tenantId: string, search?: string): Promise<PatientRow[]> {
    const snapshot = await this.tenantCol(tenantId, "patients")
      .orderBy("updated_at", "desc")
      .get();
    let patients = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PatientRow);

    if (search) {
      const needle = search.toLowerCase();
      patients = patients.filter(
        (p) =>
          p.first_name.toLowerCase().includes(needle) ||
          p.last_name.toLowerCase().includes(needle) ||
          p.patient_id.toLowerCase().includes(needle),
      );
    }
    return patients;
  }

  // ===========================================================================
  // STUDIES
  // ===========================================================================

  async upsertStudy(tenantId: string, study: UpsertStudyInput): Promise<StudyRow> {
    const now = new Date().toISOString();
    const existing = await this.getStudyByUid(tenantId, study.studyInstanceUid);

    if (existing) {
      const patch: Partial<StudyRow> = {
        patient_name: study.patientName ?? existing.patient_name,
        study_date: study.studyDate ?? existing.study_date,
        modality: study.modality ?? existing.modality,
        description: study.description ?? existing.description,
        metadata: study.metadata ?? existing.metadata,
        updated_at: now,
      };
      await this.tenantCol(tenantId, "studies").doc(existing.id).update(patch);
      return { ...existing, ...patch } as StudyRow;
    }

    const docRef = this.tenantCol(tenantId, "studies").doc();
    const row: StudyRow = {
      id: docRef.id,
      tenant_id: tenantId,
      study_instance_uid: study.studyInstanceUid,
      patient_name: study.patientName,
      study_date: study.studyDate,
      modality: study.modality,
      description: study.description,
      body_part: study.bodyPart,
      location: study.location,
      status: study.status ?? "unassigned",
      uploader_id: study.uploaderId,
      ae_title: study.aeTitle,
      institution_name: study.institutionName,
      metadata: study.metadata ?? {},
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async getStudy(tenantId: string, studyId: string): Promise<StudyRow | null> {
    const doc = await this.tenantCol(tenantId, "studies").doc(studyId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as StudyRow) : null;
  }

  async getStudyByUid(tenantId: string, studyInstanceUid: string): Promise<StudyRow | null> {
    const snapshot = await this.tenantCol(tenantId, "studies")
      .where("study_instance_uid", "==", studyInstanceUid)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as StudyRow;
  }

  async listStudies(tenantId: string, filters?: StudyFilters): Promise<StudyRow[]> {
    let query: FirebaseFirestore.Query = this.tenantCol(tenantId, "studies");

    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.assignedTo) query = query.where("assigned_to", "==", filters.assignedTo);
    if (filters?.modality) query = query.where("modality", "==", filters.modality);

    const snapshot = await query.get();
    let studies = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as StudyRow);

    if (filters?.name) {
      const needle = filters.name.toLowerCase();
      studies = studies.filter((s) => (s.patient_name ?? "").toLowerCase().includes(needle));
    }

    return studies.sort((a, b) => (b.study_date ?? "").localeCompare(a.study_date ?? ""));
  }

  async assignStudies(tenantId: string, studyIds: string[], radiologistId: string): Promise<StudyRow[]> {
    const now = new Date().toISOString();
    const results: StudyRow[] = [];

    const batch = this.db.batch();
    for (const studyId of studyIds) {
      const ref = this.tenantCol(tenantId, "studies").doc(studyId);
      batch.update(ref, {
        status: "assigned",
        assigned_to: radiologistId,
        assigned_at: now,
        updated_at: now,
      });
    }
    await batch.commit();

    for (const studyId of studyIds) {
      const updated = await this.getStudy(tenantId, studyId);
      if (updated) results.push(updated);
    }
    return results;
  }

  // ===========================================================================
  // REPORTS
  // ===========================================================================

  async createReport(tenantId: string, report: CreateReportInput): Promise<ReportRow> {
    const now = new Date().toISOString();
    const initialVersion = {
      id: uuid(),
      type: "initial",
      content: report.content,
      authorId: report.ownerId,
      createdAt: now,
    };

    const docRef = this.tenantCol(tenantId, "reports").doc();
    const row: ReportRow = {
      id: docRef.id,
      tenant_id: tenantId,
      study_id: report.studyId,
      template_id: report.templateId,
      content: report.content,
      sections: report.sections ?? [],
      status: report.status ?? "draft",
      priority: report.priority ?? "routine",
      owner_id: report.ownerId,
      metadata: report.metadata ?? {},
      versions: [initialVersion],
      attachments: [],
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async getReport(tenantId: string, reportId: string): Promise<ReportRow | null> {
    const doc = await this.tenantCol(tenantId, "reports").doc(reportId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as ReportRow) : null;
  }

  async getReportByStudyId(tenantId: string, studyId: string): Promise<ReportRow | null> {
    const snapshot = await this.tenantCol(tenantId, "reports")
      .where("study_id", "==", studyId)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as ReportRow;
  }

  async listReports(tenantId: string, ownerId?: string): Promise<ReportRow[]> {
    let query: FirebaseFirestore.Query = this.tenantCol(tenantId, "reports");
    if (ownerId) query = query.where("owner_id", "==", ownerId);

    const snapshot = await query.orderBy("updated_at", "desc").get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ReportRow);
  }

  async updateReport(tenantId: string, reportId: string, patch: Partial<ReportRow>): Promise<ReportRow> {
    const existing = await this.getReport(tenantId, reportId);
    if (!existing) throw new Error("Report not found");

    const allowed = ["content", "sections", "status", "priority", "metadata", "signed_by", "signed_at"] as const;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (patch[key] !== undefined) updates[key] = patch[key];
    }

    await this.tenantCol(tenantId, "reports").doc(reportId).update(updates);
    return { ...existing, ...updates } as ReportRow;
  }

  // ===========================================================================
  // TEMPLATES
  // ===========================================================================

  async createTemplate(tenantId: string, template: CreateTemplateInput): Promise<TemplateRow> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "templates").doc();
    const row: TemplateRow = {
      id: docRef.id,
      tenant_id: tenantId,
      name: template.name,
      content: template.content,
      category: template.category,
      modality: template.modality,
      body_part: template.bodyPart,
      sections: template.sections ?? [],
      is_system: template.isSystem ?? false,
      owner_id: template.ownerId,
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async listTemplates(tenantId: string, ownerId?: string): Promise<TemplateRow[]> {
    const snapshot = await this.tenantCol(tenantId, "templates").get();
    let templates = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as TemplateRow);

    if (ownerId) {
      templates = templates.filter((t) => t.owner_id === ownerId || t.is_system);
    }
    return templates;
  }

  // ===========================================================================
  // ORDERS
  // ===========================================================================

  async createOrder(tenantId: string, order: CreateOrderInput): Promise<OrderRow> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "orders").doc();
    const row: OrderRow = {
      id: docRef.id,
      tenant_id: tenantId,
      patient_id: order.patientId,
      patient_name: order.patientName,
      referring_physician_id: order.referringPhysicianId,
      referring_physician_name: order.referringPhysicianName,
      modality: order.modality,
      body_part: order.bodyPart,
      clinical_history: order.clinicalHistory,
      priority: order.priority ?? "routine",
      status: order.status ?? "scheduled",
      scheduled_date: order.scheduledDate,
      notes: order.notes,
      created_by: order.createdBy,
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async listOrders(tenantId: string, filters?: OrderFilters): Promise<OrderRow[]> {
    let query: FirebaseFirestore.Query = this.tenantCol(tenantId, "orders");
    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.patientId) query = query.where("patient_id", "==", filters.patientId);

    const snapshot = await query.get();
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as OrderRow);
    return orders.sort((a, b) => (b.scheduled_date ?? "").localeCompare(a.scheduled_date ?? ""));
  }

  // ===========================================================================
  // BILLING
  // ===========================================================================

  async createBilling(tenantId: string, billing: CreateBillingInput): Promise<BillingRow> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "billing").doc();
    const row: BillingRow = {
      id: docRef.id,
      tenant_id: tenantId,
      order_id: billing.orderId,
      patient_id: billing.patientId,
      patient_name: billing.patientName,
      description: billing.description,
      modality: billing.modality,
      body_part: billing.bodyPart,
      amount: billing.amount,
      status: billing.status ?? "pending",
      created_by: billing.createdBy,
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async listBilling(tenantId: string, filters?: BillingFilters): Promise<BillingRow[]> {
    let query: FirebaseFirestore.Query = this.tenantCol(tenantId, "billing");
    if (filters?.status) query = query.where("status", "==", filters.status);
    if (filters?.patientId) query = query.where("patient_id", "==", filters.patientId);

    const snapshot = await query.get();
    const records = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as BillingRow);
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ===========================================================================
  // REFERRING PHYSICIANS
  // ===========================================================================

  async createReferringPhysician(tenantId: string, physician: CreatePhysicianInput): Promise<PhysicianRow> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "referring_physicians").doc();
    const row: PhysicianRow = {
      id: docRef.id,
      tenant_id: tenantId,
      name: physician.name,
      specialty: physician.specialty,
      phone: physician.phone,
      email: physician.email,
      hospital: physician.hospital,
      created_at: now,
      updated_at: now,
    };
    await docRef.set(row);
    return row;
  }

  async listReferringPhysicians(tenantId: string, search?: string): Promise<PhysicianRow[]> {
    const snapshot = await this.tenantCol(tenantId, "referring_physicians")
      .orderBy("name")
      .get();
    let physicians = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PhysicianRow);

    if (search) {
      const needle = search.toLowerCase();
      physicians = physicians.filter(
        (p) => p.name.toLowerCase().includes(needle) || (p.hospital ?? "").toLowerCase().includes(needle),
      );
    }
    return physicians;
  }

  // ===========================================================================
  // ROLE PERMISSIONS (per-tenant)
  // ===========================================================================

  async getRolePermissions(tenantId: string, role: string): Promise<RolePermissionRow | null> {
    const doc = await this.tenantCol(tenantId, "role_permissions").doc(role).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as RolePermissionRow) : null;
  }

  async setRolePermissions(
    tenantId: string,
    role: string,
    permissions: string[],
    updatedBy: string,
  ): Promise<RolePermissionRow> {
    const now = new Date().toISOString();
    const record: RolePermissionRow = {
      id: role,
      tenant_id: tenantId,
      role,
      permissions,
      is_customized: true,
      updated_by: updatedBy,
      updated_at: now,
    };
    await this.tenantCol(tenantId, "role_permissions").doc(role).set(record);
    return record;
  }

  // ===========================================================================
  // AUDIT LOGS
  // ===========================================================================

  async writeAuditLog(tenantId: string, entry: AuditLogInput): Promise<void> {
    const now = new Date().toISOString();
    const docRef = this.tenantCol(tenantId, "audit_logs").doc();
    await docRef.set({
      id: docRef.id,
      tenant_id: tenantId,
      user_id: entry.userId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      details: entry.details ?? {},
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      created_at: now,
    });
  }

  async listAuditLogs(tenantId: string, opts?: {
    userId?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogRow[]> {
    let query: FirebaseFirestore.Query = this.tenantCol(tenantId, "audit_logs");

    if (opts?.userId) query = query.where("user_id", "==", opts.userId);
    if (opts?.resourceType) query = query.where("resource_type", "==", opts.resourceType);

    query = query.orderBy("created_at", "desc");

    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    query = query.limit(limit + offset);

    const snapshot = await query.get();
    const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AuditLogRow);
    return logs.slice(offset);
  }
}

// ===========================================================================
// TYPE DEFINITIONS (Row types matching Firestore schema)
// ===========================================================================

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash?: string;
  display_name?: string;
  role: string;
  is_approved: boolean;
  request_status: string;
  auth_provider: string;
  firebase_uid?: string;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertUserInput {
  id?: string;
  email: string;
  displayName?: string;
  role: string;
  isApproved?: boolean;
  requestStatus?: string;
  authProvider?: string;
  firebaseUid?: string;
  passwordHash?: string;
}

export interface PatientRow {
  id: string; tenant_id: string; patient_id: string;
  first_name: string; last_name: string; date_of_birth?: string;
  gender?: string; phone?: string; email?: string; address?: string;
  created_at: string; updated_at: string;
}

export interface CreatePatientInput {
  patientId: string; firstName: string; lastName: string;
  dateOfBirth?: string; gender?: string; phone?: string;
  email?: string; address?: string;
}

export interface StudyRow {
  id: string; tenant_id: string; study_instance_uid: string;
  patient_name?: string; study_date?: string; modality?: string;
  description?: string; body_part?: string; location?: string;
  status: string; assigned_to?: string; assigned_at?: string;
  reported_at?: string; tat_hours?: number; uploader_id?: string;
  ae_title?: string; institution_name?: string;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string;
}

export interface UpsertStudyInput {
  studyInstanceUid: string; patientName?: string; studyDate?: string;
  modality?: string; description?: string; bodyPart?: string;
  location?: string; status?: string; uploaderId?: string;
  aeTitle?: string; institutionName?: string;
  metadata?: Record<string, unknown>;
}

export interface StudyFilters {
  status?: string; assignedTo?: string; modality?: string; name?: string;
}

export interface ReportRow {
  id: string; tenant_id: string; study_id?: string; template_id?: string;
  content?: string; sections: unknown; status: string; priority: string;
  signed_by?: string; signed_at?: string; owner_id: string;
  metadata: Record<string, unknown>; versions: unknown; attachments: unknown;
  created_at: string; updated_at: string;
}

export interface CreateReportInput {
  studyId?: string; templateId?: string; content: string;
  sections?: unknown[]; status?: string; priority?: string;
  ownerId: string; metadata?: Record<string, unknown>;
}

export interface TemplateRow {
  id: string; tenant_id: string; name: string; content?: string;
  category?: string; modality?: string; body_part?: string;
  sections: unknown; is_system: boolean; owner_id: string;
  created_at: string; updated_at: string;
}

export interface CreateTemplateInput {
  name: string; content?: string; category?: string; modality?: string;
  bodyPart?: string; sections?: unknown[]; isSystem?: boolean; ownerId: string;
}

export interface OrderRow {
  id: string; tenant_id: string; patient_id: string; patient_name?: string;
  referring_physician_id?: string; referring_physician_name?: string;
  modality?: string; body_part?: string; clinical_history?: string;
  priority: string; status: string; scheduled_date?: string;
  completed_date?: string; study_id?: string; report_id?: string;
  notes?: string; created_by: string; created_at: string; updated_at: string;
}

export interface CreateOrderInput {
  patientId: string; patientName?: string; referringPhysicianId?: string;
  referringPhysicianName?: string; modality?: string; bodyPart?: string;
  clinicalHistory?: string; priority?: string; status?: string;
  scheduledDate?: string; notes?: string; createdBy: string;
}

export interface OrderFilters { status?: string; patientId?: string; }

export interface BillingRow {
  id: string; tenant_id: string; order_id?: string; patient_id: string;
  patient_name?: string; description?: string; modality?: string;
  body_part?: string; amount?: number; status: string;
  invoice_number?: string; paid_date?: string; notes?: string;
  created_by: string; created_at: string; updated_at: string;
}

export interface CreateBillingInput {
  orderId?: string; patientId: string; patientName?: string;
  description?: string; modality?: string; bodyPart?: string;
  amount?: number; status?: string; createdBy: string;
}

export interface BillingFilters { status?: string; patientId?: string; }

export interface PhysicianRow {
  id: string; tenant_id: string; name: string; specialty?: string;
  phone?: string; email?: string; hospital?: string;
  created_at: string; updated_at: string;
}

export interface CreatePhysicianInput {
  name: string; specialty?: string; phone?: string;
  email?: string; hospital?: string;
}

export interface RolePermissionRow {
  id: string; tenant_id: string; role: string;
  permissions: string[]; is_customized: boolean;
  updated_by?: string; updated_at: string;
}

export interface AuditLogInput {
  userId?: string; action: string; resourceType?: string;
  resourceId?: string; details?: Record<string, unknown>;
  ipAddress?: string; userAgent?: string;
}

export interface AuditLogRow {
  id: string; tenant_id: string; user_id?: string;
  action: string; resource_type?: string; resource_id?: string;
  details: Record<string, unknown>; ip_address?: string;
  user_agent?: string; created_at: string;
}
