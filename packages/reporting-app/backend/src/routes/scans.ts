import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

const scanTypeEnum = z.enum(["X-Ray", "CT", "MRI", "Ultrasound", "Mammogram", "Fluoroscopy", "PET", "Nuclear", "Other"]);
const modalityEnum = z.enum(["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"]);
const statusEnum = z.enum(["scheduled", "in-progress", "completed", "failed", "cancelled"]);

const createScanSchema = z.object({
  patientId: z.string().min(1),
  patientName: z.string().min(1),
  orderId: z.string().optional(),
  scanType: scanTypeEnum,
  modality: modalityEnum,
  bodyPart: z.string().min(1),
  scanDate: z.string().min(1),
  status: statusEnum.default("scheduled"),
  technician: z.string().optional(),
  radiologist: z.string().optional(),
  findings: z.string().optional(),
  imageCount: z.number().int().min(0).optional(),
  contrastUsed: z.boolean().optional(),
  notes: z.string().optional(),
});

const updateScanSchema = z.object({
  status: statusEnum.optional(),
  scanDate: z.string().optional(),
  technician: z.string().optional(),
  radiologist: z.string().optional(),
  findings: z.string().optional(),
  imageCount: z.number().int().min(0).optional(),
  contrastUsed: z.boolean().optional(),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  patientId: z.string().optional(),
  scanType: z.string().optional(),
  date: z.string().optional(),
  search: z.string().optional(),
});

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function scansRouter(store: StoreService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensurePermission(store, "scans:view"), asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const scans = await store.listScans(query);
    res.json(scans);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(store, "scans:view"), asyncHandler(async (req, res) => {
    const scan = await store.getScan(resolveParam(req.params.id));
    if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
    res.json(scan);
  }));

  router.post("/", ensureAuthenticated, ensurePermission(store, "scans:create"), asyncHandler(async (req, res) => {
    const body = createScanSchema.parse(req.body);
    const scan = await store.createScan({
      ...body,
      createdBy: req.session.user?.id ?? "unknown",
    });
    res.status(201).json(scan);
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "scans:edit"), asyncHandler(async (req, res) => {
    const body = updateScanSchema.parse(req.body);
    const scan = await store.updateScan(resolveParam(req.params.id), body);
    res.json(scan);
  }));

  return router;
}
