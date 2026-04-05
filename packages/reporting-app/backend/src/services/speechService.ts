import { SpeechClient } from "@google-cloud/speech";
import { v4 as uuid } from "uuid";
import { StorageService } from "./storageService";
import { ServiceRegistry } from "./serviceRegistry";
import { logger } from "./logger";
import type { RadiologyTranscript } from "@medical-report-system/shared";

interface TranscribeResult {
  transcript: string;
  storageUrl: string;
}

interface RadiologyTranscribeResult {
  rawTranscript: string;
  correctedTranscript: string;
  radiologyReport: RadiologyTranscript;
  confidence: number;
  modelUsed: string;
  storageUrl: string;
}

export class SpeechService {
  private client: SpeechClient | null = null;
  private readonly registry: ServiceRegistry;

  constructor(
    private readonly storageService: StorageService,
    registry?: ServiceRegistry,
  ) {
    this.registry = registry ?? new ServiceRegistry();
  }

  private getClient(): SpeechClient {
    if (!this.client) {
      this.client = new SpeechClient();
    }
    return this.client;
  }

  async transcribeAudio(data: Buffer, mimeType: string, languageCode = "en-US"): Promise<TranscribeResult> {
    const providerAttempts = await this.getProviderAttempts();

    for (const provider of providerAttempts) {
      try {
        return await this.transcribeWithProvider(provider.url, data, mimeType);
      } catch (err) {
        logger.warn({
          message: "STT provider failed, trying next available provider",
          provider: provider.name,
          error: (err as Error).message,
        });
      }
    }

    if (providerAttempts.length === 0) {
      return { transcript: "", storageUrl: "" };
    }

    return this.transcribeWithGoogle(data, mimeType, languageCode);
  }

  async transcribeRadiology(data: Buffer, mimeType: string): Promise<RadiologyTranscribeResult> {
    const providerAttempts = await this.getProviderAttempts();

    for (const provider of providerAttempts) {
      try {
        return await this.radiologyWithProvider(provider.url, data, mimeType);
      } catch (err) {
        logger.warn({
          message: "STT radiology failed, trying next available provider",
          provider: provider.name,
          error: (err as Error).message,
        });
      }
    }

    if (providerAttempts.length === 0) {
      return this.fallbackBrowserTranscript(data, mimeType, "");
    }

    const storageUrl = await this.tryUpload(data, mimeType);

    try {
      const googleResult = await this.transcribeWithGoogle(data, mimeType, "en-US");
      const corrected = await this.correctWithLLM(googleResult.transcript);

      return {
        rawTranscript: googleResult.transcript,
        correctedTranscript: corrected.findings
          ? `Findings: ${corrected.findings}\n\nImpression: ${corrected.impression}`
          : googleResult.transcript,
        radiologyReport: corrected,
        confidence: 0.85,
        modelUsed: "google-stt + llm-correction",
        storageUrl,
      };
    } catch (googleErr) {
      logger.warn({ message: "Google STT also failed", error: (googleErr as Error).message });
      return this.fallbackBrowserTranscript(data, mimeType, storageUrl);
    }
  }

  private async getProviderAttempts(): Promise<Array<{ name: "wav2vec2" | "medasr"; url: string }>> {
    const config = await this.registry.getConfig();

    if (config.stt.provider === "off") {
      return [];
    }

    const primary =
      config.stt.provider === "wav2vec2"
        ? { name: "wav2vec2" as const, url: config.stt.wav2vec2Url }
        : { name: "medasr" as const, url: config.stt.medasrUrl };

    const secondary =
      config.stt.provider === "wav2vec2"
        ? { name: "medasr" as const, url: config.stt.medasrUrl }
        : { name: "wav2vec2" as const, url: config.stt.wav2vec2Url };

    return [primary, secondary].filter(
      (provider, index, list) =>
        !!provider.url && list.findIndex((item) => item.url === provider.url) === index,
    );
  }

  async correctWithLLM(transcript: string): Promise<RadiologyTranscript> {
    const correctionUrl = await this.registry.getCorrectionUrl();

    if (!correctionUrl) {
      logger.info({ message: "LLM correction skipped — provider is off" });
      return {
        findings: transcript,
        impression: "Clinical correlation recommended.",
        corrections_applied: ["LLM correction disabled — raw transcript used"],
      };
    }

    try {
      const form = new FormData();
      form.append("transcript", transcript);

      const llmProvider = await this.registry.getLlmProvider();
      logger.info({ message: "Sending correction request", provider: llmProvider, url: `${correctionUrl}/v1/correct` });

      const response = await fetch(`${correctionUrl}/v1/correct`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) throw new Error(`LLM correction failed: ${response.status}`);
      return await response.json() as RadiologyTranscript;
    } catch (err) {
      logger.warn({ message: "LLM correction unavailable", error: (err as Error).message });
      return {
        findings: transcript,
        impression: "Clinical correlation recommended.",
        corrections_applied: ["LLM correction unavailable — raw transcript used"],
      };
    }
  }

  private async fallbackBrowserTranscript(_data: Buffer, _mimeType: string, storageUrl: string): Promise<RadiologyTranscribeResult> {
    const placeholder = "Audio received but server-side transcription is unavailable. " +
      "Use the browser dictation (microphone) button for real-time transcription, " +
      "then click 'Format with AI' to structure the report.";

    return {
      rawTranscript: placeholder,
      correctedTranscript: placeholder,
      radiologyReport: {
        findings: placeholder,
        impression: "Please use browser-based voice input and AI formatting.",
        corrections_applied: ["Server ASR unavailable — use browser dictation + /v1/correct"],
      },
      confidence: 0,
      modelUsed: "fallback-notice",
      storageUrl,
    };
  }

  private async tryUpload(data: Buffer, mimeType: string): Promise<string> {
    try {
      const tempPath = `temp/transcription-${uuid()}`;
      return await this.storageService.uploadBuffer(tempPath, data, mimeType);
    } catch {
      logger.warn({ message: "Storage upload skipped — GCS not configured" });
      return "";
    }
  }

  private async transcribeWithGoogle(data: Buffer, mimeType: string, languageCode: string): Promise<TranscribeResult> {
    const tempPath = `temp/transcription-${uuid()}`;
    const storageUrl = await this.storageService.uploadBuffer(tempPath, data, mimeType);

    try {
      const [operation] = await this.getClient().longRunningRecognize({
        config: {
          encoding: mimeType.includes("wav") ? "LINEAR16" : "MP3",
          languageCode,
          enableAutomaticPunctuation: true,
        },
        audio: { uri: storageUrl },
      });

      const [result] = await operation.promise();
      const transcript =
        result.results
          ?.map((chunk) => chunk.alternatives?.[0]?.transcript ?? "")
          .join(" ")
          .trim() ?? "";

      return { transcript, storageUrl };
    } catch (error) {
      throw new Error(`Google Speech-to-Text failed: ${(error as Error).message}`);
    } finally {
      await this.storageService.deleteObject(tempPath).catch(() => {});
    }
  }

  private async transcribeWithProvider(providerUrl: string, data: Buffer, mimeType: string): Promise<TranscribeResult> {
    const ext = mimeType.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("audio", new File([new Uint8Array(data)], `audio.${ext}`, { type: mimeType }));
    form.append("apply_medical_correction", "true");

    const response = await fetch(`${providerUrl}/v1/transcribe`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT provider error ${response.status}: ${errText}`);
    }

    const result = await response.json() as {
      raw_transcript: string;
      corrected_transcript?: string;
    };

    return {
      transcript: result.corrected_transcript ?? result.raw_transcript,
      storageUrl: "",
    };
  }

  private async radiologyWithProvider(providerUrl: string, data: Buffer, mimeType: string): Promise<RadiologyTranscribeResult> {
    const ext = mimeType.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("audio", new File([new Uint8Array(data)], `audio.${ext}`, { type: mimeType }));

    const response = await fetch(`${providerUrl}/v1/transcribe/radiology`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT radiology error ${response.status}: ${errText}`);
    }

    const result = await response.json() as {
      raw_transcript: string;
      corrected_transcript?: string;
      report?: { findings: string; impression: string; corrections_applied?: string[] };
      confidence: number;
      model_used: string;
    };

    const report: RadiologyTranscript = result.report ?? {
      findings: result.corrected_transcript ?? result.raw_transcript,
      impression: "Clinical correlation recommended.",
    };

    return {
      rawTranscript: result.raw_transcript,
      correctedTranscript: result.corrected_transcript ?? result.raw_transcript,
      radiologyReport: report,
      confidence: result.confidence,
      modelUsed: result.model_used,
      storageUrl: "",
    };
  }
}
