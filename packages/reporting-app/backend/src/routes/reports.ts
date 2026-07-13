import { Request, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { EmailService } from "../services/emailService";
import { PdfService } from "../services/pdfService";
import { ReportService } from "../services/reportService";

import { StorageService } from "../services/storageService";
import { StoreService } from "../services/store";
import { HipaaAuditService } from "../services/hipaaAuditService";
import { NotificationService } from "../services/notificationService";
import { getClientIp, getUserAgent } from "../middleware/hipaaMiddleware";

const upload = multer({ storage: multer.memoryStorage() });

const sectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  content: z.string(),
});

const createReportSchema = z.object({
  studyId: z.string().min(1),
  templateId: z.string().optional(),
  content: z.string().default(""),
  sections: z.array(sectionSchema).optional(),
  priority: z.enum(["routine", "urgent", "critical"]).default("routine"),
  metadata: z.record(z.unknown()).optional(),
});

const updateReportSchema = z.object({
  content: z.string().optional(),
  sections: z.array(sectionSchema).optional(),
  priority: z.enum(["routine", "urgent", "critical"]).optional(),
});

const statusSchema = z.object({
  status: z.enum(["draft", "preliminary", "final", "amended", "cancelled"]),
});

const addendumSchema = z.object({ addendum: z.string().min(1) });
const shareSchema = z.object({ email: z.string().email() });

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function reportsRouter(params: {
  store: StoreService;
  reportService: ReportService;
  storageService: StorageService;

  emailService: EmailService;
  pdfService: PdfService;
  hipaaAuditService?: HipaaAuditService;
  notificationService?: NotificationService;
}): Router {
  const router = Router();
  const resolveParamId = (id: string | string[]): string => (Array.isArray(id) ? id[0] : id);

  // When a report is saved with priority "critical": write a HIPAA audit entry immediately
  // and create a notification (visible to admin + radiologist roles) so the finding can't
  // be missed. Fired from both create (POST) and update (PUT) — whichever path results in
  // the report ending up critical.
  async function flagCriticalFinding(req: Request, report: { id: string; studyId: string; metadata?: Record<string, unknown> }): Promise<void> {
    const metadata = report.metadata ?? {};
    const patientMeta = (typeof metadata.patient === "object" && metadata.patient !== null ? metadata.patient as Record<string, unknown> : {});
    const patientName = typeof patientMeta.patientName === "string" && patientMeta.patientName.trim() ? patientMeta.patientName : "Unknown patient";

    const studyRecord = await params.store.getStudyRecord(report.studyId);
    const studyType =
      studyRecord?.description ||
      [studyRecord?.bodyPart, studyRecord?.modality].filter(Boolean).join(" ").trim() ||
      "Unknown study";

    const radiologistName = req.session.user?.displayName ?? req.session.user?.email ?? "Unknown radiologist";

    await params.hipaaAuditService?.log({
      action: "CRITICAL_FINDING_FLAGGED",
      severity: "critical",
      userId: req.session.user?.id ?? "unknown",
      userEmail: req.session.user?.email ?? "unknown",
      userRole: req.session.user?.role ?? "unknown",
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      resourceType: "report",
      resourceId: report.id,
      description: `Critical finding flagged on report ${report.id} for ${patientName} (${studyType})`,
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      phiAccessed: true,
      phiFieldsAccessed: ["patientName"],
    });

    await params.notificationService?.create({
      type: "critical_finding",
      report_id: report.id,
      patient_name: patientName,
      radiologist_name: radiologistName,
      study_type: studyType,
      target_roles: ["admin", "radiologist"],
    });
  }

  // Referring physicians may only view finalized reports tied to their own orders.
  async function assertReferringCanViewReport(req: Request, store: StoreService, report: { studyId: string; status: string }): Promise<void> {
    const user = req.session.user;
    if (user?.role !== "referring") return;
    if (report.status !== "final" && report.status !== "amended") {
      throw new Error("Report not found");
    }
    const orders = await store.listOrders({ referringPhysicianId: user.id });
    const ownsStudy = orders.some((o) => o.studyId === report.studyId);
    if (!ownsStudy) {
      throw new Error("Report not found");
    }
  }

  router.post("/", ensureAuthenticated, ensurePermission(params.store, "reports:create"), asyncHandler(async (req, res) => {
    const body = createReportSchema.parse(req.body);
    const studyRecord = await params.store.getStudyRecord(body.studyId);
    const studyMetadata = studyRecord?.metadata as Record<string, unknown> | undefined;
    const patientMrn = metadataString(studyMetadata, ["patientId", "PatientID", "patient_id", "00100020"]);
    const patient = patientMrn ? await params.store.getPatientByMrn(patientMrn) : null;
    // Pull clinicalHistory from the order (stored in study metadata during check-in/intake)
    const orderClinicalHistory = (
      metadataString(studyMetadata, ["clinicalHistory", "clinical_history", "chiefComplaint", "complaints"]) ??
      (studyRecord as any)?.clinicalHistory ??
      ""
    );
    const reportMetadata = {
      ...(body.metadata ?? {}),
      // Surface order-level fields so the ReportEditor can read them
      bodyPart: (studyRecord as any)?.bodyPart ?? metadataString(studyMetadata, ["bodyPart", "body_part"]) ?? "",
      modality: studyRecord?.modality ?? metadataString(studyMetadata, ["modality"]) ?? "",
      // clinicalHistory comes from the ORDER record (receptionist intake), not the radiologist
      clinicalHistory: orderClinicalHistory,
      patient: {
        ...(body.metadata && typeof body.metadata.patient === "object" && body.metadata.patient !== null
          ? body.metadata.patient as Record<string, unknown>
          : {}),
        studyId: body.studyId,
        patientName:
          patient
            ? `${patient.firstName} ${patient.lastName}`.trim()
            : (studyRecord?.patientName ?? metadataString(studyMetadata, ["patientName", "PatientName", "00100010"])),
        patientId: patient?.patientId ?? patientMrn,
        patientRegistryId: patient?.id ?? metadataString(studyMetadata, ["patientRegistryId"]),
        dateOfBirth: patient?.dateOfBirth ?? metadataString(studyMetadata, ["patientDateOfBirth"]),
        age: patient?.dateOfBirth ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / 3.156e10) : undefined,
        gender: patient?.gender ?? metadataString(studyMetadata, ["patientSex", "gender"]),
        phone: patient?.phone ?? metadataString(studyMetadata, ["patientPhone"]),
        email: patient?.email ?? metadataString(studyMetadata, ["patientEmail"]),
        address: patient?.address ?? metadataString(studyMetadata, ["patientAddress"]),
      },
    };

    const report = await params.reportService.createReport({
      studyId: body.studyId,
      templateId: body.templateId,
      content: body.content,
      sections: body.sections,
      status: "draft",
      priority: body.priority,
      ownerId: req.session.user!.id,
      metadata: reportMetadata,
    });

    if (report.priority === "critical") {
      await flagCriticalFinding(req, { id: report.id, studyId: report.studyId, metadata: report.metadata });
    }

    res.status(201).json(report);
  }));

  router.get("/", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const user = req.session.user!;
    const reports = user.role === "referring"
      ? await params.store.listReportsForReferringPhysician(user.id)
      : await params.store.listReports(user.id);
    res.json(reports);
  }));

  router.get("/by-study/:studyId", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const studyId = resolveParamId(req.params.studyId);
    const report = await params.store.getReportByStudyId(studyId);
    if (!report) throw new Error("Report not found");
    await assertReferringCanViewReport(req, params.store, report);
    res.json(report);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const reportId = resolveParamId(req.params.id);
    const report = await params.store.getReport(reportId);
    if (!report) throw new Error("Report not found");
    await assertReferringCanViewReport(req, params.store, report);
    res.json(report);
  }));

  router.put("/:id", ensureAuthenticated, ensurePermission(params.store, "reports:edit"), asyncHandler(async (req, res) => {
    const body = updateReportSchema.parse(req.body);
    const reportId = resolveParamId(req.params.id);
    const existing = await params.store.getReport(reportId);
    if (!existing) throw new Error("Report not found");

    const updated = await params.store.updateReport(reportId, {
      content: body.content ?? existing.content,
      sections: body.sections ?? existing.sections,
      priority: body.priority ?? existing.priority,
    });

    await params.store.appendVersion(reportId, {
      id: `${Date.now()}`,
      type: "edit",
      content: "Report content updated",
      authorId: req.session.user!.id,
      createdAt: new Date().toISOString(),
    });

    // Only fire on the transition into "critical" — not on every subsequent edit of an
    // already-critical report — so saving small text changes doesn't spam new alerts.
    if (updated.priority === "critical" && existing.priority !== "critical") {
      await flagCriticalFinding(req, { id: updated.id, studyId: updated.studyId, metadata: updated.metadata });
    }

    res.json(updated);
  }));

  router.patch("/:id/status", ensureAuthenticated, ensurePermission(params.store, "reports:sign"), asyncHandler(async (req, res) => {
    const body = statusSchema.parse(req.body);
    const reportId = resolveParamId(req.params.id);
    const existing = await params.store.getReport(reportId);
    if (!existing) throw new Error("Report not found");

    const VALID_TRANSITIONS: Record<string, string[]> = {
      draft: ["preliminary", "final", "cancelled"],
      preliminary: ["final", "cancelled"],
      final: ["amended"],
      amended: ["final"],
      cancelled: [],
    };
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.status)) {
      res.status(400).json({ error: `Cannot transition from '${existing.status}' to '${body.status}'` });
      return;
    }

    const patch: Record<string, unknown> = { status: body.status };

    if (body.status === "final") {
      patch.signedBy = req.session.user!.id;
      patch.signedAt = new Date().toISOString();
    }

    const updated = await params.store.updateReport(reportId, patch);

    await params.store.appendVersion(reportId, {
      id: `${Date.now()}`,
      type: body.status === "final" ? "sign" : "status-change",
      content: `Report status changed to ${body.status}`,
      authorId: req.session.user!.id,
      createdAt: new Date().toISOString(),
    });

    res.json(updated);
  }));

  router.patch("/:id/addendum", ensureAuthenticated, ensurePermission(params.store, "reports:addendum"), asyncHandler(async (req, res) => {
    const body = addendumSchema.parse(req.body);
    const reportId = resolveParamId(req.params.id);
    const updated = await params.reportService.addAddendum(reportId, body.addendum, req.session.user!.id);
    res.json(updated);
  }));

  router.post("/:id/attach", ensureAuthenticated, ensurePermission(params.store, "reports:edit"), upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) throw new Error("No file uploaded");
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) throw new Error("Only image uploads (JPEG, PNG, WebP) are allowed");

    const reportId = resolveParamId(req.params.id);
    const objectPath = `reports/${reportId}/attachments/${Date.now()}-${req.file.originalname}`;
    const url = await params.storageService.uploadBuffer(objectPath, req.file.buffer, req.file.mimetype);
    const updated = await params.store.addAttachment(reportId, url, req.session.user!.id);
    res.json(updated);
  }));


  router.post("/:id/share", ensureAuthenticated, ensurePermission(params.store, "reports:share"), asyncHandler(async (req, res) => {
    const body = shareSchema.parse(req.body);
    const reportId = resolveParamId(req.params.id);
    const report = await params.store.getReport(reportId);
    if (!report) throw new Error("Report not found");

    const pdf = await params.pdfService.buildReportPdf(report);
    await params.emailService.sendReportShareEmail(body.email, pdf, report.id);

    const updated = await params.store.appendVersion(report.id, {
      id: `${Date.now()}`,
      type: "share",
      content: `Shared report via email to ${body.email}`,
      authorId: req.session.user!.id,
      createdAt: new Date().toISOString(),
    });

    res.json({ message: "Report shared", report: updated });
  }));

  router.get("/:id/pdf", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const reportId = resolveParamId(req.params.id);
    const report = await params.store.getReport(reportId);
    if (!report) throw new Error("Report not found");
    await assertReferringCanViewReport(req, params.store, report);

    const pdf = await params.pdfService.buildReportPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${reportId}.pdf"`);
    res.send(pdf);
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // AI Report Template Routes (local MedGemma via Ollama, no cloud)
  // ─────────────────────────────────────────────────────────────────────────

  const medasrUrl = process.env.MEDASR_SERVER_URL ?? "http://localhost:5001";

  /** GET /reports/ai/templates — list all available report templates */
  router.get("/ai/templates", ensureAuthenticated, asyncHandler(async (_req, res) => {
    try {
      const resp = await fetch(`${medasrUrl}/v1/report/templates`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      res.json(data);
    } catch {
      res.status(503).json({ error: "Report AI service unavailable", templates: [] });
    }
  }));

  /** POST /reports/ai/structure — generate full report sections from dictation */
  router.post("/ai/structure", ensureAuthenticated, asyncHandler(async (req, res) => {
    const {
      dictation,
      body_part = "CHEST",
      modality = "CR",
      laterality,
      patient_name,
      patient_age,
      patient_sex,
      clinical_history,
      auto_detect,
    } = req.body as {
      dictation?: string;
      body_part?: string;
      modality?: string;
      laterality?: string;
      patient_name?: string;
      patient_age?: number;
      patient_sex?: string;
      clinical_history?: string;
      auto_detect?: boolean;
    };

    if (!dictation || dictation.trim().length < 3) {
      res.status(400).json({ error: "dictation must be at least 3 characters" });
      return;
    }

    try {
      const resp = await fetch(`${medasrUrl}/v1/report/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dictation, body_part, modality, laterality, patient_name, patient_age, patient_sex, clinical_history, auto_detect }),
        signal: AbortSignal.timeout(60_000), // 60s for local LLM inference
      });


      if (!resp.ok) {
        const text = await resp.text();
        res.status(resp.status).json({ error: `Report AI error: ${text}` });
        return;
      }

      res.json(await resp.json());
    } catch {
      // AI service down — return 503 so frontend uses rule-based fallback
      res.status(503).json({ error: "Report AI service unavailable", fallback: true });
    }
  }));

  /** POST /reports/ai/suggest — get a single-section suggestion as radiologist types */
  router.post("/ai/suggest", ensureAuthenticated, asyncHandler(async (req, res) => {
    const { partial_text, section_key, body_part = "CHEST", modality = "CR", laterality } = req.body as {
      partial_text?: string;
      section_key?: string;
      body_part?: string;
      modality?: string;
      laterality?: string;
    };

    if (!partial_text || !section_key) {
      res.status(400).json({ error: "partial_text and section_key are required" });
      return;
    }

    try {
      const resp = await fetch(`${medasrUrl}/v1/report/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partial_text, section_key, body_part, modality, laterality }),
        signal: AbortSignal.timeout(30_000),
      });

      res.json(await resp.json());
    } catch {
      res.status(503).json({ suggestion: "" });
    }
  }));

  /** GET /reports/ai/health — check AI service status */
  router.get("/ai/health", ensureAuthenticated, asyncHandler(async (_req, res) => {
    try {
      const resp = await fetch(`${medasrUrl}/v1/report/health`, { signal: AbortSignal.timeout(3000) });
      res.json(await resp.json());
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  }));


  return router;
}
