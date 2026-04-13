import { Router } from "express";
import { z } from "zod";
import type { UserRole, Permission } from "@medical-report-system/shared";
import { ALL_PERMISSIONS } from "@medical-report-system/shared";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensureAdmin } from "../middleware/auth";
import { StoreService } from "../services/store";
import { DEFAULT_PERMISSIONS, resolvePermissions } from "../services/permissions";
import { logger } from "../services/logger";

const VALID_ROLES: UserRole[] = ["super_admin", "admin", "developer", "radiologist", "radiographer", "billing", "referring", "receptionist", "viewer"];

const updatePermissionsSchema = z.object({
  permissions: z.array(z.string()),
});

export function permissionsRouter(store: StoreService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensureAdmin, asyncHandler(async (_req, res) => {
    const overrides = await store.getAllRolePermissions();
    const overrideMap = new Map(overrides.map((o) => [o.role, o]));

    const result = VALID_ROLES.map((role) => {
      const override = overrideMap.get(role) ?? null;
      return {
        role,
        permissions: resolvePermissions(role, override),
        isCustomized: override?.isCustomized ?? false,
        updatedAt: override?.updatedAt ?? null,
        updatedBy: override?.updatedBy ?? null,
      };
    });

    res.json({ roles: result, allPermissions: ALL_PERMISSIONS });
  }));

  router.put("/:role", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const role = req.params.role as UserRole;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}` });
      return;
    }
    if (role === "admin" || role === "super_admin") {
      res.status(400).json({ error: "Cannot modify admin platform permissions" });
      return;
    }

    const body = updatePermissionsSchema.parse(req.body);
    const validPerms = body.permissions.filter((p) =>
      (ALL_PERMISSIONS as readonly string[]).includes(p),
    ) as Permission[];

    const record = await store.setRolePermissions(role, validPerms, req.session.user!.id);
    res.json(record);
  }));

  router.post("/:role/reset", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const role = req.params.role as UserRole;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}` });
      return;
    }

    await store.resetRolePermissions(role);
    res.json({
      role,
      permissions: DEFAULT_PERMISSIONS[role],
      isCustomized: false,
    });
  }));

  router.get("/my-permissions", ensureAuthenticated, asyncHandler(async (req, res) => {
    const role = req.session.user!.role as UserRole;
    let override = null;
    try {
      override = await store.getRolePermissions(role);
    } catch (error) {
      logger.warn({
        message: "Failed to load role permission override, using defaults",
        role,
        error: String(error),
      });
    }
    const permissions = resolvePermissions(role, override);
    res.json({ role, permissions });
  }));

  return router;
}
