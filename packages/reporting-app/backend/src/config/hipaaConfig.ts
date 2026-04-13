import { env } from "./env";

export const hipaaConfig = {
  sessionTimeoutMs: Number(process.env.HIPAA_SESSION_TIMEOUT_MINUTES ?? 15) * 60 * 1000,

  maxFailedLoginAttempts: Number(process.env.HIPAA_MAX_FAILED_LOGINS ?? 5),
  lockoutDurationMs: Number(process.env.HIPAA_LOCKOUT_DURATION_MINUTES ?? 30) * 60 * 1000,

  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    maxAgeDays: 90,
    preventReuse: 6,
  },

  audit: {
    enabled: (process.env.HIPAA_AUDIT_ENABLED ?? "true") === "true",
    retentionDays: Number(process.env.HIPAA_AUDIT_RETENTION_DAYS ?? 2190), // 6 years per HIPAA
    collection: "hipaa_audit_log",
    emergencyAccessCollection: "hipaa_emergency_access",
    baaCollection: "hipaa_baa_tracking",
  },

  encryption: {
    requireTLS: (process.env.HIPAA_REQUIRE_HTTPS ?? (env.NODE_ENV === "production" ? "true" : "false")) === "true",
    minTLSVersion: "TLSv1.2" as const,
  },

  phiRoutePatterns: [
    /^\/patients/,
    /^\/reports/,
    /^\/orders/,
    /^\/scans/,
    /^\/billing/,
    /^\/worklist/,
    /^\/dicom/,
    /^\/dicomweb/,
    /^\/dicom-web/,
    /^\/wado/,
    /^\/ai\/analyze/,
    /^\/ai\/results/,
    /^\/referring-physicians/,
    /^\/api\/v1\/dicomweb/,
  ],

  isPhiRoute(path: string): boolean {
    return this.phiRoutePatterns.some((pattern) => pattern.test(path));
  },
};
