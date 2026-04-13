import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface ServiceConfig {
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
  llm: { enabled: boolean; provider: "ollama" | "gemini" | "off" };

  isMonaiEnabled: boolean;
  isLlmEnabled: boolean;

  monaiUiVisible: boolean;
  llmUiVisible: boolean;

  refetch: () => void;
}

const DEFAULTS: ServiceStatus = {
  loading: true,
  error: false,
  config: null,
  monai: { enabled: false, url: "", useMedGemma: false },
  llm: { enabled: false, provider: "off" },
  isMonaiEnabled: false,
  isLlmEnabled: false,
  monaiUiVisible: false,
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

    return {
      loading: false,
      error: false,
      config,
      monai: {
        enabled: config.inference.enabled,
        url: config.inference.monaiUrl,
        useMedGemma: config.inference.useMedGemma,
      },
      llm: { enabled: config.llm.provider !== "off", provider: config.llm.provider },
      isMonaiEnabled: config.inference.enabled,
      isLlmEnabled: config.llm.provider !== "off",
      monaiUiVisible: config.inference.uiVisible !== false,
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
