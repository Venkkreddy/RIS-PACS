import { NextFunction, Request, Response } from "express";
import { TenantRequest } from "./tenantContext";
import { getFirestore } from "../services/firebaseAdmin";
import { logger } from "../services/logger";

/**
 * IDOR Prevention: Validates that a referenced resource belongs to the
 * requesting tenant before allowing access.
 */
export function validateResourceOwnership(collectionName: string, paramName: string) {
  const allowedCollections = new Set([
    "users", "patients", "studies", "reports", "templates",
    "orders", "billing", "referring_physicians", "role_permissions",
  ]);

  if (!allowedCollections.has(collectionName)) {
    throw new Error(`validateResourceOwnership: unknown collection "${collectionName}"`);
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantReq = req as TenantRequest;
    const rawResourceId = req.params[paramName];
    const resourceId = Array.isArray(rawResourceId) ? rawResourceId[0] : rawResourceId;

    if (!resourceId || !tenantReq.tenant?.id) {
      res.status(400).json({ error: "Missing resource ID or tenant context" });
      return;
    }

    try {
      const db = getFirestore();
      const doc = await db
        .collection("tenants")
        .doc(tenantReq.tenant.id)
        .collection(collectionName)
        .doc(resourceId)
        .get();

      if (!doc.exists) {
        logger.warn({
          message: "IDOR attempt: resource not found for tenant",
          collection: collectionName,
          resourceId,
          tenantId: tenantReq.tenant.id,
          userId: tenantReq.tokenPayload?.sub,
          ip: req.ip,
        });
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      next();
    } catch (err) {
      logger.error({ message: "Resource ownership check failed", error: String(err) });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

/**
 * Study-level DICOM access guard: ensures the study UID belongs to the tenant.
 */
export function validateStudyAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantReq = req as TenantRequest;
    const studyUID = req.params.studyUID;

    if (!studyUID) {
      next();
      return;
    }

    if (!tenantReq.tenant?.id) {
      res.status(401).json({ error: "Tenant context required" });
      return;
    }

    try {
      const db = getFirestore();
      const snapshot = await db
        .collection("tenants")
        .doc(tenantReq.tenant.id)
        .collection("studies")
        .where("study_instance_uid", "==", studyUID)
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.warn({
          message: "Unauthorized DICOM study access attempt",
          studyUID,
          tenantId: tenantReq.tenant.id,
          userId: tenantReq.tokenPayload?.sub,
          ip: req.ip,
        });
        res.status(404).json({ error: "Study not found" });
        return;
      }

      next();
    } catch (err) {
      logger.error({ message: "Study access validation failed", error: String(err) });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

/**
 * Request body tenant injection: automatically sets tenant_id in the request
 * body for create/update operations.
 */
export function injectTenantId() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const tenantReq = req as TenantRequest;
    if (tenantReq.tenant?.id && req.body && typeof req.body === "object") {
      req.body.tenant_id = tenantReq.tenant.id;
      delete req.body.tenantId;
    }
    next();
  };
}

/**
 * Rate limiting per tenant: prevents one tenant from monopolizing resources.
 */
export function perTenantRateLimit(opts: { windowMs: number; maxRequests: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenant?.id;
    if (!tenantId) { next(); return; }

    const now = Date.now();
    let window = windows.get(tenantId);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + opts.windowMs };
      windows.set(tenantId, window);
    }

    window.count++;

    if (window.count > opts.maxRequests) {
      res.status(429).json({ error: "Tenant rate limit exceeded" });
      return;
    }

    res.setHeader("X-Tenant-RateLimit-Remaining", String(opts.maxRequests - window.count));
    next();
  };
}
