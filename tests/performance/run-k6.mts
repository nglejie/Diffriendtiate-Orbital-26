import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptDir = __dirname;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diffriendtiate-k6-"));
const sourcePath = path.join(scriptDir, "smoke.k6.ts");
const bundledPath = path.join(tempDir, "smoke.k6.js");
const target = process.env.PERF_BASE_URL || "http://host.docker.internal:4000";
const vus = process.env.PERF_VUS || "5";
const duration = process.env.PERF_DURATION || "20s";

const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
fs.writeFileSync(bundledPath, transpiled.outputText, "utf8");

const args = [
  "run",
  "--rm",
  "-v",
  `${tempDir}:/scripts:ro`,
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
  fs.rmSync(tempDir, { force: true, recursive: true });
  process.exit(code ?? 1);
});
