import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { getFirestore } from "./firebaseAdmin";
import { hipaaConfig } from "../config/hipaaConfig";
import { logger } from "./logger";

export type AuditAction =
  | "PHI_ACCESS"
  | "PHI_CREATE"
  | "PHI_UPDATE"
  | "PHI_DELETE"
  | "PHI_EXPORT"
  | "PHI_SHARE"
  | "PHI_PRINT"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "SESSION_TIMEOUT"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED"
  | "PASSWORD_CHANGE"
  | "ROLE_CHANGE"
  | "PERMISSION_CHANGE"
  | "EMERGENCY_ACCESS"
  | "EMERGENCY_ACCESS_REVOKE"
  | "SYSTEM_CONFIG_CHANGE"
  | "AUDIT_LOG_ACCESS"
  | "DICOM_ACCESS"
  | "DICOM_UPLOAD"
  | "REPORT_SIGN"
  | "REPORT_ADDENDUM"
  | "USER_APPROVAL"
  | "USER_REJECTION"
  | "ENCRYPTION_FAILURE";

export type AuditSeverity = "info" | "warning" | "critical";

export type PhiCategory =
  | "patient"
  | "report"
  | "study"
  | "order"
  | "scan"
  | "billing"
  | "dicom"
  | "transcript"
  | "referring_physician";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  severity: AuditSeverity;
  userId: string;
  userEmail: string;
  userRole: string;
  ipAddress: string;
  userAgent: string;
  resourceType: PhiCategory;
  resourceId: string;
  tenantId?: string;
  description: string;
  httpMethod: string;
  httpPath: string;
  httpStatus?: number;
  phiAccessed: boolean;
  phiFieldsAccessed?: string[];
  integrityHash: string;
  previousEntryHash?: string;
  metadata?: Record<string, unknown>;
}

export interface EmergencyAccessRecord {
  id: string;
  userId: string;
  userEmail: string;
  reason: string;
  patientId: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
  approvedBy?: string;
}

function computeIntegrityHash(entry: Omit<AuditEntry, "integrityHash">): string {
  const payload = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    userId: entry.userId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    previousEntryHash: entry.previousEntryHash,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

let lastEntryHash: string | undefined;

export class HipaaAuditService {
  private readonly firestore: FirebaseFirestore.Firestore;
  private readonly collection: string;

  constructor(firestore?: FirebaseFirestore.Firestore) {
    this.firestore = firestore ?? getFirestore();
    this.collection = hipaaConfig.audit.collection;
  }

  async log(params: {
    action: AuditAction;
    severity?: AuditSeverity;
    userId: string;
    userEmail: string;
    userRole: string;
    ipAddress: string;
    userAgent: string;
    resourceType: PhiCategory;
    resourceId: string;
    tenantId?: string;
    description: string;
    httpMethod: string;
    httpPath: string;
    httpStatus?: number;
    phiAccessed?: boolean;
    phiFieldsAccessed?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!hipaaConfig.audit.enabled) return;

    try {
      const entryWithoutHash: Omit<AuditEntry, "integrityHash"> = {
        id: uuid(),
        timestamp: new Date().toISOString(),
        action: params.action,
        severity: params.severity ?? "info",
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        tenantId: params.tenantId,
        description: params.description,
        httpMethod: params.httpMethod,
        httpPath: params.httpPath,
        httpStatus: params.httpStatus,
        phiAccessed: params.phiAccessed ?? true,
        phiFieldsAccessed: params.phiFieldsAccessed,
        previousEntryHash: lastEntryHash,
        metadata: params.metadata,
      };

      const integrityHash = computeIntegrityHash(entryWithoutHash);
      const entry: AuditEntry = { ...entryWithoutHash, integrityHash };

      const firestoreDoc: Record<string, unknown> = { ...entry };
      for (const key of Object.keys(firestoreDoc)) {
        if (firestoreDoc[key] === undefined) delete firestoreDoc[key];
      }
      await this.firestore.collection(this.collection).doc(entry.id).set(firestoreDoc);
      lastEntryHash = integrityHash;

      if (params.severity === "critical") {
        logger.warn({
          message: "HIPAA critical audit event",
          auditId: entry.id,
          action: entry.action,
          userId: entry.userId,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
        });
      }
    } catch (err) {
      logger.error({
        message: "HIPAA AUDIT FAILURE — unable to write audit log",
        error: String(err),
        action: params.action,
        userId: params.userId,
      });
    }
  }

  async logPhiAccess(params: {
    userId: string;
    userEmail: string;
    userRole: string;
    ipAddress: string;
    userAgent: string;
    resourceType: PhiCategory;
    resourceId: string;
    tenantId?: string;
    action: "view" | "create" | "update" | "delete" | "export" | "share";
    httpMethod: string;
    httpPath: string;
    httpStatus?: number;
    phiFieldsAccessed?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const actionMap: Record<string, AuditAction> = {
      view: "PHI_ACCESS",
      create: "PHI_CREATE",
      update: "PHI_UPDATE",
      delete: "PHI_DELETE",
      export: "PHI_EXPORT",
      share: "PHI_SHARE",
    };

    await this.log({
      action: actionMap[params.action],
      userId: params.userId,
      userEmail: params.userEmail,
      userRole: params.userRole,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      tenantId: params.tenantId,
      description: `${params.action.toUpperCase()} ${params.resourceType} [${params.resourceId}]`,
      httpMethod: params.httpMethod,
      httpPath: params.httpPath,
      httpStatus: params.httpStatus,
      phiAccessed: true,
      phiFieldsAccessed: params.phiFieldsAccessed,
      metadata: params.metadata,
    });
  }

  async queryAuditLog(filters: {
    userId?: string;
    action?: AuditAction;
    resourceType?: PhiCategory;
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    severity?: AuditSeverity;
    tenantId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditEntry[]; total: number }> {
    let query: FirebaseFirestore.Query = this.firestore
      .collection(this.collection)
      .orderBy("timestamp", "desc");

    if (filters.userId) query = query.where("userId", "==", filters.userId);
    if (filters.action) query = query.where("action", "==", filters.action);
    if (filters.resourceType) query = query.where("resourceType", "==", filters.resourceType);
    if (filters.severity) query = query.where("severity", "==", filters.severity);
    if (filters.tenantId) query = query.where("tenantId", "==", filters.tenantId);
    if (filters.startDate) query = query.where("timestamp", ">=", filters.startDate);
    if (filters.endDate) query = query.where("timestamp", "<=", filters.endDate);

    const limit = Math.min(filters.limit ?? 100, 500);
    const snapshot = await query.limit(limit).get();
    const entries = snapshot.docs.map((doc) => doc.data() as AuditEntry);

    return { entries, total: entries.length };
  }

  async verifyAuditIntegrity(startDate?: string, endDate?: string): Promise<{
    verified: number;
    tampered: number;
    tamperedEntries: string[];
  }> {
    let query: FirebaseFirestore.Query = this.firestore
      .collection(this.collection)
      .orderBy("timestamp", "asc");

    if (startDate) query = query.where("timestamp", ">=", startDate);
    if (endDate) query = query.where("timestamp", "<=", endDate);

    const snapshot = await query.limit(10000).get();
    const entries = snapshot.docs.map((doc) => doc.data() as AuditEntry);

    let verified = 0;
    let tampered = 0;
    const tamperedEntries: string[] = [];

    for (const entry of entries) {
      const { integrityHash, ...rest } = entry;
      const expectedHash = computeIntegrityHash(rest as Omit<AuditEntry, "integrityHash">);

      if (expectedHash === integrityHash) {
        verified++;
      } else {
        tampered++;
        tamperedEntries.push(entry.id);
      }
    }

    return { verified, tampered, tamperedEntries };
  }

  async grantEmergencyAccess(params: {
    userId: string;
    userEmail: string;
    reason: string;
    patientId: string;
    durationMinutes?: number;
  }): Promise<EmergencyAccessRecord> {
    const now = new Date();
    const durationMs = (params.durationMinutes ?? 60) * 60 * 1000;

    const record: EmergencyAccessRecord = {
      id: uuid(),
      userId: params.userId,
      userEmail: params.userEmail,
      reason: params.reason,
      patientId: params.patientId,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
    };

    await this.firestore
      .collection(hipaaConfig.audit.emergencyAccessCollection)
      .doc(record.id)
      .set(record);

    await this.log({
      action: "EMERGENCY_ACCESS",
      severity: "critical",
      userId: params.userId,
      userEmail: params.userEmail,
      userRole: "emergency",
      ipAddress: "system",
      userAgent: "system",
      resourceType: "patient",
      resourceId: params.patientId,
      description: `Emergency access granted: ${params.reason}`,
      httpMethod: "POST",
      httpPath: "/hipaa/emergency-access",
      phiAccessed: true,
      metadata: { emergencyAccessId: record.id, durationMinutes: params.durationMinutes ?? 60 },
    });

    return record;
  }

  async revokeEmergencyAccess(accessId: string, revokedBy: string): Promise<void> {
    const docRef = this.firestore
      .collection(hipaaConfig.audit.emergencyAccessCollection)
      .doc(accessId);
    const doc = await docRef.get();

    if (!doc.exists) throw new Error("Emergency access record not found");

    const record = doc.data() as EmergencyAccessRecord;
    await docRef.update({
      revokedAt: new Date().toISOString(),
      revokedBy,
    });

    await this.log({
      action: "EMERGENCY_ACCESS_REVOKE",
      severity: "critical",
      userId: revokedBy,
      userEmail: "system",
      userRole: "admin",
      ipAddress: "system",
      userAgent: "system",
      resourceType: "patient",
      resourceId: record.patientId,
      description: `Emergency access revoked for user ${record.userId}`,
      httpMethod: "POST",
      httpPath: "/hipaa/emergency-access/revoke",
      phiAccessed: false,
      metadata: { emergencyAccessId: accessId },
    });
  }

  async listEmergencyAccess(filters?: {
    userId?: string;
    active?: boolean;
  }): Promise<EmergencyAccessRecord[]> {
    let query: FirebaseFirestore.Query = this.firestore
      .collection(hipaaConfig.audit.emergencyAccessCollection)
      .orderBy("grantedAt", "desc");

    if (filters?.userId) query = query.where("userId", "==", filters.userId);

    const snapshot = await query.get();
    let records = snapshot.docs.map((doc) => doc.data() as EmergencyAccessRecord);

    if (filters?.active) {
      const now = new Date().toISOString();
      records = records.filter((r) => !r.revokedAt && r.expiresAt > now);
    }

    return records;
  }
}
