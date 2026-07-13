export const API_BASE = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "diffriendtiate_token";
const SESSION_TOKEN_KEY = "diffriendtiate_session_token";

let authToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || "";

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

type CreateChannelBody = {
  name: string;
  type?: string;
  resourceId?: string;
};

type AnnotationBody = {
  position?: any;
  content?: any;
  comment?: string;
  annotationType?: string;
  resolved?: boolean;
};

type AnnotationReplyBody = {
  comment: string;
};

export function resolveServerAssetUrl(url: string | null | undefined) {
  const value = String(url || "");
  if (!value) return "";
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  if (!API_BASE || !value.startsWith("/uploads/")) return value;
  return `${API_BASE.replace(/\/$/, "")}${value}`;
}

function normalizeResourceUrls(resource) {
  if (!resource || typeof resource !== "object") return resource;

  return {
    ...resource,
    fileUrl: resolveServerAssetUrl(resource.fileUrl),
    pdfUrl: resolveServerAssetUrl(resource.pdfUrl),
    url: resolveServerAssetUrl(resource.url),
  };
}

function normalizeResourcePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  return {
    ...payload,
    resource: normalizeResourceUrls(payload.resource),
    resources: Array.isArray(payload.resources)
      ? payload.resources.map(normalizeResourceUrls)
      : payload.resources,
  };
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string, options: { remember?: boolean } = {}) {
  authToken = token || "";
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);

  if (authToken) {
    if (options.remember === false) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, authToken);
    } else {
      localStorage.setItem(TOKEN_KEY, authToken);
    }
  }
}

export function getOAuthUrl(provider: string) {
  return `${API_BASE}/api/auth/oauth/${encodeURIComponent(provider)}`;
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
    const error = new Error(payload.message || "Something went wrong.") as Error & {
      payload?: any;
      status?: number;
      [key: string]: any;
    };
    Object.assign(error, payload);
    error.payload = payload;
    error.status = response.status;
    throw error;
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
  completeSupabaseSession: (body) =>
    request("/api/auth/supabase/session", { method: "POST", body }),
  requestPasswordReset: (body) =>
    request("/api/auth/password-reset/request", { method: "POST", body }),
  resetPassword: (body) =>
    request("/api/auth/password-reset/confirm", { method: "POST", body }),
  resendEmailVerification: (body) =>
    request("/api/auth/email-verification/resend", { method: "POST", body }),
  confirmEmailVerification: (body) =>
    request("/api/auth/email-verification/confirm", { method: "POST", body }),
  me: () => request("/api/auth/me"),
  updateProfile: (body) => request("/api/auth/me", { method: "PATCH", body }),
  updateAccount: (body) => request("/api/auth/account", { method: "PATCH", body }),
  updatePassword: (body) => request("/api/auth/password", { method: "PATCH", body }),
  getLlmApiKeys: () => request("/api/auth/llm-api-keys"),
  saveLlmApiKey: (body) =>
    request("/api/auth/llm-api-keys", { method: "POST", body }),
  deleteLlmApiKey: (keyId) =>
    request(`/api/auth/llm-api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }),
  deleteAccount: () => request("/api/auth/me", { method: "DELETE" }),
  listRooms: (search = "") =>
    request(`/api/rooms${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createRoom: (body) => request("/api/rooms", { method: "POST", body }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  updateRoom: (roomId, body) =>
    request(`/api/rooms/${roomId}`, { method: "PATCH", body }),
  deleteRoom: (roomId) => request(`/api/rooms/${roomId}`, { method: "DELETE" }),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: "POST" }),
  leaveRoom: (roomId) => request(`/api/rooms/${roomId}/leave`, { method: "POST" }),
  joinInvite: (inviteCode, body) =>
    request(`/api/invites/${inviteCode}/join`, { method: "POST", body }),
  createChannel: (roomId: string, body: CreateChannelBody) =>
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
  updateChannelLayout: (roomId: string, channelLayout: any[]) =>
    request(`/api/rooms/${roomId}/channel-layout`, {
      method: "PATCH",
      body: { channelLayout },
    }),
  getAnnotations: (roomId: string, channel: string) =>
    request(`/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations`),
  createAnnotation: (roomId: string, channel: string, body: AnnotationBody) =>
    request(`/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations`, {
      method: "POST",
      body,
    }),
  updateAnnotation: (
    roomId: string,
    channel: string,
    annotationId: string,
    body: AnnotationBody,
  ) =>
    request(
      `/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations/${encodeURIComponent(annotationId)}`,
      { method: "PATCH", body },
    ),
  deleteAnnotation: (roomId: string, channel: string, annotationId: string) =>
    request(
      `/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations/${encodeURIComponent(annotationId)}`,
      { method: "DELETE" },
    ),
  addAnnotationReply: (
    roomId: string,
    channel: string,
    annotationId: string,
    body: AnnotationReplyBody,
  ) =>
    request(
      `/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations/${encodeURIComponent(annotationId)}/replies`,
      { method: "POST", body },
    ),
  deleteAnnotationReply: (
    roomId: string,
    channel: string,
    annotationId: string,
    replyId: string,
  ) =>
    request(
      `/api/rooms/${roomId}/channels/${encodeURIComponent(channel)}/annotations/${encodeURIComponent(annotationId)}/replies/${encodeURIComponent(replyId)}`,
      { method: "DELETE" },
    ),
  getMessages: (roomId) => request(`/api/rooms/${roomId}/messages`),
  getResources: (roomId, options: ResourceQueryOptions = {}) => {
    const params = new URLSearchParams();
    if (options.includeDeleted) params.set("includeDeleted", "true");
    if (options.deletedOnly) params.set("deleted", "true");
    const query = params.toString();
    return request(`/api/rooms/${roomId}/resources${query ? `?${query}` : ""}`).then(normalizeResourcePayload);
  },
  addUrlResource: (roomId, body) =>
    request(`/api/rooms/${roomId}/resources/url`, { method: "POST", body }).then(normalizeResourcePayload),
  uploadFileResource: (roomId, formData) =>
    request(`/api/rooms/${roomId}/resources/file`, {
      method: "POST",
      body: formData,
    }).then(normalizeResourcePayload),
  updateResource: (resourceId, body) =>
    request(`/api/resources/${resourceId}`, { method: "PATCH", body }).then(normalizeResourcePayload),
  moveResourceFolder: (roomId, body) =>
    request(`/api/rooms/${roomId}/resources/folders`, { method: "PATCH", body }).then(normalizeResourcePayload),
  deleteResource: (resourceId) =>
    request(`/api/resources/${resourceId}`, { method: "DELETE" }),
  restoreResource: (resourceId) =>
    request(`/api/resources/${resourceId}/restore`, { method: "PATCH" }).then(normalizeResourcePayload),
  deleteResourcePermanently: (resourceId) =>
    request(`/api/resources/${resourceId}/permanent`, { method: "DELETE" }),
  getBuddyHealth: (roomId) => request(`/api/rooms/${roomId}/buddy/health`),
  getBuddyProviders: (roomId) => request(`/api/rooms/${roomId}/buddy/providers`),
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
  getCoordinate: (roomId) => request(`/api/rooms/${roomId}/coordinate`),
  saveCoordinatePoll: (roomId, body) =>
    request(`/api/rooms/${roomId}/coordinate/poll`, { method: "PUT", body }),
  deleteCoordinatePoll: (roomId, pollId) =>
    request(`/api/rooms/${roomId}/coordinate/poll/${pollId}`, { method: "DELETE" }),
  saveCoordinateAvailability: (roomId, body) =>
    request(`/api/rooms/${roomId}/coordinate/availability`, { method: "PUT", body }),
  getCanvasCourses: (roomId, body) =>
    request(`/api/rooms/${roomId}/integrations/canvas/courses`, { method: "POST", body }),
  importCanvasDeadlines: (roomId, body) =>
    request(`/api/rooms/${roomId}/integrations/canvas/import`, { method: "POST", body }),
};
