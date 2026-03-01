import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@lumen/core-agent": path.resolve(__dirname, "../../packages/core-agent/src/index.ts"),
      "@lumen/llm-client": path.resolve(__dirname, "../../packages/llm-client/src/index.ts")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  clearScreen: false
});
