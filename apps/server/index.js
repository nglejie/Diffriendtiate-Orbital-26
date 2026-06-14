import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Server } from "socket.io";
import { initDb, readDb, storageMode, writeDb } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "uploads");
const port = Number(process.env.PORT || 4000);
const jwtSecret =
  process.env.JWT_SECRET || "diffriendtiate-local-development-secret";
const chatbotBaseUrl = (
  process.env.CHATBOT_BASE_URL || "http://127.0.0.1:5000"
).replace(/\/+$/, "");
const chatbotDocumentExtensions = new Set([".pdf", ".txt", ".docx"]);
const roomCorpusSyncCache = new Map();

fs.mkdirSync(uploadDir, { recursive: true });

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createInviteCode() {
  return crypto.randomBytes(6).toString("base64url");
}

function toEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
}

async function getUserByToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret);
    const db = await readDb();
    return db.users.find((user) => user.id === payload.sub) || null;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await getUserByToken(token);

  if (!user) {
    return res.status(401).json({ message: "Please log in again." });
  }

  req.user = user;
  next();
}

function isMember(room, userId) {
  return room.ownerId === userId || room.memberIds.includes(userId);
}

function canViewRoom(room, userId) {
  return room.visibility === "public" || isMember(room, userId);
}

function roomDto(db, room, userId) {
  const owner = db.users.find((user) => user.id === room.ownerId);
  const messages = db.messages.filter((message) => message.roomId === room.id);
  const latestMessage = messages.at(-1);
  const members = (room.memberIds || [])
    .map((memberId) => publicUser(db.users.find((user) => user.id === memberId)))
    .filter(Boolean);

  return {
    id: room.id,
    name: room.name,
    moduleCode: room.moduleCode,
    description: room.description,
    visibility: room.visibility,
    tags: room.tags || [],
    theme: room.theme,
    background: room.background || "aurora",
    inviteCode: isMember(room, userId) ? room.inviteCode : null,
    channels: normalizeChannels(room.channels),
    owner: publicUser(owner),
    members,
    isOwner: room.ownerId === userId,
    isMember: isMember(room, userId),
    memberCount: room.memberIds.length,
    messageCount: messages.length,
    latestMessageAt: latestMessage?.createdAt || room.createdAt,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

function messageDto(db, message) {
  return {
    ...message,
    channel: normalizeChannel(message.channel || "general"),
    attachments: normalizeMessageAttachments(message.attachments),
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
  };
}

function resourceDto(db, resource) {
  return {
    ...resource,
    folder: resource.folder || "General",
    uploader: publicUser(db.users.find((user) => user.id === resource.uploaderId)),
  };
}

function sessionDto(db, session) {
  return {
    ...session,
    creator: publicUser(db.users.find((user) => user.id === session.createdBy)),
  };
}

function normalizeBuddyVisibility(value) {
  return value === "public" ? "public" : "private";
}

function normalizeBuddyThreadMessages(value, actor) {
  if (!Array.isArray(value)) return [];

  return value
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const body = String(message?.body || message?.content || "").trim().slice(0, 12000);
      const attachments = normalizeMessageAttachments(message?.attachments);
      const sources = Array.isArray(message?.sources)
        ? message.sources.map(String).map((source) => source.trim()).filter(Boolean).slice(0, 8)
        : [];
      const thinkingSteps =
        role === "assistant" && Array.isArray(message?.thinkingSteps)
          ? message.thinkingSteps
              .map(String)
              .map((step) => step.trim())
              .filter(Boolean)
              .slice(0, 40)
          : [];

      return {
        id: String(message?.id || createId("bmsg")),
        role,
        body,
        attachments,
        sources,
        thinkingSteps,
        isThinking: false,
        authorId: role === "user" ? String(message?.authorId || actor?.id || "") : null,
        authorName: role === "user" ? String(message?.authorName || actor?.name || "") : null,
        createdAt: message?.createdAt || new Date().toISOString(),
      };
    })
    .filter(
      (message) =>
        message.body ||
        message.attachments.length ||
        message.sources.length ||
        message.thinkingSteps.length,
    )
    .slice(-80);
}

function canViewBuddyThread(thread, userId) {
  return thread.visibility === "public" || thread.ownerId === userId;
}

function canEditBuddyThread(thread, userId) {
  return thread.ownerId === userId;
}

function isSubstantiveBuddyThread(thread) {
  return normalizeBuddyThreadMessages(thread.messages).some(
    (message) =>
      message.id !== "welcome" &&
      message.body !== "Send a question with any files you want me to consider.",
  );
}

function buddyThreadDto(db, thread, userId) {
  return {
    ...thread,
    visibility: normalizeBuddyVisibility(thread.visibility),
    messages: normalizeBuddyThreadMessages(thread.messages),
    owner: publicUser(db.users.find((user) => user.id === thread.ownerId)),
    isOwner: thread.ownerId === userId,
  };
}

function normalizeTags(value) {
  // Room cards are designed around at most three visible tags.
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeFolder(value) {
  const folder = String(value || "General").trim();
  return folder.slice(0, 48) || "General";
}

function normalizeChannel(value) {
  const channel = String(value || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 32);

  return channel || "general";
}

function normalizeChannels(value) {
  const channels = Array.isArray(value) ? value : [];
  return [...new Set(["general", ...channels.map(normalizeChannel)])].slice(0, 20);
}

function normalizeMessageAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((attachment) => ({
      id: String(attachment?.id || "").trim(),
      title: String(attachment?.title || attachment?.name || "Attachment").trim(),
      url: String(attachment?.url || "").trim(),
      type: String(attachment?.type || "file").trim(),
      size: Number(attachment?.size || 0),
    }))
    .filter((attachment) => attachment.id && attachment.url)
    .slice(0, 8);
}

function normalizeBuddyMessages(value) {
  if (!Array.isArray(value)) return [];

  // Keep the prompt compact enough for query-based chatbot requests while preserving
  // the most recent user/assistant context the model needs to answer coherently.
  return value
    .filter((message) => message?.id !== "welcome")
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || message?.body || "").trim().slice(0, 4000),
    }))
    .filter((message) => message.content)
    .slice(-12);
}

function getResourceExtension(resource) {
  const source =
    resource?.originalName || resource?.storageName || resource?.title || resource?.url || "";

  try {
    return path.extname(new URL(source, "http://local").pathname).toLowerCase();
  } catch {
    return path.extname(source).toLowerCase();
  }
}

function isChatbotDocument(resource) {
  return (
    ["file", "url"].includes(resource?.type) &&
    chatbotDocumentExtensions.has(getResourceExtension(resource))
  );
}

function isChatbotFileResource(resource) {
  return resource?.type === "file" && chatbotDocumentExtensions.has(getResourceExtension(resource));
}

function resourceUrlForChatbot(resource) {
  if (!isChatbotDocument(resource)) return null;
  return resource.url || (resource.storageName ? `/uploads/${resource.storageName}` : null);
}

function chatbotDocumentPayload(resource) {
  const url = resourceUrlForChatbot(resource);
  if (!url) return null;

  return {
    url,
    file_name: resource.originalName || resource.title || resource.storageName || url,
  };
}

function roomCorpusFingerprint(resources) {
  return JSON.stringify(
    resources
      .map((resource) => ({
        id: resource.id,
        url: resourceUrlForChatbot(resource),
        name: resource.originalName || resource.title || resource.storageName || "",
        size: resource.size || 0,
        createdAt: resource.createdAt || "",
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

async function syncRoomResourcesWithChatbot(db, room, options = {}) {
  const force = Boolean(options.force);
  const supportedResources = db.resources.filter(
    (resource) => resource.roomId === room.id && isChatbotDocument(resource),
  );
  const fingerprint = roomCorpusFingerprint(supportedResources);

  if (!force && roomCorpusSyncCache.get(room.id) === fingerprint) {
    return {
      result: true,
      success: supportedResources.map(
        (resource) => resource.originalName || resource.title || resource.storageName,
      ),
      failed: [],
      totalChunks: 0,
      cached: true,
      message: "Room corpus is already synced.",
    };
  }

  const urls = supportedResources.map(chatbotDocumentPayload).filter(Boolean);

  if (!urls.length) {
    await clearChatbotCorpus(room.id);
    roomCorpusSyncCache.set(room.id, fingerprint);
    return {
      result: true,
      success: [],
      failed: [],
      totalChunks: 0,
      message: "No supported PDF, TXT, or DOCX resources are available to sync.",
    };
  }

  console.info(`[buddy] Syncing ${urls.length} resource(s) for room ${room.id}`);
  const payload = await callChatbotJson("/embed", {
    room_id: room.id,
    urls,
  });

  if (payload.result) {
    roomCorpusSyncCache.set(room.id, fingerprint);
  }

  return {
    result: Boolean(payload.result),
    success: payload.success || [],
    failed: payload.failed || [],
    totalChunks: Number(payload.total_chunks || 0),
  };
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function resolveBuddyMessagePayload(db, room, body) {
  const messageChain = normalizeBuddyMessages(body.messages);
  if (!messageChain.length || messageChain.at(-1).role !== "user") {
    throw createHttpError(400, "Send a question before asking LLM Buddy.");
  }

  const attachmentIds = Array.isArray(body.attachmentResourceIds)
    ? body.attachmentResourceIds.map(String)
    : [];
  const attachedResources = attachmentIds
    .map((resourceId) =>
      db.resources.find(
        (resource) => resource.id === resourceId && resource.roomId === room.id,
      ),
    )
    .filter(Boolean);
  const directResource = attachedResources.find(isChatbotFileResource);

  if (attachedResources.length && !directResource) {
    throw createHttpError(
      400,
      "LLM Buddy can currently read one PDF, TXT, or DOCX attachment at a time.",
    );
  }

  return { messageChain, directResource };
}

function safeUploadPath(storageName) {
  const targetPath = path.resolve(uploadDir, storageName || "");
  const uploadRoot = path.resolve(uploadDir);

  if (!targetPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Invalid upload path.");
  }

  return targetPath;
}

function chatbotUrl(pathname) {
  return new URL(pathname, `${chatbotBaseUrl}/`);
}

async function readChatbotPayload(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg || item.message || String(item)).join(" ")
      : payload.detail;
    throw new Error(detail || payload.message || "LLM Buddy is not available right now.");
  }

  return payload;
}

async function callChatbotJson(pathname, body, timeoutMs = 180_000) {
  const response = await fetch(chatbotUrl(pathname), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  return readChatbotPayload(response);
}

async function clearChatbotCorpus(roomId) {
  const url = chatbotUrl("/corpus");
  url.searchParams.set("room_id", roomId);

  const response = await fetch(url, {
    method: "DELETE",
    signal: AbortSignal.timeout(15_000),
  });

  return readChatbotPayload(response);
}

async function createChatbotPredictRequest(pathname, { messageChain, roomId, resource }) {
  const url = chatbotUrl(pathname);
  url.searchParams.set("message_chain", JSON.stringify(messageChain));
  url.searchParams.set("room_id", roomId);

  const init = {
    method: "POST",
    signal: AbortSignal.timeout(240_000),
  };

  if (resource) {
    const filePath = safeUploadPath(resource.storageName);
    const fileBytes = await fs.promises.readFile(filePath);
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([fileBytes], {
        type: resource.mimeType || "application/octet-stream",
      }),
      resource.originalName || resource.title || resource.storageName,
    );

    init.body = formData;
  }

  return { url, init };
}

async function askChatbot({ messageChain, roomId, resource }) {
  const { url, init } = await createChatbotPredictRequest("/predict", {
    messageChain,
    roomId,
    resource,
  });
  const response = await fetch(url, init);
  return readChatbotPayload(response);
}

async function streamChatbot({ messageChain, roomId, resource }) {
  const { url, init } = await createChatbotPredictRequest("/predict/stream", {
    messageChain,
    roomId,
    resource,
  });
  const response = await fetch(url, init);

  if (!response.ok) {
    await readChatbotPayload(response);
  }

  if (!response.body) {
    throw new Error("LLM Buddy did not return a stream.");
  }

  return response;
}

function findRoomOr404(db, roomId, res) {
  const room = db.rooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    res.status(404).json({ message: "Room not found." });
    return null;
  }
  return room;
}

function assertRoomMember(db, roomId, userId, res) {
  const room = findRoomOr404(db, roomId, res);
  if (!room) return null;

  if (!isMember(room, userId)) {
    res.status(403).json({ message: "Join the room to access this area." });
    return null;
  }

  return room;
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "");
    callback(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 12 * 1024 * 1024,
  },
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Diffriendtiate API", storage: storageMode() });
});

app.post("/api/auth/register", async (req, res) => {
  const db = await readDb();
  const name = String(req.body.name || "").trim();
  const email = toEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name || !email || password.length < 6) {
    return res.status(400).json({
      message: "Name, email, and a password of at least 6 characters are required.",
    });
  }

  if (db.users.some((user) => user.email === email)) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  const now = new Date().toISOString();
  const user = {
    id: createId("usr"),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: now,
  };

  db.users.push(user);
  await writeDb(db);

  res.status(201).json({
    token: signToken(user),
    user: publicUser(user),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const db = await readDb();
  const email = toEmail(req.body.email);
  const password = String(req.body.password || "");
  const user = db.users.find((candidate) => candidate.email === email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  res.json({
    token: signToken(user),
    user: publicUser(user),
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/rooms", requireAuth, async (req, res) => {
  const db = await readDb();
  const query = String(req.query.search || "").trim().toLowerCase();

  const rooms = db.rooms
    .filter((room) => canViewRoom(room, req.user.id))
    .filter((room) => {
      if (!query) return true;
      return [
        room.name,
        room.moduleCode,
        room.description,
        ...(room.tags || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .map((room) => roomDto(db, room, req.user.id))
    .sort((a, b) => String(b.latestMessageAt).localeCompare(String(a.latestMessageAt)));

  res.json({ rooms });
});

app.post("/api/rooms", requireAuth, async (req, res) => {
  const db = await readDb();
  const now = new Date().toISOString();
  const name = String(req.body.name || "").trim();
  const moduleCode = String(req.body.moduleCode || "").trim().toUpperCase();
  const visibility = req.body.visibility === "private" ? "private" : "public";
  const password = String(req.body.password || "");

  if (!name || !moduleCode) {
    return res.status(400).json({ message: "Room name and module code are required." });
  }

  if (visibility === "private" && !password.trim()) {
    return res.status(400).json({ message: "Password is required for private room." });
  }

  const room = {
    id: createId("room"),
    name,
    moduleCode,
    description: String(req.body.description || "").trim(),
    visibility,
    tags: normalizeTags(req.body.tags),
    theme: String(req.body.theme || "twilight"),
    background: String(req.body.background || "aurora"),
    channels: ["general"],
    passwordHash:
      visibility === "private" ? await bcrypt.hash(password.trim(), 10) : null,
    ownerId: req.user.id,
    memberIds: [req.user.id],
    inviteCode: createInviteCode(),
    createdAt: now,
    updatedAt: now,
  };

  db.rooms.push(room);
  await writeDb(db);
  res.status(201).json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (!canViewRoom(room, req.user.id)) {
    return res.status(403).json({ message: "This room is private. Use an invite link to join." });
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.patch("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can edit this room." });
  }

  const name = String(req.body.name ?? room.name).trim();
  const moduleCode = String(req.body.moduleCode ?? room.moduleCode).trim().toUpperCase();
  if (!name || !moduleCode) {
    return res.status(400).json({ message: "Room name and module code are required." });
  }

  room.name = name;
  room.moduleCode = moduleCode;
  room.description = String(req.body.description ?? room.description).trim();
  room.visibility = req.body.visibility === "private" ? "private" : "public";
  room.tags = normalizeTags(req.body.tags ?? room.tags);
  room.theme = String(req.body.theme || room.theme || "twilight");
  room.background = String(req.body.background || room.background || "aurora");

  if (room.visibility === "private") {
    const password = String(req.body.password || "");
    if (password.trim()) {
      room.passwordHash = await bcrypt.hash(password.trim(), 10);
    } else if (!room.passwordHash) {
      return res.status(400).json({ message: "Password is required for private room." });
    }
  } else {
    room.passwordHash = null;
  }

  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  io.to(`room:${room.id}`).emit("room:updated", roomDto(db, room, req.user.id));
  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/rooms/:roomId/channels", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = normalizeChannel(req.body.name);
  room.channels = normalizeChannels([...(room.channels || []), channel]);
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  io.to(`room:${room.id}`).emit("room:updated", roomDto(db, room, req.user.id));
  res.status(201).json({ room: roomDto(db, room, req.user.id), channel });
});

app.patch("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const currentChannel = normalizeChannel(req.params.channel);
  const nextChannel = normalizeChannel(req.body.name);
  const channels = normalizeChannels(room.channels);

  if (currentChannel === "general") {
    return res.status(400).json({ message: "The general channel cannot be renamed." });
  }

  if (!channels.includes(currentChannel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  if (channels.includes(nextChannel) && nextChannel !== currentChannel) {
    return res.status(409).json({ message: "A channel with that name already exists." });
  }

  room.channels = normalizeChannels(
    channels.map((channel) => (channel === currentChannel ? nextChannel : channel)),
  );
  room.updatedAt = new Date().toISOString();

  db.messages = db.messages.map((message) =>
    message.roomId === room.id && normalizeChannel(message.channel) === currentChannel
      ? { ...message, channel: nextChannel }
      : message,
  );

  await writeDb(db);
  io.to(`room:${room.id}`).emit("room:updated", roomDto(db, room, req.user.id));
  res.json({ room: roomDto(db, room, req.user.id), channel: nextChannel });
});

app.delete("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = normalizeChannel(req.params.channel);
  const channels = normalizeChannels(room.channels);

  if (channel === "general") {
    return res.status(400).json({ message: "The general channel cannot be deleted." });
  }

  if (!channels.includes(channel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  room.channels = normalizeChannels(channels.filter((candidate) => candidate !== channel));
  room.updatedAt = new Date().toISOString();
  db.messages = db.messages.filter(
    (message) => message.roomId !== room.id || normalizeChannel(message.channel) !== channel,
  );

  await writeDb(db);
  io.to(`room:${room.id}`).emit("room:updated", roomDto(db, room, req.user.id));
  res.json({ room: roomDto(db, room, req.user.id), channel: "general" });
});

app.delete("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can delete this room." });
  }

  const roomResources = db.resources.filter((resource) => resource.roomId === room.id);
  for (const resource of roomResources) {
    if (resource.type === "file" && resource.storageName) {
      fs.rmSync(path.join(uploadDir, resource.storageName), { force: true });
    }
  }

  db.rooms = db.rooms.filter((candidate) => candidate.id !== room.id);
  db.messages = db.messages.filter((message) => message.roomId !== room.id);
  db.resources = db.resources.filter((resource) => resource.roomId !== room.id);
  db.sessions = db.sessions.filter((session) => session.roomId !== room.id);
  db.buddyThreads = db.buddyThreads.filter((thread) => thread.roomId !== room.id);
  await writeDb(db);

  clearChatbotCorpus(room.id).catch((error) => {
    console.warn(`[buddy] Failed to clear corpus for deleted room ${room.id}: ${error.message}`);
  });
  io.to(`room:${room.id}`).emit("room:deleted", { roomId: room.id });
  res.status(204).end();
});

app.post("/api/rooms/:roomId/join", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.visibility !== "public") {
    return res.status(403).json({ message: "Private rooms require an invite link." });
  }

  if (!isMember(room, req.user.id)) {
    room.memberIds.push(req.user.id);
    room.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/invites/:inviteCode/join", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = db.rooms.find((candidate) => candidate.inviteCode === req.params.inviteCode);

  if (!room) {
    return res.status(404).json({ message: "Invite link not found." });
  }

  if (room.visibility === "private" && !isMember(room, req.user.id)) {
    const password = String(req.body?.password || "");
    if (!password) {
      return res.status(403).json({ message: "Private room password is required." });
    }

    if (!room.passwordHash || !(await bcrypt.compare(password, room.passwordHash))) {
      return res.status(403).json({ message: "Incorrect private room password." });
    }
  }

  if (!isMember(room, req.user.id)) {
    room.memberIds.push(req.user.id);
    room.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId/messages", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const messages = db.messages
    .filter((message) => message.roomId === room.id)
    .map((message) => messageDto(db, message));

  res.json({ messages });
});

app.post("/api/rooms/:roomId/messages", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const body = String(req.body.body || "").trim();
  const attachments = normalizeMessageAttachments(req.body.attachments);
  const channel = normalizeChannel(req.body.channel);
  if (!body && !attachments.length) {
    return res.status(400).json({ message: "Message cannot be empty." });
  }

  room.channels = normalizeChannels([...(room.channels || []), channel]);

  const message = {
    id: createId("msg"),
    roomId: room.id,
    senderId: req.user.id,
    channel,
    body: body.slice(0, 2000),
    attachments,
    createdAt: new Date().toISOString(),
  };

  db.messages.push(message);
  await writeDb(db);

  const dto = messageDto(db, message);
  io.to(`room:${room.id}`).emit("message:new", dto);
  res.status(201).json({ message: dto });
});

app.get("/api/rooms/:roomId/resources", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const resources = db.resources
    .filter((resource) => resource.roomId === room.id)
    .map((resource) => resourceDto(db, resource))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  res.json({ resources });
});

app.post("/api/rooms/:roomId/resources/url", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const title = String(req.body.title || "").trim();
  const url = String(req.body.url || "").trim();
  const folder = normalizeFolder(req.body.folder);

  if (!title || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ message: "Provide a title and a valid http(s) URL." });
  }

  const resource = {
    id: createId("res"),
    roomId: room.id,
    uploaderId: req.user.id,
    type: "url",
    title,
    folder,
    url,
    createdAt: new Date().toISOString(),
  };

  db.resources.push(resource);
  await writeDb(db);
  res.status(201).json({ resource: resourceDto(db, resource) });
});

app.post(
  "/api/rooms/:roomId/resources/file",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const db = await readDb();
    const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
    if (!room) return;

    if (!req.file) {
      return res.status(400).json({ message: "Choose a file to upload." });
    }

    const resource = {
      id: createId("res"),
      roomId: room.id,
      uploaderId: req.user.id,
      type: "file",
      title: String(req.body.title || req.file.originalname).trim(),
      folder: normalizeFolder(req.body.folder),
      originalName: req.file.originalname,
      storageName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
      createdAt: new Date().toISOString(),
    };

    db.resources.push(resource);
    await writeDb(db);
    res.status(201).json({ resource: resourceDto(db, resource) });
  },
);

app.delete("/api/resources/:resourceId", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!room || (room.ownerId !== req.user.id && resource.uploaderId !== req.user.id)) {
    return res.status(403).json({ message: "You cannot delete this resource." });
  }

  if (resource.type === "file" && resource.storageName) {
    fs.rmSync(path.join(uploadDir, resource.storageName), { force: true });
  }

  db.resources = db.resources.filter((candidate) => candidate.id !== resource.id);
  await writeDb(db);
  res.status(204).end();
});

app.get("/api/rooms/:roomId/buddy/threads", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const threads = (db.buddyThreads || [])
    .filter(
      (thread) =>
        thread.roomId === room.id &&
        canViewBuddyThread(thread, req.user.id) &&
        isSubstantiveBuddyThread(thread),
    )
    .map((thread) => buddyThreadDto(db, thread, req.user.id))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  res.json({ threads });
});

app.post("/api/rooms/:roomId/buddy/threads", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const now = new Date().toISOString();
  const thread = {
    id: createId("buddy"),
    roomId: room.id,
    ownerId: req.user.id,
    title: String(req.body.title || "New Chat").trim().slice(0, 60) || "New Chat",
    visibility: normalizeBuddyVisibility(req.body.visibility),
    messages: normalizeBuddyThreadMessages(req.body.messages, req.user),
    createdAt: now,
    updatedAt: now,
  };

  db.buddyThreads.push(thread);
  await writeDb(db);
  res.status(201).json({ thread: buddyThreadDto(db, thread, req.user.id) });
});

app.patch("/api/rooms/:roomId/buddy/threads/:threadId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const thread = (db.buddyThreads || []).find(
    (candidate) => candidate.id === req.params.threadId && candidate.roomId === room.id,
  );

  if (!thread || !canViewBuddyThread(thread, req.user.id)) {
    return res.status(404).json({ message: "Buddy chat not found." });
  }

  if (req.body.title !== undefined) {
    if (!canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "Only the chat owner can rename this Buddy chat." });
    }
    thread.title = String(req.body.title || "New Chat").trim().slice(0, 60) || "New Chat";
  }

  if (req.body.visibility !== undefined) {
    if (!canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "Only the chat owner can change visibility." });
    }
    thread.visibility = normalizeBuddyVisibility(req.body.visibility);
  }

  if (req.body.messages !== undefined) {
    if (thread.visibility !== "public" && !canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "This Buddy chat is private." });
    }
    thread.messages = normalizeBuddyThreadMessages(req.body.messages, req.user);
  }

  thread.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ thread: buddyThreadDto(db, thread, req.user.id) });
});

app.delete("/api/rooms/:roomId/buddy/threads/:threadId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const thread = (db.buddyThreads || []).find(
    (candidate) => candidate.id === req.params.threadId && candidate.roomId === room.id,
  );

  if (!thread || !canViewBuddyThread(thread, req.user.id)) {
    return res.status(404).json({ message: "Buddy chat not found." });
  }

  if (!canEditBuddyThread(thread, req.user.id)) {
    return res.status(403).json({ message: "Only the chat owner can delete this Buddy chat." });
  }

  db.buddyThreads = (db.buddyThreads || []).filter((candidate) => candidate.id !== thread.id);
  await writeDb(db);
  res.status(204).end();
});

app.get("/api/rooms/:roomId/buddy/health", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const response = await fetch(chatbotUrl("/health"), {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readChatbotPayload(response);
    res.json({ ok: true, service: payload.message || "LLM Buddy" });
  } catch (error) {
    console.warn(`[buddy] Health check failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: "LLM Buddy is not available yet. Start the chatbot service and try again.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/embed", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    res.json(await syncRoomResourcesWithChatbot(db, room, { force: true }));
  } catch (error) {
    console.warn(`[buddy] Resource sync failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to sync room resources with LLM Buddy.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const { messageChain, directResource } = resolveBuddyMessagePayload(db, room, req.body);
    await syncRoomResourcesWithChatbot(db, room);
    console.info(
      `[buddy] Asking room ${room.id} with ${directResource ? directResource.title : "corpus only"}`,
    );
    const payload = await askChatbot({
      messageChain,
      roomId: room.id,
      resource: directResource,
    });

    res.json({
      answer: payload.answer || "",
      sources: payload.sources || [],
      messageChain: payload.message_chain || [],
      directAttachment: directResource ? resourceDto(db, directResource) : null,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.warn(`[buddy] Message failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to get a response from LLM Buddy.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message/stream", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const { messageChain, directResource } = resolveBuddyMessagePayload(db, room, req.body);
    await syncRoomResourcesWithChatbot(db, room);
    console.info(
      `[buddy] Streaming room ${room.id} with ${directResource ? directResource.title : "corpus only"}`,
    );
    const response = await streamChatbot({
      messageChain,
      roomId: room.id,
      resource: directResource,
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    res.flush?.();

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
      res.flush?.();
    }

    res.end();
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    console.warn(`[buddy] Stream failed for ${room.id}: ${error.message}`);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      return res.end();
    }

    return res.status(502).json({
      message: error.message || "Unable to stream a response from LLM Buddy.",
    });
  }
});

app.get("/api/rooms/:roomId/sessions", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const sessions = db.sessions
    .filter((session) => session.roomId === room.id)
    .map((session) => sessionDto(db, session))
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));

  res.json({ sessions });
});

app.post("/api/rooms/:roomId/sessions", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const title = String(req.body.title || "").trim();
  const startsAt = String(req.body.startsAt || "").trim();

  if (!title || Number.isNaN(Date.parse(startsAt))) {
    return res.status(400).json({ message: "Session title and date/time are required." });
  }

  const session = {
    id: createId("ses"),
    roomId: room.id,
    createdBy: req.user.id,
    title,
    agenda: String(req.body.agenda || "").trim(),
    startsAt: new Date(startsAt).toISOString(),
    createdAt: new Date().toISOString(),
  };

  db.sessions.push(session);
  await writeDb(db);
  res.status(201).json({ session: sessionDto(db, session) });
});

app.delete("/api/sessions/:sessionId", requireAuth, async (req, res) => {
  const db = await readDb();
  const session = db.sessions.find((candidate) => candidate.id === req.params.sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === session.roomId);
  if (!room || (room.ownerId !== req.user.id && session.createdBy !== req.user.id)) {
    return res.status(403).json({ message: "You cannot delete this session." });
  }

  db.sessions = db.sessions.filter((candidate) => candidate.id !== session.id);
  await writeDb(db);
  res.status(204).end();
});

io.use(async (socket, next) => {
  const user = await getUserByToken(socket.handshake.auth?.token);
  if (!user) {
    return next(new Error("Authentication failed."));
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  socket.on("room:join", async (roomId, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before chatting." });
        return;
      }

      socket.join(`room:${room.id}`);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to join the room right now." });
    }
  });

  socket.on("message:send", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before chatting." });
        return;
      }

      const body = String(payload?.body || "").trim();
      const attachments = normalizeMessageAttachments(payload?.attachments);
      const channel = normalizeChannel(payload?.channel);
      if (!body && !attachments.length) {
        ack?.({ ok: false, message: "Message cannot be empty." });
        return;
      }

      room.channels = normalizeChannels([...(room.channels || []), channel]);

      const message = {
        id: createId("msg"),
        roomId: room.id,
        senderId: socket.user.id,
        channel,
        body: body.slice(0, 2000),
        attachments,
        createdAt: new Date().toISOString(),
      };

      db.messages.push(message);
      await writeDb(db);

      const dto = messageDto(db, message);
      io.to(`room:${room.id}`).emit("message:new", dto);
      ack?.({ ok: true, message: dto });
    } catch {
      ack?.({ ok: false, message: "Unable to send the message right now." });
    }
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Something went wrong." });
});

await initDb();

server.listen(port, () => {
  console.log(
    `Diffriendtiate API running on http://127.0.0.1:${port} using ${storageMode()} storage`,
  );
});
