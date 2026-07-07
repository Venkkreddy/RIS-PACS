import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";
import { HipaaAuditService } from "../services/hipaaAuditService";
import { EmailService } from "../services/emailService";
import { getClientIp, getUserAgent } from "../middleware/hipaaMiddleware";
import { logger } from "../services/logger";

const billingStatusEnum = z.enum(["pending", "invoiced", "paid", "cancelled"]);

const createBillingSchema = z.object({
  orderId: z.string().optional(),
  patientId: z.string().min(1),
  patientName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().min(0),
  status: billingStatusEnum.default("pending"),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
});

const updateBillingSchema = z.object({
  status: billingStatusEnum.optional(),
  amount: z.number().min(0).optional(),
  invoiceNumber: z.string().optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  status: billingStatusEnum.optional(),
  patientId: z.string().optional(),
  search: z.string().optional(),
});

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function billingRouter(store: StoreService, hipaaAudit?: HipaaAuditService, emailService?: EmailService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensurePermission(store, "billing:view"), asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const records = await store.listBilling(query);
    res.json(records);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(store, "billing:view"), asyncHandler(async (req, res) => {
    const record = await store.getBilling(resolveParam(req.params.id));
    if (!record) { res.status(404).json({ error: "Billing record not found" }); return; }
    res.json(record);
  }));

  router.post("/", ensureAuthenticated, ensurePermission(store, "billing:create"), asyncHandler(async (req, res) => {
    const body = createBillingSchema.parse(req.body);
    const record = await store.createBilling({
      ...body,
      createdBy: req.session.user?.id ?? "unknown",
    });
    res.status(201).json(record);
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "billing:edit"), asyncHandler(async (req, res) => {
    const body = updateBillingSchema.parse(req.body);
    const record = await store.updateBilling(resolveParam(req.params.id), body);
    res.json(record);
  }));

  // Sends an email reminder for an overdue invoice (if the patient has an email on file
  // and SendGrid is configured) and logs the action in the HIPAA audit log either way.
  router.post("/:id/remind", ensureAuthenticated, ensurePermission(store, "billing:edit"), asyncHandler(async (req, res) => {
    const id = resolveParam(req.params.id);
    const record = await store.getBilling(id);
    if (!record) { res.status(404).json({ error: "Billing record not found" }); return; }

    const patient = await store.getPatient(record.patientId).catch(() => null);
    let emailSent = false;
    if (emailService && patient?.email) {
      try {
        await emailService.sendBillingReminderEmail(patient.email, {
          patientName: record.patientName,
          invoiceNumber: record.invoiceNumber,
          amount: record.amount,
        });
        emailSent = true;
      } catch (error) {
        logger.warn({ message: "Failed to send billing reminder email", billingId: id, error: String(error) });
      }
    }

    const user = req.session.user;
    await hipaaAudit?.log({
      action: "BILLING_REMINDER_SENT",
      severity: "info",
      userId: user?.id ?? "unknown",
      userEmail: user?.email ?? "unknown",
      userRole: user?.role ?? "unknown",
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      resourceType: "billing",
      resourceId: id,
      description: `Payment reminder ${emailSent ? "emailed" : "logged"} for ${record.patientName} (invoice ${record.invoiceNumber ?? id}, amount $${record.amount})`,
      httpMethod: "POST",
      httpPath: `/billing/${id}/remind`,
      httpStatus: 200,
      phiAccessed: true,
      phiFieldsAccessed: ["patientName", "amount"],
    });

    res.json({
      message: emailSent ? "Reminder email sent" : "Reminder logged (no email on file or email not configured)",
      billingId: id,
      emailSent,
    });
  }));

  return router;
}
