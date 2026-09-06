import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Alvo default cobre `pnpm --filter @orquestra/web dev` fora do Docker; o compose
// sobrescreve via VITE_API_PROXY_TARGET para o nome do serviço na rede interna.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
