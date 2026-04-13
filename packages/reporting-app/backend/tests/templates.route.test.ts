import request from "supertest";
import { createApp } from "../src/app";

async function login(app: any, role: string) {
  const agent = request.agent(app);
  await agent.post("/auth/dev-login").send({ role });
  return agent;
}

const makeApp = () => {
  const store: any = {
    createTemplate: jest.fn().mockResolvedValue({ id: "t1", name: "CT Head", content: "{}", ownerId: "dev-radiologist" }),
    listTemplates: jest.fn().mockResolvedValue([{ id: "t1", name: "CT Head", content: "{}", ownerId: "dev-radiologist" }]),
    getRolePermissions: jest.fn().mockResolvedValue(null),
  };

  const reportService = {
    createReport: jest.fn(),
    addAddendum: jest.fn(),
  } as never;

  const { app } = createApp({
    store,
    reportService,
    storageService: { uploadBuffer: jest.fn(), deleteObject: jest.fn() } as never,
    emailService: { sendReportShareEmail: jest.fn() } as never,
    pdfService: { buildReportPdf: jest.fn() } as never,
    dicoogleService: { fetchStudyMetadata: jest.fn() } as never,
  });

  return { app, store };
};

describe("Template routes", () => {
  it("creates a template (templates:create = admin, radiologist)", async () => {
    const { app, store } = makeApp();
    const agent = await login(app, "radiologist");

    const response = await agent.post("/templates").send({ name: "Chest", content: "<p>Template</p>" });

    expect(response.status).toBe(201);
    expect(store.createTemplate).toHaveBeenCalled();
  });
});
