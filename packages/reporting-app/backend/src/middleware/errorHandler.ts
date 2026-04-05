import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../services/logger";

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ message: error.message, stack: error.stack });

  if (error instanceof ZodError) {
    res.status(400).json({ error: error.errors });
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
            : 500;

  res.status(status).json({ error: error.message });
}
