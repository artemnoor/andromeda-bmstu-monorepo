import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const reactRoot = fileURLToPath(new URL("..", import.meta.url));
const vanillaRoot = fileURLToPath(new URL("../../web", import.meta.url));
const reactPort = process.env.REACT_WEB_PORT ?? "4181";
const reactBaseURL = process.env.REACT_WEB_BASE_URL ?? `http://127.0.0.1:${reactPort}`;
const localVanillaPort = process.env.CI ? "4173" : "43173";
const vanillaBaseURL = process.env.VANILLA_WEB_BASE_URL
  ?? `http://127.0.0.1:${process.env.VANILLA_WEB_PORT ?? localVanillaPort}`;
const serverEnv = {
  API_PROXY_TARGET: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
};
const webServer = [];

if (!process.env.REACT_WEB_BASE_URL) {
  webServer.push({
    command: `npx vite preview --host 127.0.0.1 --port ${reactPort} --strictPort`,
    url: reactBaseURL,
    cwd: reactRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: serverEnv,
  });
}

if (!process.env.VANILLA_WEB_BASE_URL) {
  webServer.push({
    command: `node tools/server.mjs --dist --port ${process.env.VANILLA_WEB_PORT ?? localVanillaPort}`,
    url: vanillaBaseURL,
    cwd: vanillaRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      API_ORIGIN: process.env.API_ORIGIN ?? serverEnv.API_PROXY_TARGET,
    },
  });
}

export default defineConfig({
  testDir: fileURLToPath(new URL("../tests/e2e", import.meta.url)),
  outputDir: fileURLToPath(new URL("../test-results/paired-visual-performance", import.meta.url)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", {
    outputFolder: fileURLToPath(new URL("../playwright-report/paired", import.meta.url)),
    open: "never",
  }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: reactBaseURL,
    headless: true,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...(webServer.length ? { webServer } : {}),
});
