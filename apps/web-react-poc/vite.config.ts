import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:8000";
const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));
const appDirectory = fileURLToPath(new URL("./app", import.meta.url));

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "@": sourceDirectory,
      "~": appDirectory,
    },
  },
  // Keep the isolated POC independent from PostCSS configs in parent directories.
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/openapi.json": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4181,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/openapi.json": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
