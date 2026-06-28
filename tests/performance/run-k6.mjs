import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptDir = __dirname;
const target = process.env.PERF_BASE_URL || "http://host.docker.internal:4000";
const vus = process.env.PERF_VUS || "5";
const duration = process.env.PERF_DURATION || "20s";

const args = [
  "run",
  "--rm",
  "-v",
  `${scriptDir}:/scripts:ro`,
  "-e",
  `PERF_BASE_URL=${target}`,
  "-e",
  `PERF_VUS=${vus}`,
  "-e",
  `PERF_DURATION=${duration}`,
  "grafana/k6:latest",
  "run",
  "/scripts/smoke.k6.js",
];

const child = spawn("docker", args, { stdio: "inherit" });
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
