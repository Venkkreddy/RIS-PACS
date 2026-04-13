import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { logger } from "../services/logger";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function buildAllowedOrigins(): Set<string> {
  const configuredOrigins = [
    env.FRONTEND_URL,
    env.OHIF_BASE_URL,
    env.OHIF_PUBLIC_BASE_URL,
    ...(env.CORS_ALLOWED_ORIGINS?.split(",") ?? []),
  ];
  const normalizedOrigins = new Set<string>();

  for (const configuredOrigin of configuredOrigins) {
    if (!configuredOrigin) {
      continue;
    }

    const normalizedOrigin = normalizeOrigin(configuredOrigin);
    if (!normalizedOrigin) {
      logger.warn({
        message: "Ignoring invalid CORS origin configuration",
        origin: configuredOrigin,
      });
      continue;
    }

    normalizedOrigins.add(normalizedOrigin);

    const parsed = new URL(normalizedOrigin);
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      continue;
    }

    // Localhost and 127.0.0.1 are both common in local Docker/browser setups.
    // Expand loopback entries so either host/protocol works without manual tweaks.
    for (const protocol of ["http:", "https:"] as const) {
      for (const host of LOOPBACK_HOSTS) {
        const variant = new URL(`${protocol}//${host}`);
        if (parsed.port) {
          variant.port = parsed.port;
        }
        normalizedOrigins.add(variant.origin);
      }
    }
  }

  return normalizedOrigins;
}

const allowedOrigins = buildAllowedOrigins();

function isConfiguredOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  const normalizedOrigin = normalizeOrigin(origin);
  return normalizedOrigin ? allowedOrigins.has(normalizedOrigin) : false;
}

function isLocalDevOrigin(origin: string): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const isProduction = env.NODE_ENV === "production";

if (isProduction && env.CORS_ALLOW_ALL) {
  logger.warn({
    message: "HIPAA WARNING: CORS_ALLOW_ALL=true in production is non-compliant — wildcard CORS disabled",
  });
}

const corsMiddleware = (isProduction && env.CORS_ALLOW_ALL)
  ? cors({
      origin(origin, callback) {
        if (isConfiguredOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
    })
  : env.CORS_ALLOW_ALL
    ? cors({ origin: true, credentials: true })
    : cors({
        origin(origin, callback) {
          if (isConfiguredOriginAllowed(origin) || (origin ? isLocalDevOrigin(origin) : false)) {
            callback(null, true);
            return;
          }
          callback(new Error("Origin not allowed by CORS"));
        },
        credentials: true,
      });

function hipaaSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' https:; frame-ancestors 'none'",
  );
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.removeHeader("X-Powered-By");
  next();
}

export const securityMiddleware = [
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    contentSecurityPolicy: false,
  }),
  hipaaSecurityHeaders,
  corsMiddleware,
  express.json({ limit: "4mb" }),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 300 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — rate limit exceeded", code: "RATE_LIMITED" },
  }),
];
