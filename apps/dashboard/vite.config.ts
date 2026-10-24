import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs separately (pnpm dev:api); everything under /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8081}` },
  },
  build: { target: "es2022", sourcemap: false },
});
