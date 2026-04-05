import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { DicoogleService } from "../services/dicoogleService";
import { ReportService } from "../services/reportService";
import { logger } from "../services/logger";

const webhookSchema = z.object({
  studyId: z.string().min(1),
  tenantSlug: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  ownerId: z.string().default("system"),
});

export function webhookRouter(reportService: ReportService, dicoogle: DicoogleService): Router {
  const router = Router();

  router.post("/study", asyncHandler(async (req, res) => {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers["x-webhook-secret"] as string | undefined;
      if (provided !== webhookSecret) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }
    }

    const payload = webhookSchema.parse(req.body);
    const metadata = payload.metadata ?? (await dicoogle.fetchStudyMetadata(payload.studyId).catch(() => ({})));
    const draftMetadata = {
      ...metadata,
      reportStatus: "draft",
      source: "dicoogle-webhook",
      receivedAt: new Date().toISOString(),
      ...(payload.tenantSlug ? { tenantSlug: payload.tenantSlug } : {}),
    };

    // Multi-tenant: resolve tenant from the slug embedded by the Lua webhook
    if (env.MULTI_TENANT_ENABLED && payload.tenantSlug) {
      try {
        const { getFirestore } = await import("../services/firebaseAdmin");
        const db = getFirestore();
        const snapshot = await db.collection("tenants_meta")
          .where("slug", "==", payload.tenantSlug)
          .where("is_active", "==", true)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const tenantId = snapshot.docs[0].id;
          const { TenantScopedStore } = await import("../services/tenantScopedStore");
          const tenantStore = new TenantScopedStore();
          await tenantStore.upsertStudy(tenantId, {
            studyInstanceUid: payload.studyId,
            patientName: (metadata as Record<string, unknown>).patientName as string | undefined,
            studyDate: (metadata as Record<string, unknown>).studyDate as string | undefined,
            modality: (metadata as Record<string, unknown>).modality as string | undefined,
            location: (metadata as Record<string, unknown>).aeTitle as string | undefined,
            status: "unassigned",
            metadata: draftMetadata,
          });
          logger.info({
            message: "Webhook: tenant-scoped study upserted",
            tenantSlug: payload.tenantSlug,
            tenantId,
            studyId: payload.studyId,
          });
        }
      } catch (err) {
        logger.warn({
          message: "Webhook: failed to upsert tenant-scoped study",
          tenantSlug: payload.tenantSlug,
          error: String(err),
        });
      }
    }

    const report = await reportService.createReport({
      studyId: payload.studyId,
      content: "",
      ownerId: payload.ownerId,
      metadata: draftMetadata,
    });

    res.status(201).json({ message: "Draft report created", report });
  }));

  return router;
}
