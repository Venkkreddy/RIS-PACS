import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

const modalityEnum = z.enum(["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"]);
const priorityEnum = z.enum(["routine", "urgent", "stat"]);
const statusEnum = z.enum(["scheduled", "in-progress", "completed", "cancelled"]);

const createOrderSchema = z.object({
  patientId: z.string().min(1),
  patientName: z.string().min(1),
  referringPhysicianId: z.string().optional(),
  referringPhysicianName: z.string().optional(),
  modality: modalityEnum,
  bodyPart: z.string().min(1),
  clinicalHistory: z.string().optional(),
  priority: priorityEnum.default("routine"),
  status: statusEnum.default("scheduled"),
  scheduledDate: z.string().min(1),
  notes: z.string().optional(),
});

const updateOrderSchema = z.object({
  status: statusEnum.optional(),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
  studyId: z.string().optional(),
  reportId: z.string().optional(),
  completedDate: z.string().optional(),
  priority: priorityEnum.optional(),
  referringPhysicianId: z.string().optional(),
  referringPhysicianName: z.string().optional(),
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  patientId: z.string().optional(),
  date: z.string().optional(),
  search: z.string().optional(),
});

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function ordersRouter(store: StoreService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensurePermission(store, "orders:view"), asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const orders = await store.listOrders(query);
    res.json(orders);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(store, "orders:view"), asyncHandler(async (req, res) => {
    const order = await store.getOrder(resolveParam(req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(order);
  }));

  router.post("/", ensureAuthenticated, ensurePermission(store, "orders:create"), asyncHandler(async (req, res) => {
    const body = createOrderSchema.parse(req.body);
    const order = await store.createOrder({
      ...body,
      createdBy: req.session.user?.id ?? "unknown",
    });
    res.status(201).json(order);
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "orders:edit"), asyncHandler(async (req, res) => {
    const body = updateOrderSchema.parse(req.body);
    const order = await store.updateOrder(resolveParam(req.params.id), body);
    res.json(order);
  }));

  return router;
}
