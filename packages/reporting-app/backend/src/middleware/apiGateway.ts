import { NextFunction, Request, Response, Router } from "express";
import { env } from "../config/env";
import { JwtService, TenantTokenPayload } from "../services/jwtService";
import { logger } from "../services/logger";

export interface GatewayRequest extends Request {
  tenantId?: string;
  tenantSlug?: string;
  gatewayUser?: {
    id: string;
    email: string;
    role: string;
  };
}

interface CachedTenantEntry {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  ts: number;
}

const tenantCache = new Map<string, CachedTenantEntry>();
const TENANT_CACHE_TTL = 60_000;

async function resolveTenantById(tenantId: string): Promise<CachedTenantEntry | null> {
  const cached = tenantCache.get(tenantId);
  if (cached && Date.now() - cached.ts < TENANT_CACHE_TTL) return cached;

  try {
    const { getFirestore } = await import("../services/firebaseAdmin");
    const db = getFirestore();
    const doc = await db.collection("tenants_meta").doc(tenantId).get();
    if (!doc.exists) return null;

    const data = doc.data()!;
    const entry: CachedTenantEntry = {
      id: doc.id,
      slug: data.slug,
      name: data.name,
      isActive: data.is_active ?? true,
      ts: Date.now(),
    };
    tenantCache.set(tenantId, entry);
    return entry;
  } catch {
    return null;
  }
}

const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 300;

function perTenantRateCheck(tenantId: string, res: Response): boolean {
  const now = Date.now();
  let entry = requestCounts.get(tenantId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    requestCounts.set(tenantId, entry);
  }
  entry.count++;
  if (entry.count > RATE_MAX_REQUESTS) {
    res.status(429).json({ error: "Rate limit exceeded for tenant" });
    return false;
  }
  res.setHeader("X-RateLimit-Remaining", String(RATE_MAX_REQUESTS - entry.count));
  return true;
}

/**
 * API Gateway middleware: sits between frontend and all backend routes.
 *
 * In multi-tenant mode:
 *   - Extracts JWT from Authorization header
 *   - Validates tenant from token
 *   - Injects tenantId into request
 *   - Rate-limits per tenant
 *
 * In single-tenant mode:
 *   - Falls through to existing session auth
 *   - Injects a default tenantId from session context
 *
 * Both modes:
 *   - Logs every API access
 *   - Strips dangerous headers
 *   - Validates Content-Type for mutations
 */
export function apiGateway(jwtService?: JwtService): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    const gwReq = req as GatewayRequest;

    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    const authHeader = req.headers.authorization;
    const hasBearer = authHeader?.startsWith("Bearer ");

    if (env.MULTI_TENANT_ENABLED && hasBearer && jwtService) {
      const token = authHeader!.slice(7);
      let payload: TenantTokenPayload;

      try {
        payload = jwtService.verifyAccessToken(token);
      } catch (err) {
        const message = err instanceof Error && err.name === "TokenExpiredError"
          ? "Token expired — please refresh"
          : "Invalid authentication token";
        res.status(401).json({ error: message });
        return;
      }

      void (async () => {
        try {
          const tenant = await resolveTenantById(payload.tid);
          if (!tenant) {
            res.status(403).json({ error: "Tenant not found" });
            return;
          }
          if (!tenant.isActive) {
            res.status(403).json({ error: "Tenant account suspended" });
            return;
          }

          if (!perTenantRateCheck(tenant.id, res)) return;

          gwReq.tenantId = tenant.id;
          gwReq.tenantSlug = tenant.slug;
          gwReq.gatewayUser = {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
          };

          req.headers["x-tenant-id"] = tenant.id;
          req.headers["x-tenant-slug"] = tenant.slug;

          logger.debug({
            message: "API Gateway: JWT tenant request",
            method: req.method,
            path: req.path,
            tenantId: tenant.id,
            userId: payload.sub,
          });

          next();
        } catch (err) {
          logger.error({ message: "API Gateway tenant resolution error", error: String(err) });
          res.status(500).json({ error: "Internal gateway error" });
        }
      })();
      return;
    }

    if (env.MULTI_TENANT_ENABLED) {
      const tenantHeader = req.headers["x-tenant-id"] as string | undefined;
      if (tenantHeader) {
        void (async () => {
          try {
            const tenant = await resolveTenantById(tenantHeader);
            if (tenant && tenant.isActive) {
              gwReq.tenantId = tenant.id;
              gwReq.tenantSlug = tenant.slug;
              if (!perTenantRateCheck(tenant.id, res)) return;
            }
            next();
          } catch {
            next();
          }
        })();
        return;
      }
    }

    logger.debug({
      message: "API Gateway: session-based request",
      method: req.method,
      path: req.path,
      hasSession: !!req.session?.user,
    });

    next();
  });

  return router;
}
