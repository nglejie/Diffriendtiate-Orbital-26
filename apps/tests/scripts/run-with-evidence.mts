import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "")
  .replace("T", "_");
const evidenceRoot =
  process.env.QA_EVIDENCE_DIR ||
  path.join(repoRoot, "docs", `QA_Test_Evidence_${timestamp}`);
const logsDir = path.join(evidenceRoot, "logs");
const screenshotsDir = path.join(evidenceRoot, "screenshots");

const commands = [
  // Build/reproducibility runs first because later suites are less meaningful if
  // the app cannot build, audit cleanly, or validate Docker configuration.
  {
    id: "01-build-reproducibility",
    title: "Build & Reproducibility",
    description: "Syntax, production build, dependency audit, Docker Compose config, and whitespace checks.",
    args: ["run", "test:build"],
  },
  // Unit/component tests cover pure helpers and rendered UI components without
  // starting the app server, so they provide fast feedback on app behavior.
  {
    id: "02-unit-component",
    title: "Unit & Component Tests",
    description: "Fast UI logic and component coverage for themes, rooms, chat, resources, and Intelligrate helpers.",
    args: ["run", "test:unit", "--", "--reporter", "verbose"],
  },
  // API/integration tests start the real app server with isolated storage and
  // verify auth, room, chat, and resource flows through HTTP.
  {
    id: "03-api-integration",
    title: "API & Integration Tests",
    description: "Real app server checks for auth, rooms, channels, messages, resources, and soft deletion.",
    args: ["run", "test:integration", "--", "--reporter", "verbose"],
  },
  // AI reliability focuses on app-side Intelligrate behavior, especially corpus
  // fingerprint caching, while using a mock service instead of ./services.
  {
    id: "04-ai-reliability",
    title: "AI & Reliability Tests",
    description: "Intelligrate app-side reliability, corpus sync caching, and chat thread visibility.",
    args: ["run", "test:ai", "--", "--reporter", "verbose"],
  },
  // Performance smoke checks do not replace load testing; they catch obvious
  // latency regressions in high-traffic room and resource endpoints.
  {
    id: "05-performance-smoke",
    title: "Performance Smoke Tests",
    description: "Low-cost timing budgets for health, room listing, messages, and resources.",
    args: ["run", "test:performance", "--", "--reporter", "verbose"],
  },
  // Security checks combine dependency audit, permission boundaries, generic
  // error responses, and a lightweight source scan.
  {
    id: "06-security",
    title: "Security Checks",
    description: "Audit gate, authorization boundaries, private rooms, error hygiene, and injection scan.",
    args: ["run", "test:security", "--", "--reporter", "verbose"],
  },
  // E2E/UAT uses a real browser to prove that a user can register, create a
  // room with images, navigate core tabs, and that members cannot see owner UI.
  {
    id: "07-e2e-uat",
    title: "E2E / UAT Tests",
    description: "Browser walkthroughs for registration, theme toggle, room creation, tabs, and non-owner controls.",
    args: ["run", "test:e2e"],
  },
];

function commandSpec(command, args) {
  // Resolve npm through the active Node install so evidence generation works
  // consistently from PowerShell, npm scripts, and CI shells.
  if (command !== "npm") return { command, args };

  return {
    command: process.execPath,
    args: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args],
  };
}

function escapeHtml(value) {
  // Escape command output before embedding it into HTML screenshots.
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripAnsi(value) {
  // Remove terminal color codes so logs and HTML reports remain readable when
  // opened outside a terminal.
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

function extractMetrics(output) {
  // Pull the most important summary lines from Vitest, Playwright, npm audit,
  // and custom build checks so the evidence screenshots show quick PASS totals
  // above the detailed log transcript.
  const clean = stripAnsi(output || "(no output)");
  const metrics = [];
  const testFiles = clean.match(/Test Files\s+(.+)/);
  const tests = clean.match(/\n\s*Tests\s+(.+)/);
  const duration = clean.match(/\n\s*Duration\s+(.+)/);
  const playwright = clean.match(/^\s*(\d+)\s+passed\s+\(([^)]+)\)/m);
  const passChecks = [...clean.matchAll(/\[PASS\]/g)].length;
  const failChecks = [...clean.matchAll(/\[FAIL\]/g)].length;
  const npmAudit = clean.match(/found\s+0\s+vulnerabilities/i);

  if (testFiles) metrics.push({ label: "Test Files", value: testFiles[1].trim() });
  if (tests) metrics.push({ label: "Tests", value: tests[1].trim() });
  if (duration) metrics.push({ label: "Duration", value: duration[1].trim() });
  if (playwright) metrics.push({ label: "Browser Tests", value: `${playwright[1]} passed` });
  if (playwright) metrics.push({ label: "Duration", value: playwright[2].trim() });
  if (passChecks || failChecks) {
    metrics.push({
      label: "Checks",
      value: `${passChecks} passed${failChecks ? `, ${failChecks} failed` : ""}`,
    });
  }
  if (npmAudit) metrics.push({ label: "Audit", value: "0 high/critical" });

  return metrics.slice(0, 4);
}

function classifyLine(line) {
  // Classify each log row so screenshots make PASS/FAIL/INFO/CMD lines obvious
  // instead of showing an undifferentiated wall of terminal text.
  const trimmed = line.trim();

  if (!trimmed) return "blank";
  if (/\bFAIL\b|\bfailed\b|AssertionError|Error:|exited with code [1-9]|\sx\s+\d+\s+\[/i.test(trimmed)) {
    return "fail";
  }
  if (/\bPASS\b|\[PASS\]|\bpassed\b|^\s*ok\s+\d+\s+\[|^\s*\u2713/i.test(trimmed)) {
    return "pass";
  }
  if (/^Test Files|^Tests|^Duration|^Start at|^Running \d+ tests|^RUN\s+v/i.test(trimmed)) {
    return "summary";
  }
  if (/^\$ |^> /.test(trimmed)) return "command";
  if (/^\[BUILD\]|^\[QA\]/.test(trimmed)) return "section";

  return "line";
}

function lineBadge(className) {
  // Convert row classes into the left-column badges displayed in each proof
  // screenshot.
  if (className === "pass") return "PASS";
  if (className === "fail") return "FAIL";
  if (className === "summary") return "INFO";
  if (className === "command") return "CMD";
  if (className === "section") return "STEP";
  return "";
}

function logRows(output) {
  // Render the raw command output as structured rows while preserving line
  // breaks. This is what makes the proof screenshot look like a test report.
  return stripAnsi(output || "(no output)")
    .split(/\r?\n/)
    .map((line) => {
      const className = classifyLine(line);
      return `<div class="log-row ${className}">
        <span class="log-badge">${lineBadge(className)}</span>
        <span class="log-text">${escapeHtml(line || " ")}</span>
      </div>`;
    })
    .join("\n");
}

function metricCards(metrics) {
  // Render parsed metrics such as test counts, durations, and audit result.
  if (!metrics.length) return "";

  return `<section class="metrics">
    ${metrics
      .map(
        (metric) => `<article>
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
        </article>`,
      )
      .join("")}
  </section>`;
}

function terminalHtml({ command, description, exitCode, metrics, output, title }) {
  // Creates the per-suite HTML report that Playwright screenshots. The content
  // is generated from real command output; it is not a mocked test result.
  const status = exitCode === 0 ? "PASS" : "FAIL";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: dark;
        font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
      }
      body {
        margin: 0;
        background: #111019;
        color: #f2e9e1;
      }
      .terminal {
        box-sizing: border-box;
        min-height: 100vh;
        padding: 32px;
        background:
          radial-gradient(circle at top right, rgba(235, 111, 146, 0.22), transparent 32rem),
          linear-gradient(180deg, rgba(49, 34, 54, 0.96), rgba(17, 16, 25, 0.99));
      }
      .hero {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 22px;
      }
      .hero-copy {
        max-width: 840px;
      }
      h1 {
        margin: 0 0 10px;
        font: 800 32px/1.1 system-ui, sans-serif;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #c4a7e7;
        font: 600 15px/1.45 system-ui, sans-serif;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 104px;
        border-radius: 999px;
        padding: 10px 16px;
        background: ${exitCode === 0 ? "rgba(49, 116, 143, 0.42)" : "rgba(235, 111, 146, 0.34)"};
        border: 1px solid ${exitCode === 0 ? "#9ccfd8" : "#eb6f92"};
        color: ${exitCode === 0 ? "#9ccfd8" : "#eb6f92"};
        font: 900 22px/1 system-ui, sans-serif;
      }
      .meta {
        margin-bottom: 18px;
        border: 1px solid rgba(224, 222, 244, 0.12);
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(25, 23, 36, 0.76);
        color: #e0def4;
        font: 700 14px/1.45 Consolas, "Cascadia Mono", monospace;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin: 0 0 18px;
      }
      .metrics article {
        border: 1px solid rgba(224, 222, 244, 0.12);
        border-radius: 14px;
        padding: 14px;
        background: rgba(38, 35, 58, 0.82);
      }
      .metrics span {
        display: block;
        color: #908caa;
        font: 700 12px/1.2 system-ui, sans-serif;
        text-transform: uppercase;
      }
      .metrics strong {
        display: block;
        margin-top: 6px;
        color: #f2e9e1;
        font: 800 20px/1.2 system-ui, sans-serif;
      }
      .log {
        border: 1px solid rgba(224, 222, 244, 0.12);
        border-radius: 14px;
        overflow: hidden;
        background: rgba(17, 16, 25, 0.92);
      }
      .log-row {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr);
        gap: 10px;
        padding: 2px 14px;
        min-height: 22px;
        font: 15px/1.45 Consolas, "Cascadia Mono", "Courier New", monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .log-row:nth-child(2n) {
        background: rgba(224, 222, 244, 0.025);
      }
      .log-badge {
        color: #6e6a86;
        font-weight: 800;
      }
      .log-text {
        color: #e0def4;
      }
      .pass .log-badge,
      .pass .log-text {
        color: #9ccfd8;
        font-weight: 800;
      }
      .fail .log-badge,
      .fail .log-text {
        color: #eb6f92;
        font-weight: 900;
      }
      .summary .log-badge,
      .summary .log-text {
        color: #f6c177;
        font-weight: 800;
      }
      .command .log-badge,
      .command .log-text,
      .section .log-badge,
      .section .log-text {
        color: #c4a7e7;
        font-weight: 800;
      }
      .blank .log-badge {
        color: transparent;
      }
    </style>
  </head>
  <body>
    <main class="terminal">
      <section class="hero">
        <div class="hero-copy">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description || "Captured from the actual test command output.")}</p>
        </div>
        <div class="status-pill">${status}</div>
      </section>
      <div class="meta">$ npm ${escapeHtml(command)}</div>
      ${metricCards(metrics)}
      <div class="log">
        ${logRows(output)}
      </div>
    </main>
  </body>
</html>`;
}

function dashboardHtml(summary) {
  // Creates the top-level dashboard screenshot summarizing all QA categories.
  const status = summary.failed === 0 ? "PASS" : "FAIL";
  const cards = summary.results
    .map((result) => {
      const resultStatus = result.exitCode === 0 ? "PASS" : "FAIL";
      return `<article class="card ${result.exitCode === 0 ? "pass" : "fail"}">
        <div class="card-top">
          <span>${escapeHtml(result.id)}</span>
          <strong>${resultStatus}</strong>
        </div>
        <h2>${escapeHtml(result.title)}</h2>
        <p>${escapeHtml(result.description)}</p>
        ${metricCards(result.metrics)}
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, sans-serif;
      }
      body {
        margin: 0;
        background: #111019;
        color: #f2e9e1;
      }
      main {
        box-sizing: border-box;
        min-height: 100vh;
        padding: 38px;
        background:
          radial-gradient(circle at 78% 6%, rgba(235, 111, 146, 0.26), transparent 28rem),
          radial-gradient(circle at 8% 18%, rgba(246, 193, 119, 0.18), transparent 24rem),
          linear-gradient(180deg, #26233a, #111019);
      }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 28px;
        margin-bottom: 26px;
      }
      h1 {
        margin: 0 0 10px;
        font: 900 40px/1.05 system-ui, sans-serif;
      }
      .hero p {
        margin: 0;
        color: #c4a7e7;
        font: 700 16px/1.45 system-ui, sans-serif;
      }
      .status {
        align-self: flex-start;
        border: 1px solid ${summary.failed === 0 ? "#9ccfd8" : "#eb6f92"};
        border-radius: 999px;
        padding: 12px 20px;
        color: ${summary.failed === 0 ? "#9ccfd8" : "#eb6f92"};
        background: ${summary.failed === 0 ? "rgba(49, 116, 143, 0.38)" : "rgba(235, 111, 146, 0.26)"};
        font: 900 24px/1 system-ui, sans-serif;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .card {
        border: 1px solid rgba(224, 222, 244, 0.14);
        border-radius: 18px;
        padding: 18px;
        background: rgba(25, 23, 36, 0.82);
      }
      .card.pass {
        box-shadow: inset 5px 0 0 #9ccfd8;
      }
      .card.fail {
        box-shadow: inset 5px 0 0 #eb6f92;
      }
      .card-top {
        display: flex;
        justify-content: space-between;
        color: #908caa;
        font: 800 12px/1.2 system-ui, sans-serif;
        text-transform: uppercase;
      }
      .card.pass .card-top strong {
        color: #9ccfd8;
      }
      .card.fail .card-top strong {
        color: #eb6f92;
      }
      h2 {
        margin: 12px 0 8px;
        font: 850 22px/1.15 system-ui, sans-serif;
      }
      .card p {
        min-height: 42px;
        margin: 0 0 14px;
        color: #c4a7e7;
        font: 600 14px/1.45 system-ui, sans-serif;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .metrics article {
        border-radius: 12px;
        padding: 10px;
        background: rgba(38, 35, 58, 0.92);
      }
      .metrics span {
        display: block;
        color: #908caa;
        font: 800 11px/1.2 system-ui, sans-serif;
        text-transform: uppercase;
      }
      .metrics strong {
        display: block;
        margin-top: 4px;
        color: #f2e9e1;
        font: 850 16px/1.2 system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div>
          <h1>Diffriendtiate QA Evidence</h1>
          <p>Generated from actual test command output. ${summary.passed} categories passed, ${summary.failed} failed.</p>
        </div>
        <div class="status">${status}</div>
      </section>
      <section class="grid">${cards}</section>
    </main>
  </body>
</html>`;
}

async function screenshotHtml(html, screenshotPath, viewport = { width: 1400, height: 1000 }) {
  // Use Playwright to render the generated HTML exactly as documentation will
  // display it, then save a full-page PNG as evidence.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ fullPage: true, path: screenshotPath });
  await browser.close();
}

function runCommand(entry) {
  // Runs a QA category, streams its output to the current terminal, and captures
  // the same output for logs, HTML reports, and proof screenshots.
  return new Promise((resolve) => {
    const commandText = entry.args.join(" ");
    console.log(`\n[QA] ${entry.title}`);
    console.log(`$ npm ${commandText}`);

    const spec = commandSpec("npm", entry.args);
    const child = spawn(spec.command, spec.args, {
      cwd: repoRoot,
      env: { ...process.env, CI: "1", FORCE_COLOR: "1" },
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stderr.write(text);
    });
    child.on("exit", (code) => {
      resolve({
        ...entry,
        command: commandText,
        exitCode: code || 0,
        output,
      });
    });
  });
}

await fs.mkdir(logsDir, { recursive: true });
await fs.mkdir(screenshotsDir, { recursive: true });

const results = [];
for (const command of commands) {
  const result = await runCommand(command);
  const metrics = extractMetrics(result.output);
  const html = terminalHtml({ ...result, metrics });
  const logPath = path.join(logsDir, `${result.id}.log`);
  const screenshotPath = path.join(screenshotsDir, `${result.id}.png`);
  const htmlPath = path.join(evidenceRoot, `${result.id}.html`);

  result.metrics = metrics;
  results.push(result);

  await fs.writeFile(logPath, stripAnsi(result.output), "utf8");
  await fs.writeFile(htmlPath, html, "utf8");
  await screenshotHtml(html, screenshotPath);
}

const summary = {
  createdAt: new Date().toISOString(),
  evidenceRoot,
  passed: results.filter((result) => result.exitCode === 0).length,
  failed: results.filter((result) => result.exitCode !== 0).length,
  results: results.map((result) => ({
    description: result.description,
    html: `${result.id}.html`,
    id: result.id,
    title: result.title,
    exitCode: result.exitCode,
    metrics: result.metrics || [],
    log: path.relative(evidenceRoot, path.join(logsDir, `${result.id}.log`)),
    screenshot: path.relative(evidenceRoot, path.join(screenshotsDir, `${result.id}.png`)),
  })),
};

const reportHtml = dashboardHtml(summary);
await fs.writeFile(path.join(evidenceRoot, "report.html"), reportHtml, "utf8");
await screenshotHtml(
  reportHtml,
  path.join(screenshotsDir, "00-summary-dashboard.png"),
  { width: 1500, height: 1100 },
);
await fs.writeFile(path.join(evidenceRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
await fs.writeFile(
  path.join(evidenceRoot, "README.md"),
  [
    "# Diffriendtiate QA Evidence",
    "",
    `Created: ${summary.createdAt}`,
    "",
    "Main report: `report.html`",
    "Summary screenshot: `screenshots/00-summary-dashboard.png`",
    "",
    "| Area | Status | Screenshot | Log |",
    "| --- | --- | --- | --- |",
    ...summary.results.map((result) =>
      `| ${result.title} | ${result.exitCode === 0 ? "PASS" : "FAIL"} | ${result.screenshot} | ${result.log} |`,
    ),
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\nQA evidence saved to ${evidenceRoot}`);

if (summary.failed > 0) {
  console.error(`${summary.failed} QA command(s) failed.`);
  process.exit(1);
}
