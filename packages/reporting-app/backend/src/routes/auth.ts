import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { getFirebaseAuth } from "../services/firebaseAdmin";
import { StoreService, UserRecord } from "../services/store";

const firebaseLoginSchema = z.object({
  idToken: z.string().min(10),
});

const roleSchema = z.object({
  role: z.enum(["radiographer", "radiologist", "referring", "billing", "receptionist"]).default("radiographer"),
});

export function authRouter(store: StoreService): Router {
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
        role: "admin" | "viewer";
        displayName?: string;
        approved?: boolean;
      };

      const user = await store.upsertUser({
        id: profile.id,
        email: profile.email.toLowerCase(),
        displayName: profile.displayName,
        role: profile.role === "admin" ? "admin" : "radiographer",
        approved: profile.role === "admin" || !!profile.approved,
        requestStatus: profile.role === "admin" ? "approved" : "pending",
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
    const decodedToken = await firebaseAuth.verifyIdToken(body.idToken);

    const email = (decodedToken.email ?? "").toLowerCase();
    if (!email) throw new Error("Unauthorized");

    const admin = isMasterAdmin(email);
    const existing = (await store.getUserById(decodedToken.uid)) ?? (await store.getUserByEmail(email));
    const provider = typeof decodedToken.firebase?.sign_in_provider === "string" ? decodedToken.firebase.sign_in_provider : "password";

    const user: UserRecord = await store.upsertUser({
      id: decodedToken.uid,
      email,
      displayName: decodedToken.name ?? existing?.displayName,
      role: admin ? "admin" : (existing?.role ?? "radiographer"),
      approved: admin ? true : (existing?.approved ?? false),
      requestStatus: admin ? "approved" : (existing?.requestStatus ?? "pending"),
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

    res.json({ user: req.session.user });
  }));

  router.post("/register-request", asyncHandler(async (req, res) => {
    const body = roleSchema.parse(req.body);
    const user = req.session.user;
    if (!user) throw new Error("Unauthorized");
    if (isMasterAdmin(user.email)) {
      res.json({ message: "Master admin account is auto-approved" });
      return;
    }

    const updated = await store.upsertUser({
      id: user.id,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      role: body.role,
      approved: false,
      requestStatus: "pending",
      authProvider: "password",
    });

    req.session.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: updated.role,
      approved: updated.approved,
      requestStatus: updated.requestStatus,
    };

    res.json({ message: "Registration request submitted", user: req.session.user });
  }));

  router.post("/dev-login", asyncHandler(async (req, res) => {
    if (env.NODE_ENV === "production") {
      res.status(403).json({ error: "Quick access is disabled in production" });
      return;
    }

    const role = req.body.role ?? env.DEFAULT_DEV_ROLE;
    const validRoles = ["admin", "developer", "radiographer", "radiologist", "referring", "billing", "receptionist", "viewer"];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const devUser = {
      id: `dev-${role}`,
      email: `${role}@example.com`,
      role: role as "admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer",
      displayName: `Dev ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      approved: true,
      requestStatus: "approved" as const,
    };

    req.session.user = devUser;
    res.json({ user: devUser });
  }));

  router.get("/me", (req, res) => res.json({ user: req.session.user ?? null }));

  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  router.get("/failure", (_req, res) => {
    res.status(401).json({ error: "OAuth failure" });
  });

  return router;
}
