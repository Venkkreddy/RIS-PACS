import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { logger } from "../services/logger";

const corsMiddleware = cors({
  origin: true,
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

const isProduction = env.NODE_ENV === "production";

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
