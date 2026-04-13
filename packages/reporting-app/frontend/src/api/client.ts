import axios from "axios";

function debugApiLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = "run-1",
) {
  fetch("http://127.0.0.1:7829/ingest/0823df88-6411-4f3d-9920-ebf0779efd31", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b161f5",
    },
    body: JSON.stringify({
      sessionId: "b161f5",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

function debugAgentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = "run-quick-access-1",
) {
  fetch("http://127.0.0.1:7406/ingest/cd2ccaa8-51d1-4291-bf05-faef93098c97", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b20a13",
    },
    body: JSON.stringify({
      sessionId: "b20a13",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 30000,
});

function isPublicRoute(pathname: string) {
  return pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/pending-approval");
}

function redirectToLoginIfNeeded() {
  const shouldRedirect = !isPublicRoute(window.location.pathname);
  // #region agent log
  debugAgentLog("H2", "client.ts:redirectToLoginIfNeeded", "evaluated login redirect after auth failure", {
    currentPath: window.location.pathname,
    shouldRedirect,
  });
  // #endregion
  if (shouldRedirect) {
    window.location.href = "/";
  }
}

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
  (config as unknown as { _debugStartedAt?: number })._debugStartedAt = Date.now();
  // #region agent log
  debugApiLog("H8", "client.ts:request", "api request start", {
    method: config.method ?? "get",
    url: config.url ?? "unknown",
    path: typeof window !== "undefined" ? window.location.pathname : "unknown",
  });
  // #endregion
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
  (res) => {
    const startedAt = (res.config as unknown as { _debugStartedAt?: number })._debugStartedAt;
    // #region agent log
    debugApiLog("H8", "client.ts:response", "api request success", {
      method: res.config.method ?? "get",
      url: res.config.url ?? "unknown",
      status: res.status,
      elapsedMs: typeof startedAt === "number" ? Date.now() - startedAt : -1,
    });
    // #endregion
    return res;
  },
  async (error) => {
    const startedAt = (error?.config as { _debugStartedAt?: number } | undefined)?._debugStartedAt;
    // #region agent log
    debugApiLog("H9", "client.ts:responseError", "api request failed", {
      method: error?.config?.method ?? "get",
      url: error?.config?.url ?? "unknown",
      status: error?.response?.status ?? "no_response",
      code: error?.code ?? "unknown",
      elapsedMs: typeof startedAt === "number" ? Date.now() - startedAt : -1,
      currentPath: typeof window !== "undefined" ? window.location.pathname : "unknown",
    });
    // #endregion
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // #region agent log
    debugAgentLog("H2", "client.ts:received401", "received HTTP 401 from API response", {
      method: error?.config?.method ?? "get",
      url: error?.config?.url ?? "unknown",
      currentPath: typeof window !== "undefined" ? window.location.pathname : "unknown",
    });
    // #endregion

    const originalRequest = error.config;
    if (!originalRequest || (originalRequest as unknown as Record<string, unknown>)._retry) {
      redirectToLoginIfNeeded();
      return Promise.reject(error);
    }

    // Multi-tenant: try refresh token
    if (_refreshToken && _accessToken) {
      (originalRequest as unknown as Record<string, unknown>)._retry = true;
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
        redirectToLoginIfNeeded();
        return Promise.reject(error);
      }
    }

    // Session auth: redirect to login
    redirectToLoginIfNeeded();
    return Promise.reject(error);
  },
);
