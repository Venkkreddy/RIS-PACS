import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

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

export function billingRouter(store: StoreService): Router {
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

  return router;
}
