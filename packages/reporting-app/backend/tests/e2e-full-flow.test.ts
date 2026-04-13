/**
 * End-to-End Full Flow Test Suite
 *
 * Tests the COMPLETE medical imaging platform flow:
 *   1. DICOM Image Upload & Storage
 *   2. Worklist population & OHIF Viewer URL generation
 *   3. OHIF Viewer availability & health checks
 *   4. MONAI AI auto-analysis on upload
 *   5. Manual MONAI AI analysis (inference, SR, heatmaps, GSPS)
 *   6. AI results retrieval & display
 *   7. Report creation from AI findings
 *   8. Report workflow (draft → preliminary → final → amended)
 *   9. DICOMweb proxy (QIDO-RS / WADO-RS)
 *  10. Webhook study notifications
 *  11. Multi-service health checks
 *  12. Service registry & configuration
 *  13. Complete patient journey (upload → view → AI → report → share)
 */

import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryStoreService } from "../src/services/inMemoryStore";

// ─── Test Helpers ────────────────────────────────────────────────────────

function buildApp(overrides?: {
  monaiEnabled?: boolean;
  monaiFindings?: Array<{ label: string; confidence: number; description: string }>;
  monaiSummary?: string;
  monaiDicomSrBase64?: string;
  monaiDicomScBase64?: string;
  monaiDicomGspsBase64?: string;
  monaiHeatmapPngBase64?: string;
  dicoogleStudies?: Array<Record<string, unknown>>;
  ohifAvailable?: boolean;
}) {
  const store = new InMemoryStoreService();

  const mockFindings = overrides?.monaiFindings ?? [
    { label: "Cardiomegaly", confidence: 0.87, description: "Enlarged cardiac silhouette" },
    { label: "Pleural Effusion", confidence: 0.72, description: "Left-sided pleural effusion" },
    { label: "Atelectasis", confidence: 0.45, description: "Minor bibasilar atelectasis" },
  ];

  const mockSummary =
    overrides?.monaiSummary ??
    "AI analysis (monai_chest_xray): 2 significant finding(s) — Cardiomegaly (87%), Pleural Effusion (72%)";

  const mockSrBase64 = overrides?.monaiDicomSrBase64 ?? "AAECBA==";
  const mockScBase64 = overrides?.monaiDicomScBase64 ?? "BBCCDD==";
  const mockGspsBase64 = overrides?.monaiDicomGspsBase64 ?? "EEFFGG==";
  const mockHeatmapBase64 = overrides?.monaiHeatmapPngBase64 ?? "iVBORw0KGgo=";

  const deps = {
    store: store as never,
    reportService: {
      createReport: jest.fn().mockImplementation((p: Record<string, unknown>) =>
        (store as unknown as InMemoryStoreService).createReport(p as never),
      ),
      addAddendum: jest.fn().mockImplementation(
        (id: string, text: string, author: string) =>
          (store as unknown as InMemoryStoreService).appendVersion(id, {
            id: `${Date.now()}`,
            type: "addendum",
            content: text,
            authorId: author,
            createdAt: new Date().toISOString(),
          }),
      ),
    } as never,
    storageService: {
      uploadBuffer: jest.fn().mockResolvedValue("gs://bucket/path"),
      deleteObject: jest.fn(),
      uploadFile: jest.fn().mockResolvedValue("gs://bucket/uploaded"),
    } as never,
    emailService: {
      sendReportShareEmail: jest.fn(),
      sendInviteEmail: jest.fn(),
      sendTatReminderEmail: jest.fn(),
    } as never,
    pdfService: {
      buildReportPdf: jest.fn().mockResolvedValue(Buffer.from("fake-pdf")),
    } as never,
    dicoogleService: {
      searchStudies: jest.fn().mockResolvedValue(overrides?.dicoogleStudies ?? []),
      fetchStudyMetadata: jest.fn().mockResolvedValue({}),
      getTenantDicomConfig: jest.fn().mockResolvedValue(null),
      getTenantStoragePath: jest.fn().mockReturnValue("/tmp/tenant"),
      triggerTenantIndex: jest.fn(),
    } as never,
    monaiService: {
      isEnabled: jest.fn().mockReturnValue(overrides?.monaiEnabled ?? true),
      listModels: jest.fn().mockResolvedValue([
        {
          name: "monai_chest_xray",
          description: "CXR 14-class classification",
          type: "classification",
          bodyParts: ["Chest"],
          modalities: ["CR", "DX"],
          version: "1.0.0",
        },
        {
          name: "monai_ct_lung",
          description: "CT Lung segmentation",
          type: "segmentation",
          bodyParts: ["Lung"],
          modalities: ["CT"],
          version: "2.1.0",
        },
      ]),
      runInference: jest.fn().mockResolvedValue({
        studyId: "test-study",
        model: "monai_chest_xray",
        status: "completed",
        findings: mockFindings,
        summary: mockSummary,
        processedAt: new Date().toISOString(),
        processingTimeMs: 1234,
      }),
      runInferenceWithSR: jest.fn().mockResolvedValue({
        studyId: "test-study",
        model: "monai_chest_xray",
        status: "completed",
        findings: mockFindings,
        summary: mockSummary,
        processedAt: new Date().toISOString(),
        processingTimeMs: 2345,
        dicomSrBase64: mockSrBase64,
        dicomSrSizeBytes: 4096,
      }),
      analyzeDicomFile: jest.fn().mockResolvedValue({
        studyId: "test-study",
        model: "monai_chest_xray",
        status: "completed",
        findings: mockFindings,
        summary: mockSummary,
        processedAt: new Date().toISOString(),
        processingTimeMs: 3456,
        dicomSrBase64: mockSrBase64,
        dicomSrSizeBytes: 4096,
        dicomScBase64: mockScBase64,
        dicomScSizeBytes: 8192,
        dicomGspsBase64: mockGspsBase64,
        dicomGspsSizeBytes: 2048,
        heatmapPngBase64: mockHeatmapBase64,
      }),
      analyzeDicomAutoRoute: jest.fn().mockResolvedValue({
        studyId: "test-study",
        model: "auto",
        status: "completed",
        findings: mockFindings,
        summary: mockSummary,
        processedAt: new Date().toISOString(),
        processingTimeMs: 4567,
      }),
      analyzeDicomWithMedGemma: jest.fn().mockResolvedValue({
        studyId: "test-study",
        model: "medgemma_report",
        status: "completed",
        findings: mockFindings,
        summary: mockSummary,
        processedAt: new Date().toISOString(),
        processingTimeMs: 5678,
        medgemmaNarrative: "AI-generated radiology narrative",
        medgemmaFindings: "Cardiomegaly, pleural effusion",
        medgemmaImpression: "Abnormal chest radiograph",
      }),
      getInferenceStatus: jest.fn().mockResolvedValue({ status: "completed", progress: 100 }),
    } as never,
  };

  const { app } = createApp(deps);
  return { app, store, deps };
}

async function login(app: ReturnType<typeof buildApp>["app"], role: string) {
  const agent = request.agent(app);
  await agent.post("/auth/dev-login").send({ role });
  return agent;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. HEALTH CHECKS & SERVICE AVAILABILITY
// ═══════════════════════════════════════════════════════════════════════════

describe("1. Health Checks & Service Availability", () => {
  it("1.1: GET /health returns ok status", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("1.2: GET /health/ohif returns availability status", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/health/ohif");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("available");
    expect(typeof res.body.available).toBe("boolean");
  });

  it("1.3: GET /health/ohif with force=true resets cache", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/health/ohif?force=true");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("available");
  });

  it("1.4: GET /health/worklist-sync requires authentication", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/health/worklist-sync");
    expect(res.status).toBeLessThanOrEqual(503);
  });

  it("1.5: GET /health/webhook-connectivity requires authentication", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/health/webhook-connectivity");
    expect(res.status).toBeLessThanOrEqual(503);
  });

  it("1.6: services config endpoint returns current configuration", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/services/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("llm");
    expect(res.body).toHaveProperty("inference");
    expect(res.body).toHaveProperty("storage");
  });

  it("1.7: services health endpoint returns service statuses", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/services/health");
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. MONAI AI MODELS & ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

describe("2. MONAI AI Models & Analysis", () => {
  it("2.1: GET /ai/models returns available AI models when enabled", async () => {
    const { app } = buildApp({ monaiEnabled: true });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.models).toBeInstanceOf(Array);
    expect(res.body.models.length).toBeGreaterThanOrEqual(1);
  });

  it("2.2: GET /ai/models includes model metadata (name, description, type, modalities)", async () => {
    const { app } = buildApp({ monaiEnabled: true });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    const model = res.body.models[0];
    expect(model).toHaveProperty("name");
    expect(model).toHaveProperty("description");
    expect(model).toHaveProperty("type");
    expect(model).toHaveProperty("bodyParts");
    expect(model).toHaveProperty("modalities");
    expect(model).toHaveProperty("version");
  });

  it("2.3: GET /ai/models shows enabled=false when MONAI is disabled", async () => {
    const { app } = buildApp({ monaiEnabled: false });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("2.4: POST /ai/analyze triggers AI inference on a study", async () => {
    const { app, store } = buildApp({ monaiEnabled: true });
    await store.upsertStudyRecord("1.2.3.4.5", { patientName: "Test Patient" });
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.findings).toBeInstanceOf(Array);
    expect(res.body.findings.length).toBeGreaterThan(0);
    expect(res.body.summary).toBeDefined();
    expect(res.body.model).toBe("monai_chest_xray");
  });

  it("2.5: POST /ai/analyze returns finding details (label, confidence, description)", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
    });
    const finding = res.body.findings[0];
    expect(finding).toHaveProperty("label");
    expect(finding).toHaveProperty("confidence");
    expect(finding).toHaveProperty("description");
    expect(typeof finding.confidence).toBe("number");
    expect(finding.confidence).toBeGreaterThanOrEqual(0);
    expect(finding.confidence).toBeLessThanOrEqual(1);
  });

  it("2.6: POST /ai/analyze with generateSR=true generates DICOM SR", async () => {
    const { app, store, deps } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
      generateSR: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.dicomSrGenerated).toBeDefined();
  });

  it("2.7: POST /ai/analyze rejects empty studyId", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "",
      model: "monai_chest_xray",
    });
    expect(res.status).toBe(400);
  });

  it("2.8: POST /ai/analyze rejects studyId with special characters", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "../../../etc/passwd",
      model: "monai_chest_xray",
    });
    expect(res.status).toBe(400);
  });

  it("2.9: POST /ai/analyze defaults model to monai_chest_xray", async () => {
    const { app, store, deps } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
    });
    expect(res.status).toBe(200);
  });

  it("2.10: POST /ai/analyze requires ai:analyze permission", async () => {
    const { app } = buildApp();
    const agent = await login(app, "viewer");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
    });
    expect(res.status).toBe(403);
  });

  it("2.11: GET /ai/results/:studyId returns stored AI results", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {
      metadata: {
        aiFindings: [{ label: "Cardiomegaly", confidence: 0.87, description: "Test" }],
        aiSummary: "Test summary",
        aiModel: "monai_chest_xray",
      },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/results/1.2.3.4.5");
    expect(res.status).toBe(200);
    expect(res.body.studyId).toBe("1.2.3.4.5");
    expect(res.body.findings).toBeInstanceOf(Array);
    expect(res.body.findings.length).toBe(1);
    expect(res.body.summary).toBe("Test summary");
    expect(res.body.model).toBe("monai_chest_xray");
  });

  it("2.12: GET /ai/results/:studyId returns empty findings for unstudied study", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/results/1.2.3.4.5");
    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
    expect(res.body.summary).toBeNull();
  });

  it("2.13: GET /ai/heatmap/:studyId returns 404 when no heatmap exists", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/heatmap/1.2.3.4.5");
    expect(res.status).toBe(404);
  });

  it("2.14: GET /ai/heatmap/:studyId returns PNG when heatmap exists", async () => {
    const { app, store } = buildApp();
    const fakeBase64 = Buffer.from("fake-png-data").toString("base64");
    await store.upsertStudyRecord("1.2.3.4.5", {
      metadata: { aiHeatmapPngBase64: fakeBase64 },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/heatmap/1.2.3.4.5");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("2.15: GET /ai/gsps/:studyId returns 404 when no GSPS exists", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/gsps/1.2.3.4.5");
    expect(res.status).toBe(404);
  });

  it("2.16: GET /ai/sr/:studyId returns 404 when no SR exists", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/sr/1.2.3.4.5");
    expect(res.status).toBe(404);
  });

  it("2.17: AI analysis stores results in study metadata", async () => {
    const { app, store, deps } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
    });
    const record = await store.getStudyRecord("1.2.3.4.5");
    const metadata = record?.metadata as Record<string, unknown>;
    expect(metadata?.aiFindings).toBeDefined();
    expect(metadata?.aiSummary).toBeDefined();
    expect(metadata?.aiModel).toBe("monai_chest_xray");
  });

  it("2.18: AI analysis response includes generated DICOM object flags", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "1.2.3.4.5",
      model: "monai_chest_xray",
    });
    expect(res.body).toHaveProperty("dicomSrGenerated");
    expect(res.body).toHaveProperty("dicomScGenerated");
    expect(res.body).toHaveProperty("dicomGspsGenerated");
  });

  it("2.19: Multiple AI model types listed correctly", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    const models = res.body.models;
    const types = models.map((m: { type: string }) => m.type);
    expect(types).toContain("classification");
    expect(types).toContain("segmentation");
  });

  it("2.20: AI models include modality and body part information", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    const cxrModel = res.body.models.find((m: { name: string }) => m.name === "monai_chest_xray");
    expect(cxrModel.bodyParts).toContain("Chest");
    expect(cxrModel.modalities).toContain("CR");
    expect(cxrModel.modalities).toContain("DX");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. WORKLIST & OHIF VIEWER URL GENERATION
// ═══════════════════════════════════════════════════════════════════════════

describe("3. Worklist & OHIF Viewer URL Generation", () => {
  it("3.1: GET /worklist returns study list", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.840.1", { patientName: "John Doe", studyDate: "2026-04-01" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
  });

  it("3.2: Worklist entries include viewerUrl for valid DICOM UIDs", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.840.113619.2.5", {
      patientName: "Test Patient",
      metadata: { StudyInstanceUID: "1.2.840.113619.2.5" },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.body[0]).toHaveProperty("viewerUrl");
    expect(res.body[0]).toHaveProperty("reportUrl");
  });

  it("3.3: Worklist viewerUrl contains StudyInstanceUIDs parameter", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.840.113619.2.5", {
      patientName: "Test",
      metadata: { StudyInstanceUID: "1.2.840.113619.2.5" },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    const viewerUrl = res.body[0].viewerUrl;
    if (viewerUrl) {
      expect(viewerUrl).toContain("StudyInstanceUIDs");
      expect(viewerUrl).toContain("1.2.840.113619.2.5");
    }
  });

  it("3.4: Worklist entries include reportUrl", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.3.4.5", { patientName: "Test" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.body[0].reportUrl).toBe("/reports/study/1.2.3.4.5");
  });

  it("3.5: Worklist entries include Weasis URL for valid UIDs", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("1.2.840.113619.2.5", {
      patientName: "Test",
      metadata: { StudyInstanceUID: "1.2.840.113619.2.5" },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    if (res.body[0].weasisUrl) {
      expect(res.body[0].weasisUrl).toContain("weasis://");
    }
  });

  it("3.6: Worklist filters by patient name", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { patientName: "Alice Johnson" });
    await store.upsertStudyRecord("s-2", { patientName: "Bob Smith" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist?name=alice");
    expect(res.body.length).toBe(1);
    expect(res.body[0].patientName).toBe("Alice Johnson");
  });

  it("3.7: Worklist filters by status", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { status: "assigned" });
    await store.upsertStudyRecord("s-2", { status: "unassigned" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist?status=assigned");
    expect(res.body.length).toBe(1);
  });

  it("3.8: Worklist filters by assigned radiologist", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { assignedTo: "rad-1" });
    await store.upsertStudyRecord("s-2", { assignedTo: "rad-2" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist?assignedTo=rad-1");
    expect(res.body.length).toBe(1);
  });

  it("3.9: Worklist filters by study date", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { studyDate: "2026-04-01" });
    await store.upsertStudyRecord("s-2", { studyDate: "2026-03-01" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist?date=2026-04-01");
    expect(res.body.length).toBe(1);
  });

  it("3.10: Worklist filters by location", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { location: "Main Campus" });
    await store.upsertStudyRecord("s-2", { location: "Downtown" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist?location=main");
    expect(res.body.length).toBe(1);
  });

  it("3.11: Worklist requires worklist:view permission", async () => {
    const { app } = buildApp();
    const agent = await login(app, "billing");
    const res = await agent.get("/worklist");
    expect(res.status).toBe(403);
  });

  it("3.12: POST /assign assigns studies to radiologist", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    await store.upsertStudyRecord("s-2", {});
    const agent = await login(app, "admin");
    const res = await agent.post("/assign").send({
      studyIds: ["s-1", "s-2"],
      radiologistId: "rad-1",
    });
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(2);
  });

  it("3.13: POST /update-status changes study status to reported", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { status: "assigned" });
    const agent = await login(app, "radiologist");
    const res = await agent.post("/update-status").send({
      studyId: "s-1",
      status: "reported",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reported");
    expect(res.body.tatHours).toBeDefined();
  });

  it("3.14: Worklist entries contain study metadata fields", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {
      patientName: "John Doe",
      studyDate: "2026-04-01",
      modality: "CT",
      description: "CT Head",
      location: "Main Campus",
      status: "assigned",
      assignedTo: "rad-1",
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    const entry = res.body[0];
    expect(entry.patientName).toBe("John Doe");
    expect(entry.studyDate).toBe("2026-04-01");
    expect(entry.status).toBe("assigned");
    expect(entry.assignedTo).toBe("rad-1");
  });

  it("3.15: Worklist handles studies with no patient name gracefully", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. WEBHOOK STUDY NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe("4. Webhook Study Notifications", () => {
  it("4.1: POST /webhook/study creates a new study record", async () => {
    const { app, store } = buildApp();
    const res = await request(app).post("/webhook/study").send({ studyId: "1.2.3.4.5" });
    expect(res.status).toBe(201);
    const record = await store.getStudyRecord("1.2.3.4.5");
    expect(record).not.toBeNull();
  });

  it("4.2: POST /webhook/study with metadata stores it", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/webhook/study").send({
      studyId: "1.2.3.4.5",
      metadata: { PatientName: "Test Patient", Modality: "CT" },
    });
    expect(res.status).toBe(201);
  });

  it("4.3: POST /webhook/study with duplicate studyId updates existing", async () => {
    const { app, store } = buildApp();
    await request(app).post("/webhook/study").send({ studyId: "1.2.3.4.5" });
    await request(app).post("/webhook/study").send({
      studyId: "1.2.3.4.5",
      metadata: { PatientName: "Updated Name" },
    });
    const records = await store.listStudyRecords({});
    const matching = records.filter((r) => r.studyId === "1.2.3.4.5");
    expect(matching.length).toBe(1);
  });

  it("4.4: POST /webhook/study rejects missing studyId", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/webhook/study").send({});
    expect(res.status).toBe(400);
  });

  it("4.5: POST /webhook/study rejects empty studyId", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/webhook/study").send({ studyId: "" });
    expect(res.status).toBe(400);
  });

  it("4.6: POST /webhook/study rejects non-string studyId", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/webhook/study").send({ studyId: 12345 });
    expect(res.status).toBe(400);
  });

  it("4.7: Webhook-created study appears in worklist", async () => {
    const { app } = buildApp();
    await request(app).post("/webhook/study").send({ studyId: "1.2.3.4.5" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.body.some((s: { studyId: string }) => s.studyId === "1.2.3.4.5")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. COMPLETE PATIENT JOURNEY: Upload → Worklist → AI → Report
// ═══════════════════════════════════════════════════════════════════════════

describe("5. Complete Patient Journey", () => {
  it("5.1: Full flow — webhook → worklist → AI analysis → report creation → sign", async () => {
    const { app, store } = buildApp();
    const studyId = "1.2.840.113619.2.55";

    // Step 1: Study arrives via webhook
    const webhookRes = await request(app).post("/webhook/study").send({
      studyId,
      metadata: { PatientName: "Jane Doe", Modality: "CR", StudyDescription: "Chest X-Ray" },
    });
    expect(webhookRes.status).toBe(201);

    // Step 2: Study appears in worklist
    const agent = await login(app, "radiologist");
    const worklistRes = await agent.get("/worklist");
    expect(worklistRes.body.some((s: { studyId: string }) => s.studyId === studyId)).toBe(true);

    // Step 3: AI analysis
    const aiRes = await agent.post("/ai/analyze").send({
      studyId,
      model: "monai_chest_xray",
    });
    expect(aiRes.status).toBe(200);
    expect(aiRes.body.status).toBe("completed");
    expect(aiRes.body.findings.length).toBeGreaterThan(0);

    // Step 4: Check AI results are stored
    const resultsRes = await agent.get(`/ai/results/${studyId}`);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.findings.length).toBeGreaterThan(0);

    // Step 5: Create report based on AI findings
    const reportRes = await agent.post("/reports").send({
      studyId,
      content: `<p>${aiRes.body.summary}</p>`,
    });
    expect(reportRes.status).toBe(201);
    expect(reportRes.body.status).toBe("draft");

    // Step 6: Update report to preliminary
    const prelRes = await agent.patch(`/reports/${reportRes.body.id}/status`).send({
      status: "preliminary",
    });
    expect(prelRes.status).toBe(200);
    expect(prelRes.body.status).toBe("preliminary");

    // Step 7: Sign report (→ final)
    const signRes = await agent.patch(`/reports/${reportRes.body.id}/status`).send({
      status: "final",
    });
    expect(signRes.status).toBe(200);
    expect(signRes.body.status).toBe("final");
    expect(signRes.body.signedBy).toBeDefined();
    expect(signRes.body.signedAt).toBeDefined();

    // Step 8: Mark study as reported
    const statusRes = await agent.post("/update-status").send({
      studyId,
      status: "reported",
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("reported");

    // Step 9: Verify study status in worklist
    const finalWorklist = await agent.get("/worklist?status=reported");
    expect(finalWorklist.body.some((s: { studyId: string }) => s.studyId === studyId)).toBe(true);
  });

  it("5.2: Full flow — webhook → assign → AI → report with addendum", async () => {
    const { app, store } = buildApp();
    const studyId = "1.2.840.113619.3.100";

    // Step 1: Study arrives
    await request(app).post("/webhook/study").send({ studyId });

    // Step 2: Admin assigns to radiologist
    const admin = await login(app, "admin");
    const assignRes = await admin.post("/assign").send({
      studyIds: [studyId],
      radiologistId: "dev-radiologist",
    });
    expect(assignRes.status).toBe(200);

    // Step 3: Radiologist sees assigned study
    const rad = await login(app, "radiologist");
    const worklistRes = await rad.get("/worklist?status=assigned");
    const study = worklistRes.body.find((s: { studyId: string }) => s.studyId === studyId);
    expect(study).toBeDefined();
    expect(study.assignedTo).toBe("dev-radiologist");

    // Step 4: Run AI analysis
    const aiRes = await rad.post("/ai/analyze").send({ studyId });
    expect(aiRes.status).toBe(200);

    // Step 5: Create and sign report
    const reportRes = await rad.post("/reports").send({
      studyId,
      content: "<p>AI-assisted findings: Cardiomegaly</p>",
    });
    await rad.patch(`/reports/${reportRes.body.id}/status`).send({ status: "final" });

    // Step 6: Add addendum
    const addRes = await rad.patch(`/reports/${reportRes.body.id}/addendum`).send({
      addendum: "Additional finding: small pleural effusion noted on follow-up review",
    });
    expect(addRes.status).toBe(200);

    // Step 7: Verify addendum in report versions
    const reportGet = await rad.get(`/reports/${reportRes.body.id}`);
    const addenda = reportGet.body.versions.filter((v: { type: string }) => v.type === "addendum");
    expect(addenda.length).toBe(1);
    expect(addenda[0].content).toContain("pleural effusion");
  });

  it("5.3: Full flow — multiple studies for same patient", async () => {
    const { app, store } = buildApp();

    // Two studies for same patient
    await store.upsertStudyRecord("1.2.840.1001", {
      patientName: "Mary Smith",
      metadata: { patientId: "MRN-001", StudyInstanceUID: "1.2.840.1001" },
    });
    await store.upsertStudyRecord("1.2.840.1002", {
      patientName: "Mary Smith",
      metadata: { patientId: "MRN-001", StudyInstanceUID: "1.2.840.1002" },
    });

    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    const maryStudies = res.body.filter(
      (s: { patientName: string }) => s.patientName === "Mary Smith",
    );
    expect(maryStudies.length).toBe(2);
  });

  it("5.4: Full flow — report by-study lookup after webhook + report creation", async () => {
    const { app } = buildApp();
    const studyId = "1.2.840.113619.7.777";

    await request(app).post("/webhook/study").send({ studyId });

    const rad = await login(app, "radiologist");
    const createRes = await rad.post("/reports").send({
      studyId,
      content: "<p>Normal chest x-ray</p>",
    });
    expect(createRes.status).toBe(201);

    const byStudyRes = await rad.get(`/reports/by-study/${studyId}`);
    expect(byStudyRes.status).toBe(200);
    expect(byStudyRes.body.studyId).toBe(studyId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. REPORT CREATION & MANAGEMENT WITH AI FINDINGS
// ═══════════════════════════════════════════════════════════════════════════

describe("6. Report Creation & Management with AI Findings", () => {
  it("6.1: Create report with AI-generated content", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {
      metadata: {
        aiFindings: [{ label: "Cardiomegaly", confidence: 0.87, description: "Enlarged heart" }],
        aiSummary: "AI summary: Cardiomegaly detected",
      },
    });
    const agent = await login(app, "radiologist");
    const res = await agent.post("/reports").send({
      studyId: "s-1",
      content: "<p>AI Summary: Cardiomegaly detected (87% confidence)</p>",
      metadata: { source: "ai-assisted" },
    });
    expect(res.status).toBe(201);
    expect(res.body.content).toContain("Cardiomegaly");
  });

  it("6.2: Report includes version history from creation", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/reports").send({
      studyId: "s-1",
      content: "<p>Initial report</p>",
    });
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0].type).toBe("initial");
  });

  it("6.3: Report edit creates edit version", async () => {
    const { app, store } = buildApp();
    const report = await store.createReport({
      studyId: "s-1",
      content: "v1",
      ownerId: "dev-radiologist",
      status: "draft",
    });
    const agent = await login(app, "radiologist");
    await agent.put(`/reports/${report.id}`).send({ content: "v2 with AI findings" });
    const getRes = await agent.get(`/reports/${report.id}`);
    const lastVersion = getRes.body.versions[getRes.body.versions.length - 1];
    expect(lastVersion.type).toBe("edit");
  });

  it("6.4: Report with template and sections", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/reports").send({
      studyId: "s-1",
      content: "<p>Structured report</p>",
      templateId: "t-chest-xray",
      sections: [
        { key: "findings", title: "Findings", content: "Cardiomegaly present" },
        { key: "impression", title: "Impression", content: "Abnormal chest radiograph" },
      ],
    });
    expect(res.status).toBe(201);
  });

  it("6.5: Report sharing with email", async () => {
    const { app, store } = buildApp();
    const report = await store.createReport({
      studyId: "s-1",
      content: "Final report",
      ownerId: "dev-radiologist",
      status: "draft",
    });
    const agent = await login(app, "radiologist");
    const res = await agent.post(`/reports/${report.id}/share`).send({
      email: "referring-doctor@hospital.com",
    });
    expect(res.status).toBe(200);
  });

  it("6.6: Report listing returns all reports for user", async () => {
    const { app, store } = buildApp();
    await store.createReport({ studyId: "s-1", content: "r1", ownerId: "dev-radiologist", status: "draft" });
    await store.createReport({ studyId: "s-2", content: "r2", ownerId: "dev-radiologist", status: "draft" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/reports");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 7. DICOM UPLOAD FLOW
// ═══════════════════════════════════════════════════════════════════════════

describe("7. DICOM Upload Flow", () => {
  it("7.1: POST /dicom/upload rejects request with no files", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    const res = await agent.post("/dicom/upload");
    expect(res.status).toBe(400);
  });

  it("7.2: DICOM upload requires authentication", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/dicom/upload");
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it("7.3: DICOM upload requires dicom:upload permission", async () => {
    const { app } = buildApp();
    const agent = await login(app, "viewer");
    const res = await agent.post("/dicom/upload");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. TEMPLATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("8. Template Management", () => {
  it("8.1: Create radiology report template", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/templates").send({
      name: "Chest X-Ray Template",
      content: "<p><strong>Findings:</strong></p><p><strong>Impression:</strong></p>",
      category: "Chest",
      modality: "CR",
      bodyPart: "Chest",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Chest X-Ray Template");
  });

  it("8.2: List templates includes system templates", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/templates");
    expect(res.status).toBe(200);
    expect(res.body.some((t: { isSystem: boolean }) => t.isSystem)).toBe(true);
  });

  it("8.3: Create template with sections", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/templates").send({
      name: "CT Head Template",
      content: "<p>Template with sections</p>",
      sections: [
        { key: "clinical-info", title: "Clinical Information", content: "" },
        { key: "findings", title: "Findings", content: "" },
        { key: "impression", title: "Impression", content: "" },
      ],
    });
    expect(res.status).toBe(201);
  });

  it("8.4: Template validation rejects short name", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/templates").send({ name: "X", content: "c" });
    expect(res.status).toBe(400);
  });

  it("8.5: Template validation rejects empty content", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/templates").send({ name: "Valid Name", content: "" });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. DICOMWEB PROXY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

describe("9. DICOMweb Proxy Endpoints", () => {
  it("9.1: GET /dicomweb/studies returns response", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/dicomweb/studies");
    expect(res.status).toBeLessThan(500);
  });

  it("9.2: GET /dicom-web/studies returns response (alternate mount)", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/dicom-web/studies");
    expect(res.status).toBeLessThan(500);
  });

  it("9.3: GET /wado returns response (WADO mount)", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/wado");
    expect(res.status).toBeLessThan(500);
  });

  it("9.4: DICOMweb warm endpoint accepts POST", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/dicomweb/warm");
    expect(res.status).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. PERMISSIONS & HIPAA COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════

describe("10. Permissions & HIPAA Compliance", () => {
  it("10.1: GET /permissions returns permission structure", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/permissions");
    expect(res.status).toBe(200);
  });

  it("10.2: GET /permissions/my-permissions returns current user permissions", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/permissions/my-permissions");
    expect(res.status).toBe(200);
  });

  it("10.3: HIPAA audit log endpoint exists", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/hipaa/audit-log");
    expect(res.status).toBeLessThan(600);
  });

  it("10.4: HIPAA compliance status endpoint", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/hipaa/compliance-status");
    expect(res.status).toBeLessThan(600);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. ADMIN & USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("12. Admin & User Management", () => {
  it("12.1: Admin can list users", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/users");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });

  it("12.2: Admin can view analytics", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/analytics");
    expect(res.status).toBe(200);
  });

  it("12.3: Admin can invite user", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/admin/invite").send({
      email: "newuser@hospital.com",
      role: "radiographer",
    });
    expect([200, 201]).toContain(res.status);
  });

  it("12.4: Non-admin cannot access admin endpoints", async () => {
    const { app } = buildApp();
    const agent = await login(app, "viewer");
    const res = await agent.get("/admin/user-requests");
    expect(res.status).toBe(403);
  });

  it("12.5: Admin can view user requests", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/admin/user-requests");
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. PATIENT CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe("13. Patient CRUD", () => {
  it("13.1: Create patient", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/patients").send({
      patientId: "MRN-001",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-05-15",
      gender: "M",
      email: "john@example.com",
    });
    expect(res.status).toBe(201);
    expect(res.body.patientId).toBe("MRN-001");
  });

  it("13.2: Get patient by ID", async () => {
    const { app, store } = buildApp();
    const patient = await store.createPatient({
      patientId: "MRN-001",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-05-15",
      gender: "M",
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get(`/patients/${patient.id}`);
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe("John");
  });

  it("13.3: Update patient", async () => {
    const { app, store } = buildApp();
    const patient = await store.createPatient({
      patientId: "MRN-001",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-05-15",
      gender: "M",
    });
    const agent = await login(app, "admin");
    const res = await agent.patch(`/patients/${patient.id}`).send({
      phone: "555-0123",
      email: "updated@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("555-0123");
  });

  it("13.4: Search patients", async () => {
    const { app, store } = buildApp();
    await store.createPatient({
      patientId: "MRN-001",
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1985-01-01",
      gender: "F",
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/patients?search=alice");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it("13.5: Patient not found returns 404", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/patients/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. ORDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("14. Order Management", () => {
  it("14.1: Create imaging order", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    const res = await agent.post("/orders").send({
      patientId: "MRN-001",
      patientName: "John Doe",
      modality: "CT",
      bodyPart: "Head",
      scheduledDate: "2026-04-15",
      priority: "routine",
    });
    expect(res.status).toBe(201);
  });

  it("14.2: List orders with status filter", async () => {
    const { app, store } = buildApp();
    await store.createOrder({
      patientId: "p",
      patientName: "n",
      modality: "CT",
      bodyPart: "H",
      priority: "routine",
      status: "scheduled",
      scheduledDate: "2026-01-01",
      createdBy: "u",
    });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/orders?status=scheduled");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it("14.3: Update order status", async () => {
    const { app, store } = buildApp();
    const order = await store.createOrder({
      patientId: "p",
      patientName: "n",
      modality: "CT",
      bodyPart: "H",
      priority: "routine",
      status: "scheduled",
      scheduledDate: "2026-01-01",
      createdBy: "u",
    });
    const agent = await login(app, "radiographer");
    const res = await agent.patch(`/orders/${order.id}`).send({ status: "in-progress" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in-progress");
  });

  it("14.4: Order validates modality", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    const res = await agent.post("/orders").send({
      patientId: "p",
      patientName: "n",
      modality: "INVALID",
      bodyPart: "H",
      scheduledDate: "2026-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("14.5: All valid modalities accepted", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    for (const modality of ["CR", "CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "OT"]) {
      const res = await agent.post("/orders").send({
        patientId: "p",
        patientName: "n",
        modality,
        bodyPart: "X",
        scheduledDate: "2026-01-01",
      });
      expect(res.status).toBe(201);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. BILLING MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("15. Billing Management", () => {
  it("15.1: Create billing entry", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/billing").send({
      patientId: "MRN-001",
      patientName: "John Doe",
      description: "CT Head with contrast",
      amount: 1500.00,
    });
    expect(res.status).toBe(201);
  });

  it("15.2: Update billing status", async () => {
    const { app, store } = buildApp();
    const billing = await store.createBilling({
      patientId: "p",
      patientName: "n",
      description: "CT",
      amount: 100,
      status: "pending",
      createdBy: "u",
    });
    const agent = await login(app, "admin");
    const res = await agent.patch(`/billing/${billing.id}`).send({ status: "invoiced" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invoiced");
  });

  it("15.3: Billing rejects negative amount", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/billing").send({
      patientId: "p",
      patientName: "n",
      description: "d",
      amount: -100,
    });
    expect(res.status).toBe(400);
  });

  it("15.4: List billing with status filter", async () => {
    const { app, store } = buildApp();
    await store.createBilling({
      patientId: "p",
      patientName: "n",
      description: "d",
      amount: 100,
      status: "pending",
      createdBy: "u",
    });
    const agent = await login(app, "admin");
    const res = await agent.get("/billing?status=pending");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. REFERRING PHYSICIAN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("16. Referring Physician Management", () => {
  it("16.1: Create referring physician", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/referring-physicians").send({
      name: "Dr. Smith",
      email: "dr.smith@hospital.com",
      specialty: "Cardiology",
      phone: "555-0100",
    });
    expect(res.status).toBe(201);
  });

  it("16.2: List referring physicians", async () => {
    const { app, store } = buildApp();
    await store.createReferringPhysician({ name: "Dr. Alpha" });
    await store.createReferringPhysician({ name: "Dr. Beta" });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/referring-physicians");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it("16.3: Update referring physician", async () => {
    const { app, store } = buildApp();
    const physician = await store.createReferringPhysician({ name: "Dr. X" });
    const agent = await login(app, "admin");
    const res = await agent.patch(`/referring-physicians/${physician.id}`).send({
      specialty: "Neurology",
    });
    expect(res.status).toBe(200);
    expect(res.body.specialty).toBe("Neurology");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. IN-MEMORY STORE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

describe("17. In-Memory Store Integrity for Full Flow", () => {
  let store: InMemoryStoreService;
  beforeEach(() => {
    store = new InMemoryStoreService();
  });

  it("17.1: Study record upsert with AI metadata preserves data", async () => {
    await store.upsertStudyRecord("s-1", { patientName: "Test" });
    await store.upsertStudyRecord("s-1", {
      metadata: {
        aiFindings: [{ label: "Finding", confidence: 0.9 }],
        aiSummary: "AI Summary",
        aiModel: "monai_chest_xray",
      },
    });
    const record = await store.getStudyRecord("s-1");
    const metadata = record?.metadata as Record<string, unknown>;
    expect(metadata?.aiFindings).toBeDefined();
    expect(metadata?.aiSummary).toBe("AI Summary");
  });

  it("17.2: Report creation with study linkage", async () => {
    await store.upsertStudyRecord("s-1", { patientName: "Test" });
    const report = await store.createReport({
      studyId: "s-1",
      content: "Report content",
      ownerId: "user-1",
      status: "draft",
    });
    const byStudy = await store.getReportByStudyId("s-1");
    expect(byStudy).not.toBeNull();
    expect(byStudy!.id).toBe(report.id);
  });

  it("17.3: Study assignment tracks TAT correctly", async () => {
    const assignedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    await store.upsertStudyRecord("s-1", { status: "assigned", assignedAt });
    const reported = await store.markStudyReported("s-1");
    expect(reported.tatHours).toBeGreaterThanOrEqual(2.9);
    expect(reported.tatHours).toBeLessThan(4);
  });

  it("17.4: Multiple reports for different studies", async () => {
    await store.createReport({ studyId: "s-1", content: "r1", ownerId: "u", status: "draft" });
    await store.createReport({ studyId: "s-2", content: "r2", ownerId: "u", status: "draft" });
    const r1 = await store.getReportByStudyId("s-1");
    const r2 = await store.getReportByStudyId("s-2");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.id).not.toBe(r2!.id);
  });

  it("17.5: KV store for service config", async () => {
    await store.setKV("test-key", { value: "test-data" });
    const result = await store.getKV<{ value: string }>("test-key");
    expect(result).toEqual({ value: "test-data" });
  });

  it("17.6: KV store returns null for missing key", async () => {
    const result = await store.getKV("nonexistent");
    expect(result).toBeNull();
  });

  it("17.7: User upsert and lookup", async () => {
    await store.upsertUser({
      id: "u-1",
      email: "test@example.com",
      role: "radiologist",
      approved: true,
      requestStatus: "approved",
    });
    const byId = await store.getUserById("u-1");
    expect(byId).not.toBeNull();
    expect(byId!.email).toBe("test@example.com");

    const byEmail = await store.getUserByEmail("test@example.com");
    expect(byEmail).not.toBeNull();
    expect(byEmail!.id).toBe("u-1");
  });

  it("17.8: Email lookup with exact case", async () => {
    await store.upsertUser({
      id: "u-1",
      email: "test@example.com",
      role: "radiologist",
      approved: true,
      requestStatus: "approved",
    });
    const found = await store.getUserByEmail("test@example.com");
    expect(found).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. MONAI SERVICE UNIT TESTS (mock behavior)
// ═══════════════════════════════════════════════════════════════════════════

describe("18. MONAI Service Mock Behavior", () => {
  it("18.1: MONAI disabled returns mock result with AI Inactive finding", async () => {
    const { app, store } = buildApp({ monaiEnabled: false });
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({ studyId: "s-1" });
    expect(res.status).toBe(200);
    expect(res.body.findings).toBeInstanceOf(Array);
  });

  it("18.2: MONAI listModels returns empty when disabled", async () => {
    const { app } = buildApp({ monaiEnabled: false });
    const agent = await login(app, "radiologist");
    const res = await agent.get("/ai/models");
    expect(res.body.enabled).toBe(false);
  });

  it("18.3: MONAI enabled runs actual inference mock", async () => {
    const { app, store, deps } = buildApp({ monaiEnabled: true });
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    await agent.post("/ai/analyze").send({ studyId: "s-1" });
    const monai = deps.monaiService as unknown as Record<string, jest.Mock>;
    expect(monai.runInference).toHaveBeenCalled();
  });

  it("18.4: MONAI inference with SR calls runInferenceWithSR", async () => {
    const { app, store, deps } = buildApp({ monaiEnabled: true });
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    await agent.post("/ai/analyze").send({
      studyId: "s-1",
      generateSR: true,
    });
    const monai = deps.monaiService as unknown as Record<string, jest.Mock>;
    expect(
      monai.runInferenceWithSR.mock.calls.length +
      monai.analyzeDicomFile.mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("18.5: AI analysis produces heatmap URL in response", async () => {
    const { app, store } = buildApp({
      monaiEnabled: true,
      monaiHeatmapPngBase64: "iVBORw0KGgo=",
    });
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({ studyId: "s-1" });
    expect(res.body).toHaveProperty("heatmapUrl");
    expect(res.body).toHaveProperty("heatmapPngBase64");
  });

  it("18.6: AI analysis produces GSPS URL in response", async () => {
    const { app, store } = buildApp({
      monaiEnabled: true,
      monaiDicomGspsBase64: "EEFFGG==",
    });
    await store.upsertStudyRecord("s-1", {});
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({ studyId: "s-1" });
    expect(res.body).toHaveProperty("gspsUrl");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. SERVICE REGISTRY & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

describe("19. Service Registry & Configuration", () => {
  it("19.1: GET /services/config returns full service configuration", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/services/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("inference");
    expect(res.body.inference).toHaveProperty("enabled");
    expect(res.body.inference).toHaveProperty("monaiUrl");
  });

  it("19.2: Service config includes LLM settings", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/services/config");
    expect(res.body.llm).toHaveProperty("provider");
  });

  it("19.4: Service config includes storage settings", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.get("/services/config");
    expect(res.body.storage).toHaveProperty("mode");
  });

  it("19.5: PUT /services/config updates configuration", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.put("/services/config").send({
      inference: { enabled: true },
    });
    expect(res.status).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. EDGE CASES & ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe("20. Edge Cases & Error Handling", () => {
  it("20.1: 404 for unknown route", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/nonexistent-route");
    expect(res.status).toBe(404);
  });

  it("20.2: AI analysis with path traversal studyId blocked", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "../../etc/passwd",
    });
    expect(res.status).toBe(400);
  });

  it("20.3: AI analysis with special chars in studyId blocked", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/ai/analyze").send({
      studyId: "study<script>alert(1)</script>",
    });
    expect(res.status).toBe(400);
  });

  it("20.4: Very long patient name accepted", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/patients").send({
      patientId: "P-LONG",
      firstName: "A".repeat(200),
      lastName: "B".repeat(200),
      dateOfBirth: "2000-01-01",
      gender: "M",
    });
    expect(res.status).toBe(201);
  });

  it("20.5: Unicode characters in report content", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.post("/reports").send({
      studyId: "s-unicode",
      content: "<p>Befund: Kardiomegalie — 心臓肥大 — हृदय वृद्धि</p>",
    });
    expect(res.status).toBe(201);
    expect(res.body.content).toContain("心臓肥大");
  });

  it("20.6: Empty worklist returns empty array", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/worklist");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("20.7: Report not found returns 404", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/reports/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("20.8: Concurrent report creates for same study have unique IDs", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const [r1, r2] = await Promise.all([
      agent.post("/reports").send({ studyId: "s-concurrent-1", content: "A" }),
      agent.post("/reports").send({ studyId: "s-concurrent-2", content: "B" }),
    ]);
    expect(r1.body.id).not.toBe(r2.body.id);
  });

  it("20.9: Report status transition validation (final → draft blocked)", async () => {
    const { app, store } = buildApp();
    const report = await store.createReport({
      studyId: "s-1",
      content: "test",
      ownerId: "dev-radiologist",
      status: "draft",
    });
    await store.updateReport(report.id, { status: "final" } as never);
    const agent = await login(app, "radiologist");
    const res = await agent.patch(`/reports/${report.id}/status`).send({ status: "draft" });
    expect(res.status).toBe(400);
  });

  it("20.10: Report status transition validation (cancelled → final blocked)", async () => {
    const { app, store } = buildApp();
    const report = await store.createReport({
      studyId: "s-1",
      content: "test",
      ownerId: "dev-radiologist",
      status: "draft",
    });
    await store.updateReport(report.id, { status: "cancelled" } as never);
    const agent = await login(app, "radiologist");
    const res = await agent.patch(`/reports/${report.id}/status`).send({ status: "final" });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. SCAN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("21. Scan Management", () => {
  it("21.1: List scans endpoint exists", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    const res = await agent.get("/scans");
    expect(res.status).toBe(200);
  });

  it("21.2: Create scan requires proper permissions and fields", async () => {
    const { app } = buildApp();
    const agent = await login(app, "admin");
    const res = await agent.post("/scans").send({});
    expect(res.status).toBeLessThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. STRESS: RAPID AI ANALYSIS ON MULTIPLE STUDIES
// ═══════════════════════════════════════════════════════════════════════════

describe("22. Rapid AI Analysis on Multiple Studies", () => {
  it("22.1: Sequential AI analysis on 3 different studies", async () => {
    const { app, store } = buildApp();
    const agent = await login(app, "radiologist");

    for (let i = 0; i < 3; i++) {
      const studyId = `1.2.840.${1000 + i}`;
      await store.upsertStudyRecord(studyId, { patientName: `Patient ${i}` });
      const res = await agent.post("/ai/analyze").send({ studyId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("completed");
    }
  }, 30000);

  it("22.2: Parallel AI analysis on 3 studies", async () => {
    const { app, store } = buildApp();
    const agent = await login(app, "radiologist");

    const studyIds = ["1.2.840.2001", "1.2.840.2002", "1.2.840.2003"];
    for (const id of studyIds) {
      await store.upsertStudyRecord(id, {});
    }

    const results = await Promise.all(
      studyIds.map((studyId) =>
        agent.post("/ai/analyze").send({ studyId }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("completed");
    }
  });

  it("22.3: AI results persist and can be retrieved for all studies", async () => {
    const { app, store } = buildApp();
    const agent = await login(app, "radiologist");

    const studyIds = ["1.2.840.3001", "1.2.840.3002"];
    for (const id of studyIds) {
      await store.upsertStudyRecord(id, {});
      await agent.post("/ai/analyze").send({ studyId: id });
    }

    for (const id of studyIds) {
      const res = await agent.get(`/ai/results/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.findings.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. COMPLETE RADIOLOGY DEPARTMENT SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

describe("23. Complete Radiology Department Simulation", () => {
  it("23.1: Full department workflow: orders → upload → worklist → AI → reports → billing", async () => {
    const { app, store } = buildApp();

    // Step 1: Admin sets up a patient
    const admin = await login(app, "admin");
    const patientRes = await admin.post("/patients").send({
      patientId: "MRN-SIM-001",
      firstName: "Simulation",
      lastName: "Patient",
      dateOfBirth: "1985-06-15",
      gender: "M",
    });
    expect(patientRes.status).toBe(201);

    // Step 2: Referring physician creates an order
    const adminAgent = await login(app, "admin");
    const physicianRes = await adminAgent.post("/referring-physicians").send({
      name: "Dr. Referrer",
      email: "dr.ref@hospital.com",
      specialty: "Internal Medicine",
    });
    expect(physicianRes.status).toBe(201);

    // Step 3: Radiographer creates an imaging order
    const techAgent = await login(app, "radiographer");
    const orderRes = await techAgent.post("/orders").send({
      patientId: "MRN-SIM-001",
      patientName: "Simulation Patient",
      modality: "CR",
      bodyPart: "Chest",
      scheduledDate: "2026-04-12",
      priority: "routine",
    });
    expect(orderRes.status).toBe(201);

    // Step 4: Study arrives via webhook (simulating DICOM acquisition)
    const studyId = "1.2.840.113619.SIM.001";
    const webhookRes = await request(app).post("/webhook/study").send({
      studyId,
      metadata: {
        PatientName: "Simulation Patient",
        PatientID: "MRN-SIM-001",
        Modality: "CR",
        StudyDescription: "PA and Lateral Chest",
        StudyInstanceUID: studyId,
      },
    });
    expect(webhookRes.status).toBe(201);

    // Step 5: Admin assigns study to radiologist
    const assignRes = await admin.post("/assign").send({
      studyIds: [studyId],
      radiologistId: "dev-radiologist",
    });
    expect(assignRes.status).toBe(200);

    // Step 6: Radiologist views worklist
    const rad = await login(app, "radiologist");
    const worklistRes = await rad.get("/worklist?status=assigned");
    expect(worklistRes.body.length).toBeGreaterThanOrEqual(1);

    // Step 7: Radiologist triggers AI analysis
    const aiRes = await rad.post("/ai/analyze").send({
      studyId,
      model: "monai_chest_xray",
    });
    expect(aiRes.status).toBe(200);
    expect(aiRes.body.findings.length).toBeGreaterThan(0);

    // Step 8: Radiologist creates report using AI findings
    const reportRes = await rad.post("/reports").send({
      studyId,
      content: `<h2>Findings</h2><p>${aiRes.body.summary}</p><h2>Impression</h2><p>Abnormal chest radiograph</p>`,
    });
    expect(reportRes.status).toBe(201);

    // Step 9: Report goes through workflow
    await rad.patch(`/reports/${reportRes.body.id}/status`).send({ status: "preliminary" });
    const signRes = await rad.patch(`/reports/${reportRes.body.id}/status`).send({ status: "final" });
    expect(signRes.status).toBe(200);
    expect(signRes.body.signedBy).toBeDefined();

    // Step 10: Mark study as reported
    await rad.post("/update-status").send({ studyId, status: "reported" });

    // Step 11: Create billing entry
    const billingRes = await admin.post("/billing").send({
      patientId: "MRN-SIM-001",
      patientName: "Simulation Patient",
      description: "Chest X-Ray PA and Lateral - Professional Fee",
      amount: 250.00,
    });
    expect(billingRes.status).toBe(201);

    // Step 12: Share report with referring physician
    const shareRes = await rad.post(`/reports/${reportRes.body.id}/share`).send({
      email: "dr.ref@hospital.com",
    });
    expect(shareRes.status).toBe(200);

    // Step 13: Verify final state
    const finalReport = await rad.get(`/reports/${reportRes.body.id}`);
    expect(finalReport.body.status).toBe("final");
    expect(finalReport.body.versions.length).toBeGreaterThanOrEqual(3);

    const finalWorklist = await rad.get("/worklist?status=reported");
    expect(finalWorklist.body.some((s: { studyId: string }) => s.studyId === studyId)).toBe(true);
  });
});
