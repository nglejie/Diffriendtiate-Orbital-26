import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  createRoom,
  registerUser,
} from "../helpers/apiClient.mts";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mts";

function percentile(values, ratio) {
  // A small percentile helper is enough for smoke testing: sort the collected
  // samples and pick the requested percentile index without pulling in a full
  // benchmarking library.
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

async function timed(label, operation) {
  // Wrap an API call with wall-clock timing while preserving the original
  // response. Tests can assert both correctness and rough responsiveness.
  const start = performance.now();
  const result = await operation();
  return { label, ms: performance.now() - start, result };
}

describe("performance smoke", () => {
  let app;
  let chatbot;
  let owner;
  let room;

  beforeAll(async () => {
    // Run the same app API used by integration tests, but keep this suite
    // focused on latency budgets for common read paths instead of deep behavior.
    chatbot = await startMockChatbot();
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "Performance Owner" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "Performance Room",
      moduleCode: "CS3230",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  // Samples the cheapest endpoint repeatedly and checks the p95 remains well
  // below a generous smoke-test budget. This catches severe server startup,
  // routing, or JSON serialization regressions.
  it("keeps API health checks comfortably below a smoke-test p95 budget", async () => {
    const samples = [];

    for (let index = 0; index < 25; index += 1) {
      const sample = await timed("health", () => apiRequest(app.baseUrl, "/api/health"));
      expect(sample.result.status).toBe(200);
      samples.push(sample.ms);
    }

    expect(percentile(samples, 0.95)).toBeLessThan(250);
  });

  // Sends concurrent dashboard room-list requests to approximate several tabs
  // or users loading the dashboard at once. Every response must succeed, and the
  // 95th percentile must stay within a practical interactive budget.
  it("handles room dashboard reads under concurrent load", async () => {
    const samples = await Promise.all(
      Array.from({ length: 20 }, () =>
        timed("rooms", () => apiRequest(app.baseUrl, "/api/rooms", { token: owner.token })),
      ),
    );

    expect(samples.every((sample) => sample.result.status === 200)).toBe(true);
    expect(percentile(samples.map((sample) => sample.ms), 0.95)).toBeLessThan(650);
  });

  // Seeds one chat message and one resource, then concurrently reads both lists.
  // This protects the active-room paths that users hit often while switching
  // between Chat, Resources, and Intelligrate.
  it("keeps resource and message list endpoints responsive for an active room", async () => {
    await apiRequest(app.baseUrl, `/api/rooms/${room.id}/messages`, {
      method: "POST",
      token: owner.token,
      body: { body: "Performance smoke message", channel: "general" },
    });
    await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources/url`, {
      method: "POST",
      token: owner.token,
      body: {
        folder: "Reference",
        title: "Performance Reference",
        url: "https://example.com/performance-reference.pdf",
      },
    });

    const samples = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        timed("messages", () => apiRequest(app.baseUrl, `/api/rooms/${room.id}/messages`, { token: owner.token })),
      ),
      ...Array.from({ length: 10 }, () =>
        timed("resources", () => apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources`, { token: owner.token })),
      ),
    ]);

    expect(samples.every((sample) => sample.result.status === 200)).toBe(true);
    expect(percentile(samples.map((sample) => sample.ms), 0.95)).toBeLessThan(750);
  });
});
