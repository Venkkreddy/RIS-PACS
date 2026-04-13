import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryStoreService } from "../src/services/inMemoryStore";

async function login(app: any, role: string) {
  const agent = request.agent(app);
  await agent.post("/auth/dev-login").send({ role });
  return agent;
}

describe("Share endpoint", () => {
  it("sends report email (reports:share = admin, radiologist)", async () => {
    const emailService = { sendReportShareEmail: jest.fn().mockResolvedValue(undefined) };
    const store = new InMemoryStoreService();
    const report = await store.createReport({
      studyId: "s1",
      content: "<p>ok</p>",
      ownerId: "dev-radiologist",
      status: "draft",
    });

    const { app } = createApp({
      store: store as never,
      reportService: {
        createReport: jest.fn().mockImplementation((p: any) => store.createReport(p)),
        addAddendum: jest.fn(),
      } as never,
      storageService: { uploadBuffer: jest.fn(), deleteObject: jest.fn() } as never,
      emailService: emailService as never,
      pdfService: { buildReportPdf: jest.fn().mockResolvedValue(Buffer.from("pdf")) } as never,
      dicoogleService: { fetchStudyMetadata: jest.fn() } as never,
    });

    const agent = await login(app, "radiologist");
    const response = await agent.post(`/reports/${report.id}/share`).send({ email: "team@example.com" });

    expect(response.status).toBe(200);
    expect(emailService.sendReportShareEmail).toHaveBeenCalledTimes(1);
  });
});
