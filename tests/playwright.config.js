import { defineConfig, devices } from "@playwright/test";

const shouldStartDevServer = process.env.PLAYWRIGHT_START_APP === "1";
const baseURL =
  process.env.E2E_BASE_URL ||
  (shouldStartDevServer ? "http://127.0.0.1:5173" : "http://127.0.0.1:4000");

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: shouldStartDevServer
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "integration",
      testMatch: /integration\/.*\.spec\.js/,
    },
    {
      name: "e2e-chromium",
      testMatch: /e2e\/.*\.spec\.js/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
