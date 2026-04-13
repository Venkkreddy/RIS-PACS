import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensureAdmin } from "../middleware/auth";
import { getClientIp, getUserAgent } from "../middleware/hipaaMiddleware";
import { HipaaAuditService } from "../services/hipaaAuditService";

const auditQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  tenantId: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
});

const emergencyAccessSchema = z.object({
  reason: z.string().min(10, "Emergency access reason must be at least 10 characters"),
  patientId: z.string().min(1),
  durationMinutes: z.number().min(5).max(480).default(60),
});

const revokeEmergencySchema = z.object({
  accessId: z.string().min(1),
});

export function hipaaRouter(auditService: HipaaAuditService): Router {
  const router = Router();

  router.get(
    "/audit-log",
    ensureAuthenticated,
    ensureAdmin,
    asyncHandler(async (req, res) => {
      const query = auditQuerySchema.parse(req.query);

      await auditService.log({
        action: "AUDIT_LOG_ACCESS",
        severity: "warning",
        userId: req.session.user!.id,
        userEmail: req.session.user!.email,
        userRole: req.session.user!.role,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        resourceType: "patient",
        resourceId: "audit-log",
        description: "Admin accessed HIPAA audit log",
        httpMethod: req.method,
        httpPath: req.path,
        phiAccessed: false,
        metadata: { queryFilters: query },
      });

      const result = await auditService.queryAuditLog({
        userId: query.userId,
        action: query.action as any,
        resourceType: query.resourceType as any,
        severity: query.severity,
        tenantId: query.tenantId,
        startDate: query.startDate,
        endDate: query.endDate,
        limit: query.limit,
      });

      res.json(result);
    }),
  );

  router.get(
    "/audit-log/integrity",
    ensureAuthenticated,
    ensureAdmin,
    asyncHandler(async (req, res) => {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
      const result = await auditService.verifyAuditIntegrity(startDate, endDate);
      res.json(result);
    }),
  );

  router.post(
    "/emergency-access",
    ensureAuthenticated,
    asyncHandler(async (req, res) => {
      const body = emergencyAccessSchema.parse(req.body);
      const record = await auditService.grantEmergencyAccess({
        userId: req.session.user!.id,
        userEmail: req.session.user!.email,
        reason: body.reason,
        patientId: body.patientId,
        durationMinutes: body.durationMinutes,
      });
      res.status(201).json(record);
    }),
  );

  router.post(
    "/emergency-access/revoke",
    ensureAuthenticated,
    ensureAdmin,
    asyncHandler(async (req, res) => {
      const body = revokeEmergencySchema.parse(req.body);
      await auditService.revokeEmergencyAccess(body.accessId, req.session.user!.id);
      res.json({ message: "Emergency access revoked" });
    }),
  );

  router.get(
    "/emergency-access",
    ensureAuthenticated,
    ensureAdmin,
    asyncHandler(async (req, res) => {
      const active = req.query.active === "true";
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const records = await auditService.listEmergencyAccess({ userId, active });
      res.json(records);
    }),
  );

  router.get(
    "/compliance-status",
    ensureAuthenticated,
    ensureAdmin,
    asyncHandler(async (req, res) => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const recentAudit = await auditService.queryAuditLog({
        startDate: oneDayAgo,
        limit: 1,
      });

      const criticalEvents = await auditService.queryAuditLog({
        severity: "critical",
        startDate: oneDayAgo,
        limit: 10,
      });

      const activeEmergency = await auditService.listEmergencyAccess({ active: true });

      const integrity = await auditService.verifyAuditIntegrity(
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );

      res.json({
        status: integrity.tampered > 0 ? "WARNING" : "COMPLIANT",
        timestamp: now.toISOString(),
        auditLogging: {
          enabled: true,
          recentActivity: recentAudit.total > 0,
          last24hEntries: recentAudit.total,
        },
        criticalEvents: {
          last24h: criticalEvents.total,
          events: criticalEvents.entries.map((e) => ({
            id: e.id,
            action: e.action,
            timestamp: e.timestamp,
            userId: e.userId,
          })),
        },
        emergencyAccess: {
          activeCount: activeEmergency.length,
          records: activeEmergency.map((r) => ({
            id: r.id,
            userId: r.userId,
            patientId: r.patientId,
            expiresAt: r.expiresAt,
          })),
        },
        auditIntegrity: {
          last7days: integrity,
          status: integrity.tampered > 0 ? "TAMPERED" : "INTACT",
        },
        encryption: {
          tlsRequired: true,
          dataAtRestEncryption: "Firebase/GCP managed",
        },
        accessControls: {
          rbacEnabled: true,
          sessionTimeout: "15 minutes",
          accountLockout: "5 failed attempts / 30 min lockout",
          mfaAvailable: "Via Firebase Authentication",
        },
      });
    }),
  );

  return router;
}
