import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

const modeFromEnv = process.env.APP_ENV_MODE?.trim().toLowerCase();

let envContextDir = process.cwd();

function loadEnvFile(envFilePath: string): boolean {
  const resolved = path.resolve(envFilePath);
  if (!fs.existsSync(resolved)) {
    return false;
  }
  dotenv.config({ path: resolved });
  envContextDir = path.dirname(resolved);
  return true;
}

function loadRuntimeEnv(): void {
  const explicitEnvFile = process.env.APP_ENV_FILE?.trim();
  if (explicitEnvFile) {
    loadEnvFile(explicitEnvFile);
  } else if (modeFromEnv) {
    const modeFile = `.env.${modeFromEnv}`;
    const candidateDirs = [
      process.cwd(),
      path.resolve(process.cwd(), ".."),
      path.resolve(process.cwd(), "..", ".."),
      path.resolve(process.cwd(), "..", "..", ".."),
      path.resolve(__dirname, "..", ".."),
      path.resolve(__dirname, "..", "..", ".."),
      path.resolve(__dirname, "..", "..", "..", ".."),
      path.resolve(__dirname, "..", "..", "..", "..", ".."),
    ];
    const visited = new Set<string>();
    for (const dir of candidateDirs) {
      const normalizedDir = path.resolve(dir);
      if (visited.has(normalizedDir)) {
        continue;
      }
      visited.add(normalizedDir);
      const loaded = loadEnvFile(path.join(normalizedDir, modeFile));
      if (loaded) {
        break;
      }
    }
  }

  // Fall back to regular .env in the current working directory if present.
  dotenv.config();
}

function resolveEnvPath(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(envContextDir, value);
}

loadRuntimeEnv();

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().url().optional(),
);

const schema = z.object({
  APP_ENV_MODE: z.enum(["local", "docker"]).default("local"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  ENABLE_AUTH: z.enum(["true", "false"]).optional(),
  BACKEND_URL: z.string().url().default("http://localhost:8081"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  OHIF_BASE_URL: z.string().url().default("http://localhost:3000"),
  OHIF_PUBLIC_BASE_URL: optionalUrl,
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters").default("change-me-to-a-real-secret"),
  DEFAULT_DEV_ROLE: z.enum(["super_admin", "admin", "developer", "radiographer", "radiologist", "referring", "billing", "receptionist", "viewer"]).default("radiologist"),
  MASTER_ADMIN_EMAILS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().default("ris-pacs-9859a"),
  GCP_PROJECT_ID: z.string().default("ris-pacs-9859a"),
  GCS_BUCKET: z.string().default("ris-pacs-9859a.firebasestorage.app"),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().default("reports@example.com"),
  WEASIS_BASE_URL: optionalUrl,
  MONAI_SERVER_URL: z.string().url().default("http://localhost:5000"),
  MONAI_ENABLED: z.enum(["true", "false"]).default("false"),
  MEDASR_SERVER_URL: z.string().url().default("http://localhost:5001"),
  MEDASR_ENABLED: z.enum(["true", "false"]).default("false"),
  WAV2VEC2_SERVER_URL: z.string().url().default("http://localhost:5002"),
  DICOOGLE_BASE_URL: z.string().url().default("http://localhost:8080"),
  DICOOGLE_FALLBACK_BASE_URL: optionalUrl,
  DICOOGLE_STORAGE_DIR: z.string().optional(),
  /** file:// URI Dicoogle uses to scan storage (inside the Dicoogle container, e.g. file:///var/dicoogle/storage). */
  DICOOGLE_INDEX_URI: z.string().optional(),
  DICOOGLE_USERNAME: z.string().default("dicoogle"),
  DICOOGLE_PASSWORD: z.string().default("dicoogle"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3"),
  INTERNAL_SERVICE_SECRET: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOW_ALL: z.enum(["true", "false"]).default("false"),

  // Multi-tenant configuration
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").default("change-me-to-a-real-jwt-secret-at-least-32-chars"),
  MULTI_TENANT_ENABLED: z.enum(["true", "false"]).default("false"),
  PLATFORM_ADMIN_KEY: z.string().optional(),
  ORTHANC_BASE_URL: optionalUrl,
  ORTHANC_AUTH: z.string().optional(),
  TENANT_STORAGE_ROOT: z.string().default("/storage"),

  // HIPAA Compliance configuration
  HIPAA_AUDIT_ENABLED: z.enum(["true", "false"]).default("true"),
  HIPAA_AUDIT_RETENTION_DAYS: z.coerce.number().default(2190),
  HIPAA_SESSION_TIMEOUT_MINUTES: z.coerce.number().default(15),
  HIPAA_MAX_FAILED_LOGINS: z.coerce.number().default(5),
  HIPAA_LOCKOUT_DURATION_MINUTES: z.coerce.number().default(30),
  HIPAA_REQUIRE_HTTPS: z.enum(["true", "false"]).default("true"),
  HIPAA_MIN_PASSWORD_LENGTH: z.coerce.number().default(12),
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  OHIF_PUBLIC_BASE_URL: parsed.OHIF_PUBLIC_BASE_URL ?? parsed.OHIF_BASE_URL,
  DICOOGLE_STORAGE_DIR: resolveEnvPath(parsed.DICOOGLE_STORAGE_DIR),
  TENANT_STORAGE_ROOT: resolveEnvPath(parsed.TENANT_STORAGE_ROOT),
  ENABLE_AUTH: parsed.ENABLE_AUTH ? parsed.ENABLE_AUTH === "true" : parsed.NODE_ENV === "production",
  MONAI_ENABLED: parsed.MONAI_ENABLED === "true",
  MEDASR_ENABLED: parsed.MEDASR_ENABLED === "true",
  CORS_ALLOW_ALL: parsed.CORS_ALLOW_ALL === "true",
  MULTI_TENANT_ENABLED: parsed.MULTI_TENANT_ENABLED === "true",
};
