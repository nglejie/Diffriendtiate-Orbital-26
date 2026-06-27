import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "../..");
const apiPort = Number(process.env.E2E_API_PORT || 4011);
const clientPort = Number(process.env.E2E_CLIENT_PORT || 4174);
const mockPort = Number(process.env.MOCK_CHATBOT_PORT || 5011);
const dataDir = path.join(repoRoot, "apps/tests/.tmp/e2e-server-data");

export default defineConfig({
  testDir: path.join(testsDir, "e2e"),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(repoRoot, "apps/tests/.tmp/playwright-report") }],
  ],
  use: {
    // Browser UAT starts from the local Vite client and keeps screenshots/traces
    // only when a test fails, so successful runs stay lightweight.
    baseURL: `http://127.0.0.1:${clientPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      // Mock Intelligrate first so the app server can reach the configured LLM
      // endpoint as soon as it boots.
      command: "node apps/tests/scripts/mock-chatbot-server.mjs",
      cwd: repoRoot,
      env: { MOCK_CHATBOT_PORT: String(mockPort) },
      reuseExistingServer: false,
      timeout: 20_000,
      url: `http://127.0.0.1:${mockPort}/health`,
    },
    {
      // Start the app API with isolated E2E storage and the mock chatbot URL.
      command: "node apps/tests/scripts/start-e2e-server.mjs",
      cwd: repoRoot,
      env: {
        E2E_API_PORT: String(apiPort),
        E2E_DATA_DIR: dataDir,
        E2E_MOCK_CHATBOT_URL: `http://127.0.0.1:${mockPort}`,
      },
      reuseExistingServer: false,
      timeout: 25_000,
      url: `http://127.0.0.1:${apiPort}/api/health`,
    },
    {
      // Start the React client against the isolated API server for real browser
      // walkthroughs.
      command: `npm run dev --workspace @diffriendtiate/client -- --host 127.0.0.1 --port ${clientPort}`,
      cwd: repoRoot,
      env: {
        VITE_API_URL: `http://127.0.0.1:${apiPort}`,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: `http://127.0.0.1:${clientPort}`,
    },
  ],
});
