import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { MonaiInferenceResult, MonaiModelInfo } from "../types/worklist";
import { useAuthRole } from "../hooks/useAuthRole";
import { useServiceStatus } from "../hooks/useServiceStatus";

interface StoredAiResult {
  studyId: string;
  findings: MonaiInferenceResult["findings"];
  summary: string | null;
  model: string | null;
  dicomSrAvailable?: boolean;
  dicomScAvailable?: boolean;
  dicomGspsAvailable?: boolean;
  heatmapUrl?: string | null;
  gspsUrl?: string | null;
}

interface MonaiPanelProps {
  studyId: string;
}

function confidenceLabel(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function MonaiPanel({ studyId }: MonaiPanelProps) {
  const auth = useAuthRole();
  const serviceStatus = useServiceStatus();
  const canAnalyze = auth.hasPermission("ai:analyze");
  const canViewResults = auth.hasPermission("ai:view_results");

  const [selectedModel, setSelectedModel] = useState("monai_chest_xray");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MonaiInferenceResult | null>(null);

  const modelsQuery = useQuery({
    queryKey: ["monai-models"],
    queryFn: async () => {
      const res = await api.get<{ enabled: boolean; models: MonaiModelInfo[] }>("/ai/models");
      return res.data;
    },
    enabled: auth.isAuthenticated && auth.approved && (canAnalyze || canViewResults),
    staleTime: 60_000,
    retry: 1,
  });

  const cachedResultsQuery = useQuery({
    queryKey: ["monai-results", studyId],
    queryFn: async () => {
      const res = await api.get<StoredAiResult>(`/ai/results/${encodeURIComponent(studyId)}`);
      return res.data;
    },
    enabled: auth.isAuthenticated && auth.approved && canViewResults && !!studyId,
    staleTime: 10_000,
    retry: 1,
  });

  const models = modelsQuery.data?.models ?? [];

  useEffect(() => {
    if (models.length === 0) return;
    if (models.some((model) => model.name === selectedModel)) return;
    setSelectedModel(models[0]?.name ?? "monai_chest_xray");
  }, [models, selectedModel]);

  useEffect(() => {
    const cached = cachedResultsQuery.data;
    if (!cached) return;
    if (!cached.summary && (!cached.findings || cached.findings.length === 0)) return;
    setResult((prev) => prev ?? {
      studyId: cached.studyId,
      model: cached.model ?? selectedModel,
      status: "completed",
      findings: cached.findings ?? [],
      summary: cached.summary ?? "",
      processedAt: new Date().toISOString(),
      processingTimeMs: 0,
      heatmapUrl: cached.heatmapUrl ?? undefined,
      gspsUrl: cached.gspsUrl ?? undefined,
      dicomSrGenerated: cached.dicomSrAvailable,
      dicomScGenerated: cached.dicomScAvailable,
      dicomGspsGenerated: cached.dicomGspsAvailable,
    });
  }, [cachedResultsQuery.data, selectedModel]);

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.name === selectedModel) ?? null,
    [models, selectedModel],
  );

  async function runAnalysis() {
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<MonaiInferenceResult>("/ai/analyze", {
        studyId,
        model: selectedModel,
        generateSR: true,
      });
      setResult(res.data);
      void cachedResultsQuery.refetch();
      if (res.data.status === "failed") {
        setError(res.data.summary || "MONAI analysis failed.");
      }
    } catch (err) {
      const resp = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { error?: string; message?: string; summary?: string } } }).response?.data
        : null;
      const message = resp?.summary ?? resp?.message ?? resp?.error;
      setError(message || "MONAI analysis failed.");
    } finally {
      setRunning(false);
    }
  }

  if (!auth.isAuthenticated || !auth.approved) return null;
  if (!canAnalyze && !canViewResults) return null;
  if (!serviceStatus.monaiUiVisible) return null;

  return (
    <div className="flex h-full flex-col border-l border-white/10 bg-tdai-navy-950 text-white">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tdai-teal-300">MONAI</p>
            <h3 className="mt-1 text-sm font-bold text-white">Image Analysis</h3>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${serviceStatus.isMonaiEnabled ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
            {serviceStatus.isMonaiEnabled ? "Enabled" : "Inactive"}
          </span>
        </div>
        <p className="mt-2 text-xs text-tdai-gray-400">
          MONAI inference is available. MedGemma, Gemini, and other LLM-backed report generation remain disabled.
        </p>
      </div>

      {!serviceStatus.isMonaiEnabled ? (
        <div className="p-4 text-sm text-amber-200">
          MONAI is currently turned off in server configuration.
        </div>
      ) : (
        <>
          <div className="space-y-3 border-b border-white/10 p-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tdai-gray-400">
                Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={running || modelsQuery.isLoading || !canAnalyze}
                className="w-full rounded-lg border border-white/10 bg-tdai-navy-900 px-3 py-2 text-sm text-white outline-none"
              >
                {models.length > 0 ? (
                  models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))
                ) : (
                  <option value="monai_chest_xray">monai_chest_xray</option>
                )}
              </select>
            </div>

            {selectedModelInfo && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-tdai-gray-300">
                <p className="font-semibold text-white">{selectedModelInfo.description || selectedModelInfo.name}</p>
                <p className="mt-1">
                  {selectedModelInfo.modalities.join(", ") || "General modality"} | {selectedModelInfo.bodyParts.join(", ") || "General body part"}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {canAnalyze && (
                <button
                  type="button"
                  onClick={() => void runAnalysis()}
                  disabled={running}
                  className="inline-flex items-center justify-center rounded-lg bg-tdai-teal-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-tdai-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {running ? "Running..." : "Run MONAI"}
                </button>
              )}
              {canViewResults && (
                <button
                  type="button"
                  onClick={() => void cachedResultsQuery.refetch()}
                  className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-tdai-gray-200 transition hover:bg-white/10"
                >
                  Refresh
                </button>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {modelsQuery.isLoading && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-tdai-gray-300">
                Loading MONAI models...
              </div>
            )}

            {result?.summary && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tdai-gray-400">Summary</p>
                <p className="mt-2 text-sm leading-6 text-tdai-gray-100">{result.summary}</p>
                <p className="mt-3 text-[11px] text-tdai-gray-500">
                  Model: {result.model} {result.processingTimeMs ? `| ${result.processingTimeMs} ms` : ""}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tdai-gray-400">Findings</p>
              {result?.findings?.length ? (
                <div className="mt-3 space-y-2">
                  {result.findings.map((finding, index) => (
                    <div key={`${finding.label}-${index}`} className="rounded-lg border border-white/10 bg-tdai-navy-900/80 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{finding.label}</p>
                          {finding.description && (
                            <p className="mt-1 text-xs leading-5 text-tdai-gray-300">{finding.description}</p>
                          )}
                          {finding.location && (
                            <p className="mt-1 text-[11px] text-tdai-gray-500">Location: {finding.location}</p>
                          )}
                        </div>
                        <span className="rounded-full bg-tdai-teal-500/15 px-2.5 py-1 text-[11px] font-semibold text-tdai-teal-200">
                          {confidenceLabel(finding.confidence)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-tdai-gray-400">
                  No MONAI findings stored for this study yet.
                </p>
              )}
            </div>

            {(result?.heatmapUrl || result?.heatmapPngBase64) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tdai-gray-400">Heatmap</p>
                <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/20">
                  <img
                    src={result.heatmapPngBase64 ? `data:image/png;base64,${result.heatmapPngBase64}` : result.heatmapUrl}
                    alt="MONAI heatmap"
                    className="h-auto w-full object-contain"
                  />
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tdai-gray-400">DICOM Artifacts</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {result?.dicomSrGenerated && (
                  <a
                    href={`/ai/sr/${encodeURIComponent(studyId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-tdai-gray-100 transition hover:bg-white/10"
                  >
                    Open SR
                  </a>
                )}
                {result?.dicomGspsGenerated && result.gspsUrl && (
                  <a
                    href={result.gspsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-tdai-gray-100 transition hover:bg-white/10"
                  >
                    Open GSPS
                  </a>
                )}
                {!result?.dicomSrGenerated && !result?.dicomGspsGenerated && !result?.dicomScGenerated && (
                  <p className="text-sm text-tdai-gray-400">Artifacts will appear here after MONAI analysis runs.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
