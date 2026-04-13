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

try {
  const rootElement = document.getElementById("root");

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
} catch (error) {
  throw error;
}
