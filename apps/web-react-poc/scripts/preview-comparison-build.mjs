import { preview } from "vite";
import { resolve } from "node:path";

const [directory, port = "4182"] = process.argv.slice(2);
if (!directory) throw new Error("Usage: node scripts/preview-comparison-build.mjs BUILD_DIRECTORY [PORT]");
const apiTarget = process.env.API_PROXY_TARGET;
if (!apiTarget) throw new Error("Set API_PROXY_TARGET to the read-only test API.");
const server = await preview({
  configFile: false,
  build: { outDir: resolve(directory) },
  preview: {
    host: "127.0.0.1", port: Number(port), strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
server.printUrls();
