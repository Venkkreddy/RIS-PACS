import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_BACKEND_PROXY_TARGET ?? env.VITE_API_BASE_URL ?? "http://localhost:8080";

  const certPath = path.resolve(__dirname, "certs/selfsigned.crt");
  const keyPath = path.resolve(__dirname, "certs/selfsigned.key");
  const certsExist = fs.existsSync(certPath) && fs.existsSync(keyPath);

  return {
    plugins: [react()],
    server: {
      port: 5173,
      https: certsExist ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } : undefined,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 600_000,
          proxyTimeout: 600_000,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});
