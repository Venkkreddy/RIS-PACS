import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../services/logger";
import multer from "multer";

/**
 * Voice dictation proxy routes.
 *
 * The frontend records audio (WebM/Opus via MediaRecorder) and POSTs it here.
 * This router forwards the raw bytes to the MedASR transcription server
 * (google/medasr) which runs as a separate FastAPI container on MEDASR_SERVER_URL.
 *
 * Endpoints:
 *   POST /voice/transcribe           — raw transcription
 *   POST /voice/transcribe/radiology — transcription + MedGemma report structuring
 *   GET  /voice/health               — MedASR server connectivity check
 */

// Accept up to 50 MB audio files (matches MedASR's MAX_UPLOAD_SIZE)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function voiceRouter(): Router {
  const router = Router();
  const medasrUrl = env.MEDASR_SERVER_URL; // e.g. http://localhost:5001

  // ── Health check ──────────────────────────────────────────────────────────
  router.get("/health", async (_req: Request, res: Response) => {
    try {
      const response = await fetch(`${medasrUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      res.json({ status: "ok", medasr: data });
    } catch (err) {
      logger.warn({ message: "MedASR health check failed", error: String(err) });
      res.status(503).json({
        status: "unavailable",
        error: "Cannot reach MedASR server",
        medasrUrl,
      });
    }
  });

  // ── POST /transcribe — basic transcription ────────────────────────────────
  router.post("/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
    if (!env.MEDASR_ENABLED) {
      return res.status(503).json({ error: "Voice dictation is not enabled. Set MEDASR_ENABLED=true." });
    }

    const audioBuffer = req.file?.buffer;
    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: "No audio data or file too small" });
    }

    try {
      logger.info({ message: "Proxying audio to MedASR /v1/transcribe", bytes: audioBuffer.length });

      const formData = new FormData();
      formData.append("audio", new Blob([new Uint8Array(audioBuffer)]), req.file!.originalname || "recording.webm");

      const response = await fetch(`${medasrUrl}/v1/transcribe`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60_000), // 60s for long recordings
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ message: "MedASR transcribe failed", status: response.status, body: text });
        return res.status(response.status).json({ error: `MedASR error: ${text}` });
      }

      const result = await response.json();
      logger.info({
        message: "MedASR transcription complete",
        confidence: result.confidence,
        processingMs: result.processing_time_ms,
      });

      return res.json(result);
    } catch (err) {
      logger.error({ message: "Voice transcription proxy error", error: String(err) });
      return res.status(502).json({ error: "Failed to reach MedASR server" });
    }
  });

  // ── POST /transcribe/radiology — transcription + report structuring ───────
  router.post("/transcribe/radiology", upload.single("audio"), async (req: Request, res: Response) => {
    if (!env.MEDASR_ENABLED) {
      return res.status(503).json({ error: "Voice dictation is not enabled. Set MEDASR_ENABLED=true." });
    }

    const audioBuffer = req.file?.buffer;
    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: "No audio data or file too small" });
    }

    try {
      logger.info({ message: "Proxying audio to MedASR /v1/transcribe/radiology", bytes: audioBuffer.length });

      const formData = new FormData();
      formData.append("audio", new Blob([new Uint8Array(audioBuffer)]), req.file!.originalname || "recording.webm");

      const response = await fetch(`${medasrUrl}/v1/transcribe/radiology`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120_000), // 2 min for transcription + LLM correction
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ message: "MedASR radiology transcribe failed", status: response.status, body: text });
        return res.status(response.status).json({ error: `MedASR error: ${text}` });
      }

      const result = await response.json();
      logger.info({
        message: "MedASR radiology transcription complete",
        confidence: result.confidence,
        processingMs: result.processing_time_ms,
        hasReport: !!result.report,
      });

      return res.json(result);
    } catch (err) {
      logger.error({ message: "Voice radiology proxy error", error: String(err) });
      return res.status(502).json({ error: "Failed to reach MedASR server" });
    }
  });

  return router;
}
