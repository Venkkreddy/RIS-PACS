import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../middleware/asyncHandler";
import { JwtService } from "../services/jwtService";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { getFirestore } from "../services/firebaseAdmin";
import { tenantContextMiddleware, requireRole, TenantRequest } from "../middleware/tenantContext";

const storageModeSchema = z.enum(["local", "cloud"]);

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  aeTitle: z.string().min(1).max(16).regex(/^[A-Z0-9_]+$/, "AE Title must be uppercase alphanumeric"),
  institutionName: z.string().optional(),
  domain: z.string().optional(),
  maxUsers: z.number().int().min(1).max(10000).default(100),
  maxStorageGb: z.number().int().min(1).max(50000).default(500),
  storageMode: storageModeSchema.default("cloud"),
  pacsEndpointUrl: z.string().url().optional(),
  cloudBucket: z.string().min(3).max(63).optional(),
  cloudPrefix: z.string().max(255).optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminDisplayName: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.storageMode === "cloud" && !value.pacsEndpointUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "pacsEndpointUrl is required when storageMode is cloud",
      path: ["pacsEndpointUrl"],
    });
  }
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  institutionName: z.string().optional(),
  domain: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  maxUsers: z.number().int().min(1).optional(),
  maxStorageGb: z.number().int().min(1).optional(),
  storageMode: storageModeSchema.optional(),
  localStoragePath: z.string().max(500).optional(),
  pacsEndpointUrl: z.string().url().nullable().optional(),
  cloudBucket: z.string().min(3).max(63).nullable().optional(),
  cloudPrefix: z.string().max(255).nullable().optional(),
  config: z.record(z.unknown()).optional(),
});

const createHospitalAdminSchema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminDisplayName: z.string().min(1),
});

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeCloudPrefix(prefix: string | null | undefined, fallback: string): string {
  const candidate = (prefix ?? fallback).trim();
  return candidate.replace(/^\/+|\/+$/g, "");
}

function hasSessionSuperAdmin(req: Request): boolean {
  return req.session?.user?.role === "super_admin";
}

function hasValidPlatformKey(req: Request): boolean {
  const configured = process.env.PLATFORM_ADMIN_KEY?.trim();
  const provided = firstValue(req.headers["x-platform-key"])?.trim();
  return Boolean(configured && provided && configured === provided);
}

function assertPlatformAccess(req: Request, res: Response): boolean {
  if (hasSessionSuperAdmin(req) || hasValidPlatformKey(req)) {
    return true;
  }
  res.status(403).json({ error: "Super admin platform access required" });
  return false;
}

export function tenantAdminRouter(store: TenantScopedStore, jwtService: JwtService): Router {
  const router = Router();
  const db = getFirestore();

  router.post("/tenants", asyncHandler(async (req: Request, res: Response) => {
    if (!assertPlatformAccess(req, res)) return;
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
    const storagePath = body.storageMode === "cloud" ? `/cloud/${body.slug}` : `/storage/${body.slug}`;
    const cloudPrefix = normalizeCloudPrefix(body.cloudPrefix, body.slug);

    const tenantData = {
      name: body.name,
      slug: body.slug,
      ae_title: body.aeTitle,
      institution_name: body.institutionName ?? null,
      domain: body.domain ?? null,
      max_users: body.maxUsers,
      max_storage_gb: body.maxStorageGb,
      storage_mode: body.storageMode,
      storage_path: storagePath,
      is_active: true,
      config: {},
      created_at: now,
      updated_at: now,
    };
    await tenantRef.set(tenantData);

    const dicomConfig = {
      ae_title: body.aeTitle,
      institution_name: body.institutionName ?? null,
      storage_mode: body.storageMode,
      storage_path: storagePath,
      pacs_endpoint_url: body.pacsEndpointUrl ?? null,
      cloud_bucket: body.cloudBucket ?? null,
      cloud_prefix: body.storageMode === "cloud" ? cloudPrefix : null,
      created_at: now,
      updated_at: now,
    };
    await db.collection("tenants").doc(tenantRef.id).collection("dicom_config").doc("default").set(dicomConfig);

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
      userId: req.session.user?.id ?? adminUser.id,
      action: "tenant_created",
      resourceType: "tenant",
      resourceId: tenantRef.id,
      details: {
        name: body.name,
        slug: body.slug,
        storageMode: body.storageMode,
        pacsEndpointUrl: body.pacsEndpointUrl ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      tenant: { id: tenantRef.id, ...tenantData },
      dicomConfig,
      admin: { id: adminUser.id, email: adminUser.email },
    });
  }));

  router.get("/tenants", asyncHandler(async (req: Request, res: Response) => {
    if (!assertPlatformAccess(req, res)) return;
    const snapshot = await db.collection("tenants_meta").orderBy("created_at", "desc").get();
    const tenants = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const usersSnapshot = await db.collection("tenants").doc(doc.id).collection("users").get();
      const configDoc = await db.collection("tenants").doc(doc.id).collection("dicom_config").doc("default").get();
      const users = usersSnapshot.docs.map((u) => u.data() as { role?: string });
      const hospitalAdminCount = users.filter((u) => u.role === "admin").length;
      tenants.push({
        id: doc.id,
        ...data,
        user_count: usersSnapshot.size,
        hospital_admin_count: hospitalAdminCount,
        dicom_config: configDoc.exists ? configDoc.data() : null,
      });
    }

    res.json({ tenants });
  }));

  router.patch("/tenants/:tenantId", asyncHandler(async (req: Request, res: Response) => {
    if (!assertPlatformAccess(req, res)) return;
    const body = updateTenantSchema.parse(req.body);
    const tenantId = firstValue(req.params.tenantId);
    if (!tenantId) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    const tenantRef = db.collection("tenants_meta").doc(tenantId);
    const configRef = db.collection("tenants").doc(tenantId).collection("dicom_config").doc("default");
    const [tenantDoc, configDoc] = await Promise.all([tenantRef.get(), configRef.get()]);
    if (!tenantDoc.exists) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const currentTenant = tenantDoc.data() as Record<string, unknown>;
    const currentConfig = configDoc.exists ? (configDoc.data() as Record<string, unknown>) : {};
    const slug = String(currentTenant.slug ?? tenantId);
    const now = new Date().toISOString();

    const finalStorageMode =
      body.storageMode
      ?? (typeof currentTenant.storage_mode === "string" ? currentTenant.storage_mode : undefined)
      ?? (typeof currentConfig.storage_mode === "string" ? currentConfig.storage_mode : undefined)
      ?? "cloud";
    const finalPacsEndpoint =
      body.pacsEndpointUrl !== undefined
        ? body.pacsEndpointUrl
        : (typeof currentConfig.pacs_endpoint_url === "string" ? currentConfig.pacs_endpoint_url : null);
    if (finalStorageMode === "cloud" && !finalPacsEndpoint) {
      res.status(400).json({ error: "pacsEndpointUrl is required when storage mode is cloud" });
      return;
    }

    const effectiveStoragePath =
      finalStorageMode === "local"
        ? (body.localStoragePath ?? (typeof currentTenant.storage_path === "string" ? currentTenant.storage_path : `/storage/${slug}`))
        : `/cloud/${slug}`;

    const tenantUpdates: Record<string, unknown> = { updated_at: now };
    if (body.name !== undefined) tenantUpdates.name = body.name;
    if (body.institutionName !== undefined) tenantUpdates.institution_name = body.institutionName;
    if (body.domain !== undefined) tenantUpdates.domain = body.domain;
    if (body.isActive !== undefined) tenantUpdates.is_active = body.isActive;
    if (body.maxUsers !== undefined) tenantUpdates.max_users = body.maxUsers;
    if (body.maxStorageGb !== undefined) tenantUpdates.max_storage_gb = body.maxStorageGb;
    if (body.config !== undefined) tenantUpdates.config = body.config;
    tenantUpdates.storage_mode = finalStorageMode;
    tenantUpdates.storage_path = effectiveStoragePath;

    const configUpdates: Record<string, unknown> = { updated_at: now };
    if (!configDoc.exists) configUpdates.created_at = now;
    if (body.institutionName !== undefined) configUpdates.institution_name = body.institutionName;
    configUpdates.storage_mode = finalStorageMode;
    configUpdates.storage_path = effectiveStoragePath;
    if (body.pacsEndpointUrl !== undefined) configUpdates.pacs_endpoint_url = body.pacsEndpointUrl;
    if (body.cloudBucket !== undefined) configUpdates.cloud_bucket = body.cloudBucket;
    if (body.cloudPrefix !== undefined) {
      configUpdates.cloud_prefix = body.cloudPrefix ? normalizeCloudPrefix(body.cloudPrefix, slug) : null;
    } else if (finalStorageMode === "cloud" && typeof currentConfig.cloud_prefix !== "string") {
      configUpdates.cloud_prefix = normalizeCloudPrefix(undefined, slug);
    }

    await Promise.all([
      tenantRef.update(tenantUpdates),
      configRef.set(configUpdates, { merge: true }),
    ]);

    const [updatedTenantDoc, updatedConfigDoc] = await Promise.all([tenantRef.get(), configRef.get()]);
    res.json({
      tenant: {
        id: updatedTenantDoc.id,
        ...updatedTenantDoc.data(),
        dicom_config: updatedConfigDoc.exists ? updatedConfigDoc.data() : null,
      },
    });
  }));

  router.post("/tenants/:tenantId/admins", asyncHandler(async (req: Request, res: Response) => {
    if (!assertPlatformAccess(req, res)) return;
    const tenantId = firstValue(req.params.tenantId);
    if (!tenantId) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    const body = createHospitalAdminSchema.parse(req.body);
    const tenantDoc = await db.collection("tenants_meta").doc(tenantId).get();
    if (!tenantDoc.exists) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const existing = await store.getUserByEmail(tenantId, body.adminEmail);
    if (existing) {
      res.status(409).json({ error: "Hospital admin email already exists for this tenant" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.adminPassword, 12);
    const adminUser = await store.upsertUser(tenantId, {
      email: body.adminEmail,
      displayName: body.adminDisplayName,
      role: "admin",
      isApproved: true,
      requestStatus: "approved",
      authProvider: "local",
      passwordHash,
    });

    await store.writeAuditLog(tenantId, {
      userId: req.session.user?.id ?? adminUser.id,
      action: "hospital_admin_created",
      resourceType: "user",
      resourceId: adminUser.id,
      details: { email: body.adminEmail },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      admin: {
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        displayName: adminUser.display_name,
      },
    });
  }));

  router.get("/monitoring/overview", asyncHandler(async (req: Request, res: Response) => {
    if (!assertPlatformAccess(req, res)) return;
    const tenantsSnapshot = await db.collection("tenants_meta").get();
    let activeTenants = 0;
    let suspendedTenants = 0;
    let totalUsers = 0;
    let totalHospitalAdmins = 0;
    let totalPendingApprovals = 0;
    let totalStudies = 0;

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantData = tenantDoc.data() as { is_active?: boolean };
      if (tenantData.is_active === false) suspendedTenants += 1;
      else activeTenants += 1;

      const usersSnapshot = await db.collection("tenants").doc(tenantDoc.id).collection("users").get();
      const studiesSnapshot = await db.collection("tenants").doc(tenantDoc.id).collection("studies").get();
      totalUsers += usersSnapshot.size;
      totalStudies += studiesSnapshot.size;

      usersSnapshot.docs.forEach((userDoc) => {
        const user = userDoc.data() as { role?: string; request_status?: string };
        if (user.role === "admin") totalHospitalAdmins += 1;
        if (user.request_status === "pending") totalPendingApprovals += 1;
      });
    }

    res.json({
      totalTenants: tenantsSnapshot.size,
      activeTenants,
      suspendedTenants,
      totalUsers,
      totalHospitalAdmins,
      totalPendingApprovals,
      totalStudies,
      updatedAt: new Date().toISOString(),
    });
  }));

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
    const userId = firstValue(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

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
