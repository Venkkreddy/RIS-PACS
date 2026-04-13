import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import axios from "axios";
import { InMemoryStoreService } from "../src/services/inMemoryStore";

const TEST_STORAGE_ROOT = path.join(os.tmpdir(), "tdai-dicom-multi-image-tests");

process.env.DICOOGLE_STORAGE_DIR = TEST_STORAGE_ROOT;
process.env.TENANT_STORAGE_ROOT = TEST_STORAGE_ROOT;
process.env.MULTI_TENANT_ENABLED = "false";
process.env.DICOOGLE_BASE_URL = "http://127.0.0.1:65535";

jest.mock("dicom-parser", () => {
  const parseDicom = jest.fn((byteArray: Uint8Array) => {
    const raw = Buffer.from(
      byteArray.buffer,
      byteArray.byteOffset,
      byteArray.byteLength,
    ).toString("utf8");
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const payload =
      start >= 0 && end > start ? JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown> : {};

    const readString = (tag: string): string | undefined => {
      const value = payload[tag];
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      return undefined;
    };
    const readNumber = (tag: string): number | undefined => {
      const value = readString(tag);
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    return {
      elements: {},
      string: readString,
      intString: readNumber,
      uint16: readNumber,
    };
  });

  return {
    __esModule: true,
    default: {
      parseDicom,
    },
  };
});

type CreateAppFn = typeof import("../src/app").createApp;

let createApp: CreateAppFn;

function buildFakeDicomBuffer(tags: Record<string, string>): Buffer {
  return Buffer.from(
    JSON.stringify({
      ...tags,
      __pad: "x".repeat(300),
    }),
    "utf8",
  );
}

async function loginAsAdmin(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  const loginResponse = await agent.post("/auth/dev-login").send({ role: "admin" });
  expect(loginResponse.status).toBe(200);
  return agent;
}

describe("DICOM upload and retrieval (multi-image)", () => {
  beforeAll(async () => {
    ({ createApp } = await import("../src/app"));
  });

  beforeEach(() => {
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_STORAGE_ROOT, { recursive: true });

    jest.spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url.endsWith("/login")) {
        return { data: { token: "test-token" } } as Awaited<ReturnType<typeof axios.post>>;
      }
      return { data: {} } as Awaited<ReturnType<typeof axios.post>>;
    });
    jest.spyOn(axios, "get").mockRejectedValue(new Error("Dicoogle unavailable in tests"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
  });

  it("stores and retrieves multiple DICOM images for one patient", async () => {
    const store = new InMemoryStoreService();
    const { app } = createApp({ store: store as never });
    const agent = await loginAsAdmin(app);

    const patientId = "MRN-MULTI-1001";
    const patientName = "Multi Image Patient";
    const studyUID = "1.2.840.113619.2.55.3.604688435.12.5001";
    const seriesUID = "1.2.840.113619.2.55.3.604688435.12.7001";
    const sopUIDA = "1.2.840.113619.2.55.3.604688435.12.9001";
    const sopUIDB = "1.2.840.113619.2.55.3.604688435.12.9002";

    const dicomA = buildFakeDicomBuffer({
      x00100020: patientId,
      x00100010: patientName,
      x0020000d: studyUID,
      x0020000e: seriesUID,
      x00080018: sopUIDA,
      x00080060: "CT",
      x00080020: "20260406",
      x00200011: "1",
    });
    const dicomB = buildFakeDicomBuffer({
      x00100020: patientId,
      x00100010: patientName,
      x0020000d: studyUID,
      x0020000e: seriesUID,
      x00080018: sopUIDB,
      x00080060: "CT",
      x00080020: "20260406",
      x00200011: "1",
    });

    const uploadResponse = await agent
      .post("/dicom/upload")
      .field("patientId", patientId)
      .field("patientName", patientName)
      .attach("files", dicomA, { filename: "img-a.dcm", contentType: "application/dicom" })
      .attach("files", dicomB, { filename: "img-b.dcm", contentType: "application/dicom" });

    expect(uploadResponse.status).toBe(200);
    const uploadBody = uploadResponse.body as {
      results: Array<{ status: string }>;
      studyIds: string[];
    };
    expect(uploadBody.results.filter((item) => item.status === "stored")).toHaveLength(2);
    expect(uploadBody.studyIds).toContain(studyUID);

    const patientDir = path.join(TEST_STORAGE_ROOT, patientId);
    expect(fs.existsSync(patientDir)).toBe(true);
    const storedFiles = fs.readdirSync(patientDir, { withFileTypes: true })
      .filter((entry) => entry.isFile());
    expect(storedFiles).toHaveLength(2);

    const storedStudy = await store.getStudyRecord(studyUID);
    expect(storedStudy).not.toBeNull();
    expect((storedStudy?.metadata as Record<string, unknown> | undefined)?.fileCount).toBe(2);

    const studiesResponse = await agent
      .get("/dicom-web/studies")
      .query({ StudyInstanceUID: studyUID });
    expect(studiesResponse.status).toBe(200);
    expect(studiesResponse.body).toHaveLength(1);
    expect(studiesResponse.body[0]["0020000D"].Value[0]).toBe(studyUID);
    expect(studiesResponse.body[0]["00201208"].Value[0]).toBe(2);

    const seriesResponse = await agent.get(`/dicom-web/studies/${encodeURIComponent(studyUID)}/series`);
    expect(seriesResponse.status).toBe(200);
    expect(seriesResponse.body).toHaveLength(1);
    expect(seriesResponse.body[0]["0020000E"].Value[0]).toBe(seriesUID);

    const instancesResponse = await agent.get(
      `/dicom-web/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances`,
    );
    expect(instancesResponse.status).toBe(200);
    expect(instancesResponse.body).toHaveLength(2);
    const returnedSopUids = (instancesResponse.body as Array<Record<string, unknown>>)
      .map((instance) => (instance["00080018"] as { Value: string[] }).Value[0]);
    expect(new Set(returnedSopUids)).toEqual(new Set([sopUIDA, sopUIDB]));

    const seriesWadoResponse = await agent.get(
      `/dicom-web/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}`,
    );
    expect(seriesWadoResponse.status).toBe(200);
    expect(String(seriesWadoResponse.headers["content-type"] ?? "")).toContain(
      'multipart/related; type="application/dicom"',
    );

    for (const sopUID of [sopUIDA, sopUIDB]) {
      const instanceResponse = await agent.get(
        `/dicom-web/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(sopUID)}`,
      );
      expect(instanceResponse.status).toBe(200);
      expect(String(instanceResponse.headers["content-type"] ?? "")).toContain("multipart/related");
    }
  });
});
