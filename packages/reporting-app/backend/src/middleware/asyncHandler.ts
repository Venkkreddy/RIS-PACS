import { NextFunction, Request, Response } from "express";

/**
 * Wraps an async Express route handler so rejected promises
 * are forwarded to the error-handling middleware instead of
 * crashing the process as unhandled rejections.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
