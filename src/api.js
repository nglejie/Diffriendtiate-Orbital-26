const API_BASE = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "diffriendtiate_token";

let authToken = localStorage.getItem(TOKEN_KEY) || "";

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token) {
  authToken = token || "";

  if (authToken) {
    localStorage.setItem(TOKEN_KEY, authToken);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const init = {
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
  joinInvite: (inviteCode) =>
    request(`/api/invites/${inviteCode}/join`, { method: "POST" }),
  getMessages: (roomId) => request(`/api/rooms/${roomId}/messages`),
  getResources: (roomId) => request(`/api/rooms/${roomId}/resources`),
  addUrlResource: (roomId, body) =>
    request(`/api/rooms/${roomId}/resources/url`, { method: "POST", body }),
  uploadFileResource: (roomId, formData) =>
    request(`/api/rooms/${roomId}/resources/file`, {
      method: "POST",
      body: formData,
    }),
  deleteResource: (resourceId) =>
    request(`/api/resources/${resourceId}`, { method: "DELETE" }),
  getSessions: (roomId) => request(`/api/rooms/${roomId}/sessions`),
  addSession: (roomId, body) =>
    request(`/api/rooms/${roomId}/sessions`, { method: "POST", body }),
  deleteSession: (sessionId) =>
    request(`/api/sessions/${sessionId}`, { method: "DELETE" }),
};
