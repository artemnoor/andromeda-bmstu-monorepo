import { defineConfig } from "@playwright/test";

const localPort = process.env.PLAYWRIGHT_WEB_PORT || "4179";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:" + localPort;
const browserNames = (process.env.PLAYWRIGHT_BROWSERS || "chromium,firefox,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const useLocalServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: Number(process.env.PLAYWRIGHT_WORKERS) || 2,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}",
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../artifacts/qa-stabilization/playwright-report", open: "never" }],
  ],
  outputDir: "../../artifacts/qa-stabilization/playwright-results",
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: browserNames.map((browserName) => ({
    name: browserName,
    use: { browserName },
  })),
  webServer: useLocalServer
    ? {
        command: "node tools/server.mjs --port " + localPort,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
      }
    : undefined,
});
