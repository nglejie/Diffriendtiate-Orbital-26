import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const npmCli =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");

export function getRepoRoot() {
  return repoRoot;
}

export async function getFreePort(): Promise<number> {
  // Ask the OS for an available local port so parallel or repeated test runs do
  // not fight over a hardcoded server port.
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

function readRequestBody(request) {
  // Parse mock-service request bodies as JSON when possible, while preserving
  // raw text for endpoints that might send non-JSON payloads.
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
  });
}

function sendJson(response, status, payload) {
  // Minimal JSON responder for the mock Intelligrate server.
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

export async function startMockChatbot() {
  // Starts a local fake Intelligrate-compatible service. Tests inspect the
  // `calls` object to prove when the app did or did not call /embed, /corpus,
  // /predict, and /predict_stream.
  const port = await getFreePort();
  const calls = {
    corpusDeletes: [],
    embeds: [],
    predictions: [],
    streams: [],
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { message: "Mock Intelligrate ready" });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/corpus") {
      calls.corpusDeletes.push(url.searchParams.get("room_id"));
      sendJson(response, 200, { result: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/embed") {
      const body = await readRequestBody(request);
      calls.embeds.push(body);
      sendJson(response, 200, {
        result: true,
      success: Array.isArray((body as any)?.urls)
          ? (body as any).urls.map((item) => item.name || item.file_name || item.url || "resource")
          : [],
        failed: [],
        total_chunks: Array.isArray((body as any)?.urls) ? (body as any).urls.length : 0,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/predict") {
      calls.predictions.push(Object.fromEntries(url.searchParams.entries()));
      sendJson(response, 200, {
        answer: "Mock Intelligrate answer",
        sources: [],
        message_chain: [],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/predict_stream") {
      calls.streams.push(Object.fromEntries(url.searchParams.entries()));
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write("event: thought\ndata: Searching room resources\n\n");
      response.write("event: final\ndata: Mock streamed answer\n\n");
      response.end();
      return;
    }

    sendJson(response, 404, { message: `Unhandled mock chatbot route: ${request.method} ${url.pathname}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    calls,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function formatChildLogs(logs) {
  const output = logs.join("").trim();
  return output ? `\n\nServer output:\n${output.slice(-4000)}` : "";
}

async function waitForHealth(baseUrl, child, logs, timeoutMs = 20_000) {
  // Poll the app health endpoint until the spawned server is ready. If the child
  // exits early or never becomes healthy, fail fast with useful diagnostics.
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited before health check passed with code ${child.exitCode}.${formatChildLogs(logs)}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(
    `Timed out waiting for ${baseUrl}/api/health: ${lastError?.message || "unknown error"}${formatChildLogs(logs)}`,
  );
}

export async function startTestApp(options: any = {}) {
  // Launches the real app API in a child process with isolated JSON storage and
  // test-only secrets. This gives integration, AI, performance, and security
  // tests realistic behavior without touching local development data.
  const port = options.port || await getFreePort();
  const dataDir =
    options.dataDir ||
    await fs.mkdtemp(path.join(os.tmpdir(), "diffriendtiate-app-test-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];

  const child = spawn(process.execPath, [npmCli, "run", "dev", "--workspace", "@diffriendtiate/server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AUTH_TEST_ACTION_LINKS: "true",
      CHATBOT_BASE_URL: options.chatbotUrl || "http://127.0.0.1:59999",
      DATABASE_URL: "",
      DIFFRIENDTIATE_DATA_DIR: dataDir,
      INTELLIGRATE_GPU_ENABLED: "true",
      JWT_SECRET: "diffriendtiate-test-secret",
      LIBREOFFICE_BIN: options.libreOfficeBin ?? process.env.LIBREOFFICE_BIN ?? "libreoffice",
      NODE_ENV: "test",
      PORT: String(port),
      ...(options.env || {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  await waitForHealth(baseUrl, child, logs);

  return {
    baseUrl,
    dataDir,
    logs,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
      }
      if (!options.keepData) {
        await fs.rm(dataDir, { force: true, recursive: true });
      }
    },
  };
}
