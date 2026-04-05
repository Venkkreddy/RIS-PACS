import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

const createPhysicianSchema = z.object({
  name: z.string().min(1),
  specialty: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  hospital: z.string().optional(),
});

const updatePhysicianSchema = createPhysicianSchema.partial();

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function referringPhysiciansRouter(store: StoreService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensurePermission(store, "referring_physicians:view"), asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const physicians = await store.listReferringPhysicians(search);
    res.json(physicians);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(store, "referring_physicians:view"), asyncHandler(async (req, res) => {
    const physician = await store.getReferringPhysician(resolveParam(req.params.id));
    if (!physician) { res.status(404).json({ error: "Physician not found" }); return; }
    res.json(physician);
  }));

  router.post("/", ensureAuthenticated, ensurePermission(store, "referring_physicians:create"), asyncHandler(async (req, res) => {
    const body = createPhysicianSchema.parse(req.body);
    const physician = await store.createReferringPhysician(body);
    res.status(201).json(physician);
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "referring_physicians:edit"), asyncHandler(async (req, res) => {
    const body = updatePhysicianSchema.parse(req.body);
    const physician = await store.updateReferringPhysician(resolveParam(req.params.id), body);
    res.json(physician);
  }));

  return router;
}
