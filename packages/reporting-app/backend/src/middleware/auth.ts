import { NextFunction, Request, Response } from "express";
import type { Permission, UserRole } from "@medical-report-system/shared";
import { env } from "../config/env";
import { hipaaConfig } from "../config/hipaaConfig";
import { resolvePermissions } from "../services/permissions";
import { logger } from "../services/logger";
import type { StoreService } from "../services/store";
import type { InMemoryStoreService } from "../services/inMemoryStore";

export function ensureAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!env.ENABLE_AUTH) {
    if (!req.session.user) {
      req.session.user = {
        id: `dev-${env.DEFAULT_DEV_ROLE}`,
        email: `${env.DEFAULT_DEV_ROLE}@example.com`,
        role: env.DEFAULT_DEV_ROLE,
        approved: true,
        requestStatus: "approved",
        displayName: `Local ${env.DEFAULT_DEV_ROLE}`,
      };
    }
    (req.session as any).lastActivity = Date.now();
    next();
    return;
  }

  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const lastActivity = (req.session as any).lastActivity as number | undefined;
  const now = Date.now();
  if (lastActivity && now - lastActivity > hipaaConfig.sessionTimeoutMs) {
    const userId = req.session.user.id;
    logger.info({
      message: "HIPAA automatic session timeout",
      userId,
      inactiveMs: now - lastActivity,
    });
    req.session.destroy(() => {});
    res.status(440).json({
      error: "Session expired due to inactivity",
      code: "SESSION_TIMEOUT",
    });
    return;
  }

  (req.session as any).lastActivity = now;

  if (req.session.user.approved === false) {
    res.status(403).json({ error: "Pending approval" });
    return;
  }
  next();
}

export function ensureRole(...roles: Array<"super_admin" | "admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session.user || !roles.includes(req.session.user.role as typeof roles[number])) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Middleware factory that checks granular permissions.
 * Resolves the user's effective permissions (defaults + any admin overrides)
 * and verifies the user holds at least one of the required permissions.
 */
export function ensurePermission(store: StoreService | InMemoryStoreService, ...required: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const role = req.session.user.role as UserRole;

    if (role === "admin" || role === "super_admin") {
      next();
      return;
    }

    let effective: Permission[];
    try {
      const override = await store.getRolePermissions(role);
      effective = resolvePermissions(role, override);
    } catch (error) {
      // Degrade gracefully when remote permission overrides are unavailable
      // (e.g. missing Firestore credentials in local/docker environments).
      logger.warn({
        message: "Role permission lookup failed, falling back to default permissions",
        role,
        requiredPermissions: required,
        error: String(error),
      });
      effective = resolvePermissions(role, null);
    }

    const granted = required.some((p) => effective.includes(p));
    if (!granted) {
      logger.warn({
        message: "Permission denied",
        userId: req.session.user.id,
        role,
        requiredPermissions: required,
        effectivePermissionCount: effective.length,
        path: req.path,
        method: req.method,
      });
      res.status(403).json({ error: "Forbidden — insufficient permissions" });
      return;
    }

    next();
  };
}

export const ensureRadiologist = ensureRole("radiologist", "admin", "super_admin");
export const ensureAdmin = ensureRole("admin", "super_admin");
export const ensureSuperAdmin = ensureRole("super_admin");
