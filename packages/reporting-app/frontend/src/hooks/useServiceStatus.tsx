import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface ServiceConfig {
  stt: {
    provider: "wav2vec2" | "medasr" | "off";
    wav2vec2Url: string;
    medasrUrl: string;
    uiVisible?: boolean;
  };
  llm: {
    provider: "ollama" | "gemini" | "off";
    ollamaUrl: string;
    ollamaModel: string;
    geminiModel: string;
    uiVisible?: boolean;
  };
  inference: {
    enabled: boolean;
    monaiUrl: string;
    useMedGemma: boolean;
    uiVisible?: boolean;
  };
  storage: {
    mode: "local" | "cloud";
    cloudBucket: string;
    cloudPrefix: string;
    keepLocalCopy: boolean;
  };
  updatedAt: string;
  updatedBy: string;
}

export interface ServiceStatus {
  loading: boolean;
  error: boolean;
  config: ServiceConfig | null;

  monai: { enabled: boolean; url: string; useMedGemma: boolean };
  stt: { enabled: boolean; provider: "wav2vec2" | "medasr" | "off"; activeUrl: string | null };
  llm: { enabled: boolean; provider: "ollama" | "gemini" | "off" };

  isMonaiEnabled: boolean;
  isWav2vec2Active: boolean;
  isMedasrActive: boolean;
  isSttEnabled: boolean;
  isLlmEnabled: boolean;

  monaiUiVisible: boolean;
  sttUiVisible: boolean;
  llmUiVisible: boolean;

  refetch: () => void;
}

const DEFAULTS: ServiceStatus = {
  loading: true,
  error: false,
  config: null,
  monai: { enabled: false, url: "", useMedGemma: false },
  stt: { enabled: false, provider: "off", activeUrl: null },
  llm: { enabled: false, provider: "off" },
  isMonaiEnabled: false,
  isWav2vec2Active: false,
  isMedasrActive: false,
  isSttEnabled: false,
  isLlmEnabled: false,
  monaiUiVisible: false,
  sttUiVisible: false,
  llmUiVisible: false,
  refetch: () => {},
};

const ServiceStatusContext = createContext<ServiceStatus>(DEFAULTS);

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["service-status-global"],
    queryFn: async () => {
      try {
        const res = await api.get<ServiceConfig>("/services/config");
        return res.data;
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const value = useMemo<ServiceStatus>(() => {
    const config = query.data ?? null;
    if (!config) {
      return {
        ...DEFAULTS,
        loading: query.isLoading,
        error: query.isError,
        refetch: () => query.refetch(),
      };
    }

    const sttProvider = config.stt.provider;
    const sttEnabled = sttProvider !== "off";
    const activeUrl = sttProvider === "wav2vec2"
      ? config.stt.wav2vec2Url
      : sttProvider === "medasr"
        ? config.stt.medasrUrl
        : null;

    return {
      loading: false,
      error: false,
      config,
      monai: {
        enabled: config.inference.enabled,
        url: config.inference.monaiUrl,
        useMedGemma: config.inference.useMedGemma,
      },
      stt: { enabled: sttEnabled, provider: sttProvider, activeUrl },
      llm: { enabled: config.llm.provider !== "off", provider: config.llm.provider },
      isMonaiEnabled: config.inference.enabled,
      isWav2vec2Active: sttProvider === "wav2vec2",
      isMedasrActive: sttProvider === "medasr",
      isSttEnabled: sttEnabled,
      isLlmEnabled: config.llm.provider !== "off",
      monaiUiVisible: config.inference.uiVisible !== false,
      sttUiVisible: config.stt.uiVisible !== false,
      llmUiVisible: config.llm.uiVisible !== false,
      refetch: () => query.refetch(),
    };
  }, [query.data, query.isLoading, query.isError, query.refetch]);

  return (
    <ServiceStatusContext.Provider value={value}>
      {children}
    </ServiceStatusContext.Provider>
  );
}

export function useServiceStatus(): ServiceStatus {
  return useContext(ServiceStatusContext);
}
