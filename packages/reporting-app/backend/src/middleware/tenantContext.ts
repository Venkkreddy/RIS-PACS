import { NextFunction, Request, Response } from "express";
import { JwtService, TenantTokenPayload } from "../services/jwtService";
import { getFirestore } from "../services/firebaseAdmin";
import { logger } from "../services/logger";

export interface TenantRequest extends Request {
  tenant: {
    id: string;
    slug: string;
    name: string;
    aeTitle: string;
    storagePath: string;
    config: Record<string, unknown>;
  };
  tokenPayload: TenantTokenPayload;
}

interface CachedTenant {
  id: string;
  slug: string;
  name: string;
  ae_title: string;
  storage_path: string;
  config: Record<string, unknown>;
  is_active: boolean;
}

const tenantCache = new Map<string, { tenant: CachedTenant; ts: number }>();
const CACHE_TTL = 60_000;

async function resolveTenant(tenantId: string): Promise<CachedTenant | null> {
  const cached = tenantCache.get(tenantId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.tenant;

  const db = getFirestore();
  const doc = await db.collection("tenants_meta").doc(tenantId).get();

  if (!doc.exists) return null;

  const data = doc.data()!;
  const tenant: CachedTenant = {
    id: doc.id,
    slug: data.slug,
    name: data.name,
    ae_title: data.ae_title,
    storage_path: data.storage_path ?? `/storage/${doc.id}`,
    config: data.config ?? {},
    is_active: data.is_active ?? true,
  };

  tenantCache.set(tenantId, { tenant, ts: Date.now() });
  return tenant;
}

export function clearTenantCache(): void {
  tenantCache.clear();
}

export function tenantContextMiddleware(jwtService: JwtService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header" });
      return;
    }

    const token = authHeader.slice(7);
    let payload: TenantTokenPayload;

    try {
      payload = jwtService.verifyAccessToken(token);
    } catch (err) {
      const message = err instanceof Error && err.name === "TokenExpiredError"
        ? "Token expired"
        : "Invalid token";
      res.status(401).json({ error: message });
      return;
    }

    let tenant: CachedTenant | null;
    try {
      tenant = await resolveTenant(payload.tid);
    } catch (err) {
      logger.error({ message: "Tenant resolution failed", error: String(err), tenantId: payload.tid });
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!tenant) {
      res.status(403).json({ error: "Tenant not found" });
      return;
    }

    if (!tenant.is_active) {
      res.status(403).json({ error: "Tenant account is suspended" });
      return;
    }

    const tenantReq = req as TenantRequest;
    tenantReq.tenant = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      aeTitle: tenant.ae_title,
      storagePath: tenant.storage_path ?? `/storage/${tenant.id}`,
      config: tenant.config,
    };
    tenantReq.tokenPayload = payload;

    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantReq = req as TenantRequest;
    if (!tenantReq.tokenPayload) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(tenantReq.tokenPayload.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

export function enforceTenantMatch(paramName: string = "tenantSlug") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantReq = req as TenantRequest;
    const urlTenantSlug = req.params[paramName];

    if (urlTenantSlug && tenantReq.tenant && urlTenantSlug !== tenantReq.tenant.slug) {
      logger.warn({
        message: "Tenant mismatch: URL tenant does not match token tenant",
        urlTenant: urlTenantSlug,
        tokenTenant: tenantReq.tenant.slug,
        userId: tenantReq.tokenPayload?.sub,
      });
      res.status(403).json({ error: "Access denied: tenant mismatch" });
      return;
    }

    next();
  };
}
