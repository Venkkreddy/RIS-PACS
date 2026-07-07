import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated } from "../middleware/auth";
import { NotificationService } from "../services/notificationService";

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function notificationsRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, asyncHandler(async (req, res) => {
    const role = req.session.user?.role ?? "viewer";
    const notifications = await notificationService.listForRole(role);
    res.json(notifications);
  }));

  router.patch("/:id/read", ensureAuthenticated, asyncHandler(async (req, res) => {
    const id = resolveParam(req.params.id);
    await notificationService.markRead(id);
    res.json({ message: "Marked as read" });
  }));

  return router;
}
