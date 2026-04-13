import { NextFunction, Request, Response } from "express";
import { logger } from "../services/logger";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    const logEntry: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
      ip: getClientIp(req),
      userId: req.session?.user?.id,
      userRole: req.session?.user?.role,
      contentLength: res.getHeader("content-length"),
    };

    if (res.statusCode >= 400) {
      logger.warn(logEntry);
    } else {
      logger.info(logEntry);
    }
  });
  next();
}
