import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:8000";
const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));
const appDirectory = fileURLToPath(new URL("./app", import.meta.url));
const profilingBuild = process.env.ANDROMEDA_REACT_PROFILE_BUILD === "1";

export default defineConfig({
  plugins: [reactRouter()],
  define: {
    __ANDROMEDA_REACT_PROFILE__: JSON.stringify(profilingBuild),
  },
  resolve: {
    alias: [
      ...(profilingBuild
        ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }]
        : []),
      { find: "@", replacement: sourceDirectory },
      { find: "~", replacement: appDirectory },
    ],
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
