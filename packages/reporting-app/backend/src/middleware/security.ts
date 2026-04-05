import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";

const allowedOrigins = new Set(
  [
    env.FRONTEND_URL,
    env.OHIF_BASE_URL,
    env.OHIF_PUBLIC_BASE_URL,
    ...(env.CORS_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()) ?? []),
  ].filter(Boolean),
);

function isLocalDevOrigin(origin: string): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export const securityMiddleware = [
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
  }),
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  }),
  express.json({ limit: "4mb" }),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true }),
];
