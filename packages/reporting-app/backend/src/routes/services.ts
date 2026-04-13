import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { ServiceRegistry } from "../services/serviceRegistry";
import type { ServiceConfig } from "../services/serviceRegistry";
import { logger } from "../services/logger";
import type { StoreService } from "../services/store";
import type { InMemoryStoreService } from "../services/inMemoryStore";

const BLOCKED_HOSTS = /^(169\.254\.|metadata\.google\.internal|metadata\.internal)/i;

function isSafeUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (BLOCKED_HOSTS.test(parsed.hostname)) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

const safeServiceUrl = z.string().url().refine(
  (url) => isSafeUrl(url),
  { message: "URL points to a blocked internal address" },
);

const configUpdateSchema = z.object({
  stt: z.object({
    provider: z.enum(["wav2vec2", "medasr", "off"]),
    wav2vec2Url: safeServiceUrl.optional(),
    medasrUrl: safeServiceUrl.optional(),
    uiVisible: z.boolean().optional(),
  }).partial().optional(),
  llm: z.object({
    provider: z.enum(["ollama", "gemini", "off"]),
    ollamaUrl: safeServiceUrl.optional(),
    ollamaModel: z.string().optional(),
    geminiModel: z.string().optional(),
    uiVisible: z.boolean().optional(),
  }).partial().optional(),
  inference: z.object({
    enabled: z.boolean(),
    monaiUrl: safeServiceUrl.optional(),
    uiVisible: z.boolean().optional(),
  }).partial().optional(),
  storage: z.object({
    mode: z.enum(["local", "cloud"]),
    cloudBucket: z.string().min(3).max(63),
    cloudPrefix: z.string().max(255),
    keepLocalCopy: z.boolean(),
  }).partial().optional(),
}).strict();

async function checkHealth(url: string): Promise<{ status: string; latencyMs: number | null }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { status: "healthy", latencyMs, ...data };
    }
    return { status: "unhealthy", latencyMs };
  } catch {
    return { status: "unreachable", latencyMs: null };
  }
}

export function servicesRouter(
  registry: ServiceRegistry,
  store: StoreService | InMemoryStoreService,
): Router {
  const router = Router();

  const ensureToggle = ensurePermission(store, "developer:toggle_services");
  const ensureHealth = ensurePermission(store, "developer:view_health");

  router.get("/services/config", ensureAuthenticated, asyncHandler(async (_req, res) => {
    const config = await registry.getConfig();
    res.json(config);
  }));

  router.put("/services/config", ensureAuthenticated, ensureToggle, asyncHandler(async (req, res) => {
    const patch = configUpdateSchema.parse(req.body) as Partial<ServiceConfig>;
    const userId = req.session.user?.id ?? "unknown";
    const updated = await registry.updateConfig(patch, userId);
    logger.info({ message: "Service config updated", updatedBy: userId, config: updated });
    res.json(updated);
  }));

  router.get("/services/health", ensureAuthenticated, ensureHealth, asyncHandler(async (_req, res) => {
    const config = await registry.getConfig();

    const [sttHealth, monaiHealth, ollamaHealth] = await Promise.all([
      config.stt.provider !== "off"
        ? checkHealth(config.stt.provider === "wav2vec2" ? config.stt.wav2vec2Url : config.stt.medasrUrl)
        : Promise.resolve({ status: "off", latencyMs: null }),
      config.inference.enabled
        ? checkHealth(config.inference.monaiUrl)
        : Promise.resolve({ status: "off", latencyMs: null }),
      config.llm.provider === "ollama"
        ? checkHealth(config.llm.ollamaUrl)
        : Promise.resolve(null),
    ]);

    const llmHealth = config.llm.provider === "off"
      ? { status: "off", latencyMs: null }
      : config.llm.provider === "ollama"
        ? { ...ollamaHealth!, model: config.llm.ollamaModel }
        : { status: "configured", latencyMs: null, model: config.llm.geminiModel };

    res.json({
      stt: { provider: config.stt.provider, ...sttHealth },
      llm: { provider: config.llm.provider, ...llmHealth },
      inference: { provider: "monai", enabled: config.inference.enabled, ...monaiHealth },
      storage: {
        mode: config.storage.mode,
        cloudBucket: config.storage.cloudBucket,
        cloudPrefix: config.storage.cloudPrefix,
        keepLocalCopy: config.storage.keepLocalCopy,
      },
    });
  }));

  return router;
}
