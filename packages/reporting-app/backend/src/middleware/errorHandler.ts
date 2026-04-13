import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { logger } from "../services/logger";

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{9}\b/, // MRN-like
  /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/, // Patient names
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/, // Dates of birth
];

function sanitizeErrorMessage(message: string): string {
  if (env.NODE_ENV !== "production") return message;
  let sanitized = message;
  for (const pattern of PHI_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

const SAFE_ERROR_MESSAGES: Record<number, string> = {
  400: "Invalid request",
  401: "Authentication required",
  403: "Access denied",
  404: "Resource not found",
  413: "Uploaded file is too large",
  429: "Too many requests",
  500: "Internal server error",
};

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  const errorId = `ERR-${Date.now().toString(36)}`;

  logger.error({
    message: error.message,
    stack: error.stack,
    errorId,
    path: _req.path,
    method: _req.method,
    userId: _req.session?.user?.id,
  });

  if (error instanceof ZodError) {
    const safeErrors = error.errors.map((e) => ({
      path: e.path,
      message: e.message,
      code: e.code,
    }));
    res.status(400).json({ error: safeErrors, errorId });
    return;
  }

  const msg = error.message.toLowerCase();
  const status =
    msg === "unauthorized"
      ? 401
      : msg === "forbidden" || msg === "pending approval" || msg.includes("origin not allowed by cors")
          ? 403
        : msg.includes("not found")
            ? 404
          : msg.includes("file too large")
            || msg.includes("request entity too large")
            || msg.includes("payload too large")
              ? 413
            : 500;

  const isProduction = env.NODE_ENV === "production";
  const clientMessage = isProduction && status === 500
    ? SAFE_ERROR_MESSAGES[status]
    : sanitizeErrorMessage(error.message);

  res.status(status).json({
    error: clientMessage,
    errorId,
    ...(isProduction ? {} : { stack: error.stack }),
  });
}
