import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 30000,
});

/**
 * Multi-tenant token management.
 * When running in multi-tenant mode, the JWT access token and tenant context
 * are stored in memory (not localStorage) for XSS safety.
 */
let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _tenantId: string | null = null;
let _tenantSlug: string | null = null;

export function setTenantAuth(opts: {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  tenantSlug: string;
}) {
  _accessToken = opts.accessToken;
  _refreshToken = opts.refreshToken;
  _tenantId = opts.tenantId;
  _tenantSlug = opts.tenantSlug;
}

export function clearTenantAuth() {
  _accessToken = null;
  _refreshToken = null;
  _tenantId = null;
  _tenantSlug = null;
}

export function getTenantContext() {
  return { tenantId: _tenantId, tenantSlug: _tenantSlug, isMultiTenant: !!_accessToken };
}

// Inject tenant context headers on every request
api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  if (_tenantId) {
    config.headers["X-Tenant-Id"] = _tenantId;
  }
  if (_tenantSlug) {
    config.headers["X-Tenant-Slug"] = _tenantSlug;
  }
  return config;
});

// Handle 401 — attempt token refresh for multi-tenant, redirect for session auth
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const originalRequest = error.config;
    if (!originalRequest || (originalRequest as Record<string, unknown>)._retry) {
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }

    // Multi-tenant: try refresh token
    if (_refreshToken && _accessToken) {
      (originalRequest as Record<string, unknown>)._retry = true;
      try {
        const refreshRes = await axios.post("/api/api/v1/auth/refresh", {
          refreshToken: _refreshToken,
        });
        const { accessToken, refreshToken } = refreshRes.data;
        _accessToken = accessToken;
        _refreshToken = refreshToken;
        originalRequest.headers!.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        clearTenantAuth();
        if (!window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    }

    // Session auth: redirect to login
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
