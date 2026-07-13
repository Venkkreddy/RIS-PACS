import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../services/logger";
import { ensureAuthenticated } from "../middleware/auth";

/**
 * Smart Patient Intake proxy routes.
 *
 * The frontend calls POST /intake/analyze with a free-text complaint.
 * This router proxies the request to the MedASR/Intake server
 * (medasr-server) which runs the IntakeAIService (BioMistral via Ollama,
 * or rule-based fallback if AI is unavailable).
 *
 * Endpoints:
 *   POST /intake/analyze   — AI-powered intake analysis
 *   GET  /intake/health    — Intake service connectivity check
 */

export function intakeRouter(): Router {
  const router = Router();
  const medasrUrl = env.MEDASR_SERVER_URL; // e.g. http://localhost:5001

  // ── Health check ───────────────────────────────────────────────────────────
  router.get("/health", ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const response = await fetch(`${medasrUrl}/v1/intake/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      res.json({ status: "ok", intake: data });
    } catch (err) {
      logger.warn({ message: "Intake AI health check failed", error: String(err) });
      res.status(503).json({
        status: "unavailable",
        error: "Cannot reach intake AI service",
        medasrUrl,
      });
    }
  });

  // ── POST /analyze — Analyze complaint and return DICOM tag suggestions ─────
  router.post("/analyze", ensureAuthenticated, async (req: Request, res: Response) => {
    if (!env.MEDASR_ENABLED) {
      // When MedASR is disabled, proxy still works in rule-based mode
      // so we still forward — the Python service will use rule-based fallback.
      logger.info({ message: "MEDASR_ENABLED=false — intake will use rule-based fallback" });
    }

    const { complaint, patient_age, patient_sex, clarification_answers } = req.body as {
      complaint?: string;
      patient_age?: number;
      patient_sex?: string;
      clarification_answers?: Record<string, any>;
    };

    if (!complaint || typeof complaint !== "string" || complaint.trim().length < 3) {
      return res.status(400).json({ error: "complaint must be at least 3 characters" });
    }

    try {
      logger.info({
        message: "Proxying intake analyze to medasr-server",
        complaintLength: complaint.length,
        hasAge: patient_age != null,
        hasSex: !!patient_sex,
        hasClarification: !!clarification_answers,
      });

      const response = await fetch(`${medasrUrl}/v1/intake/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaint, patient_age, patient_sex, clarification_answers }),
        signal: AbortSignal.timeout(30_000), // 30s max for LLM inference
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ message: "Intake AI analyze failed", status: response.status, body: text });
        return res.status(response.status).json({ error: `Intake AI error: ${text}` });
      }

      const result = await response.json();
      logger.info({
        message: "Intake AI analysis complete",
        source: result.source,
        bodyPart: result.body_part_examined,
        urgency: result.urgency,
        followUp: result.follow_up_needed,
      });

      return res.json(result);
    } catch (err) {
      logger.warn({
        message: "Intake AI service unreachable — sending rule-based fallback signal",
        error: String(err),
      });
      // Return 503 so frontend activates its own JS-level rule-based fallback
      return res.status(503).json({
        error: "Intake AI service unavailable",
        fallback: true,
      });
    }
  });

  // ── POST /refine — Process answers and return refined suggestions ─────────
  router.post("/refine", ensureAuthenticated, async (req: Request, res: Response) => {
    const { original_complaint, answers, patient_age, patient_sex } = req.body as {
      original_complaint?: string;
      answers?: Record<string, any>;
      patient_age?: number;
      patient_sex?: string;
    };

    if (!original_complaint) {
      return res.status(400).json({ error: "original_complaint is required" });
    }

    try {
      logger.info({
        message: "Proxying intake refine to medasr-server",
        complaintLength: original_complaint.length,
      });

      const response = await fetch(`${medasrUrl}/v1/intake/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original_complaint, answers, patient_age, patient_sex }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ message: "Intake AI refine failed", status: response.status, body: text });
        return res.status(response.status).json({ error: `Intake AI refine error: ${text}` });
      }

      const result = await response.json();
      return res.json(result);
    } catch (err) {
      logger.warn({
        message: "Intake AI service refine unreachable",
        error: String(err),
      });
      return res.status(503).json({ error: "Intake AI service unavailable" });
    }
  });

  return router;
}
