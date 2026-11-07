import { defineConfig } from "vite";

export default defineConfig({
  envDir: "..", // يقرأ .env من جذر المشروع
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
