const API_BASE = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "diffriendtiate_token";

let authToken = localStorage.getItem(TOKEN_KEY) || "";

type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: any;
  headers?: Record<string, string>;
};

type StreamRequestOptions = {
  signal?: AbortSignal;
};

type ResourceQueryOptions = {
  includeDeleted?: boolean;
  deletedOnly?: boolean;
};

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string) {
  authToken = token || "";

  if (authToken) {
    localStorage.setItem(TOKEN_KEY, authToken);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Shared JSON/FormData request wrapper for the browser app.
 * It attaches the current bearer token and normalizes API errors into Error objects
 * so feature components can show user-friendly modal messages.
 */
async function request(path: string, options: ApiRequestOptions = {}) {
  const headers: Record<string, string> = { ...(options.headers || {}) };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const init: RequestInit = {
    method: options.method || "GET",
    headers,
  };

  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Something went wrong.");
  }

  return payload;
}

/**
 * Parses one Server-Sent Events block from the Intelligrate streaming endpoint.
 * The parser keeps `event:` and multi-line `data:` support in one place.
 */
function parseSseBlock(block: string) {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const value = line.slice(5);
      data.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  return { event, data: data.join("\n") };
}

/**
 * Streams a POST request and forwards each SSE event as it arrives.
 * The caller owns cancellation through AbortController so Intelligrate responses can be stopped.
 */
async function streamRequest(path: string, body: any, onEvent: any, options: StreamRequestOptions = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Something went wrong.");
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      const event = parseSseBlock(block);
      onEvent?.(event.event, event.data);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    onEvent?.(event.event, event.data);
  }
}

export const api = {
  register: (body) => request("/api/auth/register", { method: "POST", body }),
  login: (body) => request("/api/auth/login", { method: "POST", body }),
  me: () => request("/api/auth/me"),
  listRooms: (search = "") =>
    request(`/api/rooms${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createRoom: (body) => request("/api/rooms", { method: "POST", body }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  updateRoom: (roomId, body) =>
    request(`/api/rooms/${roomId}`, { method: "PATCH", body }),
  deleteRoom: (roomId) => request(`/api/rooms/${roomId}`, { method: "DELETE" }),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: "POST" }),
  joinInvite: (inviteCode, body) =>
    request(`/api/invites/${inviteCode}/join`, { method: "POST", body }),
  createChannel: (roomId, body) =>
    request(`/api/rooms/${roomId}/channels`, { method: "POST", body }),
  renameChannel: (roomId, channel, body) =>
    request(`/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}`, {
      method: "PATCH",
      body,
    }),
  deleteChannel: (roomId, channel) =>
    request(`/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}`, {
      method: "DELETE",
    }),
  getMessages: (roomId) => request(`/api/rooms/${roomId}/messages`),
  getResources: (roomId, options: ResourceQueryOptions = {}) => {
    const params = new URLSearchParams();
    if (options.includeDeleted) params.set("includeDeleted", "true");
    if (options.deletedOnly) params.set("deleted", "true");
    const query = params.toString();
    return request(`/api/rooms/${roomId}/resources${query ? `?${query}` : ""}`);
  },
  addUrlResource: (roomId, body) =>
    request(`/api/rooms/${roomId}/resources/url`, { method: "POST", body }),
  uploadFileResource: (roomId, formData) =>
    request(`/api/rooms/${roomId}/resources/file`, {
      method: "POST",
      body: formData,
    }),
  deleteResource: (resourceId) =>
    request(`/api/resources/${resourceId}`, { method: "DELETE" }),
  restoreResource: (resourceId) =>
    request(`/api/resources/${resourceId}/restore`, { method: "PATCH" }),
  deleteResourcePermanently: (resourceId) =>
    request(`/api/resources/${resourceId}/permanent`, { method: "DELETE" }),
  getBuddyHealth: (roomId) => request(`/api/rooms/${roomId}/buddy/health`),
  getBuddyThreads: (roomId) => request(`/api/rooms/${roomId}/buddy/threads`),
  createBuddyThread: (roomId, body) =>
    request(`/api/rooms/${roomId}/buddy/threads`, { method: "POST", body }),
  generateBuddyTitle: (roomId, body) =>
    request(`/api/rooms/${roomId}/buddy/title`, { method: "POST", body }),
  updateBuddyThread: (roomId, threadId, body) =>
    request(`/api/rooms/${roomId}/buddy/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body,
    }),
  deleteBuddyThread: (roomId, threadId) =>
    request(`/api/rooms/${roomId}/buddy/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    }),
  syncBuddyResources: (roomId) =>
    request(`/api/rooms/${roomId}/buddy/embed`, { method: "POST" }),
  askBuddy: (roomId, body) =>
    request(`/api/rooms/${roomId}/buddy/message`, { method: "POST", body }),
  streamBuddy: (roomId, body, onEvent, options) =>
    streamRequest(`/api/rooms/${roomId}/buddy/message/stream`, body, onEvent, options),
  getSessions: (roomId) => request(`/api/rooms/${roomId}/sessions`),
  addSession: (roomId, body) =>
    request(`/api/rooms/${roomId}/sessions`, { method: "POST", body }),
  deleteSession: (sessionId) =>
    request(`/api/sessions/${sessionId}`, { method: "DELETE" }),
};
