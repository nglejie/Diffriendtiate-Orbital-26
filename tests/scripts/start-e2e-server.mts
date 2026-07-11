import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir =
  process.env.E2E_DATA_DIR ||
  path.join(repoRoot, "tests/.tmp/e2e-server-data");

// Reset the E2E data directory before every browser test run so repeated runs
// start from a predictable empty app state.
await fs.rm(dataDir, { force: true, recursive: true });
await fs.mkdir(dataDir, { recursive: true });

// Configure the app server to use isolated test storage and the local mock
// Intelligrate service. This keeps E2E tests inside ./apps and avoids touching
// developer data or services-owned code.
process.env.CHATBOT_BASE_URL =
  process.env.E2E_MOCK_CHATBOT_URL || "http://127.0.0.1:5011";
process.env.AUTH_TEST_ACTION_LINKS = "true";
process.env.DATABASE_URL = "";
process.env.DIFFRIENDTIATE_DATA_DIR = dataDir;
process.env.JWT_SECRET = "diffriendtiate-e2e-secret";
process.env.NODE_ENV = "test";
process.env.PORT = process.env.E2E_API_PORT || "4011";

// Importing the server starts it with the environment above.
await import("../../apps/server/index.ts");
