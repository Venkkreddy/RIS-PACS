import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Building2, Cloud, Database, HardDrive, RefreshCw, Save, UserPlus } from "lucide-react";
import { api } from "../api/client";

type StorageMode = "local" | "cloud";

interface TenantDicomConfig {
  storage_mode?: StorageMode;
  pacs_endpoint_url?: string | null;
  cloud_bucket?: string | null;
  cloud_prefix?: string | null;
}

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  ae_title: string;
  institution_name?: string | null;
  domain?: string | null;
  max_users?: number;
  max_storage_gb?: number;
  storage_mode?: StorageMode;
  storage_path?: string;
  is_active?: boolean;
  user_count?: number;
  hospital_admin_count?: number;
  dicom_config?: TenantDicomConfig | null;
}

interface PlatformTenantsResponse {
  tenants: PlatformTenant[];
}

interface MonitoringOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalUsers: number;
  totalHospitalAdmins: number;
  totalPendingApprovals: number;
  totalStudies: number;
  updatedAt: string;
}

interface TenantDraft {
  storageMode: StorageMode;
  localStoragePath: string;
  pacsEndpointUrl: string;
  cloudBucket: string;
  cloudPrefix: string;
  isActive: boolean;
}

interface AdminCreateForm {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
}

interface CreateTenantForm {
  name: string;
  slug: string;
  aeTitle: string;
  institutionName: string;
  domain: string;
  maxUsers: number;
  maxStorageGb: number;
  storageMode: StorageMode;
  pacsEndpointUrl: string;
  cloudBucket: string;
  cloudPrefix: string;
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
}

const defaultTenantForm: CreateTenantForm = {
  name: "",
  slug: "",
  aeTitle: "",
  institutionName: "",
  domain: "",
  maxUsers: 100,
  maxStorageGb: 500,
  storageMode: "cloud",
  pacsEndpointUrl: "",
  cloudBucket: "",
  cloudPrefix: "",
  adminEmail: "",
  adminPassword: "",
  adminDisplayName: "",
};

const defaultAdminForm: AdminCreateForm = {
  adminEmail: "",
  adminPassword: "",
  adminDisplayName: "",
};

function normalizeInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildTenantDraft(tenant: PlatformTenant): TenantDraft {
  const config = tenant.dicom_config ?? {};
  const storageMode = tenant.storage_mode ?? config.storage_mode ?? "cloud";
  return {
    storageMode,
    localStoragePath: tenant.storage_path ?? "",
    pacsEndpointUrl: config.pacs_endpoint_url ?? "",
    cloudBucket: config.cloud_bucket ?? "",
    cloudPrefix: config.cloud_prefix ?? "",
    isActive: tenant.is_active !== false,
  };
}

export function SuperAdminPortal() {
  const queryClient = useQueryClient();
  const [createForm, setCreateForm] = useState<CreateTenantForm>(defaultTenantForm);
  const [tenantDrafts, setTenantDrafts] = useState<Record<string, TenantDraft>>({});
  const [adminForms, setAdminForms] = useState<Record<string, AdminCreateForm>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: async () => (await api.get<PlatformTenantsResponse>("/v1/platform/tenants")).data,
  });

  const monitoringQuery = useQuery({
    queryKey: ["platform-monitoring-overview"],
    queryFn: async () => (await api.get<MonitoringOverview>("/v1/platform/monitoring/overview")).data,
  });

  const tenants = tenantsQuery.data?.tenants ?? [];

  useEffect(() => {
    if (tenants.length === 0) return;
    setTenantDrafts((prev) => {
      const next = { ...prev };
      for (const tenant of tenants) {
        if (!next[tenant.id]) {
          next[tenant.id] = buildTenantDraft(tenant);
        }
      }
      return next;
    });
  }, [tenants]);

  const createTenantMutation = useMutation({
    mutationFn: async (payload: CreateTenantForm) => {
      await api.post("/v1/platform/tenants", {
        ...payload,
        institutionName: normalizeInput(payload.institutionName),
        domain: normalizeInput(payload.domain),
        pacsEndpointUrl: normalizeInput(payload.pacsEndpointUrl),
        cloudBucket: normalizeInput(payload.cloudBucket),
        cloudPrefix: normalizeInput(payload.cloudPrefix),
      });
    },
    onSuccess: async () => {
      setStatusMessage("Hospital created successfully.");
      setErrorMessage(null);
      setCreateForm(defaultTenantForm);
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring-overview"] });
    },
    onError: () => {
      setErrorMessage("Failed to create hospital. Verify required fields and PACS/storage settings.");
      setStatusMessage(null);
    },
  });

  const updateTenantMutation = useMutation({
    mutationFn: async ({ tenantId, draft }: { tenantId: string; draft: TenantDraft }) => {
      await api.patch(`/v1/platform/tenants/${encodeURIComponent(tenantId)}`, {
        storageMode: draft.storageMode,
        localStoragePath: normalizeInput(draft.localStoragePath),
        pacsEndpointUrl: normalizeInput(draft.pacsEndpointUrl) ?? null,
        cloudBucket: normalizeInput(draft.cloudBucket) ?? null,
        cloudPrefix: normalizeInput(draft.cloudPrefix) ?? null,
        isActive: draft.isActive,
      });
    },
    onSuccess: async () => {
      setStatusMessage("Hospital settings updated.");
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring-overview"] });
    },
    onError: () => {
      setErrorMessage("Could not update hospital settings.");
      setStatusMessage(null);
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: async ({ tenantId, form }: { tenantId: string; form: AdminCreateForm }) => {
      await api.post(`/v1/platform/tenants/${encodeURIComponent(tenantId)}/admins`, form);
    },
    onSuccess: async (_, vars) => {
      setAdminForms((prev) => ({ ...prev, [vars.tenantId]: defaultAdminForm }));
      setStatusMessage("Hospital admin created.");
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring-overview"] });
    },
    onError: () => {
      setErrorMessage("Failed to create hospital admin.");
      setStatusMessage(null);
    },
  });

  const cloudTenants = useMemo(
    () => tenants.filter((tenant) => (tenant.storage_mode ?? tenant.dicom_config?.storage_mode ?? "cloud") === "cloud").length,
    [tenants],
  );

  const localTenants = useMemo(
    () => tenants.filter((tenant) => (tenant.storage_mode ?? tenant.dicom_config?.storage_mode ?? "cloud") === "local").length,
    [tenants],
  );

  function updateTenantDraft(tenantId: string, patch: Partial<TenantDraft>) {
    setTenantDrafts((prev) => ({
      ...prev,
      [tenantId]: (() => {
        const existing = prev[tenantId];
        if (existing) return { ...existing, ...patch };
        const tenant = tenants.find((t) => t.id === tenantId);
        if (tenant) return { ...buildTenantDraft(tenant), ...patch };
        return {
          storageMode: "cloud",
          localStoragePath: "",
          pacsEndpointUrl: "",
          cloudBucket: "",
          cloudPrefix: "",
          isActive: true,
          ...patch,
        };
      })(),
    }));
  }

  function updateAdminForm(tenantId: string, patch: Partial<AdminCreateForm>) {
    setAdminForms((prev) => ({
      ...prev,
      [tenantId]: { ...(prev[tenantId] ?? defaultAdminForm), ...patch },
    }));
  }

  function submitCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    createTenantMutation.mutate(createForm);
  }

  return (
    <div className="min-h-screen bg-tdai-background dark:bg-tdai-gray-950">
      <div className="px-6 py-5">
        <h1 className="text-xl font-bold text-tdai-text dark:text-white">Super Admin Developer Portal</h1>
        <p className="mt-1 text-sm text-tdai-secondary dark:text-tdai-gray-400">
          Manage hospitals, PACS endpoints, storage mode toggles, hospital admins, and platform monitoring.
        </p>
      </div>

      <div className="dashboard-inner space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">
              <Building2 className="h-4 w-4" />
              Hospitals
            </div>
            <p className="mt-2 text-2xl font-bold text-tdai-text">{monitoringQuery.data?.totalTenants ?? tenants.length}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">
              <Activity className="h-4 w-4" />
              Active Hospitals
            </div>
            <p className="mt-2 text-2xl font-bold text-tdai-text">{monitoringQuery.data?.activeTenants ?? "—"}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">
              <HardDrive className="h-4 w-4" />
              Local Storage
            </div>
            <p className="mt-2 text-2xl font-bold text-tdai-text">{localTenants}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">
              <Cloud className="h-4 w-4" />
              Cloud Storage
            </div>
            <p className="mt-2 text-2xl font-bold text-tdai-text">{cloudTenants}</p>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-4 w-4 text-tdai-teal-600" />
            <h2 className="text-base font-semibold text-tdai-text">Create Hospital (Tenant)</h2>
          </div>
          <form className="space-y-4" onSubmit={submitCreateTenant}>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <input
                className="input-field"
                placeholder="Hospital Name"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
              <input
                className="input-field"
                placeholder="Tenant Slug (e.g. hospital-a)"
                value={createForm.slug}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase() }))}
                required
              />
              <input
                className="input-field"
                placeholder="PACS AE Title"
                value={createForm.aeTitle}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, aeTitle: e.target.value.toUpperCase() }))}
                required
              />
              <input
                className="input-field"
                placeholder="Institution Name"
                value={createForm.institutionName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, institutionName: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Domain (optional)"
                value={createForm.domain}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, domain: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Initial Admin Name"
                value={createForm.adminDisplayName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, adminDisplayName: e.target.value }))}
                required
              />
              <input
                className="input-field"
                type="email"
                placeholder="Initial Admin Email"
                value={createForm.adminEmail}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, adminEmail: e.target.value }))}
                required
              />
              <input
                className="input-field"
                type="password"
                placeholder="Initial Admin Password"
                value={createForm.adminPassword}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, adminPassword: e.target.value }))}
                minLength={8}
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  placeholder="Max Users"
                  value={createForm.maxUsers}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, maxUsers: Number(e.target.value || 0) }))}
                  required
                />
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  placeholder="Max Storage GB"
                  value={createForm.maxStorageGb}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, maxStorageGb: Number(e.target.value || 0) }))}
                  required
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">DICOM Storage Mode</p>
              <div className="inline-flex rounded-xl border border-tdai-gray-200 p-1">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${createForm.storageMode === "local" ? "bg-tdai-navy-700 text-white" : "text-tdai-secondary"}`}
                  onClick={() => setCreateForm((prev) => ({ ...prev, storageMode: "local" }))}
                >
                  Local
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${createForm.storageMode === "cloud" ? "bg-tdai-teal-600 text-white" : "text-tdai-secondary"}`}
                  onClick={() => setCreateForm((prev) => ({ ...prev, storageMode: "cloud" }))}
                >
                  Cloud
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <input
                className="input-field"
                placeholder={createForm.storageMode === "cloud" ? "PACS Endpoint URL (required)" : "PACS Endpoint URL (optional)"}
                value={createForm.pacsEndpointUrl}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, pacsEndpointUrl: e.target.value }))}
                required={createForm.storageMode === "cloud"}
              />
              <input
                className="input-field"
                placeholder="Cloud Bucket"
                value={createForm.cloudBucket}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, cloudBucket: e.target.value }))}
                disabled={createForm.storageMode !== "cloud"}
              />
              <input
                className="input-field"
                placeholder="Cloud Prefix"
                value={createForm.cloudPrefix}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, cloudPrefix: e.target.value }))}
                disabled={createForm.storageMode !== "cloud"}
              />
            </div>

            <button className="btn-primary" type="submit" disabled={createTenantMutation.isPending}>
              {createTenantMutation.isPending ? "Creating..." : "Create Hospital"}
            </button>
          </form>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-tdai-text">Hospitals & PACS Assignment</h2>
            <button
              className="btn-secondary !py-1.5 !px-3 text-xs"
              type="button"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {tenantsQuery.isLoading ? (
            <div className="py-12 text-center text-sm text-tdai-secondary">Loading hospitals...</div>
          ) : tenants.length === 0 ? (
            <div className="py-12 text-center text-sm text-tdai-secondary">No hospitals found. Create the first tenant above.</div>
          ) : (
            <div className="space-y-4">
              {tenants.map((tenant) => {
                const draft = tenantDrafts[tenant.id] ?? buildTenantDraft(tenant);
                const adminForm = adminForms[tenant.id] ?? defaultAdminForm;
                const isUpdating = updateTenantMutation.isPending && activeTenantId === tenant.id;
                const isCreatingAdmin = createAdminMutation.isPending && activeTenantId === tenant.id;
                return (
                  <div key={tenant.id} className="rounded-xl border border-tdai-gray-200 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-tdai-text">{tenant.name}</p>
                        <p className="text-xs text-tdai-secondary">
                          {tenant.slug} | AE: {tenant.ae_title} | Users: {tenant.user_count ?? 0} | Admins: {tenant.hospital_admin_count ?? 0}
                        </p>
                      </div>
                      <span className={`badge ${draft.isActive ? "bg-emerald-50 text-emerald-700" : "bg-tdai-red-50 text-tdai-red-700"}`}>
                        {draft.isActive ? "Active" : "Suspended"}
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <select
                        className="select-field"
                        value={draft.storageMode}
                        onChange={(e) => updateTenantDraft(tenant.id, { storageMode: e.target.value as StorageMode })}
                      >
                        <option value="local">Local Storage</option>
                        <option value="cloud">Cloud Storage</option>
                      </select>
                      <input
                        className="input-field"
                        placeholder="PACS Endpoint URL"
                        value={draft.pacsEndpointUrl}
                        onChange={(e) => updateTenantDraft(tenant.id, { pacsEndpointUrl: e.target.value })}
                      />
                      <select
                        className="select-field"
                        value={draft.isActive ? "active" : "suspended"}
                        onChange={(e) => updateTenantDraft(tenant.id, { isActive: e.target.value === "active" })}
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                      <input
                        className="input-field"
                        placeholder="Local storage path"
                        value={draft.localStoragePath}
                        onChange={(e) => updateTenantDraft(tenant.id, { localStoragePath: e.target.value })}
                        disabled={draft.storageMode !== "local"}
                      />
                      <input
                        className="input-field"
                        placeholder="Cloud bucket"
                        value={draft.cloudBucket}
                        onChange={(e) => updateTenantDraft(tenant.id, { cloudBucket: e.target.value })}
                        disabled={draft.storageMode !== "cloud"}
                      />
                      <input
                        className="input-field"
                        placeholder="Cloud prefix"
                        value={draft.cloudPrefix}
                        onChange={(e) => updateTenantDraft(tenant.id, { cloudPrefix: e.target.value })}
                        disabled={draft.storageMode !== "cloud"}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        className="btn-primary !py-1.5 !px-3 text-xs"
                        type="button"
                        onClick={() => {
                          setActiveTenantId(tenant.id);
                          updateTenantMutation.mutate({ tenantId: tenant.id, draft });
                        }}
                        disabled={isUpdating}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {isUpdating ? "Saving..." : "Save Tenant Settings"}
                      </button>
                    </div>

                    <div className="mt-4 rounded-lg border border-dashed border-tdai-gray-200 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-tdai-secondary">Create Hospital Admin</p>
                      <div className="grid gap-2 md:grid-cols-3">
                        <input
                          className="input-field"
                          type="email"
                          placeholder="Admin email"
                          value={adminForm.adminEmail}
                          onChange={(e) => updateAdminForm(tenant.id, { adminEmail: e.target.value })}
                        />
                        <input
                          className="input-field"
                          type="password"
                          placeholder="Temporary password"
                          value={adminForm.adminPassword}
                          onChange={(e) => updateAdminForm(tenant.id, { adminPassword: e.target.value })}
                        />
                        <input
                          className="input-field"
                          placeholder="Display name"
                          value={adminForm.adminDisplayName}
                          onChange={(e) => updateAdminForm(tenant.id, { adminDisplayName: e.target.value })}
                        />
                      </div>
                      <button
                        className="btn-secondary mt-2 !py-1.5 !px-3 text-xs"
                        type="button"
                        onClick={() => {
                          setActiveTenantId(tenant.id);
                          createAdminMutation.mutate({ tenantId: tenant.id, form: adminForm });
                        }}
                        disabled={isCreatingAdmin}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {isCreatingAdmin ? "Creating..." : "Create Admin"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-tdai-text">Monitoring Overview</h2>
          {monitoringQuery.isLoading ? (
            <p className="mt-2 text-sm text-tdai-secondary">Loading monitoring metrics...</p>
          ) : monitoringQuery.data ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Total Users</p>
                <p className="mt-1 text-xl font-semibold text-tdai-text">{monitoringQuery.data.totalUsers}</p>
              </div>
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Hospital Admins</p>
                <p className="mt-1 text-xl font-semibold text-tdai-text">{monitoringQuery.data.totalHospitalAdmins}</p>
              </div>
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Pending Approvals</p>
                <p className="mt-1 text-xl font-semibold text-tdai-text">{monitoringQuery.data.totalPendingApprovals}</p>
              </div>
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Total Studies</p>
                <p className="mt-1 text-xl font-semibold text-tdai-text">{monitoringQuery.data.totalStudies}</p>
              </div>
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Suspended Hospitals</p>
                <p className="mt-1 text-xl font-semibold text-tdai-text">{monitoringQuery.data.suspendedTenants}</p>
              </div>
              <div className="rounded-lg border border-tdai-gray-200 p-3">
                <p className="text-xs uppercase tracking-wider text-tdai-secondary">Updated</p>
                <p className="mt-1 text-sm font-semibold text-tdai-text">{new Date(monitoringQuery.data.updatedAt).toLocaleString()}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-tdai-secondary">Monitoring data unavailable.</p>
          )}
        </div>

        {statusMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{statusMessage}</div>
        )}
        {errorMessage && (
          <div className="rounded-xl border border-tdai-red-200 bg-tdai-red-50 px-4 py-2 text-sm text-tdai-red-700">{errorMessage}</div>
        )}
      </div>
    </div>
  );
}
