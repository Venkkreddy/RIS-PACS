import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { EmailService } from "../services/emailService";
import { PdfService } from "../services/pdfService";
import { ReportService } from "../services/reportService";
import { SpeechService } from "../services/speechService";
import { StorageService } from "../services/storageService";
import { StoreService } from "../services/store";

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
  speechService: SpeechService;
  emailService: EmailService;
  pdfService: PdfService;
}): Router {
  const router = Router();
  const resolveParamId = (id: string | string[]): string => (Array.isArray(id) ? id[0] : id);

  router.post("/", ensureAuthenticated, ensurePermission(params.store, "reports:create"), asyncHandler(async (req, res) => {
    const body = createReportSchema.parse(req.body);
    const studyRecord = await params.store.getStudyRecord(body.studyId);
    const studyMetadata = studyRecord?.metadata as Record<string, unknown> | undefined;
    const patientMrn = metadataString(studyMetadata, ["patientId", "PatientID", "patient_id", "00100020"]);
    const patient = patientMrn ? await params.store.getPatientByMrn(patientMrn) : null;
    const reportMetadata = {
      ...(body.metadata ?? {}),
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
    res.status(201).json(report);
  }));

  router.get("/", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const reports = await params.store.listReports(req.session.user!.id);
    res.json(reports);
  }));

  router.get("/by-study/:studyId", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const studyId = resolveParamId(req.params.studyId);
    const report = await params.store.getReportByStudyId(studyId);
    if (!report) throw new Error("Report not found");
    res.json(report);
  }));

  router.get("/:id", ensureAuthenticated, ensurePermission(params.store, "reports:view"), asyncHandler(async (req, res) => {
    const reportId = resolveParamId(req.params.id);
    const report = await params.store.getReport(reportId);
    if (!report) throw new Error("Report not found");
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

  router.post("/:id/voice", ensureAuthenticated, ensurePermission(params.store, "reports:edit"), upload.single("audio"), asyncHandler(async (req, res) => {
    if (!req.file) throw new Error("No audio uploaded");

    const reportId = resolveParamId(req.params.id);
    const audioPath = `reports/${reportId}/voice/${Date.now()}-${req.file.originalname}`;

    let audioUrl = "";
    try {
      audioUrl = await params.storageService.uploadBuffer(audioPath, req.file.buffer, req.file.mimetype);
    } catch {
      // Storage unavailable (no GCS in local dev) — continue without persisting audio
    }

    const useRadiology = req.query.radiology === "true";

    if (useRadiology) {
      const result = await params.speechService.transcribeRadiology(req.file.buffer, req.file.mimetype);
      const updated = await params.store.setVoice(reportId, {
        audioUrl,
        transcript: result.correctedTranscript,
        radiologyReport: result.radiologyReport,
        rawTranscript: result.rawTranscript,
        confidence: result.confidence,
        modelUsed: result.modelUsed,
      }, req.session.user!.id);
      res.json(updated);
    } else {
      const { transcript } = await params.speechService.transcribeAudio(req.file.buffer, req.file.mimetype, "en-US");
      const updated = await params.store.setVoice(reportId, { audioUrl, transcript }, req.session.user!.id);
      res.json(updated);
    }
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

  return router;
}
