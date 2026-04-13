import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../middleware/asyncHandler";
import { JwtService } from "../services/jwtService";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { getFirestore } from "../services/firebaseAdmin";
import { tenantContextMiddleware, TenantRequest } from "../middleware/tenantContext";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  role: z.enum(["radiographer", "radiologist", "referring", "billing", "receptionist"]).default("radiographer"),
  tenantSlug: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export function tenantAuthRouter(store: TenantScopedStore, jwtService: JwtService): Router {
  const router = Router();
  const db = getFirestore();

  async function getTenantBySlug(slug: string) {
    const snapshot = await db.collection("tenants_meta").where("slug", "==", slug).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as {
      id: string; slug: string; name: string; ae_title: string;
      is_active: boolean; max_users?: number;
    };
  }

  router.post("/login", asyncHandler(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);

    const tenant = await getTenantBySlug(body.tenantSlug);
    if (!tenant) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!tenant.is_active) {
      res.status(403).json({ error: "Tenant account is suspended" });
      return;
    }

    const user = await store.getUserByEmail(tenant.id, body.email);
    if (!user || !user.password_hash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const passwordValid = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordValid) {
      await store.writeAuditLog(tenant.id, {
        userId: user.id,
        action: "login_failed",
        details: { reason: "invalid_password" },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.is_approved) {
      res.status(403).json({ error: "Account pending approval" });
      return;
    }

    const tokens = jwtService.generateTokenPair({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant.slug,
    });

    await jwtService.storeRefreshToken(tenant.id, user.id, tokens.refreshToken);

    await store.writeAuditLog(tenant.id, {
      userId: user.id,
      action: "login_success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
      },
    });
  }));

  router.post("/register", asyncHandler(async (req: Request, res: Response) => {
    const body = registerSchema.parse(req.body);

    const tenant = await getTenantBySlug(body.tenantSlug);
    if (!tenant) {
      res.status(400).json({ error: "Invalid tenant" });
      return;
    }

    if (!tenant.is_active) {
      res.status(403).json({ error: "Tenant registration is closed" });
      return;
    }

    const existing = await store.getUserByEmail(tenant.id, body.email);
    if (existing) {
      res.status(409).json({ error: "Email already registered for this organization" });
      return;
    }

    if (tenant.max_users) {
      const users = await store.listUsers(tenant.id);
      if (users.length >= tenant.max_users) {
        res.status(403).json({ error: "Organization user limit reached" });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await store.upsertUser(tenant.id, {
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      isApproved: false,
      requestStatus: "pending",
      authProvider: "local",
      passwordHash,
    });

    await store.writeAuditLog(tenant.id, {
      userId: user.id,
      action: "user_registered",
      details: { role: body.role },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      message: "Registration submitted. Pending admin approval.",
      user: { id: user.id, email: user.email, role: user.role },
    });
  }));

  router.post("/refresh", asyncHandler(async (req: Request, res: Response) => {
    const body = refreshSchema.parse(req.body);

    let decoded: { sub: string; tid: string };
    try {
      decoded = jwtService.verifyRefreshToken(body.refreshToken);
    } catch {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    const valid = await jwtService.validateRefreshToken(decoded.tid, decoded.sub, body.refreshToken);
    if (!valid) {
      res.status(401).json({ error: "Refresh token revoked or expired" });
      return;
    }

    const user = await store.getUserById(decoded.tid, decoded.sub);
    if (!user || !user.is_approved) {
      res.status(401).json({ error: "User not found or not approved" });
      return;
    }

    const tenantDoc = await db.collection("tenants_meta").doc(decoded.tid).get();
    if (!tenantDoc.exists || !(tenantDoc.data() as { is_active: boolean }).is_active) {
      res.status(403).json({ error: "Tenant suspended" });
      return;
    }
    const tenantData = tenantDoc.data() as { slug: string };

    await jwtService.revokeRefreshToken(decoded.tid, body.refreshToken);

    const tokens = jwtService.generateTokenPair({
      userId: user.id,
      tenantId: decoded.tid,
      email: user.email,
      role: user.role,
      tenantSlug: tenantData.slug,
    });

    await jwtService.storeRefreshToken(decoded.tid, user.id, tokens.refreshToken);

    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  }));

  router.post("/logout",
    tenantContextMiddleware(jwtService),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const { refreshToken } = req.body;

      if (refreshToken) {
        await jwtService.revokeRefreshToken(tenantReq.tenant.id, refreshToken);
      }

      await jwtService.revokeAllUserTokens(tenantReq.tenant.id, tenantReq.tokenPayload.sub);

      await store.writeAuditLog(tenantReq.tenant.id, {
        userId: tenantReq.tokenPayload.sub,
        action: "logout",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ ok: true });
    }),
  );

  router.get("/me",
    tenantContextMiddleware(jwtService),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;

      const user = await store.getUserById(tenantReq.tenant.id, tenantReq.tokenPayload.sub);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.display_name,
          isApproved: user.is_approved,
        },
        tenant: {
          id: tenantReq.tenant.id,
          name: tenantReq.tenant.name,
          slug: tenantReq.tenant.slug,
        },
      });
    }),
  );

  return router;
}
