import { spawn } from "node:child_process";
import path from "node:path";

const commands = [
  // Ensures the Express app still parses under Node before deeper tests run.
  {
    name: "node syntax check",
    command: "npm",
    args: ["run", "check", "--workspace", "@diffriendtiate/server"],
  },
  // Builds the production React bundle to catch frontend compile, asset, and
  // dependency issues that unit tests may not cover.
  {
    name: "client production build",
    command: "npm",
    args: ["run", "build", "--workspace", "@diffriendtiate/client"],
  },
  // Blocks high/critical vulnerable dependencies from passing the QA gate.
  {
    name: "dependency audit high gate",
    command: "npm",
    args: ["audit", "--audit-level=high"],
  },
  // Validates docker-compose syntax/configuration without starting services.
  {
    name: "docker compose config validation",
    command: "docker",
    args: ["compose", "config", "--quiet"],
    env: {
      CHROMA_DIR: "/app/chroma_db",
      GEMINI_API_KEY: "qa-compose-validation-placeholder",
    },
  },
  // Fails if staged/working tree edits introduce whitespace errors that Git
  // would flag during review.
  {
    name: "git whitespace check",
    command: "git",
    args: ["diff", "--check"],
  },
];

function commandSpec(command, args) {
  // On Windows, invoking npm through the current Node executable is more
  // reliable than relying on shell-specific npm shims.
  if (command !== "npm") return { command, args };

  return {
    command: process.execPath,
    args: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args],
  };
}

function runCommand({ name, command, args, env = {} }) {
  // Execute each reproducibility check serially and stream output directly so
  // evidence logs show the real command transcript.
  return new Promise((resolve) => {
    console.log(`\n[BUILD] ${name}`);
    console.log(`$ ${[command, ...args].join(" ")}`);

    const spec = commandSpec(command, args);
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...env, FORCE_COLOR: "1" },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[PASS] ${name}`);
      } else {
        console.log(`[FAIL] ${name} exited with code ${code}`);
      }
      resolve(code || 0);
    });
  });
}

const failures = [];
for (const item of commands) {
  const code = await runCommand(item);
  if (code !== 0) failures.push(item.name);
}

if (failures.length) {
  console.error(`\n[FAIL] Build and reproducibility checks failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("\n[PASS] Build and reproducibility checks passed");
