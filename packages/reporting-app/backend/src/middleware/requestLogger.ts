import { NextFunction, Request, Response } from "express";
import { logger } from "../services/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    logger.info({ method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started });
  });
  next();
}
