import { NextFunction, Request, Response } from "express";
import type { Permission, UserRole } from "@medical-report-system/shared";
import { env } from "../config/env";
import { resolvePermissions } from "../services/permissions";
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
    next();
    return;
  }

  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.session.user.approved === false) {
    res.status(403).json({ error: "Pending approval" });
    return;
  }
  next();
}

export function ensureRole(...roles: Array<"admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer">) {
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

    if (role === "admin") {
      next();
      return;
    }

    try {
      const override = await store.getRolePermissions(role);
      const effective = resolvePermissions(role, override);
      const granted = required.some((p) => effective.includes(p));

      if (!granted) {
        res.status(403).json({ error: "Forbidden — insufficient permissions" });
        return;
      }

      next();
    } catch {
      res.status(500).json({ error: "Failed to resolve permissions" });
    }
  };
}

export const ensureRadiologist = ensureRole("radiologist", "admin");
export const ensureAdmin = ensureRole("admin");
