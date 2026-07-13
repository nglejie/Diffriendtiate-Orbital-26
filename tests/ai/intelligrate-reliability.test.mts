import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  createRoom,
  registerUser,
  uploadTextResource,
} from "../helpers/apiClient.mts";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mts";

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
    expect(chatbot.calls.corpusSyncs).toHaveLength(0);
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
    expect(chatbot.calls.corpusSyncs).toHaveLength(1);
    expect(chatbot.calls.corpusSyncs[0].files[0]).toMatchObject({
      file_name: "Lecture 2 Datapath.txt",
      source_type: "resource",
    });

    const second = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });
    expect(second.status).toBe(200);
    expect(second.payload.cached).toBe(true);
    expect(chatbot.calls.corpusSyncs).toHaveLength(1);
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
    expect(chatbot.calls.corpusSyncs).toHaveLength(2);
    expect(chatbot.calls.corpusSyncs.at(-1).files.map((item) => item.file_name)).toEqual(
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

describe("Intelligrate BYOK LiteLLM routing", () => {
  let app;
  let chatbot;
  let owner;
  let room;

  beforeAll(async () => {
    chatbot = await startMockChatbot({ streamAnswer: "Mock BYOK streamed answer" });
    app = await startTestApp({
      chatbotUrl: chatbot.url,
      env: {
        LLM_API_KEY_ENCRYPTION_KEY:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
    });
    owner = await registerUser(app.baseUrl, { name: "BYOK Stream Owner" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "BYOK Routing Room",
      moduleCode: "CS3216",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  it("streams a BYOK provider response through Intelligrate with the decrypted user key", async () => {
    const userSecret = "sk-byok-openai-secret-987654321";
    const savedKey = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        label: "Owner OpenAI",
        model: "openai/gpt-4o-mini",
        apiKey: userSecret,
      },
    });
    expect(savedKey.status).toBe(201);

    const providers = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/providers`, {
      token: owner.token,
    });
    expect(providers.status).toBe(200);
    expect(providers.payload.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: savedKey.payload.key.id,
          providerName: "OpenAI",
          available: true,
        }),
      ]),
    );

    const response = await fetch(`${app.baseUrl}/api/rooms/${room.id}/buddy/message/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerKeyId: savedKey.payload.key.id,
        messages: [{ role: "user", body: "Explain BYOK in one sentence." }],
      }),
    });

    expect(response.status).toBe(200);
    const streamText = await response.text();
    expect(streamText).toContain("event: token");
    expect(streamText).toContain("Mock BYOK streamed answer");

    expect(chatbot.calls.streams).toHaveLength(1);
    expect(chatbot.calls.streams[0]).toMatchObject({
      llm_api_key: userSecret,
      llm_model: "openai/gpt-4o-mini",
      room_id: room.id,
    });
    expect(chatbot.calls.streams[0].llm_api_key_query).toBeUndefined();
    expect(JSON.parse(chatbot.calls.streams[0].message_chain).at(-1)).toMatchObject({
      role: "user",
      content: "Explain BYOK in one sentence.",
    });
  });

  it("routes BYOK attachment prompts through the same grounded stream contract", async () => {
    const userSecret = "sk-byok-openai-grounded-secret-987654321";
    const savedKey = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        label: "Grounded OpenAI",
        model: "openai/gpt-4o",
        apiKey: userSecret,
      },
    });
    expect(savedKey.status).toBe(201);

    const upload = await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "BYOKAttachment.txt",
      "BYOK attachment content for grounded routing.",
      "Uploads/Intelligrate",
    );

    const response = await fetch(`${app.baseUrl}/api/rooms/${room.id}/buddy/message/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachmentResourceIds: [upload.resource.id],
        providerKeyId: savedKey.payload.key.id,
        messages: [{ role: "user", body: "Summarise this BYOK attachment." }],
      }),
    });

    expect(response.status).toBe(200);
    await response.text();

    const streamCall = chatbot.calls.streams.at(-1);
    expect(streamCall).toMatchObject({
      llm_api_key: userSecret,
      llm_model: "openai/gpt-4o",
      room_id: room.id,
    });
    expect(streamCall.contentType).toContain("multipart/form-data");
    expect(streamCall.bodyText).toContain("BYOKAttachment.txt");
    expect(streamCall.bodyText).toContain("BYOK attachment content");
    const messageChain = JSON.parse(streamCall.message_chain);
    expect(messageChain.at(-1).content).toContain(
      "Files attached to this message: BYOKAttachment.txt.",
    );
  });

  it("re-syncs Coordidate records when a new future session is added", async () => {
    const upcoming = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/sessions`, {
      method: "POST",
      token: owner.token,
      body: {
        title: "August Planning Meeting",
        agenda: "Plan the next Intelligrate source navigation pass.",
        startsAt: "2026-08-14T10:00:00.000Z",
        endsAt: "2026-08-14T11:00:00.000Z",
        kind: "meeting",
        visibility: "room",
      },
    });
    expect(upcoming.status).toBe(201);

    const sync = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });

    expect(sync.status).toBe(200);
    const corpus = chatbot.calls.corpusSyncs.at(-1);
    expect(corpus.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "coordidate_session",
          title: "August Planning Meeting",
          metadata: expect.objectContaining({
            start_ts: Date.parse("2026-08-14T10:00:00.000Z"),
          }),
          source_ref: expect.objectContaining({
            sessionId: upcoming.payload.session.id,
            startsAt: "2026-08-14T10:00:00.000Z",
          }),
        }),
      ]),
    );
  });
});

describe("Intelligrate typed Domain corpus sync", () => {
  let app;
  let chatbot;
  let owner;
  let room;

  beforeAll(async () => {
    chatbot = await startMockChatbot();
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "Domain Corpus Owner" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "Domain Corpus Room",
      moduleCode: "CS2103T",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  it("sends Infilenite, Convolution, annotation, and Coordidate records as typed corpus items", async () => {
    const upload = await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "DomainArchitecture.txt",
      "Domain architecture notes describe Intelligrate source routing.",
      "Architecture",
    );

    const message = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/messages`, {
      method: "POST",
      token: owner.token,
      body: {
        channel: "general",
        body: "Remember that service boundaries should keep permissions in the Node app.",
      },
    });
    expect(message.status).toBe(201);

    const annotation = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels/general/annotations`, {
      method: "POST",
      token: owner.token,
      body: {
        content: { text: "source refs must point back to exact Domain records" },
        comment: "Use this note when explaining source pill navigation.",
        annotationType: "insight",
      },
    });
    expect(annotation.status).toBe(201);

    const session = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/sessions`, {
      method: "POST",
      token: owner.token,
      body: {
        title: "Architecture Review",
        agenda: "Review Intelligrate Domain corpus routing and source references.",
        startsAt: "2026-08-01T09:00:00.000Z",
        endsAt: "2026-08-01T10:00:00.000Z",
        kind: "meeting",
        visibility: "room",
      },
    });
    expect(session.status).toBe(201);

    const sync = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/buddy/embed`, {
      method: "POST",
      token: owner.token,
    });

    expect(sync.status).toBe(200);
    expect(chatbot.calls.corpusSyncs).toHaveLength(1);
    const corpus = chatbot.calls.corpusSyncs[0];
    expect(corpus.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: upload.resource.id,
          source_type: "resource",
          source_ref: expect.objectContaining({ type: "resource", resourceId: upload.resource.id }),
        }),
      ]),
    );
    expect(corpus.documents.map((item) => item.source_type)).toEqual(
      expect.arrayContaining(["convolution_message", "annotation", "coordidate_session"]),
    );
    expect(corpus.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "convolution_message",
          source_ref: expect.objectContaining({ channel: "general" }),
        }),
        expect.objectContaining({
          source_type: "annotation",
          source_ref: expect.objectContaining({ annotationId: annotation.payload.annotation.id }),
        }),
        expect.objectContaining({
          source_type: "coordidate_session",
          metadata: expect.objectContaining({
            start_ts: expect.any(Number),
          }),
          source_ref: expect.objectContaining({
            endsAt: expect.any(String),
            sessionId: session.payload.session.id,
            startsAt: expect.any(String),
          }),
        }),
      ]),
    );
  });
});

describe("Intelligrate grounded stream contract", () => {
  let app;
  let chatbot;
  let owner;
  let room;

  beforeAll(async () => {
    chatbot = await startMockChatbot({
      streamEvents: [
        {
          event: "tool_start",
          data: { name: "search_corpus", args: { query: "Orbital" } },
        },
        {
          event: "tool_end",
          data: {
            name: "search_corpus",
            result: "[Source: OrbitalGuide.txt] Orbital is Diffriendtiate's project context.",
          },
        },
        {
          event: "token",
          data: "Orbital is Diffriendtiate's project context from the uploaded guide.",
        },
        {
          event: "answer",
          data: "Orbital is Diffriendtiate's project context from the uploaded guide.",
        },
        {
          event: "sources",
          data: [
            "OrbitalGuide.txt",
            {
              type: "resource",
              label: "OrbitalGuide.txt",
              resourceId: "pending-resource-id",
              pageNumber: 2,
              highlightPosition: {
                boundingRect: { x1: 20, y1: 40, x2: 180, y2: 70, width: 600, height: 800, pageNumber: 2 },
                rects: [
                  { x1: 20, y1: 40, x2: 180, y2: 70, width: 600, height: 800, pageNumber: 2 },
                ],
              },
              textQuote: "Orbital is Diffriendtiate's project context.",
            },
          ],
        },
        {
          event: "chain",
          data: [
            { role: "user", content: "What is Orbital?" },
            {
              role: "assistant",
              content: "Orbital is Diffriendtiate's project context from the uploaded guide.",
            },
          ],
        },
      ],
    });
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "Grounded Stream Owner" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "Grounded Stream Room",
      moduleCode: "CS3216",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  it("streams room-corpus tool events, source events, and prior chat context", async () => {
    await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "OrbitalGuide.txt",
      "Orbital is Diffriendtiate's project context.",
      "Project Notes",
    );

    const response = await fetch(`${app.baseUrl}/api/rooms/${room.id}/buddy/message/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "user", body: "Remember that Orbital matters." },
          { role: "assistant", body: "I will keep Orbital in context." },
          { role: "user", body: "What is Orbital?" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const streamText = await response.text();
    expect(streamText).toContain("event: tool_start");
    expect(streamText).toContain("event: tool_end");
    expect(streamText).toContain("event: sources");
    expect(streamText).toContain("OrbitalGuide.txt");
    expect(streamText).toContain("\"type\":\"resource\"");
    expect(streamText).toContain("\"resourceId\":\"");
    expect(streamText).toContain("\"highlightPosition\"");
    expect(streamText).toContain("\"pageNumber\":2");

    expect(chatbot.calls.corpusSyncs).toHaveLength(1);
    expect(chatbot.calls.corpusSyncs[0].files[0]).toMatchObject({
      file_name: "OrbitalGuide.txt",
      source_type: "resource",
    });
    const streamCall = chatbot.calls.streams.at(-1);
    expect(streamCall).toMatchObject({
      room_id: room.id,
    });
    const messageChain = JSON.parse(streamCall.message_chain);
    expect(messageChain.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(messageChain.at(-1).content).toContain("What is Orbital?");
    expect(messageChain.at(-1).content).toContain("Available room resource filenames: OrbitalGuide.txt.");
  });

  it("forwards one supported attachment as multipart and includes its filename in context", async () => {
    const upload = await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "AttachedOrbital.txt",
      "Attached Orbital notes explain that Orbital is the project workspace.",
      "Uploads/Intelligrate",
    );

    const response = await fetch(`${app.baseUrl}/api/rooms/${room.id}/buddy/message/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachmentResourceIds: [upload.resource.id],
        messages: [{ role: "user", body: "Summarise the attached file." }],
      }),
    });

    expect(response.status).toBe(200);
    await response.text();

    const streamCall = chatbot.calls.streams.at(-1);
    expect(streamCall.contentType).toContain("multipart/form-data");
    expect(streamCall.bodyText).toContain("AttachedOrbital.txt");
    expect(streamCall.bodyText).toContain("Attached Orbital notes");
    const messageChain = JSON.parse(streamCall.message_chain);
    expect(messageChain.at(-1).content).toContain(
      "Files attached to this message: AttachedOrbital.txt.",
    );
  });
});
