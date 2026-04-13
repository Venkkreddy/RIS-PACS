import axios from "axios";
import path from "path";
import fs from "fs";
import { env } from "../config/env";
import { getDicoogleAuthHeaders } from "./dicoogleAuth";
import { logger } from "./logger";

interface TenantDicomConfig {
  tenantId: string;
  aeTitle: string;
  storagePath: string;
}

export class DicoogleService {
  private tenantConfigCache = new Map<string, { config: TenantDicomConfig; ts: number }>();
  private static readonly TENANT_CACHE_TTL = 120_000;

  private async getWithFallbackResponse(
    path: string,
    params: Record<string, string> | undefined,
    acceptedStatuses: number[] = [200],
  ): Promise<{ status: number; data: unknown }> {
    const endpoints = Array.from(
      new Set(
        [env.DICOOGLE_BASE_URL, env.DICOOGLE_FALLBACK_BASE_URL].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    let authHeaders: Record<string, string> = {};
    try {
      authHeaders = await getDicoogleAuthHeaders();
    } catch {
      // proceed without auth if login fails
    }

    const errors: string[] = [];
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${endpoint}${path}`, {
          params,
          headers: authHeaders,
          timeout: 8000,
          validateStatus: (status) => acceptedStatuses.includes(status),
        });
        return { status: response.status, data: response.data as unknown };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${endpoint}: ${message}`);
      }
    }

    throw new Error(`Unable to reach Dicoogle endpoint. Attempts: ${errors.join(" | ")}`);
  }

  private async getWithFallback(path: string, params?: Record<string, string>): Promise<unknown> {
    const response = await this.getWithFallbackResponse(path, params, [200]);
    return response.data;
  }

  private normalizeSearchPayload(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload as Array<Record<string, unknown>>;
    }
    if (payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown[] }).results)) {
      return (payload as { results: Array<Record<string, unknown>> }).results;
    }
    return [];
  }

  async searchStudies(query?: string): Promise<Array<Record<string, unknown>>> {
    const normalizedQuery = query?.trim() ? query.trim() : "PatientID:*";
    const paramAttempts: Array<Record<string, string> | undefined> = [
      { query: normalizedQuery },
      { q: normalizedQuery },
      undefined,
    ];

    const errors: string[] = [];
    for (const params of paramAttempts) {
      try {
        const response = await this.getWithFallbackResponse("/search", params, [200, 400]);
        const payload = response.data;
        if (response.status === 400) {
          const errorMessage =
            payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
              ? (payload as { error: string }).error
              : "";
          if (/no query supplied|no valid dim providers supplied/i.test(errorMessage)) {
            return [];
          }
          throw new Error(`Dicoogle search returned 400: ${errorMessage || "Unknown search error"}`);
        }
        return this.normalizeSearchPayload(payload);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Unknown error");
      }
    }

    throw new Error(`Dicoogle search failed. Attempts: ${errors.join(" | ")}`);
  }

  async fetchStudyMetadata(studyId: string): Promise<Record<string, unknown>> {
    const payload = await this.getWithFallback(`/studies/${studyId}`);
    return payload as Record<string, unknown>;
  }

  // =========================================================================
  // Multi-tenant Dicoogle operations
  // =========================================================================

  /**
   * Resolve the DICOM config for a tenant (AE title, storage path).
   * Cached for 2 minutes to avoid repeated DB lookups.
   */
  async getTenantDicomConfig(tenantId: string): Promise<TenantDicomConfig | null> {
    const cached = this.tenantConfigCache.get(tenantId);
    if (cached && Date.now() - cached.ts < DicoogleService.TENANT_CACHE_TTL) {
      return cached.config;
    }

    try {
      const { getFirestore } = await import("./firebaseAdmin");
      const db = getFirestore();
      const doc = await db.collection("tenants").doc(tenantId).collection("dicom_config").doc("default").get();
      if (!doc.exists) return null;

      const data = doc.data()!;
      const config: TenantDicomConfig = {
        tenantId,
        aeTitle: data.ae_title,
        storagePath: data.storage_path,
      };
      this.tenantConfigCache.set(tenantId, { config, ts: Date.now() });
      return config;
    } catch (err) {
      logger.error({ message: "Failed to load tenant DICOM config", tenantId, error: String(err) });
      return null;
    }
  }

  /**
   * Get the tenant-isolated storage directory, creating it if needed.
   */
  getTenantStoragePath(tenantSlug: string): string {
    const root = env.TENANT_STORAGE_ROOT || "/storage";
    const tenantDir = path.join(root, tenantSlug);
    fs.mkdirSync(tenantDir, { recursive: true });
    return tenantDir;
  }

  /**
   * Search studies scoped to a specific tenant's AE title.
   * Falls back to unscoped search if tenant config is unavailable.
   */
  async searchStudiesForTenant(tenantId: string, query?: string): Promise<Array<Record<string, unknown>>> {
    const config = await this.getTenantDicomConfig(tenantId);
    const aeTitle = config?.aeTitle;

    let searchQuery: string;
    if (aeTitle) {
      const textPart = query?.trim() ? query.trim() : "PatientID:*";
      searchQuery = `${textPart} AND InstitutionName:${aeTitle}`;
    } else {
      searchQuery = query?.trim() ? query.trim() : "PatientID:*";
    }

    return this.searchStudies(searchQuery);
  }

  /**
   * Trigger Dicoogle re-indexing for a specific tenant's storage directory.
   */
  async triggerTenantIndex(tenantSlug: string): Promise<void> {
    const tenantDir = this.getTenantStoragePath(tenantSlug);
    const indexUri = `file:///${tenantDir.replace(/\\/g, "/")}`;

    try {
      await axios.post(`${env.DICOOGLE_BASE_URL}/management/tasks/index`, null, {
        params: { uri: indexUri },
        timeout: 30_000,
      });
    } catch (err) {
      logger.warn({
        message: "Tenant Dicoogle index request failed",
        tenantSlug,
        indexUri,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
