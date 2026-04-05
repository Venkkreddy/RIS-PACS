import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  ENABLE_AUTH: z.enum(["true", "false"]).optional(),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  OHIF_BASE_URL: z.string().url().default("http://localhost:3000"),
  OHIF_PUBLIC_BASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters").default("change-me-to-a-real-secret"),
  DEFAULT_DEV_ROLE: z.enum(["admin", "developer", "radiographer", "radiologist", "referring", "billing", "receptionist", "viewer"]).default("radiologist"),
  MASTER_ADMIN_EMAILS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().default("ris-pacs-9859a"),
  GCP_PROJECT_ID: z.string().default("ris-pacs-9859a"),
  GCS_BUCKET: z.string().default("ris-pacs-9859a.firebasestorage.app"),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().default("reports@example.com"),
  WEASIS_BASE_URL: z.string().url().optional(),
  MONAI_SERVER_URL: z.string().url().default("http://localhost:5000"),
  MONAI_ENABLED: z.enum(["true", "false"]).default("false"),
  MEDASR_SERVER_URL: z.string().url().default("http://localhost:5001"),
  MEDASR_ENABLED: z.enum(["true", "false"]).default("false"),
  WAV2VEC2_SERVER_URL: z.string().url().default("http://localhost:5002"),
  DICOOGLE_BASE_URL: z.string().url().default("http://localhost:8080"),
  DICOOGLE_FALLBACK_BASE_URL: z.string().url().default("http://tdairad-dicoogle.flycast"),
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

  // Multi-tenant configuration
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").default("change-me-to-a-real-jwt-secret-at-least-32-chars"),
  MULTI_TENANT_ENABLED: z.enum(["true", "false"]).default("false"),
  PLATFORM_ADMIN_KEY: z.string().optional(),
  ORTHANC_BASE_URL: z.string().optional(),
  ORTHANC_AUTH: z.string().optional(),
  TENANT_STORAGE_ROOT: z.string().default("/storage"),
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  OHIF_PUBLIC_BASE_URL: parsed.OHIF_PUBLIC_BASE_URL ?? parsed.OHIF_BASE_URL,
  ENABLE_AUTH: parsed.ENABLE_AUTH ? parsed.ENABLE_AUTH === "true" : parsed.NODE_ENV === "production",
  MONAI_ENABLED: parsed.MONAI_ENABLED === "true",
  MEDASR_ENABLED: parsed.MEDASR_ENABLED === "true",
  MULTI_TENANT_ENABLED: parsed.MULTI_TENANT_ENABLED === "true",
};
