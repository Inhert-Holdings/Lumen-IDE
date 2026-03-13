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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("monaco-editor")) return "vendor-monaco";
          if (id.includes("xterm")) return "vendor-terminal";
          if (id.includes("react-resizable-panels")) return "vendor-layout";
          if (id.includes("zustand")) return "vendor-state";
          return "vendor";
        }
      }
    }
  },
  clearScreen: false
});
