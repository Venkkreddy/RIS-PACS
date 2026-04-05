import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_BACKEND_PROXY_TARGET ?? env.VITE_API_BASE_URL ?? "http://localhost:8080";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // BFF/gateway in dev: browser -> vite (/api) -> backend
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 600_000,
          proxyTimeout: 600_000,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
