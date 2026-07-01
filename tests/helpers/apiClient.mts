import assert from "node:assert/strict";

type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: any;
  headers?: Record<string, string>;
  token?: string;
};

export function uniqueId(prefix = "qa") {
  // Keep generated users/resources unique across repeated local runs so tests
  // do not collide with earlier temporary data or parallel workers.
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeUser(prefix = "qa") {
  // Standard user fixture used by API tests. Individual tests can override the
  // name/email while keeping a known password for login and invite scenarios.
  const id = uniqueId(prefix);
  return {
    name: `QA ${prefix}`,
    email: `${id}@example.test`,
    password: "CorrectHorseBatteryStaple!42",
  };
}

export async function apiRequest(baseUrl, path, options: ApiRequestOptions = {}) {
  // Small fetch wrapper shared by integration-style tests. It handles bearer
  // tokens, JSON bodies, FormData uploads, and returns both status and parsed
  // payload so assertions can inspect success and failure responses.
  const headers: Record<string, string> = { ...(options.headers || {}) };
  const init: RequestInit = {
    method: options.method || "GET",
    headers,
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { headers: response.headers, payload, status: response.status };
}

export async function expectStatus(result, expectedStatus, context = "request") {
  // Produces a clearer failure message than a bare status assertion by including
  // the response payload and the operation being attempted.
  assert.equal(
    result.status,
    expectedStatus,
    `${context} expected HTTP ${expectedStatus}, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  return result.payload;
}

export async function registerUser(baseUrl, overrides = {}) {
  // Registers a fresh user through the public API and returns the test fixture
  // fields alongside the API token/user payload.
  const user = { ...makeUser("user"), ...overrides };
  const result = await apiRequest(baseUrl, "/api/auth/register", {
    method: "POST",
    body: user,
  });
  const payload = await expectStatus(result, 201, "register user");
  return { ...user, ...payload };
}

export async function loginUser(baseUrl, user) {
  // Logs in an existing fixture user. This is kept separate from registerUser so
  // tests can explicitly cover both registration and login behavior.
  const result = await apiRequest(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email: user.email, password: user.password },
  });
  return expectStatus(result, 200, "login user");
}

export async function createRoom(baseUrl, token, overrides = {}) {
  // Creates a realistic default room for app-side tests. Overrides allow each
  // suite to focus on its own scenario without repeating the full room payload.
  const result = await apiRequest(baseUrl, "/api/rooms", {
    method: "POST",
    token,
    body: {
      name: "QA Study Room",
      moduleCode: "CS2040S",
      academicTerm: "2026/2027 S1",
      description: "Quality assurance room",
      visibility: "public",
      tags: ["qa", "testing"],
      theme: "twilight",
      background: "clouds",
      ...overrides,
    },
  });
  const payload = await expectStatus(result, 201, "create room");
  return payload.room;
}

export async function joinRoom(baseUrl, token, roomId) {
  // Joins a room through the same endpoint used by members in the app.
  const result = await apiRequest(baseUrl, `/api/rooms/${roomId}/join`, {
    method: "POST",
    token,
  });
  return expectStatus(result, 200, "join room");
}

export async function uploadTextResource(baseUrl, token, roomId, fileName, text, folder = "General") {
  // Uploads an in-memory text file through the resource upload API. This avoids
  // fixture files on disk while still exercising multipart upload handling.
  const formData = new FormData();
  formData.append("file", new Blob([text], { type: "text/plain" }), fileName);
  formData.append("folder", folder);

  const result = await apiRequest(baseUrl, `/api/rooms/${roomId}/resources/file`, {
    method: "POST",
    token,
    body: formData,
  });
  return expectStatus(result, 201, `upload ${fileName}`);
}
