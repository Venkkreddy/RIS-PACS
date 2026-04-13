import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { useServiceStatus } from "../hooks/useServiceStatus";

type StorageMode = "local" | "cloud";

export function ServiceTogglePanel() {
  const { config, refetch } = useServiceStatus();
  const storageMode = config?.storage.mode ?? "cloud";

  const updateStorageModeMutation = useMutation({
    mutationFn: async (mode: StorageMode) => {
      await api.put("/services/config", { storage: { mode } });
    },
    onSuccess: () => {
      refetch();
    },
  });

  function setStorageMode(mode: StorageMode) {
    if (mode === storageMode || updateStorageModeMutation.isPending) {
      return;
    }
    updateStorageModeMutation.mutate(mode);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-tdai-navy-800 to-tdai-navy-700 px-6 py-5 text-white shadow-md">
        <p className="text-sm font-bold">Platform Configuration</p>
        <p className="mt-1 text-xs text-tdai-teal-200">
          Cloud database/storage is the default. Switch to local mode from this developer section when needed.
        </p>
      </div>

      <div className="rounded-xl border border-tdai-border bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-tdai-navy-800">Database Storage Mode</p>
        <p className="mt-1 text-xs text-tdai-secondary">
          Default is Cloud for all environments. Use Local only for development workflows.
        </p>
        <div className="mt-3 inline-flex rounded-xl border border-tdai-gray-200 p-1">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              storageMode === "cloud" ? "bg-tdai-teal-600 text-white" : "text-tdai-secondary"
            }`}
            onClick={() => setStorageMode("cloud")}
            disabled={updateStorageModeMutation.isPending}
          >
            Cloud
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              storageMode === "local" ? "bg-tdai-navy-700 text-white" : "text-tdai-secondary"
            }`}
            onClick={() => setStorageMode("local")}
            disabled={updateStorageModeMutation.isPending}
          >
            Local (Dev)
          </button>
        </div>
        {updateStorageModeMutation.isPending && (
          <p className="mt-2 text-xs text-tdai-secondary">Updating storage mode...</p>
        )}
        {updateStorageModeMutation.isError && (
          <p className="mt-2 text-xs text-tdai-red-600">Failed to update storage mode. Please try again.</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-tdai-border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-teal-50">
              <svg className="h-5 w-5 text-tdai-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 19h6a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-tdai-navy-800">OHIF Viewer</p>
              <p className="text-xs text-tdai-secondary">Kept enabled for web-based image review.</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-tdai-border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h6M3 7h6a4 4 0 014 4v2m0 0l3-3m-3 3l-3-3" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-tdai-navy-800">MONAI Inference</p>
              <p className="text-xs text-tdai-secondary">Enabled for image analysis without MedGemma report generation.</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-tdai-border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tdai-navy-50">
              <svg className="h-5 w-5 text-tdai-navy-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-tdai-navy-800">Weasis Viewer</p>
              <p className="text-xs text-tdai-secondary">Kept enabled for desktop viewing workflows.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
        This portal keeps OHIF, Weasis, and MONAI. MedGemma and Gemini/Google integrations remain unavailable.
      </div>
    </div>
  );
}
