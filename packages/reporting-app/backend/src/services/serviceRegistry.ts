import { env } from "../config/env";
import { logger } from "./logger";
import type { InMemoryStoreService } from "./inMemoryStore";

export interface ServiceConfig {
  llm: {
    provider: "ollama" | "gemini" | "off";
    ollamaUrl: string;
    ollamaModel: string;
    geminiModel: string;
    uiVisible: boolean;
  };
  inference: {
    enabled: boolean;
    monaiUrl: string;
    useMedGemma: boolean;
    uiVisible: boolean;
  };
  storage: {
    mode: "local" | "cloud";
    cloudBucket: string;
    cloudPrefix: string;
    // Keep a local mirror for DICOMweb compatibility when cloud mode is enabled.
    keepLocalCopy: boolean;
  };
  updatedAt: string;
  updatedBy: string;
}

const CACHE_TTL_MS = 30_000;
const KV_CONFIG_KEY = "serviceConfig:active";

function enforceMonaiOnlyConfig(config: ServiceConfig): ServiceConfig {
  return {
    ...config,
    llm: {
      ...config.llm,
      provider: "off",
      uiVisible: false,
    },
    inference: {
      ...config.inference,
      enabled: config.inference.enabled,
      useMedGemma: false,
      uiVisible: true,
    },
  };
}

function defaultConfig(): ServiceConfig {
  return enforceMonaiOnlyConfig({
    llm: {
      provider: "off",
      ollamaUrl: env.OLLAMA_URL,
      ollamaModel: env.OLLAMA_MODEL,
      geminiModel: env.GEMINI_MODEL,
      uiVisible: false,
    },
    inference: {
      enabled: env.MONAI_ENABLED,
      monaiUrl: env.MONAI_SERVER_URL,
      useMedGemma: false,
      uiVisible: true,
    },
    storage: {
      mode: "cloud",
      cloudBucket: env.GCS_BUCKET,
      cloudPrefix: "ris-pacs",
      keepLocalCopy: true,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: "system-defaults",
  });
}

interface FirestoreStore {
  firestore: {
    collection: (name: string) => {
      doc: (id: string) => {
        get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
        set: (data: unknown) => Promise<void>;
      };
    };
  };
}

function isFirestoreStore(store: unknown): store is FirestoreStore {
  return !!store && typeof store === "object" && "firestore" in (store as Record<string, unknown>);
}

function isInMemoryStore(store: unknown): store is InMemoryStoreService {
  return !!store && typeof store === "object" && "getKV" in (store as Record<string, unknown>);
}

export class ServiceRegistry {
  private cache: ServiceConfig | null = null;
  private cacheTime = 0;
  private firestoreStore: FirestoreStore | null = null;
  private inMemoryStore: InMemoryStoreService | null = null;

  constructor(store?: unknown) {
    if (isFirestoreStore(store)) {
      this.firestoreStore = store;
    } else if (isInMemoryStore(store)) {
      this.inMemoryStore = store;
    }
  }

  async getConfig(): Promise<ServiceConfig> {
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      if (this.firestoreStore) {
        const docRef = this.firestoreStore.firestore.collection("serviceConfig").doc("active");
        const snap = await docRef.get();
        if (snap.exists) {
          this.cache = enforceMonaiOnlyConfig(snap.data() as unknown as ServiceConfig);
          this.cacheTime = Date.now();
          return this.cache;
        }
        const defaults = defaultConfig();
        await docRef.set(defaults);
        this.cache = defaults;
        this.cacheTime = Date.now();
        return defaults;
      }
    } catch (err) {
      logger.warn({ message: "Firestore serviceConfig read failed, using defaults", error: (err as Error).message });
    }

    if (this.inMemoryStore) {
      const stored = await this.inMemoryStore.getKV<ServiceConfig>(KV_CONFIG_KEY);
      if (stored) {
        this.cache = enforceMonaiOnlyConfig(stored);
        this.cacheTime = Date.now();
        return this.cache;
      }
    }

    if (!this.cache) {
      this.cache = defaultConfig();
      this.cacheTime = Date.now();
      if (this.inMemoryStore) {
        await this.inMemoryStore.setKV(KV_CONFIG_KEY, this.cache);
      }
    }
    return this.cache;
  }

  async updateConfig(patch: Partial<ServiceConfig>, updatedBy: string): Promise<ServiceConfig> {
    const current = await this.getConfig();
    const merged = enforceMonaiOnlyConfig({
      llm: { ...current.llm, ...(patch.llm ?? {}) },
      inference: { ...current.inference, ...(patch.inference ?? {}) },
      storage: { ...current.storage, ...(patch.storage ?? {}) },
      updatedAt: new Date().toISOString(),
      updatedBy,
    });

    try {
      if (this.firestoreStore) {
        await this.firestoreStore.firestore.collection("serviceConfig").doc("active").set(merged);
      } else if (this.inMemoryStore) {
        await this.inMemoryStore.setKV(KV_CONFIG_KEY, merged);
      }
    } catch (err) {
      logger.warn({ message: "serviceConfig write failed", error: (err as Error).message });
    }

    this.cache = merged;
    this.cacheTime = Date.now();

    if (patch.llm?.provider && patch.llm.provider !== current.llm.provider) {
      this.notifyMonaiLlmChange(merged.inference.monaiUrl, merged.llm.provider).catch(() => {});
    }

    return merged;
  }

  async getLlmProvider(): Promise<"ollama" | "gemini" | "off"> {
    const config = await this.getConfig();
    return config.llm.provider;
  }

  async getCorrectionUrl(): Promise<string | null> {
    const config = await this.getConfig();
    if (config.llm.provider === "off") return null;
    if (config.llm.provider === "gemini") return config.llm.ollamaUrl;
    if (config.llm.provider === "ollama") return config.llm.ollamaUrl;
    return null;
  }

  async isInferenceEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.inference.enabled;
  }

  async getStorageConfig(): Promise<ServiceConfig["storage"]> {
    const config = await this.getConfig();
    return config.storage;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  private async notifyMonaiLlmChange(monaiUrl: string, llmProvider: string): Promise<void> {
    try {
      const form = new FormData();
      form.append("llm_provider", llmProvider);
      const headers: Record<string, string> = {};
      const secret = process.env.INTERNAL_SERVICE_SECRET;
      if (secret) headers["x-internal-secret"] = secret;
      const resp = await fetch(`${monaiUrl}/v1/configure`, { method: "POST", body: form, headers });
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        logger.info({ message: "MONAI LLM reconfigured", previous: data.previous, current: data.current, mode: data.mode });
      } else {
        logger.warn({ message: "MONAI /v1/configure returned non-OK", status: resp.status });
      }
    } catch (err) {
      logger.warn({ message: "Failed to notify MONAI of LLM change (server may be down)", error: (err as Error).message });
    }
  }
}
