import axios, { AxiosInstance } from "axios";
import FormData from "form-data";
import { env } from "../config/env";
import { logger } from "./logger";
import { ServiceRegistry } from "./serviceRegistry";

export interface MonaiInferenceRequest {
  studyId: string;
  seriesId?: string;
  model: string;
  dicomwebUrl?: string;
}

export interface MonaiFinding {
  label: string;
  confidence: number;
  description: string;
  location?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface MedgemmaCondition {
  label: string;
  confidence: number;
  description: string;
}

export interface MonaiInferenceResult {
  studyId: string;
  model: string;
  status: "completed" | "failed" | "pending";
  findings: MonaiFinding[];
  summary: string;
  processedAt: string;
  processingTimeMs: number;
  dicomSrBase64?: string;
  dicomSrSizeBytes?: number;
  dicomScBase64?: string;
  dicomScSizeBytes?: number;
  dicomGspsBase64?: string;
  dicomGspsSizeBytes?: number;
  heatmapPngBase64?: string;
  medgemmaNarrative?: string;
  medgemmaFindings?: string;
  medgemmaImpression?: string;
  medgemmaConditions?: MedgemmaCondition[];
}

export interface MonaiModelInfo {
  name: string;
  description: string;
  type: string;
  bodyParts: string[];
  modalities: string[];
  version: string;
}

export class MonaiService {
  private client: AxiosInstance;
  private enabled: boolean;
  private registry: ServiceRegistry;

  constructor(registry?: ServiceRegistry) {
    this.enabled = env.MONAI_ENABLED;
    this.registry = registry ?? new ServiceRegistry();
    this.client = axios.create({
      baseURL: env.MONAI_SERVER_URL,
      timeout: 120_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async listModels(): Promise<MonaiModelInfo[]> {
    if (!this.enabled) return [];

    try {
      const response = await this.client.get("/v1/models");
      return (response.data as { models?: MonaiModelInfo[] }).models ?? [];
    } catch (error) {
      logger.warn({ message: "MONAI listModels failed — returning empty list", error: String(error) });
      return [];
    }
  }

  async runInference(request: MonaiInferenceRequest): Promise<MonaiInferenceResult> {
    if (!this.enabled) {
      return this.mockInferenceResult(request);
    }

    const startTime = Date.now();

    try {
      const dicomwebUrl = request.dicomwebUrl ?? `${env.DICOOGLE_BASE_URL}/dicom-web`;

      const payload = {
        model: request.model,
        studies: [request.studyId],
        series: request.seriesId ? [request.seriesId] : undefined,
        input: { type: "dicomweb", url: dicomwebUrl },
      };

      const response = await this.client.post("/v1/infer", payload);
      const data = response.data as Record<string, unknown>;

      const findings = this.parseFindings(data);
      const summary = this.buildSummary(findings, request.model);

      return {
        studyId: request.studyId,
        model: request.model,
        status: "completed",
        findings,
        summary,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const axErr = error as { response?: { data?: unknown } };
      const serverDetail =
        axErr.response?.data && typeof axErr.response.data === "object"
          ? (axErr.response.data as { detail?: string }).detail
          : undefined;
      logger.error({ message: "MONAI inference failed", studyId: request.studyId, model: request.model, error: String(error) });

      return {
        studyId: request.studyId,
        model: request.model,
        status: "failed",
        findings: [],
        summary: `AI analysis failed: ${serverDetail ?? (error instanceof Error ? error.message : "Unknown error")}`,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  async runInferenceWithSR(request: MonaiInferenceRequest): Promise<MonaiInferenceResult> {
    if (!this.enabled) {
      return this.mockInferenceResult(request);
    }

    const startTime = Date.now();

    try {
      const payload = {
        model: request.model,
        studies: [request.studyId],
        series: request.seriesId ? [request.seriesId] : undefined,
      };

      const response = await this.client.post("/v1/infer-with-sr", payload);
      const data = response.data as Record<string, unknown>;

      const findings = this.parseFindings(data);
      const summary = (data.summary as string) ?? this.buildSummary(findings, request.model);

      return {
        studyId: request.studyId,
        model: request.model,
        status: "completed",
        findings,
        summary,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        dicomSrBase64: data.dicom_sr_base64 as string | undefined,
        dicomSrSizeBytes: data.dicom_sr_size_bytes as number | undefined,
      };
    } catch (error) {
      const axErr = error as { response?: { data?: unknown } };
      const serverDetail =
        axErr.response?.data && typeof axErr.response.data === "object"
          ? (axErr.response.data as { detail?: string }).detail
          : undefined;
      logger.error({ message: "MONAI infer-with-SR failed", studyId: request.studyId, error: String(error) });

      return {
        studyId: request.studyId,
        model: request.model,
        status: "failed",
        findings: [],
        summary: `AI analysis with SR generation failed: ${serverDetail ?? (error instanceof Error ? error.message : "Unknown error")}`,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  async analyzeDicomFile(
    dicomBuffer: Buffer,
    filename: string,
    studyId: string,
    model: string,
  ): Promise<MonaiInferenceResult> {
    if (!this.enabled) {
      return this.mockInferenceResult({ studyId, model });
    }

    const startTime = Date.now();

    try {
      const form = new FormData();
      form.append("file", dicomBuffer, { filename, contentType: "application/dicom" });
      form.append("model_name", model);
      form.append("study_uid", studyId);

      const response = await axios.post(`${env.MONAI_SERVER_URL}/v1/analyze-dicom`, form, {
        headers: form.getHeaders(),
        timeout: 180_000,
        maxContentLength: 100_000_000,
        maxBodyLength: 100_000_000,
      });

      const data = response.data as Record<string, unknown>;
      const findings = this.parseFindings(data);
      const summary = (data.summary as string) ?? this.buildSummary(findings, model);

      return {
        studyId,
        model,
        status: "completed",
        findings,
        summary,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        dicomSrBase64: data.dicom_sr_base64 as string | undefined,
        dicomSrSizeBytes: data.dicom_sr_size_bytes as number | undefined,
        dicomScBase64: data.dicom_sc_base64 as string | undefined,
        dicomScSizeBytes: data.dicom_sc_size_bytes as number | undefined,
        dicomGspsBase64: data.dicom_gsps_base64 as string | undefined,
        dicomGspsSizeBytes: data.dicom_gsps_size_bytes as number | undefined,
      };
    } catch (error: unknown) {
      const axErr = error as { response?: { data?: unknown; status?: number } };
      const serverDetail =
        axErr.response?.data && typeof axErr.response.data === "object"
          ? (axErr.response.data as { detail?: string }).detail
          : undefined;
      logger.error({
        message: "MONAI analyze-dicom failed",
        studyId,
        model,
        error: String(error),
        responseStatus: axErr.response?.status,
        responseData: axErr.response?.data ? JSON.stringify(axErr.response.data).slice(0, 500) : undefined,
      });
      const userMessage = serverDetail
        ? `AI analysis failed: ${serverDetail}`
        : `AI analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      return {
        studyId,
        model,
        status: "failed",
        findings: [],
        summary: userMessage,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  async analyzeDicomWithMedGemma(
    dicomBuffer: Buffer,
    filename: string,
    studyId: string,
    monaiModel: string = "monai_chest_xray",
  ): Promise<MonaiInferenceResult> {
    if (!this.enabled) {
      return this.mockInferenceResult({ studyId, model: "medgemma_report" });
    }

    const llmProvider = await this.registry.getLlmProvider();
    const useMedGemma = llmProvider !== "off";
    const endpoint = useMedGemma ? "/v1/analyze-medgemma" : "/v1/analyze-dicom";
    const modelLabel = llmProvider === "gemini" ? "medgemma_report" : llmProvider === "ollama" ? "ollama_report" : "monai_only";

    const startTime = Date.now();

    try {
      const config = await this.registry.getConfig();
      const monaiUrl = config.inference.monaiUrl;

      const form = new FormData();
      form.append("file", dicomBuffer, { filename, contentType: "application/dicom" });
      form.append("study_uid", studyId);
      form.append("include_monai", "true");
      form.append("monai_model", monaiModel);
      if (useMedGemma) {
        form.append("llm_provider", llmProvider);
      }

      const response = await axios.post(`${monaiUrl}${endpoint}`, form, {
        headers: form.getHeaders(),
        timeout: 180_000,
        maxContentLength: 100_000_000,
        maxBodyLength: 100_000_000,
      });

      const data = response.data as Record<string, unknown>;
      const findings = this.parseFindings(data);
      const summary = (data.summary as string) ?? this.buildSummary(findings, modelLabel);

      return {
        studyId,
        model: modelLabel,
        status: "completed",
        findings,
        summary,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        dicomSrBase64: data.dicom_sr_base64 as string | undefined,
        dicomSrSizeBytes: data.dicom_sr_size_bytes as number | undefined,
        dicomScBase64: data.dicom_sc_base64 as string | undefined,
        dicomScSizeBytes: data.dicom_sc_size_bytes as number | undefined,
        dicomGspsBase64: data.dicom_gsps_base64 as string | undefined,
        dicomGspsSizeBytes: data.dicom_gsps_size_bytes as number | undefined,
        heatmapPngBase64: data.heatmap_png_base64 as string | undefined,
        medgemmaNarrative: useMedGemma ? (data.medgemma_narrative as string | undefined) : undefined,
        medgemmaFindings: useMedGemma ? (data.medgemma_findings as string | undefined) : undefined,
        medgemmaImpression: useMedGemma ? (data.medgemma_impression as string | undefined) : undefined,
        medgemmaConditions: useMedGemma ? (data.medgemma_conditions as MedgemmaCondition[] | undefined) : undefined,
      };
    } catch (error: unknown) {
      const axErr = error as { response?: { data?: unknown; status?: number } };
      logger.error({
        message: "AI analyze failed",
        studyId,
        endpoint,
        error: String(error),
        responseStatus: axErr.response?.status,
      });
      return {
        studyId,
        model: modelLabel,
        status: "failed",
        findings: [],
        summary: `AI analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  async getInferenceStatus(jobId: string): Promise<{ status: string; progress?: number }> {
    if (!this.enabled) {
      return { status: "completed", progress: 100 };
    }

    try {
      const response = await this.client.get(`/v1/infer/${jobId}/status`);
      return response.data as { status: string; progress?: number };
    } catch {
      return { status: "unknown" };
    }
  }

  private parseFindings(data: Record<string, unknown>): MonaiFinding[] {
    const raw = (data.findings ?? data.results ?? data.predictions ?? []) as Array<Record<string, unknown>>;

    return raw.map((item) => ({
      label: String(item.label ?? item.name ?? "Unknown"),
      confidence: Number(item.confidence ?? item.score ?? item.probability ?? 0),
      description: String(item.description ?? item.detail ?? ""),
      location: item.location ? String(item.location) : undefined,
      boundingBox: item.boundingBox as MonaiFinding["boundingBox"],
    }));
  }

  private buildSummary(findings: MonaiFinding[], model: string): string {
    if (findings.length === 0) {
      return `AI analysis (${model}): No significant findings detected.`;
    }

    const significant = findings.filter((f) => f.confidence >= 0.5);
    if (significant.length === 0) {
      return `AI analysis (${model}): ${findings.length} finding(s) detected, all below clinical significance threshold.`;
    }

    const descriptions = significant
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map((f) => `${f.label} (${(f.confidence * 100).toFixed(0)}%)`)
      .join(", ");

    return `AI analysis (${model}): ${significant.length} significant finding(s) — ${descriptions}`;
  }

  /**
   * When MONAI is disabled, provide a mock result so the UI flow
   * can still be demonstrated / tested without a running MONAI server.
   */
  private mockInferenceResult(request: MonaiInferenceRequest): MonaiInferenceResult {
    return {
      studyId: request.studyId,
      model: request.model,
      status: "completed",
      findings: [
        {
          label: "AI Inactive",
          confidence: 0,
          description: "MONAI server is not configured. Enable MONAI_ENABLED=true and set MONAI_SERVER_URL to activate AI analysis.",
        },
      ],
      summary: "AI analysis is not enabled. Configure MONAI to activate automated findings.",
      processedAt: new Date().toISOString(),
      processingTimeMs: 0,
    };
  }
}
