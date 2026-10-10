import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "4180";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/paired-visual-performance.spec.ts", "**/comparison-profile.spec.ts"],
  outputDir: "./test-results/e2e",
  fullyParallel: true,
  // Comparison scenarios read several cursor-paginated collections from one
  // isolated PostgreSQL instance. Keep enough parallelism while avoiding DB saturation.
  workers: process.env.CI ? 2 : 1,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    // Exercise the production SPA bundle. Development StrictMode intentionally
    // replays effects and can create expected, aborted API requests.
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      API_PROXY_TARGET:
        process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
    },
  },
});
