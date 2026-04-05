import request from "supertest";
import { createApp } from "../src/app";

function testApp() {
  const { app } = createApp({
    store: {
      createTemplate: jest.fn(),
      listTemplates: jest.fn(),
      createReport: jest.fn(),
      listReports: jest.fn(),
      getReport: jest.fn(),
      appendVersion: jest.fn(),
      addAttachment: jest.fn(),
      setVoice: jest.fn(),
    } as never,
    reportService: {
      createReport: jest.fn(),
      addAddendum: jest.fn(),
    } as never,
    storageService: { uploadBuffer: jest.fn(), deleteObject: jest.fn() } as never,
    speechService: {
      transcribeAudio: jest.fn().mockResolvedValue({ transcript: "normal lungs" }),
      transcribeRadiology: jest.fn().mockResolvedValue({
        rawTranscript: "there is patchy ggo in the right lower lobe",
        correctedTranscript: "Patchy ground-glass opacity is noted in the right lower lobe with mild pleural effusion.",
        radiologyReport: {
          findings: "Patchy ground-glass opacity is noted in the right lower lobe with mild pleural effusion.",
          impression: "Findings suggest inflammatory or infectious etiology.",
          corrections_applied: ["ggo → ground-glass opacity"],
        },
        confidence: 0.92,
        modelUsed: "medasr-radiology",
      }),
    } as never,
    emailService: { sendReportShareEmail: jest.fn() } as never,
    pdfService: { buildReportPdf: jest.fn() } as never,
    dicoogleService: { fetchStudyMetadata: jest.fn() } as never,
  });

  return app;
}

describe("Transcription endpoint", () => {
  it("returns transcript", async () => {
    const app = testApp();
    const response = await request(app)
      .post("/transcribe")
      .attach("audio", Buffer.from("123"), { filename: "note.mp3", contentType: "audio/mpeg" });

    expect(response.status).toBe(200);
    expect(response.body.transcript).toBe("normal lungs");
  });

  it("returns structured radiology report", async () => {
    const app = testApp();
    const response = await request(app)
      .post("/transcribe/radiology")
      .attach("audio", Buffer.from("123"), { filename: "dictation.webm", contentType: "audio/webm" });

    expect(response.status).toBe(200);
    expect(response.body.report).toBeDefined();
    expect(response.body.report.findings).toContain("ground-glass opacity");
    expect(response.body.report.impression).toContain("inflammatory");
    expect(response.body.rawTranscript).toBe("there is patchy ggo in the right lower lobe");
    expect(response.body.confidence).toBeGreaterThan(0.5);
  });
});
