import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAdmin, ensureAuthenticated } from "../middleware/auth";
import { EmailService } from "../services/emailService";
import { StoreService, StudyRecord } from "../services/store";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["developer", "radiographer", "radiologist", "referring", "billing", "receptionist"]),
});

const updateUserSchema = z.object({
  role: z.enum(["super_admin", "admin", "developer", "radiographer", "radiologist", "referring", "billing", "receptionist", "viewer"]),
  displayName: z.string().optional(),
});

const approvalSchema = z.object({
  role: z.enum(["super_admin", "admin", "developer", "radiographer", "radiologist", "referring", "billing", "receptionist", "viewer"]).optional(),
});

export function adminRouter(store: StoreService, emailService: EmailService): Router {
  const router = Router();
  const idFromEmail = (email: string) => email.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const resolveParam = (value: string | string[]) => (Array.isArray(value) ? value[0] : value);

  router.post("/admin/invite", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const body = inviteSchema.parse(req.body);

    const existing = await store.getUserByEmail(body.email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: "User with this email already exists" });
      return;
    }

    const token = uuid();

    const invite = await store.createInvite({
      email: body.email,
      role: body.role,
      token,
      invitedBy: req.session.user!.id,
    });

    await store.upsertUser({
      id: idFromEmail(body.email),
      email: body.email.toLowerCase(),
      role: body.role,
      approved: false,
      requestStatus: "pending",
      authProvider: "password",
    });

    await emailService.sendInviteEmail(body.email, body.role, token);

    res.status(201).json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      message: "Invite sent",
    });
  }));


  router.get("/users", ensureAuthenticated, asyncHandler(async (req, res) => {
    const users = await store.listUsers();

    if (req.session.user?.role === "super_admin" || req.session.user?.role === "admin" || req.session.user?.role === "developer") {
      res.json(users);
      return;
    }

    res.json(users.filter((user) => user.role === "radiologist"));
  }));

  router.patch("/users/:id", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const body = updateUserSchema.parse(req.body);
    const userId = resolveParam(req.params.id);
    const updated = await store.updateUserRole(userId, body.role, body.displayName);
    res.json(updated);
  }));

  router.get("/admin/user-requests", ensureAuthenticated, ensureAdmin, asyncHandler(async (_req, res) => {
    const pending = await store.listPendingUsers();
    res.json(pending);
  }));

  router.post("/admin/user-requests/:id/approve", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const body = approvalSchema.parse(req.body);
    const userId = resolveParam(req.params.id);
    const approved = await store.updateUserApproval(userId, "approved", body.role);
    res.json(approved);
  }));

  router.post("/admin/user-requests/:id/reject", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const userId = resolveParam(req.params.id);
    const rejected = await store.updateUserApproval(userId, "rejected");
    res.json(rejected);
  }));

  router.get("/analytics", ensureAuthenticated, ensureAdmin, asyncHandler(async (_req, res) => {
    const [studies, users] = await Promise.all([store.listStudyRecords({}), store.listUsers()]);

    const centerCounts = studies.reduce<Record<string, number>>((acc, study) => {
      const key = study.location || "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const radiologists = users
      .filter((user) => user.role === "radiologist")
      .map((user) => ({
        userId: user.id,
        name: user.displayName ?? user.email,
        assignedCount: studies.filter((study) => study.assignedTo === user.id).length,
      }));

    const pendingReports = studies
      .filter((study) => study.status === "assigned")
      .map((study) => ({
        ...study,
        currentTatHours: study.assignedAt
          ? Number(((Date.now() - new Date(study.assignedAt).getTime()) / (1000 * 60 * 60)).toFixed(2))
          : 0,
      }))
      .sort((a, b) => b.currentTatHours - a.currentTatHours);

    const longestTat = studies
      .filter((study) => study.status === "reported")
      .sort((a, b) => (b.tatHours ?? 0) - (a.tatHours ?? 0))
      .slice(0, 20);

    res.json({
      centers: Object.entries(centerCounts).map(([name, uploads]) => ({ name, uploads })),
      totalUploads: studies.length,
      radiologists,
      pendingReports,
      longestTat,
    });
  }));

  router.get("/admin/analytics/tat-by-radiologist", ensureAuthenticated, ensureAdmin, asyncHandler(async (_req, res) => {
    const [studies, users] = await Promise.all([store.listStudyRecords({}), store.listUsers()]);
    const usersById = new Map(users.map((user) => [user.id, user]));

    const byRadiologist = new Map<string, StudyRecord[]>();
    for (const study of studies) {
      if (!study.assignedTo) continue;
      const list = byRadiologist.get(study.assignedTo) ?? [];
      list.push(study);
      byRadiologist.set(study.assignedTo, list);
    }

    const rows = Array.from(byRadiologist.entries()).map(([userId, list]) => {
      const assignee = usersById.get(userId);
      const completed = list.filter((study) => study.status === "reported" && typeof study.tatHours === "number");
      const tatValues = completed.map((study) => study.tatHours as number);
      const avgTatHours = tatValues.length
        ? Number((tatValues.reduce((sum, value) => sum + value, 0) / tatValues.length).toFixed(2))
        : 0;
      const maxTatHours = tatValues.length ? Number(Math.max(...tatValues).toFixed(2)) : 0;

      return {
        radiologist_name: assignee?.displayName ?? assignee?.email ?? userId,
        assigned_count: list.length,
        completed_count: completed.length,
        avg_tat_hours: avgTatHours,
        max_tat_hours: maxTatHours,
        pending_count: list.filter((study) => study.status === "assigned").length,
      };
    });

    rows.sort((a, b) => b.avg_tat_hours - a.avg_tat_hours);

    res.json({ radiologists: rows });
  }));

  router.post("/admin/reminder", ensureAuthenticated, ensureAdmin, asyncHandler(async (req, res) => {
    const payload = z.object({ studyId: z.string().min(1) }).parse(req.body);
    const studies = await store.listStudyRecords({});
    const study = studies.find((item) => item.studyId === payload.studyId);
    if (!study?.assignedTo) throw new Error("Study is not assigned");

    const users = await store.listUsers();
    const assignee = users.find((user) => user.id === study.assignedTo);
    if (!assignee) throw new Error("Assigned user not found");

    await emailService.sendTatReminderEmail(assignee.email, payload.studyId);
    res.json({ message: "Reminder sent" });
  }));

  return router;
}
