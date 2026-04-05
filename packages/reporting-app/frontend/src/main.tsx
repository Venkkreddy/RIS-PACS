import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./hooks/useAuthRole";
import { ServiceStatusProvider } from "./hooks/useServiceStatus";
import "./index.css";
import "react-quill/dist/quill.snow.css";

const queryClient = new QueryClient();

// #region agent log
void fetch("http://127.0.0.1:7526/ingest/cd2ccaa8-51d1-4291-bf05-faef93098c97", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6646bc" },
  body: JSON.stringify({
    sessionId: "6646bc",
    runId: "initial",
    hypothesisId: "H7",
    location: "frontend/src/main.tsx:bootstrap",
    message: "Reporting frontend bundle executed",
    data: {},
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

ReactDOM.createRoot(document.getElementById("root")!).render(
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
