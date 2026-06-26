import http from "node:http";

const port = Number(process.env.MOCK_CHATBOT_PORT || 5011);
const calls = {
  corpusDeletes: 0,
  embeds: 0,
  predictions: 0,
  streams: 0,
};

function sendJson(response, status, payload) {
  // Minimal JSON response helper for the standalone mock service used by E2E.
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
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

const server = http.createServer(async (request, response) => {
  // Implement only the Intelligrate endpoints the app calls during tests. The
  // call counters make it easy to inspect whether embedding/prediction happened.
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { message: "Mock Intelligrate ready", calls });
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

  if (request.method === "POST" && url.pathname === "/predict") {
    calls.predictions += 1;
    sendJson(response, 200, {
      answer: "Mock Intelligrate answer",
      sources: [],
      message_chain: [],
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/predict_stream") {
    calls.streams += 1;
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.write("event: thought\ndata: Searching room resources\n\n");
    response.write("event: final\ndata: Mock streamed answer\n\n");
    response.end();
    return;
  }

  sendJson(response, 404, { message: `Unhandled mock route: ${request.method} ${url.pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  console.info(`Mock Intelligrate service running on http://127.0.0.1:${port}`);
});
