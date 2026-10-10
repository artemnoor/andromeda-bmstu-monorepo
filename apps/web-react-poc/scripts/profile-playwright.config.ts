import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.REACT_PROFILE_WEB_PORT ?? "4182";
const baseURL = process.env.REACT_PROFILE_WEB_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: fileURLToPath(new URL("../tests/e2e", import.meta.url)),
  testMatch: ["comparison-profile.spec.ts"],
  outputDir: fileURLToPath(new URL("../test-results/profile", import.meta.url)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", {
    outputFolder: fileURLToPath(new URL("../playwright-report/profile", import.meta.url)),
    open: "never",
  }]],
  projects: [{ name: "chromium-profile", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL,
    actionTimeout: 15_000,
    trace: "off",
    screenshot: "only-on-failure",
    headless: true,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort --outDir build-profile/client`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      API_PROXY_TARGET: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
    },
    cwd: appRoot,
  },
});
