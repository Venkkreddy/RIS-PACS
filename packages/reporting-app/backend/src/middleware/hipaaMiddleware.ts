import { NextFunction, Request, Response } from "express";
import { hipaaConfig } from "../config/hipaaConfig";
import { HipaaAuditService, PhiCategory } from "../services/hipaaAuditService";
import { logger } from "../services/logger";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

function getUserAgent(req: Request): string {
  return (req.headers["user-agent"] ?? "unknown").slice(0, 500);
}

function resolvePhiCategory(path: string): PhiCategory | null {
  if (/^\/patients/.test(path)) return "patient";
  if (/^\/reports/.test(path)) return "report";
  if (/^\/worklist/.test(path)) return "study";
  if (/^\/orders/.test(path)) return "order";
  if (/^\/scans/.test(path)) return "scan";
  if (/^\/billing/.test(path)) return "billing";
  if (/^\/(dicom|dicomweb|dicom-web|wado)/.test(path)) return "dicom";
  if (/^\/referring-physicians/.test(path)) return "referring_physician";
  if (/^\/ai\/(analyze|results)/.test(path)) return "study";
  if (/^\/api\/v1\/dicomweb/.test(path)) return "dicom";
  return null;
}

function resolvePhiAction(method: string): "view" | "create" | "update" | "delete" | "export" {
  switch (method.toUpperCase()) {
    case "GET":
      return "view";
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "view";
  }
}

function extractResourceId(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) return segments[segments.length - 1];
  return "collection";
}

export function hipaaPhiAccessLogger(auditService: HipaaAuditService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hipaaConfig.audit.enabled) {
      next();
      return;
    }

    const phiCategory = resolvePhiCategory(req.path);
    if (!phiCategory) {
      next();
      return;
    }

    const startTime = Date.now();

    res.on("finish", () => {
      const user = req.session?.user;
      if (!user && res.statusCode !== 401 && res.statusCode !== 403) {
        return;
      }

      const userId = user?.id ?? "anonymous";
      const userEmail = user?.email ?? "unknown";
      const userRole = user?.role ?? "unauthenticated";

      auditService.logPhiAccess({
        userId,
        userEmail,
        userRole,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        resourceType: phiCategory,
        resourceId: extractResourceId(req.path),
        tenantId: (req as any).tenantId,
        action: resolvePhiAction(req.method),
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: res.statusCode,
        metadata: {
          durationMs: Date.now() - startTime,
          queryParams: Object.keys(req.query),
        },
      }).catch((err) => {
        logger.error({ message: "Failed to write PHI audit log", error: String(err) });
      });
    });

    next();
  };
}

export function hipaaSessionTimeout() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.user) {
      next();
      return;
    }

    const lastActivity = (req.session as any).lastActivity as number | undefined;
    const now = Date.now();

    if (lastActivity && now - lastActivity > hipaaConfig.sessionTimeoutMs) {
      const userId = req.session.user.id;
      const userEmail = req.session.user.email;

      req.session.destroy((err) => {
        if (err) {
          logger.error({ message: "Session destroy error during timeout", error: String(err) });
        }
      });

      logger.info({
        message: "HIPAA session timeout — automatic logoff",
        userId,
        userEmail,
        inactiveMs: now - (lastActivity ?? now),
      });

      res.status(440).json({
        error: "Session expired due to inactivity",
        code: "SESSION_TIMEOUT",
      });
      return;
    }

    (req.session as any).lastActivity = now;
    next();
  };
}

const failedLoginAttempts = new Map<string, { count: number; lockedUntil?: number }>();

export function hipaaAccountLockout() {
  return {
    recordFailedAttempt(identifier: string): { locked: boolean; attemptsRemaining: number } {
      const entry = failedLoginAttempts.get(identifier) ?? { count: 0 };

      if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
        return { locked: true, attemptsRemaining: 0 };
      }

      if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
        entry.count = 0;
        entry.lockedUntil = undefined;
      }

      entry.count++;

      if (entry.count >= hipaaConfig.maxFailedLoginAttempts) {
        entry.lockedUntil = Date.now() + hipaaConfig.lockoutDurationMs;
        failedLoginAttempts.set(identifier, entry);
        return { locked: true, attemptsRemaining: 0 };
      }

      failedLoginAttempts.set(identifier, entry);
      return {
        locked: false,
        attemptsRemaining: hipaaConfig.maxFailedLoginAttempts - entry.count,
      };
    },

    clearAttempts(identifier: string): void {
      failedLoginAttempts.delete(identifier);
    },

    isLocked(identifier: string): boolean {
      const entry = failedLoginAttempts.get(identifier);
      if (!entry?.lockedUntil) return false;
      if (Date.now() >= entry.lockedUntil) {
        failedLoginAttempts.delete(identifier);
        return false;
      }
      return true;
    },
  };
}

export function hipaaRequireHttps() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hipaaConfig.encryption.requireTLS) {
      next();
      return;
    }

    const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
    if (proto !== "https") {
      res.status(403).json({
        error: "HTTPS required — HIPAA mandates encryption in transit",
        code: "TLS_REQUIRED",
      });
      return;
    }

    next();
  };
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const policy = hipaaConfig.passwordPolicy;

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return { valid: errors.length === 0, errors };
}

export { getClientIp, getUserAgent };
