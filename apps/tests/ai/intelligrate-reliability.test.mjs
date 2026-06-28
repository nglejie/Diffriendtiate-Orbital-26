import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  createRoom,
  registerUser,
  uploadTextResource,
} from "../helpers/apiClient.mjs";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mjs";

describe("Intelligrate app-side reliability", () => {
  let app;
  let chatbot;
  let owner;
  let room;

  beforeAll(async () => {
    // Use the real app server with a mock Intelligrate service. This verifies
    // the app-side orchestration/caching logic without reading or modifying
    // anything inside the services-owned LLM implementation.
    chatbot = await startMockChatbot();
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "AI Owner" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "Intelligrate Reliability Room",
      moduleCode: "CS2100",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  // Checks that the app can proxy Intelligrate health through the room-scoped
  // endpoint. A passing result proves the app is wired to the configured LLM
  // base URL and returns a clean service status payload.
  it("checks Intelligrate health through the app API without touching services code", async () => {
    const health = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/health`, {
      token: owner.token,
    });

    expect(health.status).toBe(200);
    expect(health.payload).toMatchObject({ ok: true, service: "Mock Intelligrate ready" });
  });

  // Reproduces the issue where /embed could be called for every LLM request.
  // With no room documents, the first sync should establish an empty corpus
  // fingerprint, and the second sync should return cached without calling embed
  // again.
  it("does not re-embed unchanged empty corpora", async () => {
    const first = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });
    expect(first.status).toBe(200);
    expect(first.payload).toMatchObject({
      result: true,
      success: [],
      totalChunks: 0,
    });
    expect(chatbot.calls.corpusDeletes).toHaveLength(1);

    const second = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });
    expect(second.status).toBe(200);
    expect(second.payload.cached).toBe(true);
    expect(chatbot.calls.corpusDeletes).toHaveLength(1);
    expect(chatbot.calls.embeds).toHaveLength(0);
  });

  // Adds the first supported resource and verifies the app sends it to
  // Intelligrate exactly once. A repeated sync should reuse the stored
  // fingerprint instead of re-uploading the same document.
  it("embeds new documents once and uses the fingerprint cache afterwards", async () => {
    await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "Lecture 2 Datapath.txt",
      "Datapath and control unit notes",
      "Lecture Notes",
    );

    const first = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });
    expect(first.status).toBe(200);
    expect(first.payload).toMatchObject({
      result: true,
      totalChunks: 1,
    });
    expect(chatbot.calls.embeds).toHaveLength(1);
    expect(chatbot.calls.embeds[0].urls[0]).toMatchObject({
      file_name: "Lecture 2 Datapath.txt",
    });

    const second = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });
    expect(second.status).toBe(200);
    expect(second.payload.cached).toBe(true);
    expect(chatbot.calls.embeds).toHaveLength(1);
  });

  // Adds a second supported file to prove change detection is incremental at the
  // room corpus level. The fingerprint should change, triggering a fresh embed
  // request that includes the current supported document set.
  it("updates the corpus fingerprint when a new supported file appears", async () => {
    await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "Tutorial 4 Pipeline.txt",
      "Pipeline hazard examples",
      "Tutorials",
    );

    const sync = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });

    expect(sync.status).toBe(200);
    expect(sync.payload.totalChunks).toBe(2);
    expect(chatbot.calls.embeds).toHaveLength(2);
    expect(chatbot.calls.embeds.at(-1).urls.map((item) => item.file_name)).toEqual(
      expect.arrayContaining(["Lecture 2 Datapath.txt", "Tutorial 4 Pipeline.txt"]),
    );
  });

  // Confirms Intelligrate conversation history is room-bounded and respects
  // thread visibility. Private owner threads should be hidden from members,
  // while explicitly public threads become visible to joined members.
  it("keeps Intelligrate chats room-bounded and private by default", async () => {
    const other = await registerUser(app.baseUrl, { name: "AI Member" });
    await apiRequest(app.baseUrl, `/api/rooms/${room.id}/join`, {
      method: "POST",
      token: other.token,
    });

    const createPrivateThread = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/threads`, {
      method: "POST",
      token: owner.token,
      body: {
        title: "Private proof",
        messages: [{ role: "user", body: "Explain datapath." }],
      },
    });
    expect(createPrivateThread.status).toBe(201);

    const memberThreads = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/threads`, {
      token: other.token,
    });
    expect(memberThreads.status).toBe(200);
    expect(memberThreads.payload.threads.map((thread) => thread.title)).not.toContain("Private proof");

    const publicThread = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/threads`, {
      method: "POST",
      token: owner.token,
      body: {
        title: "Public explanation",
        visibility: "public",
        messages: [{ role: "user", body: "What is pipelining?" }],
      },
    });
    expect(publicThread.status).toBe(201);

    const refreshed = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/threads`, {
      token: other.token,
    });
    expect(refreshed.payload.threads.map((thread) => thread.title)).toContain("Public explanation");
  });
});
