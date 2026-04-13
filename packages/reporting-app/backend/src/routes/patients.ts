import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

/** Empty strings from HTML forms must become undefined so optional email/phone validate. */
function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === null) return undefined;
  return value;
}

const INDIA_PHONE_REGEX = /^(?:\+91[\s-]?)?[6-9]\d{9}$/;

function isValidDobIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (parsed > todayUtc) return false;
  const earliest = new Date(todayUtc);
  earliest.setUTCFullYear(todayUtc.getUTCFullYear() - 130);
  return parsed >= earliest;
}

function normalizeIndianPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D+/g, "");
  let local = "";
  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else {
    return undefined;
  }
  if (!/^[6-9]\d{9}$/.test(local)) return undefined;
  return `+91${local}`;
}

const createPatientSchema = z.object({
  patientId: z.string().trim().min(1).max(64),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().trim().refine(isValidDobIsoDate, "Date of birth must be a valid past date"),
  gender: z.enum(["M", "F", "O"]),
  phone: z.preprocess(
    emptyToUndefined,
    z.string().trim().regex(INDIA_PHONE_REGEX, "Phone must be a valid Indian number (e.g. +91 9876543210)").optional(),
  ),
  email: z.preprocess(emptyToUndefined, z.string().trim().email().optional()),
  address: z.preprocess(emptyToUndefined, z.string().trim().max(280).optional()),
});

const updatePatientSchema = createPatientSchema.partial();

const resolveParam = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

function normalizeCreatePayload(body: z.infer<typeof createPatientSchema>) {
  return {
    patientId: body.patientId.trim().toUpperCase(),
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    dateOfBirth: body.dateOfBirth.trim(),
    gender: body.gender,
    ...(body.phone ? { phone: normalizeIndianPhone(body.phone) } : {}),
    ...(body.email ? { email: body.email.trim() } : {}),
    ...(body.address ? { address: body.address.trim() } : {}),
  };
}

function normalizeUpdatePayload(body: z.infer<typeof updatePatientSchema>) {
  return {
    ...(body.patientId !== undefined ? { patientId: body.patientId.trim().toUpperCase() } : {}),
    ...(body.firstName !== undefined ? { firstName: body.firstName.trim() } : {}),
    ...(body.lastName !== undefined ? { lastName: body.lastName.trim() } : {}),
    ...(body.dateOfBirth !== undefined ? { dateOfBirth: body.dateOfBirth.trim() } : {}),
    ...(body.gender !== undefined ? { gender: body.gender } : {}),
    ...(body.phone !== undefined ? { phone: normalizeIndianPhone(body.phone) } : {}),
    ...(body.email !== undefined ? { email: body.email.trim() } : {}),
    ...(body.address !== undefined ? { address: body.address.trim() } : {}),
  };
}

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
    const payload = normalizeCreatePayload(body);
    try {
      const patient = await store.createPatient(payload);
      res.status(201).json(patient);
    } catch (err: any) {
      if (err.code === "DUPLICATE_MRN") {
        res.status(409).json({ error: `A patient with MRN "${payload.patientId}" already exists.`, existingPatient: err.existingPatient });
        return;
      }
      throw err;
    }
  }));

  router.patch("/:id", ensureAuthenticated, ensurePermission(store, "patients:edit"), asyncHandler(async (req, res) => {
    const body = updatePatientSchema.parse(req.body);
    const payload = normalizeUpdatePayload(body);
    try {
      const patient = await store.updatePatient(resolveParam(req.params.id), payload);
      res.json(patient);
    } catch (err: any) {
      if (err.code === "DUPLICATE_MRN") {
        res.status(409).json({ error: `A patient with MRN "${payload.patientId}" already exists.`, existingPatient: err.existingPatient });
        return;
      }
      throw err;
    }
  }));

  router.delete("/:id", ensureAuthenticated, ensurePermission(store, "patients:delete"), asyncHandler(async (req, res) => {
    await store.deletePatient(resolveParam(req.params.id));
    res.status(204).end();
  }));

  return router;
}
