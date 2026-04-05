import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

const createPatientSchema = z.object({
  patientId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  gender: z.enum(["M", "F", "O"]),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

const updatePatientSchema = createPatientSchema.partial();

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function patientsRouter(store: StoreService): Router {
  const router = Router();

  router.get("/", ensureAuthenticated, ensurePermission(store, "patients:view"), asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const patients = await store.listPatients(search);
    res.json(patients);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(store, "patients:view"), asyncHandler(async (req, res) => {
    const patient = await store.getPatient(resolveParam(req.params.id));
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
    res.json(patient);
  }));

  router.post("/", ensureAuthenticated, ensurePermission(store, "patients:create"), asyncHandler(async (req, res) => {
    const body = createPatientSchema.parse(req.body);
    try {
      const patient = await store.createPatient(body);
      res.status(201).json(patient);
    } catch (err: any) {
      if (err.code === "DUPLICATE_MRN") {
        res.status(409).json({ error: `A patient with MRN "${body.patientId}" already exists.`, existingPatient: err.existingPatient });
        return;
      }
      throw err;
    }
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "patients:edit"), asyncHandler(async (req, res) => {
    const body = updatePatientSchema.parse(req.body);
    const patient = await store.updatePatient(resolveParam(req.params.id), body);
    res.json(patient);
  }));

  router.delete("/:id", ensureAuthenticated, ensurePermission(store, "patients:delete"), asyncHandler(async (req, res) => {
    await store.deletePatient(resolveParam(req.params.id));
    res.status(204).end();
  }));

  return router;
}
