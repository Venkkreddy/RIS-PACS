import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensureRole } from "../middleware/auth";

const ensureVoiceAccess = ensureRole("radiologist", "admin", "super_admin", "developer");
import { SpeechService } from "../services/speechService";

const upload = multer({ storage: multer.memoryStorage() });

export function transcribeRouter(speechService: SpeechService): Router {
  const router = Router();

  router.post("/", ensureAuthenticated, ensureVoiceAccess, upload.single("audio"), asyncHandler(async (req, res) => {
    if (!req.file) throw new Error("Audio file is required");
    const response = await speechService.transcribeAudio(req.file.buffer, req.file.mimetype, "en-US");
    res.json({ transcript: response.transcript });
  }));

  router.post("/radiology", ensureAuthenticated, ensureVoiceAccess, upload.single("audio"), asyncHandler(async (req, res) => {
    if (!req.file) throw new Error("Audio file is required");

    const result = await speechService.transcribeRadiology(req.file.buffer, req.file.mimetype);

    res.json({
      rawTranscript: result.rawTranscript,
      correctedTranscript: result.correctedTranscript,
      report: result.radiologyReport,
      confidence: result.confidence,
      modelUsed: result.modelUsed,
    });
  }));

  router.post("/browser", ensureAuthenticated, ensureVoiceAccess, asyncHandler(async (req, res) => {
    const { transcript } = req.body as { transcript: string };
    if (!transcript) throw new Error("Transcript is required");

    try {
      const report = await speechService.correctWithLLM(transcript);
      res.json({ report, modelUsed: "browser-stt + llm-correction" });
    } catch {
      res.json({
        report: {
          findings: transcript,
          impression: "Clinical correlation recommended.",
          corrections_applied: ["LLM correction unavailable — raw browser transcript used"],
        },
        modelUsed: "browser-stt (fallback)",
      });
    }
  }));

  return router;
}
