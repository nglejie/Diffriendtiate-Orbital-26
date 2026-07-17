import http from "node:http";

const port = Number(process.env.MOCK_CHATBOT_PORT || 5011);
const calls = {
  corpusDeletes: 0,
  embeds: 0,
  corpusSyncs: 0,
  predictions: 0,
  streams: 0,
};

function sendJson(response, status, payload) {
  // Minimal JSON response helper for the standalone mock service used by E2E.
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readBody(request): Promise<any> {
  // Parse JSON request bodies from the app API so the mock can echo realistic
  // embed success data back to the caller.
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : null);
    });
  });
}

function parseMessageChain(url: URL) {
  try {
    const parsed = JSON.parse(url.searchParams.get("message_chain") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function latestPrompt(messages: any[] = []) {
  const latest = [...messages].reverse().find((message) => message?.role === "user");
  return String(latest?.body || latest?.content || "").trim();
}

function answerForPrompt(prompt: string, turnCount: number) {
  const lower = prompt.toLowerCase();
  if (lower.includes("follow")) {
    return `Follow-up answer ${turnCount}: Intelligrate used the previous conversation and did not replay the first answer.`;
  }
  if (lower.includes("attachment")) {
    return "Attachment answer: the uploaded PDF/DOCX/PPTX context was accepted and summarized.";
  }
  if (lower.includes("meeting") || lower.includes("coordidate")) {
    return "Coordidate answer: the next meeting is on August 14, 2026 at 10:00 AM.";
  }
  if (lower.includes("convolution") || lower.includes("message")) {
    return "Convolution answer: the relevant channel message says the project color is blue.";
  }
  if (lower.includes("byok") || lower.includes("provider")) {
    return "BYOK answer: this response was routed through the selected saved provider.";
  }
  return "First answer: Intelligrate can answer from the Domain context.";
}

function writeSse(response, event: string, data: any) {
  response.write(`event: ${event}\n`);
  const value = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of String(value).split(/\r?\n/)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

const server = http.createServer(async (request, response) => {
  // Implement only the Intelligrate endpoints the app calls during tests. The
  // call counters make it easy to inspect whether embedding/prediction happened.
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { message: "Mock Intelligrate ready", calls });
    return;
  }

  if (request.method === "GET" && url.pathname === "/llm/providers") {
    sendJson(response, 200, {
      source: "mock",
      providers: [
        {
          id: "gemini",
          providerName: "Gemini",
          defaultLabel: "Gemini",
          defaultModel: "gemini/gemini-flash-lite-latest",
          models: ["gemini/gemini-flash-lite-latest", "gemini/gemini-2.5-flash"],
        },
      ],
    });
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/corpus") {
    calls.corpusDeletes += 1;
    sendJson(response, 200, { result: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/embed") {
    const body = await readBody(request);
    calls.embeds += 1;
    sendJson(response, 200, {
      result: true,
      success: Array.isArray(body?.urls)
        ? body.urls.map((item) => item.file_name || item.name || item.url || "resource")
        : [],
      failed: [],
      total_chunks: Array.isArray(body?.urls) ? body.urls.length : 0,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/corpus/sync") {
    const body = await readBody(request);
    calls.corpusSyncs += 1;
    const files = Array.isArray(body?.files) ? body.files : [];
    const documents = Array.isArray(body?.documents) ? body.documents : [];
    sendJson(response, 200, {
      result: true,
      success: [
        ...files.map((item) => item.file_name || item.name || item.url || "file"),
        ...documents.map((item) => item.title || item.id || "record"),
      ],
      failed: [],
      total_chunks: files.length + documents.length,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/predict") {
    calls.predictions += 1;
    sendJson(response, 200, {
      answer: "Mock Intelligrate answer",
      sources: [],
      message_chain: [],
    });
    return;
  }

  if (request.method === "POST" && (url.pathname === "/predict/stream" || url.pathname === "/predict_stream")) {
    calls.streams += 1;
    const messages = parseMessageChain(url);
    const prompt = latestPrompt(messages);
    const answer = answerForPrompt(prompt, messages.filter((message) => message?.role === "user").length);
    const llmModel = url.searchParams.get("llm_model") || "";
    const source =
      prompt.toLowerCase().includes("meeting") || prompt.toLowerCase().includes("coordidate")
        ? { type: "coordidate_session", label: "Architecture Review", sessionId: "sess_mock", startsAt: "2026-08-14T10:00:00.000Z" }
        : prompt.toLowerCase().includes("convolution") || prompt.toLowerCase().includes("message")
          ? { type: "convolution_message", label: "#general message", channel: "general", messageId: "msg_mock" }
          : { type: "resource", label: "Mock Lecture.pdf", resourceId: "res_mock", pageNumber: 2 };
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    writeSse(response, "tool_start", {
      name: "search_domain_context",
      args: { query: prompt || "Domain context", source_type: source.type },
    });
    writeSse(response, "tool_end", {
      name: "search_domain_context",
      result: `[Source: ${source.label}] Mock source result for ${prompt || "Domain context"}.`,
    });
    writeSse(response, "token", answer);
    writeSse(response, "sources", [source]);
    writeSse(response, "chain", [
      ...messages.map((message) => ({
        role: message.role,
        content: message.body || message.content || "",
      })),
      {
        role: "assistant",
        content: answer,
        provider: llmModel ? "BYOK" : "Intelligrate",
      },
    ]);
    writeSse(response, "done", "");
    response.end();
    return;
  }

  sendJson(response, 404, { message: `Unhandled mock route: ${request.method} ${url.pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  console.info(`Mock Intelligrate service running on http://127.0.0.1:${port}`);
});
