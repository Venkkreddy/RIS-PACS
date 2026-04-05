import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../middleware/asyncHandler";
import { JwtService } from "../services/jwtService";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { getFirestore } from "../services/firebaseAdmin";
import { tenantContextMiddleware, requireRole, TenantRequest } from "../middleware/tenantContext";

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  aeTitle: z.string().min(1).max(16).regex(/^[A-Z0-9_]+$/, "AE Title must be uppercase alphanumeric"),
  institutionName: z.string().optional(),
  domain: z.string().optional(),
  maxUsers: z.number().int().min(1).max(10000).default(100),
  maxStorageGb: z.number().int().min(1).max(50000).default(500),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminDisplayName: z.string().min(1),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  institutionName: z.string().optional(),
  isActive: z.boolean().optional(),
  maxUsers: z.number().int().min(1).optional(),
  maxStorageGb: z.number().int().min(1).optional(),
  config: z.record(z.unknown()).optional(),
});

export function tenantAdminRouter(store: TenantScopedStore, jwtService: JwtService): Router {
  const router = Router();
  const db = getFirestore();

  router.post("/tenants", asyncHandler(async (req: Request, res: Response) => {
    const platformKey = req.headers["x-platform-key"];
    if (platformKey !== process.env.PLATFORM_ADMIN_KEY) {
      res.status(403).json({ error: "Platform admin access required" });
      return;
    }

    const body = createTenantSchema.parse(req.body);

    const slugSnapshot = await db.collection("tenants_meta")
      .where("slug", "==", body.slug)
      .limit(1)
      .get();
    const aeTitleSnapshot = await db.collection("tenants_meta")
      .where("ae_title", "==", body.aeTitle)
      .limit(1)
      .get();

    if (!slugSnapshot.empty || !aeTitleSnapshot.empty) {
      res.status(409).json({ error: "Tenant slug or AE Title already exists" });
      return;
    }

    const now = new Date().toISOString();
    const tenantRef = db.collection("tenants_meta").doc();
    const tenantData = {
      name: body.name,
      slug: body.slug,
      ae_title: body.aeTitle,
      institution_name: body.institutionName ?? null,
      domain: body.domain ?? null,
      max_users: body.maxUsers,
      max_storage_gb: body.maxStorageGb,
      storage_path: `/storage/${body.slug}`,
      is_active: true,
      config: {},
      created_at: now,
      updated_at: now,
    };
    await tenantRef.set(tenantData);

    await db.collection("tenants").doc(tenantRef.id).collection("dicom_config").doc("default").set({
      ae_title: body.aeTitle,
      institution_name: body.institutionName ?? null,
      storage_path: `/storage/${body.slug}`,
    });

    const passwordHash = await bcrypt.hash(body.adminPassword, 12);
    const adminUser = await store.upsertUser(tenantRef.id, {
      email: body.adminEmail,
      displayName: body.adminDisplayName,
      role: "admin",
      isApproved: true,
      requestStatus: "approved",
      authProvider: "local",
      passwordHash,
    });

    await store.writeAuditLog(tenantRef.id, {
      userId: adminUser.id,
      action: "tenant_created",
      resourceType: "tenant",
      resourceId: tenantRef.id,
      details: { name: body.name, slug: body.slug },
      ipAddress: req.ip,
    });

    res.status(201).json({
      tenant: { id: tenantRef.id, ...tenantData },
      admin: { id: adminUser.id, email: adminUser.email },
    });
  }));

  router.get("/tenants", asyncHandler(async (req: Request, res: Response) => {
    const platformKey = req.headers["x-platform-key"];
    if (platformKey !== process.env.PLATFORM_ADMIN_KEY) {
      res.status(403).json({ error: "Platform admin access required" });
      return;
    }

    const snapshot = await db.collection("tenants_meta").orderBy("created_at", "desc").get();
    const tenants = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const usersSnapshot = await db.collection("tenants").doc(doc.id).collection("users").get();
      tenants.push({
        id: doc.id,
        ...data,
        user_count: usersSnapshot.size,
      });
    }

    res.json({ tenants });
  }));

  router.patch("/tenants/:tenantId", asyncHandler(async (req: Request, res: Response) => {
    const platformKey = req.headers["x-platform-key"];
    if (platformKey !== process.env.PLATFORM_ADMIN_KEY) {
      res.status(403).json({ error: "Platform admin access required" });
      return;
    }

    const body = updateTenantSchema.parse(req.body);
    const { tenantId } = req.params;

    const tenantRef = db.collection("tenants_meta").doc(tenantId);
    const existing = await tenantRef.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.institutionName !== undefined) updates.institution_name = body.institutionName;
    if (body.isActive !== undefined) updates.is_active = body.isActive;
    if (body.maxUsers !== undefined) updates.max_users = body.maxUsers;
    if (body.maxStorageGb !== undefined) updates.max_storage_gb = body.maxStorageGb;
    if (body.config !== undefined) updates.config = body.config;

    await tenantRef.update(updates);

    const updated = await tenantRef.get();
    res.json({ tenant: { id: updated.id, ...updated.data() } });
  }));

  // =========================================================================
  // TENANT-SCOPED ADMIN ROUTES (requires tenant JWT + admin role)
  // =========================================================================

  const tenantRouter = Router();
  tenantRouter.use(tenantContextMiddleware(jwtService));
  tenantRouter.use(requireRole("admin"));

  tenantRouter.get("/users", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    const users = await store.listUsers(tenantReq.tenant.id);
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        isApproved: u.is_approved,
        requestStatus: u.request_status,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
      })),
    });
  }));

  tenantRouter.patch("/users/:userId/approve", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    const { userId } = req.params;
    const { approval, role } = req.body;

    if (!["approved", "rejected"].includes(approval)) {
      res.status(400).json({ error: "approval must be 'approved' or 'rejected'" });
      return;
    }

    const user = await store.updateUserApproval(tenantReq.tenant.id, userId, approval, role);

    await store.writeAuditLog(tenantReq.tenant.id, {
      userId: tenantReq.tokenPayload.sub,
      action: `user_${approval}`,
      resourceType: "user",
      resourceId: userId,
      details: { role: user.role },
      ipAddress: req.ip,
    });

    res.json({ user });
  }));

  tenantRouter.get("/audit-logs", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = await store.listAuditLogs(tenantReq.tenant.id, { limit, offset });
    res.json({ auditLogs: logs, limit, offset });
  }));

  router.use("/admin", tenantRouter);

  return router;
}
