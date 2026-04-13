import request from "supertest";
import { createApp } from "../src/app";

describe("Webhook endpoint", () => {
  it("creates a draft report from study webhook payload", async () => {
    const createReport = jest.fn().mockResolvedValue({
      id: "r-webhook-1",
      studyId: "study-123",
      content: "",
      ownerId: "system",
      metadata: { reportStatus: "draft" },
      versions: [],
      attachments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { app } = createApp({
      store: {
        createTemplate: jest.fn(),
        listTemplates: jest.fn(),
        createReport: jest.fn(),
        listReports: jest.fn(),
        getReport: jest.fn(),
        appendVersion: jest.fn(),
        addAttachment: jest.fn(),
      } as never,
      reportService: {
        createReport,
        addAddendum: jest.fn(),
      } as never,
      storageService: { uploadBuffer: jest.fn(), deleteObject: jest.fn() } as never,
      emailService: { sendReportShareEmail: jest.fn() } as never,
      pdfService: { buildReportPdf: jest.fn() } as never,
      dicoogleService: {
        fetchStudyMetadata: jest.fn().mockResolvedValue({ modality: "CT", patientId: "P-1" }),
      } as never,
    });

    const response = await request(app).post("/webhook/study").send({ studyId: "study-123" });

    expect(response.status).toBe(201);
    expect(createReport).toHaveBeenCalledTimes(1);
    expect(createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        studyId: "study-123",
        content: "",
        metadata: expect.objectContaining({
          reportStatus: "draft",
          source: "dicoogle-webhook",
        }),
      }),
    );
  });
});
