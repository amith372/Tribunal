import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One URL in production: Express serves this build plus /api, so there is no CORS.
// In development Vite proxies /api to the Express process instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
