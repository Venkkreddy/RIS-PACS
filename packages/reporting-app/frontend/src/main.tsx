import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./hooks/useAuthRole";
import { ServiceStatusProvider } from "./hooks/useServiceStatus";
import "./index.css";
import "react-quill/dist/quill.snow.css";

declare global {
  interface Window {
    __tdaiAgentDebugLog?: (
      hypothesisId: string,
      location: string,
      message: string,
      data?: Record<string, unknown>,
      runId?: string,
    ) => void;
  }
}

function debugBootLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = "run-2",
) {
  if (typeof window !== "undefined" && typeof window.__tdaiAgentDebugLog === "function") {
    window.__tdaiAgentDebugLog(hypothesisId, location, message, data, runId);
    return;
  }

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

const queryClient = new QueryClient();

// #region agent log
debugBootLog("H10", "main.tsx:moduleInit", "main module initialized", {
  path: typeof window !== "undefined" ? window.location.pathname : "unknown",
}, "run-2");
// #endregion

try {
  const rootElement = document.getElementById("root");
  // #region agent log
  debugBootLog("H10", "main.tsx:beforeRender", "about to render react root", {
    hasRootElement: !!rootElement,
    hasRootLoader: !!document.getElementById("root-loader"),
  }, "run-2");
  // #endregion

  if (!rootElement) {
    throw new Error("Root element #root not found");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ServiceStatusProvider>
              <App />
            </ServiceStatusProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );

  // #region agent log
  debugBootLog("H10", "main.tsx:renderCalled", "react render call completed", {
    hasRootLoaderAfterRenderCall: !!document.getElementById("root-loader"),
  }, "run-2");
  // #endregion
} catch (error) {
  // #region agent log
  debugBootLog("H11", "main.tsx:renderError", "react bootstrap threw", {
    error:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unknown",
  }, "run-2");
  // #endregion
  throw error;
}
