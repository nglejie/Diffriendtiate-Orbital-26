import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, "reports");
const target = process.env.ZAP_TARGET_URL || "http://host.docker.internal:4000";
mkdirSync(reportsDir, { recursive: true });

const dockerArgs = [
  "run",
  "--rm",
  "-v",
  `${reportsDir}:/zap/wrk:rw`,
];

if (process.stdout.isTTY) {
  dockerArgs.push("-t");
}

dockerArgs.push(
  "ghcr.io/zaproxy/zaproxy:stable",
  "zap-baseline.py",
  "-t",
  target,
  "-r",
  "zap-baseline.html",
  "-w",
  "zap-baseline.md",
  "-J",
  "zap-baseline.json",
  "-I",
);

const child = spawn("docker", dockerArgs, { stdio: "inherit" });
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
