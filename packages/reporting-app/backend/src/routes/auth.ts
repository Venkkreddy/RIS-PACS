import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { getClientIp, getUserAgent, hipaaAccountLockout } from "../middleware/hipaaMiddleware";
import { getFirebaseAuth } from "../services/firebaseAdmin";
import { HipaaAuditService } from "../services/hipaaAuditService";
import { StoreService, UserRecord } from "../services/store";

const lockout = hipaaAccountLockout();

const DEMO_EMAIL_ROLE_MAP: Record<string, UserRecord["role"]> = {
  "super_admin@example.com": "super_admin",
  "superadmin@example.com": "super_admin",
  "admin@example.com": "admin",
  "developer@example.com": "developer",
  "radiologist@example.com": "radiologist",
  "radiographer@example.com": "radiographer",
  "referring@example.com": "referring",
  "billing@example.com": "billing",
  "receptionist@example.com": "receptionist",
  "viewer@example.com": "viewer",
  // Backward-compatible aliases from older demo seed.
  "superadmin.demo@example.com": "super_admin",
  "admin.demo@example.com": "admin",
  "developer.demo@example.com": "developer",
  "radiologist.demo@example.com": "radiologist",
  "radiographer.demo@example.com": "radiographer",
  "referring.demo@example.com": "referring",
  "billing.demo@example.com": "billing",
  "receptionist.demo@example.com": "receptionist",
  "viewer.demo@example.com": "viewer",
};

function roleFromDemoEmail(email: string): UserRecord["role"] | null {
  return DEMO_EMAIL_ROLE_MAP[email.toLowerCase()] ?? null;
}

const firebaseLoginSchema = z.object({
  idToken: z.string().min(10),
});

const roleSchema = z.object({
  role: z.enum(["radiographer", "radiologist", "referring", "billing", "receptionist"]).default("radiographer"),
});

export function authRouter(store: StoreService, hipaaAudit?: HipaaAuditService): Router {
  const router = Router();
  const masterAdmins = env.MASTER_ADMIN_EMAILS.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const isMasterAdmin = (email: string) => masterAdmins.includes(email.toLowerCase());

  router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/auth/failure" }),
    asyncHandler(async (req, res) => {
      const profile = req.user as {
        id: string;
        email: string;
        role: "super_admin" | "viewer";
        displayName?: string;
        approved?: boolean;
      };
      const normalizedEmail = profile.email.toLowerCase();
      const existing = await store.getUserByEmail(normalizedEmail);
      const demoRole = roleFromDemoEmail(normalizedEmail);
      const resolvedRole = profile.role === "super_admin" ? "super_admin" : (demoRole ?? existing?.role ?? "viewer");
      const resolvedRequestStatus =
        profile.role === "super_admin" || demoRole
          ? "approved"
          : (existing?.requestStatus ?? (profile.approved ? "approved" : "pending"));
      const resolvedApproved = profile.role === "super_admin" || !!demoRole ? true : resolvedRequestStatus !== "rejected";

      const user = await store.upsertUser({
        id: existing?.id ?? profile.id,
        email: normalizedEmail,
        displayName: profile.displayName,
        role: resolvedRole,
        approved: resolvedApproved,
        requestStatus: resolvedRequestStatus,
        authProvider: "google",
      });

      req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        approved: user.approved,
        requestStatus: user.requestStatus,
      };
      res.redirect(env.FRONTEND_URL);
    }),
  );

  router.post("/firebase-login", asyncHandler(async (req, res) => {
    const body = firebaseLoginSchema.parse(req.body);
    const firebaseAuth = getFirebaseAuth();

    let decodedToken;
    try {
      decodedToken = await firebaseAuth.verifyIdToken(body.idToken);
    } catch {
      const ip = getClientIp(req);
      hipaaAudit?.log({
        action: "LOGIN_FAILURE",
        severity: "warning",
        userId: "unknown",
        userEmail: "unknown",
        userRole: "unauthenticated",
        ipAddress: ip,
        userAgent: getUserAgent(req),
        resourceType: "patient",
        resourceId: "auth",
        description: "Failed Firebase login — invalid token",
        httpMethod: "POST",
        httpPath: "/auth/firebase-login",
        httpStatus: 401,
        phiAccessed: false,
      });
      throw new Error("Unauthorized");
    }

    const email = (decodedToken.email ?? "").toLowerCase();
    if (!email) throw new Error("Unauthorized");

    if (lockout.isLocked(email)) {
      hipaaAudit?.log({
        action: "LOGIN_FAILURE",
        severity: "critical",
        userId: "unknown",
        userEmail: email,
        userRole: "unauthenticated",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        resourceType: "patient",
        resourceId: "auth",
        description: `Login blocked — account locked due to repeated failures`,
        httpMethod: "POST",
        httpPath: "/auth/firebase-login",
        httpStatus: 423,
        phiAccessed: false,
      });
      res.status(423).json({ error: "Account temporarily locked due to repeated failed login attempts" });
      return;
    }

    lockout.clearAttempts(email);

    const superAdmin = isMasterAdmin(email);
    const existingByUid = await store.getUserById(decodedToken.uid);
    const existingByEmail = existingByUid ? null : await store.getUserByEmail(email);
    const existing = existingByUid ?? existingByEmail;
    const demoRole = roleFromDemoEmail(email);
    const provider = typeof decodedToken.firebase?.sign_in_provider === "string" ? decodedToken.firebase.sign_in_provider : "password";
    const resolvedRole = superAdmin ? "super_admin" : (demoRole ?? existing?.role ?? "viewer");
    const resolvedRequestStatus = superAdmin || demoRole ? "approved" : (existing?.requestStatus ?? "pending");
    const resolvedApproved = superAdmin || !!demoRole ? true : resolvedRequestStatus !== "rejected";
    const resolvedUserId = existing?.id ?? decodedToken.uid;

    const user: UserRecord = await store.upsertUser({
      id: resolvedUserId,
      email,
      displayName: decodedToken.name ?? existing?.displayName,
      role: resolvedRole,
      approved: resolvedApproved,
      requestStatus: resolvedRequestStatus,
      authProvider: provider,
    });

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      approved: user.approved,
      requestStatus: user.requestStatus,
    };

    hipaaAudit?.log({
      action: "LOGIN_SUCCESS",
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      resourceType: "patient",
      resourceId: "auth",
      description: `Successful login via ${provider}`,
      httpMethod: "POST",
      httpPath: "/auth/firebase-login",
      httpStatus: 200,
      phiAccessed: false,
    });

    res.json({ user: req.session.user });
  }));

  router.post("/register-request", asyncHandler(async (req, res) => {
    roleSchema.parse(req.body);
    const user = req.session.user;
    if (!user) throw new Error("Unauthorized");
    if (isMasterAdmin(user.email)) {
      res.json({ message: "Master admin account is auto-approved" });
      return;
    }

    const existing = (await store.getUserById(user.id)) ?? (await store.getUserByEmail(user.email.toLowerCase()));
    const resolvedRole = existing?.role ?? "viewer";

    const updated = await store.upsertUser({
      id: existing?.id ?? user.id,
      email: user.email.toLowerCase(),
      displayName: user.displayName ?? existing?.displayName,
      role: resolvedRole,
      approved: true,
      requestStatus: "pending",
      authProvider: existing?.authProvider ?? "password",
    });

    req.session.user = {
      id: updated.id,
      email: user.email,
      displayName: user.displayName,
      role: updated.role,
      approved: updated.approved,
      requestStatus: updated.requestStatus,
    };

    res.json({ message: "Access request noted. Admin can now assign role for this email.", user: req.session.user });
  }));

  router.get("/me", asyncHandler(async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      res.json({ user: null });
      return;
    }

    let fullUser: UserRecord | null = null;
    // Local auth-disabled sessions (dev-* IDs) and degraded environments may not have
    // a durable user record. Keep session auth functional if profile lookup fails.
    if (!sessionUser.id.startsWith("dev-")) {
      try {
        fullUser = await store.getUserById(sessionUser.id);
      } catch {
        fullUser = null;
      }
    }

    res.json({
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        role: sessionUser.role,
        approved: sessionUser.approved,
        requestStatus: sessionUser.requestStatus,
        displayName: fullUser?.displayName ?? sessionUser.displayName,
        phone: fullUser?.phone,
        department: fullUser?.department,
        createdAt: fullUser?.createdAt,
      },
    });
  }));

  router.patch("/profile", asyncHandler(async (req, res) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const profileSchema = z.object({
      displayName: z.string().min(1).max(100).optional(),
      phone: z.string().max(30).optional(),
      department: z.string().max(100).optional(),
    });

    const body = profileSchema.parse(req.body);
    const updated = await store.updateUserProfile(user.id, body);

    req.session.user = {
      ...user,
      displayName: updated.displayName,
    };

    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        approved: updated.approved,
        requestStatus: updated.requestStatus,
        displayName: updated.displayName,
        phone: updated.phone,
        department: updated.department,
        createdAt: updated.createdAt,
      },
    });
  }));

  router.post("/logout", (req, res) => {
    const user = req.session.user;
    if (user) {
      hipaaAudit?.log({
        action: "LOGOUT",
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        resourceType: "patient",
        resourceId: "auth",
        description: "User logged out",
        httpMethod: "POST",
        httpPath: "/auth/logout",
        httpStatus: 200,
        phiAccessed: false,
      });
    }
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  router.get("/failure", (_req, res) => {
    res.status(401).json({ error: "OAuth failure" });
  });

  return router;
}
