import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Server } from "socket.io";
import { initDb, readDb, storageMode, writeDb } from "./store.js";

const execFileAsync = promisify(execFile);

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }

    interface Response {
      flush?: () => void;
    }
  }
}

declare module "socket.io" {
  interface Socket {
    user?: any;
  }
}

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const serverRootDir = path.basename(runtimeDir) === "dist" ? path.dirname(runtimeDir) : runtimeDir;
const uploadDir = path.join(serverRootDir, "uploads");
const clientDistDir = path.join(serverRootDir, "..", "client", "dist");
const port = Number(process.env.PORT || 4000);
const jwtSecret =
  process.env.JWT_SECRET || "diffriendtiate-local-development-secret";
function resolveChatbotBaseUrl() {
  const explicitBaseUrl = String(process.env.CHATBOT_BASE_URL || "").trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const host = String(process.env.CHATBOT_HOST || "").trim();
  if (host) {
    const portValue = String(process.env.CHATBOT_PORT || "").trim();
    const portSuffix = portValue ? `:${portValue}` : "";
    return `http://${host}${portSuffix}`;
  }

  return "http://127.0.0.1:5000";
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const chatbotBaseUrl = resolveChatbotBaseUrl();
const renderChatbotPublicUrl =
  "https://diffriendtiate-orbital-26-ms2-chatbot.onrender.com";
const chatbotWarmupBaseUrl = String(
  process.env.CHATBOT_WARMUP_BASE_URL ||
    process.env.CHATBOT_PUBLIC_URL ||
    (process.env.NODE_ENV === "production" ? renderChatbotPublicUrl : chatbotBaseUrl),
)
  .trim()
  .replace(/\/+$/, "");
const chatbotDocumentExtensions = new Set([".pdf", ".txt", ".docx"]);
const chatbotHealthTimeoutMs = readPositiveNumber(
  process.env.CHATBOT_HEALTH_TIMEOUT_MS,
  90_000,
);
const chatbotWarmupTimeoutMs = readPositiveNumber(
  process.env.CHATBOT_WARMUP_TIMEOUT_MS,
  chatbotHealthTimeoutMs,
);
const chatbotWarmupAttempts = Math.max(
  1,
  Math.floor(readPositiveNumber(process.env.CHATBOT_WARMUP_ATTEMPTS, 2)),
);
const chatbotWarmupRetryDelayMs = readPositiveNumber(
  process.env.CHATBOT_WARMUP_RETRY_DELAY_MS,
  10_000,
);
const roomCorpusSyncCache = new Map();
const intelligrateGpuEnabled =
  String(process.env.INTELLIGRATE_GPU_ENABLED || process.env.GPU_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const geminiApiKeyConfigured = Boolean(
  geminiApiKey &&
    !["your-key-here", "qa-compose-validation-placeholder"].includes(geminiApiKey),
);

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
    avatarPreset: user.avatarPreset || null,
    avatarUrl: user.avatarUrl || "",
  };
}

function normalizeAvatarUrl(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) return "";
  if (avatarUrl.length > 2_100_000) {
    const error = new Error("Profile picture is too large.") as Error & { status?: number };
    error.status = 413;
    throw error;
  }

  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(avatarUrl)) {
    const error = new Error("Profile picture must be a PNG, JPG, WebP, or GIF image.") as Error & {
      status?: number;
    };
    error.status = 400;
    throw error;
  }

  return avatarUrl;
}

function normalizeAvatarPreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = String(value.id || "").trim().slice(0, 80);
  const label = String(value.label || "Avatar").trim().slice(0, 80);
  const category = ["base", "clothing", "accessories", "special"].includes(value.category)
    ? value.category
    : "base";
  const layers = (Array.isArray(value.layers) ? value.layers : [])
    .map((layer) => {
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
      const src = String(layer.src || "").trim();
      if (!src.startsWith("/assets/limeets/avatars/gather/")) return null;
      return {
        backSrc: String(layer.backSrc || "").startsWith("/assets/limeets/avatars/gather/")
          ? String(layer.backSrc || "").trim().slice(0, 500)
          : "",
        label: String(layer.label || "Layer").trim().slice(0, 80),
        slot: String(layer.slot || "layer").trim().slice(0, 40),
        src: src.slice(0, 500),
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  if (!id || !layers.length) return null;

  const selections =
    value.selections && typeof value.selections === "object" && !Array.isArray(value.selections)
      ? Object.fromEntries(
          Object.entries(value.selections)
            .map(([slotId, selection]) => {
              if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
                return [String(slotId).slice(0, 40), null];
              }
              return [
                String(slotId).slice(0, 40),
                {
                  itemId: String(selection.itemId || "").slice(0, 120),
                  variantId: String(selection.variantId || "").slice(0, 80),
                },
              ];
            })
            .filter(([slotId]) => Boolean(slotId))
            .slice(0, 16),
        )
      : {};

  return { id, label, category, layers, selections, version: 1 };
}

function getBuddyProviderStatus() {
  if (intelligrateGpuEnabled) {
    return {
      available: true,
      code: "local_gpu",
      provider: "ollama",
      providerLabel: "Built-in local GPU model",
      message: "Intelligrate is using the app's built-in local model.",
    };
  }

  if (geminiApiKeyConfigured) {
    return {
      available: true,
      code: "gemini_configured",
      provider: "gemini",
      providerLabel: "Gemini API key",
      message: "Intelligrate is using the configured Gemini API key.",
    };
  }

  return {
    available: false,
    code: "provider_required",
    provider: "none",
    providerLabel: "No LLM provider configured",
    message:
      "Intelligrate needs GPU mode or a configured Gemini API key before it can be used.",
  };
}

function assertBuddyProviderAvailable(res) {
  const status = getBuddyProviderStatus();
  if (status.available) return status;

  res.status(503).json({
    ...status,
    setupRequired: true,
  });
  return null;
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
}

/**
 * Resolves a bearer token into the latest user record.
 * Reading the database each time means deleted users lose access immediately.
 */
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

/**
 * Express guard for authenticated routes.
 */
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
  return (
    room?.ownerId === userId ||
    (Array.isArray(room?.memberIds) && room.memberIds.includes(userId))
  );
}

const DEFAULT_SPACE_POSITION = { x: 50, y: 62 };
const SPACE_MIN_POSITION = 5;
const SPACE_MAX_POSITION = 16384;
const DEFAULT_SPACE_TILE = { mapId: "office-main", col: 18, row: 44 };
const SPACE_MIN_TILE = 0;
const SPACE_MAX_TILE_COL = 255;
const SPACE_MAX_TILE_ROW = 255;
const SPACE_MAP_IDS = new Set(["office-main", "office-socials", "custom-world"]);
const SPACE_DIRECTIONS = new Set(["down", "left", "right", "up"]);
const ROOM_ACTIVITY_TABS = new Set([
  "focus",
  "chat",
  "buddy",
  "resources",
  "space",
  "meetings",
  "calendar",
]);
const PROFILE_STATUSES = new Set(["online", "away", "dnd", "invisible"]);
const WORLD_NAVIGATION_TABS = new Set(["focus", "chat", "buddy", "resources", "space", "calendar"]);
const WORLD_CONFIG_DEFAULT = {
  enabled: true,
  version: 2,
  backgroundImage: "",
  tileSize: 32,
  columns: 64,
  rows: 40,
  activeRoomId: "custom-world",
  spawnpoint: { roomId: "custom-world", x: 32, y: 20 },
  spawn: { mapId: "custom-world", col: 6, row: 6 },
  rooms: [{ id: "custom-world", name: "World", tilemap: {} }],
  collisions: [],
  objects: [],
  privateAreas: [],
  zones: [],
};
const WORLD_CONFIG_MAX_BACKGROUND_LENGTH = 3_500_000;
const WORLD_CONFIG_MAX_COLLISIONS = 8_000;
const WORLD_CONFIG_MAX_OBJECTS = 500;
const WORLD_CONFIG_MAX_ZONES = 48;
const WORLD_CONFIG_MAX_ROOMS = 24;
const WORLD_CONFIG_MAX_TILES = 14_000;
// Temporary live presence only: Limeets avatar positions and meeting sessions
// are intentionally kept in memory, not durable room knowledge.
const spacePresenceByRoom = new Map();
const roomActivityByRoom = new Map();
const meetingPresenceByRoom = new Map();

function normalizeSpacePosition(value, fallback = null) {
  if (!value || typeof value !== "object") return fallback;

  const col = Number(value?.col);
  const row = Number(value?.row);
  const x = Number(value?.x);
  const y = Number(value?.y);
  const fallbackMapId = fallback?.mapId || DEFAULT_SPACE_TILE.mapId;
  const requestedMapId = typeof value?.mapId === "string" ? value.mapId.trim() : fallbackMapId;
  const mapId = SPACE_MAP_IDS.has(requestedMapId) ? requestedMapId : fallbackMapId;
  const worldRoomId = String(value?.worldRoomId || fallback?.worldRoomId || "custom-world")
    .trim()
    .slice(0, 64) || "custom-world";
  const direction = SPACE_DIRECTIONS.has(String(value?.direction || ""))
    ? String(value.direction)
    : fallback?.direction || "down";
  const moving = Boolean(value?.moving);

  if (Number.isFinite(col) && Number.isFinite(row)) {
    const position = {
      mapId,
      worldRoomId,
      col: Math.min(SPACE_MAX_TILE_COL, Math.max(SPACE_MIN_TILE, Math.round(col))),
      row: Math.min(SPACE_MAX_TILE_ROW, Math.max(SPACE_MIN_TILE, Math.round(row))),
      direction,
      moving,
    };

    if (Number.isFinite(x) && Number.isFinite(y)) {
      position.x = Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, x));
      position.y = Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, y));
    }

    return position;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;

  return {
    x: Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, x)),
    y: Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, y)),
    worldRoomId,
    direction,
    moving,
  };
}

function normalizeRoomActivityTab(value) {
  const tabId = String(value || "").trim();
  return ROOM_ACTIVITY_TABS.has(tabId) ? tabId : null;
}

function normalizeProfileStatus(value) {
  const status = String(value || "").trim();
  return PROFILE_STATUSES.has(status) ? status : "online";
}

function normalizeDocumentPage(value, fallback = null) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.floor(page);
}

function getSpaceRoomKey(roomId) {
  // Keep live avatar broadcasts separate from the room chat Socket.IO room.
  return `space:${roomId}`;
}

function normalizeMeetingAreaId(value) {
  const areaId = String(value || "").trim().slice(0, 72);
  return areaId || null;
}

function getMeetingRoomKey(roomId, areaId) {
  return `meeting:${roomId}:${areaId}`;
}

function getMeetingRoomPresence(roomId) {
  if (!meetingPresenceByRoom.has(roomId)) {
    meetingPresenceByRoom.set(roomId, new Map());
  }

  return meetingPresenceByRoom.get(roomId);
}

function getMeetingAreaPresence(roomId, areaId) {
  const roomPresence = getMeetingRoomPresence(roomId);
  if (!roomPresence.has(areaId)) {
    roomPresence.set(areaId, new Map());
  }

  return roomPresence.get(areaId);
}

function serializeMeetingPresence(roomId, areaId) {
  return Array.from(meetingPresenceByRoom.get(roomId)?.get(areaId)?.values() || [])
    .filter((presence) => presence.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...presence }) => presence);
}

function serializeMeetingSummary(roomId) {
  return Array.from(meetingPresenceByRoom.get(roomId)?.entries() || [])
    .map(([areaId]) => ({
      roomId,
      areaId,
      users: serializeMeetingPresence(roomId, areaId),
    }))
    .filter((summary) => summary.users.length);
}

function normalizeMeetingMedia(value) {
  const media = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    cameraOff: Boolean(media.cameraOff),
    deafened: Boolean(media.deafened),
    muted: Boolean(media.muted),
    screenSharing: Boolean(media.screenSharing),
  };
}

function normalizeMeetingSignal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const type = String(value.type || "").trim();
  if (type === "offer" || type === "answer") {
    const sdp = String(value.sdp || "");
    if (!sdp || sdp.length > 200_000) return null;
    return { type, sdp };
  }

  if (type === "ice") {
    const rawCandidate =
      value.candidate && typeof value.candidate === "object" && !Array.isArray(value.candidate)
        ? value.candidate
        : {};
    const candidate = String(rawCandidate.candidate || "").slice(0, 5_000);
    if (!candidate) return null;

    return {
      type,
      candidate: {
        candidate,
        sdpMid:
          rawCandidate.sdpMid === null || rawCandidate.sdpMid === undefined
            ? null
            : String(rawCandidate.sdpMid).slice(0, 64),
        sdpMLineIndex: Number.isFinite(Number(rawCandidate.sdpMLineIndex))
          ? Number(rawCandidate.sdpMLineIndex)
          : null,
      },
    };
  }

  return null;
}

function getSpacePresence(roomId) {
  if (!spacePresenceByRoom.has(roomId)) {
    spacePresenceByRoom.set(roomId, new Map());
  }

  return spacePresenceByRoom.get(roomId);
}

function serializeSpacePresence(roomId) {
  return Array.from(spacePresenceByRoom.get(roomId)?.values() || [])
    .filter((presence) => presence.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...presence }) => presence);
}

function getRoomActivity(roomId) {
  if (!roomActivityByRoom.has(roomId)) {
    roomActivityByRoom.set(roomId, new Map());
  }

  return roomActivityByRoom.get(roomId);
}

function findSocketRoomActivity(socket) {
  const userId = socket.user?.id;
  if (!userId) return null;

  for (const [roomId, roomActivity] of roomActivityByRoom.entries()) {
    const activity = roomActivity.get(userId);
    if (activity?.socketId === socket.id) {
      return { roomId, roomActivity, activity };
    }
  }

  return null;
}

function serializeRoomActivity(roomId) {
  return Array.from(roomActivityByRoom.get(roomId)?.values() || [])
    .filter((activity) => activity.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...activity }) => activity);
}

function emitRoomActivityState(roomId) {
  io.to(`room:${roomId}`).emit("room:activity:state", {
    roomId,
    members: serializeRoomActivity(roomId),
  });
}

function updateSocketSpaceProfileStatus(socket, roomId, profileStatus) {
  const roomPresence = spacePresenceByRoom.get(roomId);
  const presence = roomPresence?.get(socket.id);
  if (!presence || presence.socketId !== socket.id) return;

  roomPresence.set(socket.id, {
    ...presence,
    profileStatus,
    updatedAt: new Date().toISOString(),
  });
  io.to(getSpaceRoomKey(roomId)).emit("space:state", {
    roomId,
    users: serializeSpacePresence(roomId),
  });
}

function updateSocketMeetingProfileStatus(socket, roomId, profileStatus) {
  const roomPresence = meetingPresenceByRoom.get(roomId);
  if (!roomPresence) return;

  for (const [areaId, areaPresence] of roomPresence.entries()) {
    const presence = areaPresence.get(socket.user?.id);
    if (!presence || presence.socketId !== socket.id) continue;

    areaPresence.set(socket.user.id, {
      ...presence,
      profileStatus,
      updatedAt: new Date().toISOString(),
    });
    emitMeetingState(roomId, areaId);
    emitMeetingSummary(roomId);
  }
}

function emitMeetingState(roomId, areaId) {
  io.to(getMeetingRoomKey(roomId, areaId)).emit("meeting:state", {
    roomId,
    areaId,
    users: serializeMeetingPresence(roomId, areaId),
  });
}

function emitMeetingSummary(roomId, target = io.to(`room:${roomId}`)) {
  target.emit("meeting:summary", {
    roomId,
    areas: serializeMeetingSummary(roomId),
  });
}

function removeSocketSpacePresence(socket, targetRoomId = null) {
  for (const [roomId, roomPresence] of Array.from(spacePresenceByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    const presence = roomPresence.get(socket.id);
    if (!presence || presence.socketId !== socket.id) continue;

    roomPresence.delete(socket.id);
    socket.leave(getSpaceRoomKey(roomId));

    if (roomPresence.size) {
      io.to(getSpaceRoomKey(roomId)).emit("space:user-left", {
        presenceId: presence.presenceId,
        roomId,
        userId: presence.userId,
      });
    } else {
      spacePresenceByRoom.delete(roomId);
    }
  }
}

function removeSocketRoomActivity(socket, targetRoomId = null) {
  const userId = socket.user?.id;
  if (!userId) return;

  for (const [roomId, roomActivity] of Array.from(roomActivityByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    const activity = roomActivity.get(userId);
    if (!activity || activity.socketId !== socket.id) continue;

    roomActivity.delete(userId);

    if (roomActivity.size) {
      emitRoomActivityState(roomId);
    } else {
      roomActivityByRoom.delete(roomId);
      io.to(`room:${roomId}`).emit("room:activity:state", {
        roomId,
        members: [],
      });
    }
  }
}

function removeSocketMeetingPresence(socket, targetRoomId = null, targetAreaId = null) {
  const userId = socket.user?.id;
  if (!userId) return;

  for (const [roomId, roomPresence] of Array.from(meetingPresenceByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    for (const [areaId, areaPresence] of Array.from(roomPresence.entries())) {
      if (targetAreaId && areaId !== targetAreaId) continue;

      const presence = areaPresence.get(userId);
      if (!presence || presence.socketId !== socket.id) continue;

      areaPresence.delete(userId);
      socket.leave(getMeetingRoomKey(roomId, areaId));

      if (areaPresence.size) {
        io.to(getMeetingRoomKey(roomId, areaId)).emit("meeting:user-left", {
          roomId,
          areaId,
          userId,
        });
        emitMeetingState(roomId, areaId);
      } else {
        roomPresence.delete(areaId);
      }

      emitMeetingSummary(roomId);
    }

    if (!roomPresence.size) {
      meetingPresenceByRoom.delete(roomId);
      emitMeetingSummary(roomId);
    }
  }
}

function canViewRoom(room, userId) {
  return room.visibility === "public" || isMember(room, userId);
}

/**
 * Converts a stored room into the client-facing shape, including derived
 * membership, owner, and latest-activity metadata.
 */
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
    academicTerm: room.academicTerm || "",
    roomLogo: room.roomLogo || "",
    description: room.description,
    visibility: room.visibility,
    tags: room.tags || [],
    theme: room.theme,
    background: room.background || "aurora",
    worldConfig: normalizeWorldConfig(room.worldConfig),
    integrations: publicRoomIntegrations(room),
    inviteCode: isMember(room, userId) ? room.inviteCode : null,
    channels: normalizeChannels(room.channels),
    channelLayout: normalizeRoomChannelLayout(room.channelLayout, room.channels),
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

function getEffectiveResourceType(resource) {
  const detectedResourceType = detectResourceType(
    resource?.mimeType,
    resource?.originalName || resource?.storageName || resource?.title,
  );
  return ["pdf", "docx", "pptx", "image"].includes(resource?.resourceType)
    ? resource.resourceType
    : detectedResourceType;
}

function resourceDto(db, resource) {
  const resourceType = getEffectiveResourceType(resource);
  const isOfficeResource = resourceType === "docx" || resourceType === "pptx";
  const hasCurrentOfficePdf =
    isOfficeResource &&
    Boolean(resource?.pdfPath) &&
    resource?.pdfConversionVersion === OFFICE_PDF_CONVERSION_VERSION;
  const storedConversionStatus = ["pending", "done", "failed", "not-needed"].includes(resource?.conversionStatus)
    ? resource.conversionStatus
    : "not-needed";
  const conversionStatus = hasCurrentOfficePdf
    ? "done"
    : isOfficeResource && storedConversionStatus === "done"
      ? "pending"
      : storedConversionStatus;
  const fileUrl = resource?.storageName ? uploadUrl(resource.storageName) : resource?.url || null;
  const pdfUrl = hasCurrentOfficePdf
    ? uploadUrl(resource.pdfPath)
    : resourceType === "pdf"
      ? fileUrl
      : null;

  return {
    ...resource,
    folder: resource.folder || "General",
    conversionStatus,
    fileUrl,
    metadata: resource.metadata || {},
    pdfUrl,
    resourceType,
    uploader: publicUser(db.users.find((user) => user.id === resource.uploaderId)),
  };
}

function publicRoomIntegrations(room) {
  const integrations = room.integrations && typeof room.integrations === "object" && !Array.isArray(room.integrations)
    ? room.integrations
    : {};
  const canvas = integrations.canvas && typeof integrations.canvas === "object" && !Array.isArray(integrations.canvas)
    ? integrations.canvas
    : null;

  return {
    ...integrations,
    canvas: canvas
      ? {
          connected: canvas.connected === true,
          host: canvas.host || "canvas.nus.edu.sg",
          courseId: canvas.courseId || "",
          courseName: canvas.courseName || "",
          courseCode: canvas.courseCode || "",
          connectedAt: canvas.connectedAt || "",
          lastSyncedAt: canvas.lastSyncedAt || "",
          importedDeadlineCount: Number(canvas.importedDeadlineCount) || 0,
        }
      : null,
  };
}

function sessionDto(db, session) {
  return {
    ...session,
    creator: publicUser(db.users.find((user) => user.id === session.createdBy)),
  };
}

function coordinatePollDto(db, poll) {
  return {
    ...poll,
    creator: publicUser(db.users.find((user) => user.id === poll.createdBy)),
  };
}

function coordinateResponseDto(db, response) {
  return {
    ...response,
    user: publicUser(db.users.find((user) => user.id === response.userId)),
  };
}

function coordinateDto(db, room) {
  const polls = db.coordinatePolls
    .filter((poll) => poll.roomId === room.id)
    .sort((a, b) => String(a.rangeStart || a.createdAt).localeCompare(String(b.rangeStart || b.createdAt)));
  const activePoll =
    polls.find((poll) => !poll.scheduledSessionId) ||
    polls[polls.length - 1] ||
    null;

  return {
    poll: activePoll ? coordinatePollDto(db, activePoll) : null,
    polls: polls.map((poll) => coordinatePollDto(db, poll)),
    responses: db.coordinateResponses
      .filter((response) => response.roomId === room.id)
      .map((response) => coordinateResponseDto(db, response)),
  };
}

function normalizeBuddyVisibility(value) {
  return value === "public" ? "public" : "private";
}

function getBuddyThinkingText(value: any) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (typeof value === "object" && !Array.isArray(value)) {
    const directText =
      value.text ??
      value.message ??
      value.summary ??
      value.content ??
      value.output ??
      value.detail ??
      value.description ??
      "";

    return directText && directText !== value ? getBuddyThinkingText(directText) : "";
  }

  return "";
}

function normalizeBuddyThinkingStep(step: any) {
  if (step && typeof step === "object" && !Array.isArray(step)) {
    const text = getBuddyThinkingText(step)
      .trim()
      .slice(0, 1500);

    if (!text) return null;

    return {
      id: String(step.id || `${step.type || "thought"}:${text}`).slice(0, 260),
      type: ["tool", "done", "thought"].includes(step.type) ? step.type : "thought",
      text,
      summary: getBuddyThinkingText(step.summary).slice(0, 260),
      tool: String(step.tool || "").slice(0, 80),
      status: String(step.status || "").slice(0, 40),
    };
  }

  const text = String(step || "").trim().slice(0, 1500);
  if (!text) return null;

  return text;
}

function normalizeBuddyThreadMessages(value: any, actor: any = null) {
  if (!Array.isArray(value)) return [];

  return value
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const body = String(message?.body || message?.content || "").trim().slice(0, 12000);
      const preface =
        role === "assistant"
          ? String(message?.preface || "").trim().slice(0, 3000)
          : "";
      const attachments = normalizeMessageAttachments(message?.attachments);
      const sources = Array.isArray(message?.sources)
        ? message.sources.map(String).map((source) => source.trim()).filter(Boolean).slice(0, 8)
        : [];
      const thinkingSteps =
        role === "assistant" && Array.isArray(message?.thinkingSteps)
          ? message.thinkingSteps
              .map(normalizeBuddyThinkingStep)
              .filter(Boolean)
              .slice(0, 40)
          : [];

      return {
        id: String(message?.id || createId("bmsg")),
        role,
        preface,
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
        message.preface ||
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
  return normalizeBuddyThreadMessages(thread.messages).length > 0;
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

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeWorldImage(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (!image.startsWith("data:image/")) return "";
  if (image.length > WORLD_CONFIG_MAX_BACKGROUND_LENGTH) return "";
  return image;
}

function normalizeWorldTile(value, columns, rows, fallback) {
  const fallbackTile = fallback || WORLD_CONFIG_DEFAULT.spawn;
  return {
    mapId: "custom-world",
    col: clampInteger(value?.col ?? value?.x, 0, columns - 1, fallbackTile.col),
    row: clampInteger(value?.row ?? value?.y, 0, rows - 1, fallbackTile.row),
  };
}

function normalizeWorldCollision(value, columns, rows) {
  const parts =
    typeof value === "string"
      ? value.split(",")
      : [value?.col ?? value?.x, value?.row ?? value?.y];
  const col = Number(parts[0]);
  const row = Number(parts[1]);

  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;

  const normalizedCol = Math.round(col);
  const normalizedRow = Math.round(row);

  if (
    normalizedCol < 0 ||
    normalizedCol >= columns ||
    normalizedRow < 0 ||
    normalizedRow >= rows
  ) {
    return null;
  }

  return `${normalizedCol},${normalizedRow}`;
}

function normalizeWorldZone(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
  const col = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
  const row = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
  const width = clampInteger(bounds.width ?? bounds.w, 1, columns - col, 1);
  const height = clampInteger(bounds.height ?? bounds.h, 1, rows - row, 1);
  const tabId = WORLD_NAVIGATION_TABS.has(String(value.tabId || "").trim())
    ? String(value.tabId).trim()
    : "space";
  const fallbackLabel = tabId === "space" ? "World" : tabId;
  const label = String(value.label || fallbackLabel).trim().slice(0, 72) || fallbackLabel;

  return {
    id: String(value.id || `zone-${index + 1}`).trim().slice(0, 64) || `zone-${index + 1}`,
    label,
    tabId,
    description: String(value.description || "").trim().slice(0, 160),
    bounds: {
      col,
      row,
      width,
      height,
    },
  };
}

function normalizeWorldObject(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const assetId = String(value.assetId || "").trim().slice(0, 80);
  const src = String(value.src || "").trim();
  if (!assetId || !src.startsWith("/assets/limeets/")) return null;

  const col = clampInteger(value.col ?? value.x, 0, columns - 1, 0);
  const row = clampInteger(value.row ?? value.y, 0, rows - 1, 0);
  const width = clampInteger(value.width, 1, 12, 1);
  const height = clampInteger(value.height, 1, 12, 1);
  const interactionType = value.interactionType === "link" ? "link" : "none";
  const interactionValue = String(value.interactionValue || "").trim().slice(0, 500);

  return {
    id: String(value.id || `${assetId}-${index + 1}`).trim().slice(0, 96) || `${assetId}-${index + 1}`,
    assetId,
    label: String(value.label || assetId).trim().slice(0, 72) || assetId,
    src: src.slice(0, 220),
    col,
    row,
    width: Math.min(width, columns - col),
    height: Math.min(height, rows - row),
    blocks: value.blocks !== false,
    interactionType,
    interactionValue: interactionType === "link" ? interactionValue : "",
  };
}

function normalizeWorldPrivateArea(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
  const col = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
  const row = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
  const width = clampInteger(bounds.width ?? bounds.w, 1, columns - col, 1);
  const height = clampInteger(bounds.height ?? bounds.h, 1, rows - row, 1);
  const effects = value.effects && typeof value.effects === "object" && !Array.isArray(value.effects)
    ? value.effects
    : {};
  const properties = Array.isArray(value.properties)
    ? value.properties
        .map((property) => {
          if (!property || typeof property !== "object" || Array.isArray(property)) return null;
          const type = String(property.type || "").trim().slice(0, 48);
          if (!type) return null;
          return { ...property, type };
        })
        .filter(Boolean)
        .slice(0, 24)
    : [];
  const label =
    String(value.name || value.label || "Area")
      .trim()
      .slice(0, 72) || "Area";
  const roomId = String(value.roomId || value.mapId || "custom-world").trim().slice(0, 64) || "custom-world";
  const destination = normalizeWorldTeleporter(value.destination || value.teleporter, columns, rows, roomId);

  return {
    id: String(value.id || `area-${index + 1}`).trim().slice(0, 64) || `area-${index + 1}`,
    label,
    name: label,
    roomId,
    bounds: { col, row, width, height },
    effects: {
      entryExit: effects.entryExit === true,
      impassable: effects.impassable === true,
      meeting: effects.meeting === true,
      openLink: effects.openLink === true,
      teleport: effects.teleport === true,
    },
    properties,
    linkUrl: String(value.linkUrl || value.url || "").trim().slice(0, 500),
    tabId: normalizeWorldAreaTabId(value.tabId || value.targetTabId || value.portal?.tabId),
    destination: destination || { roomId, x: 0, y: 0 },
  };
}

function normalizeWorldAreaTabId(value) {
  const tabId = String(value || "").trim();
  return WORLD_NAVIGATION_TABS.has(tabId) && tabId !== "focus" ? tabId : "chat";
}

function normalizeWorldKey(value, columns, rows) {
  const parts = String(value || "").replace(/\s+/g, "").split(",");
  const col = Number(parts[0]);
  const row = Number(parts[1]);

  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;

  const x = Math.round(col);
  const y = Math.round(row);
  if (x < 0 || x >= columns || y < 0 || y >= rows) return null;
  return { x, y, key: `${x},${y}` };
}

function normalizeWorldLayerAsset(value) {
  return String(value || "").trim().slice(0, 96);
}

function normalizeWorldLayerStack(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeWorldLayerAsset(typeof item === "string" ? item : item?.assetId || item?.id))
      .filter(Boolean)
      .slice(0, 64);
  }

  const single = normalizeWorldLayerAsset(value);
  return single ? [single] : [];
}

function normalizeWorldPortal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tabId = WORLD_NAVIGATION_TABS.has(String(value.tabId || "").trim())
    ? String(value.tabId).trim()
    : "";
  if (!tabId) return null;

  return {
    tabId,
    label: String(value.label || tabId).trim().slice(0, 72) || tabId,
  };
}

function normalizeWorldTeleporter(value, columns, rows, fallbackRoomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    roomId: String(value.roomId || value.mapId || fallbackRoomId)
      .trim()
      .slice(0, 64) || fallbackRoomId,
    x: clampInteger(value.x ?? value.col, 0, columns - 1, 0),
    y: clampInteger(value.y ?? value.row, 0, rows - 1, 0),
  };
}

function normalizeWorldTileEntry(value, columns, rows, roomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entry = {};
  const floor = normalizeWorldLayerAsset(value.floor);
  const aboveFloor = normalizeWorldLayerStack(value.above_floor);
  const object = normalizeWorldLayerStack(value.object);
  if (floor) entry.floor = floor;
  if (aboveFloor.length) entry.above_floor = aboveFloor;
  if (object.length) entry.object = object;
  if (value.impassable === true) entry.impassable = true;

  const privateAreaId = String(value.privateAreaId || "").trim().slice(0, 72);
  if (privateAreaId) entry.privateAreaId = privateAreaId;

  const teleporter = normalizeWorldTeleporter(value.teleporter, columns, rows, roomId);
  if (teleporter) entry.teleporter = teleporter;

  const portal = normalizeWorldPortal(value.portal);
  if (portal) entry.portal = portal;

  const openUrl = String(value.openUrl || value.linkUrl || "").trim().slice(0, 500);
  if (openUrl) entry.openUrl = openUrl;

  if (value.entryExit === true) entry.entryExit = true;

  return Object.keys(entry).length ? entry : null;
}

function normalizeWorldTilemap(value, columns, rows, roomId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  let count = 0;

  for (const [rawKey, rawTile] of Object.entries(source)) {
    if (count >= WORLD_CONFIG_MAX_TILES) break;
    const parsed = normalizeWorldKey(rawKey, columns, rows);
    if (!parsed) continue;

    const tile = normalizeWorldTileEntry(rawTile, columns, rows, roomId);
    if (!tile) continue;

    normalized[parsed.key] = tile;
    count += 1;
  }

  return normalized;
}

function ensureWorldTile(tilemap, x, y) {
  const key = `${x},${y}`;
  tilemap[key] = tilemap[key] || {};
  return tilemap[key];
}

function migrateLegacyWorldTilemap(config, columns, rows) {
  const tilemap = {};

  (Array.isArray(config.collisions) ? config.collisions : []).forEach((collision) => {
    const normalized = normalizeWorldCollision(collision, columns, rows);
    if (!normalized) return;
    const [x, y] = normalized.split(",").map(Number);
    ensureWorldTile(tilemap, x, y).impassable = true;
  });

  (Array.isArray(config.objects) ? config.objects : []).forEach((object) => {
    const assetId = normalizeWorldLayerAsset(object?.assetId);
    if (!assetId) return;
    const x = clampInteger(object.col ?? object.x, 0, columns - 1, 0);
    const y = clampInteger(object.row ?? object.y, 0, rows - 1, 0);
    ensureWorldTile(tilemap, x, y).object = assetId;
  });

  (Array.isArray(config.privateAreas) ? config.privateAreas : []).forEach((area, index) => {
    const normalized = normalizeWorldPrivateArea(area, index, columns, rows);
    if (!normalized) return;
    const { col, row, width, height } = normalized.bounds;
    for (let y = row; y < row + height; y += 1) {
      for (let x = col; x < col + width; x += 1) {
        ensureWorldTile(tilemap, x, y).privateAreaId = normalized.id;
      }
    }
  });

  (Array.isArray(config.zones) ? config.zones : []).forEach((zone, index) => {
    const normalized = normalizeWorldZone(zone, index, columns, rows);
    if (!normalized) return;
    const { col, row, width, height } = normalized.bounds;
    for (let y = row; y < row + height; y += 1) {
      for (let x = col; x < col + width; x += 1) {
        ensureWorldTile(tilemap, x, y).portal = {
          tabId: normalized.tabId,
          label: normalized.label,
        };
      }
    }
  });

  return tilemap;
}

function normalizeWorldRoom(value, index, columns, rows) {
  const room = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackId = index === 0 ? "custom-world" : `world-room-${index + 1}`;
  const id = String(room.id || room.roomId || room.mapId || fallbackId)
    .trim()
    .slice(0, 64) || fallbackId;

  return {
    id,
    name: String(room.name || (index === 0 ? "World" : `Room ${index + 1}`))
      .trim()
      .slice(0, 72) || "World",
    tilemap: normalizeWorldTilemap(room.tilemap, columns, rows, id),
  };
}

function normalizeWorldConfig(value) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const columns = clampInteger(config.columns, 12, 256, WORLD_CONFIG_DEFAULT.columns);
  const rows = clampInteger(config.rows, 10, 256, WORLD_CONFIG_DEFAULT.rows);
  const backgroundImage = normalizeWorldImage(config.backgroundImage);
  const sourceRooms =
    Array.isArray(config.rooms) && config.rooms.length
      ? config.rooms
      : [
          {
            id: "custom-world",
            name: "World",
            tilemap: migrateLegacyWorldTilemap(config, columns, rows),
          },
        ];
  const rooms = sourceRooms
    .map((room, index) => normalizeWorldRoom(room, index, columns, rows))
    .filter((room) => room.id && room.name)
    .slice(0, WORLD_CONFIG_MAX_ROOMS);
  if (!rooms.length) rooms.push(WORLD_CONFIG_DEFAULT.rooms[0]);
  const activeRoomId = rooms.some((room) => room.id === config.activeRoomId)
    ? String(config.activeRoomId).trim().slice(0, 64)
    : rooms[0].id;
  const spawnSource = config.spawnpoint || config.spawn || WORLD_CONFIG_DEFAULT.spawnpoint;
  const spawnpoint = {
    roomId: String(spawnSource?.roomId || spawnSource?.mapId || rooms[0].id)
      .trim()
      .slice(0, 64) || rooms[0].id,
    x: clampInteger(spawnSource?.x ?? spawnSource?.col, 0, columns - 1, Math.floor(columns / 2)),
    y: clampInteger(spawnSource?.y ?? spawnSource?.row, 0, rows - 1, Math.floor(rows / 2)),
  };
  if (!rooms.some((room) => room.id === spawnpoint.roomId)) {
    spawnpoint.roomId = rooms[0].id;
  }
  const collisions = Array.from(
    new Set(
      (Array.isArray(config.collisions) ? config.collisions : [])
        .map((collision) => normalizeWorldCollision(collision, columns, rows))
        .filter(Boolean),
    ),
  ).slice(0, WORLD_CONFIG_MAX_COLLISIONS);
  const zones = (Array.isArray(config.zones) ? config.zones : [])
    .map((zone, index) => normalizeWorldZone(zone, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_ZONES);
  const objects = (Array.isArray(config.objects) ? config.objects : [])
    .map((object, index) => normalizeWorldObject(object, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_OBJECTS);
  const privateAreas = (Array.isArray(config.privateAreas) ? config.privateAreas : [])
    .map((area, index) => normalizeWorldPrivateArea(area, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_ZONES);

  return {
    enabled: config.enabled !== false,
    version: 2,
    backgroundImage,
    tileSize: clampInteger(config.tileSize, 16, 72, WORLD_CONFIG_DEFAULT.tileSize),
    columns,
    rows,
    activeRoomId,
    spawnpoint,
    spawn: { mapId: spawnpoint.roomId, col: spawnpoint.x, row: spawnpoint.y },
    rooms,
    collisions,
    objects,
    privateAreas,
    zones,
  };
}

function normalizeFolder(value) {
  const folder = String(value || "General").trim();
  return folder.slice(0, 48) || "General";
}

const resourceTypeRules = [
  { type: "Lecture Notes", patterns: [/lecture/i, /\blec\b/i, /slides?/i, /notes?/i, /session/i] },
  { type: "Tutorial", patterns: [/tutorial/i, /\btut\b/i, /worksheet/i, /problem\s*set/i] },
  { type: "Past Year Paper", patterns: [/past/i, /\bpyp\b/i, /exam/i, /final/i, /midterm/i, /paper/i] },
  { type: "Cheatsheet", patterns: [/cheat/i, /summary/i, /formula/i, /quick\s*ref/i] },
  { type: "Assignment", patterns: [/assignment/i, /\bassg\b/i, /homework/i, /project/i] },
  { type: "Lab", patterns: [/\blab\b/i, /practical/i, /experiment/i] },
  { type: "Quiz", patterns: [/quiz/i, /test/i] },
];

const topicStopWords = new Set([
  "lecture",
  "lect",
  "notes",
  "note",
  "tutorial",
  "slides",
  "slide",
  "session",
  "week",
  "final",
  "midterm",
  "exam",
  "paper",
  "assignment",
  "lab",
  "quiz",
  "copy",
  "full",
  "official",
  "unofficial",
]);

/** Returns a stable SHA-256 hash so exact duplicate uploads can be rejected room-wide. */
async function hashUploadedFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function compactResourceName(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferResourceTypeFromName(name = "") {
  const match = resourceTypeRules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(name)),
  );

  return match?.type || "Reference";
}

function inferTopicFromName(name = "", room) {
  const moduleCode = String(room?.moduleCode || "").toLowerCase();
  const tokens = compactResourceName(name)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && token !== moduleCode && !topicStopWords.has(token));

  return tokens.slice(0, 5).join(" ") || inferResourceTypeFromName(name);
}

function inferVersionFromName(name = "") {
  const match = String(name).match(/\b(?:v|version)\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  return match ? `v${match[1]}` : "v1";
}

/**
 * Adds NUS-study-specific browsing metadata at upload time.
 * The rules are intentionally transparent so members can later override them manually.
 */
function buildResourceMetadata({ room, title, sourceType, mimeType = "", size = 0, url = "" }) {
  const extension = path.extname(new URL(url || title, "http://local").pathname).replace(".", "");
  const resourceType = inferResourceTypeFromName(title);
  const topic = inferTopicFromName(title, room);
  const tags = [
    resourceType,
    topic,
    room?.moduleCode,
    room?.academicTerm,
    extension ? extension.toUpperCase() : "",
  ].filter(Boolean);

  return {
    resourceType,
    type: resourceType,
    topic,
    module: room?.moduleCode || "",
    semester: room?.academicTerm || "",
    version: inferVersionFromName(title),
    source: sourceType,
    extension,
    mimeType,
    size,
    tags: [...new Set(tags)].slice(0, 8),
    extractedAt: new Date().toISOString(),
  };
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
  const seen = new Set();
  const result = [];
  const general = { name: "general", type: "text", resourceId: "" };
  result.push(general);
  seen.add("general");

  for (const channel of Array.isArray(value) ? value : []) {
    const name = normalizeChannel(typeof channel === "string" ? channel : channel?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      type: typeof channel === "object" && channel?.type === "document" ? "document" : "text",
      resourceId: typeof channel === "object" ? String(channel?.resourceId || "") : "",
    });
  }

  return result.slice(0, 20);
}

const DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID = "default-text-channels";

function normalizeLayoutChannelName(value) {
  const raw = String(value || "").trim();
  return raw ? normalizeChannel(raw) : "";
}

function normalizeRoomChannelLayout(layout, channels = []) {
  const channelNames = normalizeChannels(channels).map((channel) => channel.name);
  const channelSet = new Set(channelNames);
  const seenChannels = new Set();
  const categories = Array.isArray(layout)
    ? layout
        .filter((category) => category && typeof category === "object" && category.id && category.name)
        .map((category) => ({
          id: String(category.id).slice(0, 80),
          name: String(category.name).trim().slice(0, 80) || "Text Channels",
          channels: Array.isArray(category.channels)
            ? category.channels
                .map(normalizeLayoutChannelName)
                .filter((channel) => {
                  if (!channelSet.has(channel) || seenChannels.has(channel)) return false;
                  seenChannels.add(channel);
                  return true;
                })
            : [],
        }))
    : [];

  const uncategorized = channelNames.filter((channel) => !seenChannels.has(channel));
  const defaultIndex = categories.findIndex((category) => category.id === DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID);

  if (defaultIndex >= 0) {
    categories[defaultIndex] = {
      ...categories[defaultIndex],
      channels: [...categories[defaultIndex].channels, ...uncategorized],
    };
  } else {
    categories.unshift({
      id: DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID,
      name: "Text Channels",
      channels: uncategorized,
    });
  }

  return categories;
}

function renameChannelInRoomLayout(layout, channels, oldChannel, newChannel) {
  return normalizeRoomChannelLayout(layout, channels).map((category) => ({
    ...category,
    channels: category.channels.map((channel) => (channel === oldChannel ? newChannel : channel)),
  }));
}

function findNormalizedRoomChannel(room, value) {
  const channel = normalizeChannel(value);
  return normalizeChannels(room?.channels).find((candidate) => candidate.name === channel) || null;
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeAnnotationType(value) {
  return ["question", "key-point", "definition", "mistake", "insight", "general"].includes(value)
    ? value
    : "general";
}

function getAnnotationAuthorId(annotation) {
  return String(annotation?.author?.id || "");
}

function normalizeAnnotationReply(reply) {
  return {
    id: String(reply?.id || createId("annr")),
    author: normalizePlainObject(reply?.author),
    comment: String(reply?.comment || "").slice(0, 4000),
    createdAt: reply?.createdAt || new Date().toISOString(),
  };
}

function annotationDto(annotation) {
  const createdAt = annotation.createdAt || new Date().toISOString();
  return {
    id: annotation.id,
    roomId: annotation.roomId,
    channel: normalizeChannel(annotation.channel),
    resourceId: String(annotation.resourceId || ""),
    position: normalizePlainObject(annotation.position),
    content: normalizePlainObject(annotation.content),
    comment: String(annotation.comment || ""),
    annotationType: normalizeAnnotationType(annotation.annotationType),
    resolved: Boolean(annotation.resolved),
    author: normalizePlainObject(annotation.author),
    replies: Array.isArray(annotation.replies) ? annotation.replies.map(normalizeAnnotationReply) : [],
    createdAt,
    updatedAt: annotation.updatedAt || createdAt,
  };
}

function createAnnotationRecord(room, channel, user, body = {}) {
  const now = new Date().toISOString();
  return annotationDto({
    id: createId("ann"),
    roomId: room.id,
    channel: channel.name,
    resourceId: channel.resourceId || "",
    position: normalizePlainObject(body.position),
    content: normalizePlainObject(body.content),
    comment: String(body.comment || "").trim().slice(0, 4000),
    annotationType: normalizeAnnotationType(body.annotationType),
    resolved: false,
    author: publicUser(user),
    replies: [],
    createdAt: now,
    updatedAt: now,
  });
}

function findAnnotationForChannel(db, room, channel, annotationId) {
  const id = String(annotationId || "");
  return db.annotations.find(
    (annotation) =>
      annotation.id === id &&
      annotation.roomId === room.id &&
      normalizeChannel(annotation.channel) === channel.name,
  );
}

function updateAnnotationRecord(annotation, user, body = {}) {
  const ownsAnnotation = getAnnotationAuthorId(annotation) === user.id;
  const hasComment = Object.prototype.hasOwnProperty.call(body, "comment");
  const hasAnnotationType = Object.prototype.hasOwnProperty.call(body, "annotationType");
  const hasResolved = Object.prototype.hasOwnProperty.call(body, "resolved");

  if ((hasComment || hasAnnotationType) && !ownsAnnotation) {
    return { status: 403, message: "You can only edit your own annotation notes." };
  }

  let changed = false;
  if (hasComment) {
    annotation.comment = String(body.comment || "").trim().slice(0, 4000);
    changed = true;
  }

  if (hasAnnotationType) {
    annotation.annotationType = normalizeAnnotationType(body.annotationType);
    changed = true;
  }

  if (hasResolved) {
    annotation.resolved = Boolean(body.resolved);
    changed = true;
  }

  if (changed) annotation.updatedAt = new Date().toISOString();
  return { annotation: annotationDto(annotation) };
}

function addAnnotationReply(annotation, user, body = {}) {
  const comment = String(body.comment || "").trim().slice(0, 4000);
  if (!comment) {
    return { status: 400, message: "Reply comment is required." };
  }

  const reply = {
    id: createId("annr"),
    author: publicUser(user),
    comment,
    createdAt: new Date().toISOString(),
  };
  annotation.replies = [...(Array.isArray(annotation.replies) ? annotation.replies : []), reply];
  annotation.updatedAt = reply.createdAt;
  return { annotation: annotationDto(annotation), reply };
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

function normalizeBuddyMessageChain(value) {
  if (!Array.isArray(value)) return [];

  // Keep only the real chat text that the member and Intelligrate exchanged. The app
  // should not add extra assistant notes or instructions here.
  return value
    .filter((message) => !message?.interrupted)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";

      return {
        role,
        content: String(message?.content || message?.body || "")
          .trim()
          .slice(0, 4000),
      };
    })
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

function detectResourceType(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const extension = String(filename || "").split(".").pop()?.toLowerCase() || "";

  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    extension === "docx" ||
    extension === "doc"
  ) {
    return "docx";
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint" ||
    extension === "pptx" ||
    extension === "ppt"
  ) {
    return "pptx";
  }
  if (mime.startsWith("image/")) return "image";
  return "other";
}

function uploadUrl(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return null;
  return `/uploads/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

async function convertToPdf(inputPath) {
  const outputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${baseName}.pdf`);
  if (fs.existsSync(outputPath)) {
    await fs.promises.unlink(outputPath);
  }

  const libreOfficeBinary = process.env.LIBREOFFICE_BIN || "libreoffice";
  await execFileAsync(
    libreOfficeBinary,
    ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outputDir, inputPath],
    {
      timeout: 180_000,
      windowsHide: true,
      env: { ...process.env, HOME: process.env.HOME || serverRootDir },
    },
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error("LibreOffice did not produce a PDF output file.");
  }
  return outputPath;
}

function relativeUploadPath(filePath) {
  return path.relative(uploadDir, filePath).replace(/\\/g, "/");
}

const activeResourceConversions = new Set();
const OFFICE_PDF_CONVERSION_VERSION = "office-fonts-v2";

function startResourcePdfConversion({ resourceId, roomId, storageName }) {
  if (activeResourceConversions.has(resourceId)) return;
  activeResourceConversions.add(resourceId);
  const inputPath = safeUploadPath(storageName);

  convertToPdf(inputPath)
    .then(async (pdfPath) => {
      const db = await readDb();
      const resource = db.resources.find((candidate) => candidate.id === resourceId);
      if (!resource) return;

      resource.pdfPath = relativeUploadPath(pdfPath);
      resource.pdfConversionVersion = OFFICE_PDF_CONVERSION_VERSION;
      resource.conversionStatus = "done";
      await writeDb(db);

      io.to(`room:${roomId}`).emit("resource:conversion-done", {
        roomId,
        resourceId,
        pdfUrl: uploadUrl(resource.pdfPath),
        conversionStatus: "done",
      });
    })
    .catch(async (error) => {
      console.error("Resource PDF conversion failed:", error);
      const db = await readDb();
      const resource = db.resources.find((candidate) => candidate.id === resourceId);
      if (!resource) return;

      resource.pdfPath = "";
      resource.pdfConversionVersion = "";
      resource.conversionStatus = "failed";
      await writeDb(db);

      io.to(`room:${roomId}`).emit("resource:conversion-done", {
        roomId,
        resourceId,
        conversionStatus: "failed",
      });
    })
    .finally(() => {
      activeResourceConversions.delete(resourceId);
    });
}

async function ensureOfficeResourceConversion(db, resource) {
  const resourceType = getEffectiveResourceType(resource);
  if (resourceType !== "docx" && resourceType !== "pptx") return false;

  let changed = false;
  if (resource.resourceType !== resourceType) {
    resource.resourceType = resourceType;
    changed = true;
  }

  if (resource.pdfPath) {
    if (resource.pdfConversionVersion === OFFICE_PDF_CONVERSION_VERSION) {
      if (resource.conversionStatus !== "done") {
        resource.conversionStatus = "done";
        changed = true;
      }
      return changed;
    }

    if (resource.conversionStatus !== "pending") {
      resource.conversionStatus = "pending";
      changed = true;
    }
    if (resource.pdfConversionVersion) {
      resource.pdfConversionVersion = "";
      changed = true;
    }
  } else if (resource.conversionStatus === "done") {
    resource.conversionStatus = "pending";
    changed = true;
  }

  if (!resource.storageName || resource.deletedAt) return changed;
  if (resource.conversionStatus === "failed") return changed;
  if (resource.conversionStatus === "pending" && activeResourceConversions.has(resource.id)) {
    return changed;
  }

  if (resource.conversionStatus !== "pending") {
    resource.conversionStatus = "pending";
    changed = true;
  }

  startResourcePdfConversion({
    resourceId: resource.id,
    roomId: resource.roomId,
    storageName: resource.storageName,
  });
  return changed;
}

const documentChannelMimePatterns = [
  /^application\/pdf\b/i,
  /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\b/i,
  /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation\b/i,
  /^image\/png\b/i,
  /^image\/jpe?g\b/i,
  /^image\/webp\b/i,
];
const documentChannelExtensions = new Set([".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"]);
const documentChannelFileTypeMessage =
  "Document channels support PDF, DOCX, PPTX, PNG, JPG, JPEG, or WEBP files only.";

function isDocumentChannelUploadFile(file) {
  if (!file) return false;
  const mimeType = String(file.mimetype || "").toLowerCase();
  const extension = path.extname(file.originalname || "").toLowerCase();

  return (
    documentChannelMimePatterns.some((pattern) => pattern.test(mimeType)) ||
    documentChannelExtensions.has(extension)
  );
}

function isDocumentChannelResource(resource) {
  if (!resource || resource.deletedAt || resource.type !== "file") return false;
  const mimeType = String(resource.mimeType || "").toLowerCase();
  const extension = getResourceExtension(resource);

  return (
    documentChannelMimePatterns.some((pattern) => pattern.test(mimeType)) ||
    documentChannelExtensions.has(extension)
  );
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

function resourceDisplayName(resource) {
  return resource?.originalName || resource?.title || resource?.storageName || resource?.url || "";
}

function uniqueResourceNames(resources, limit = 30) {
  return [
    ...new Set(
      resources
        .map(resourceDisplayName)
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

/**
 * Adds lightweight file-name context to the final user turn before forwarding it
 * to Intelligrate. The chatbot service only accepts one manually uploaded file,
 * so multi-file comparisons are represented through the already-synced room
 * corpus instead of silently dropping every attachment after the first one.
 */
function withBuddyResourceContext(messageChain, { attachedResources = [], roomResources = [] }) {
  if (!messageChain.length) return messageChain;

  const attachedNames = uniqueResourceNames(attachedResources, 12);
  const roomNames = uniqueResourceNames(roomResources.filter(isChatbotDocument), 30);
  const contextLines = [];

  if (attachedNames.length) {
    contextLines.push(`Files attached to this message: ${attachedNames.join(", ")}.`);
  }

  if (attachedNames.length > 1) {
    contextLines.push(
      "When the user asks about the attached files together, compare all listed attachments by searching the room corpus for their synced contents.",
    );
  }

  if (roomNames.length) {
    contextLines.push(`Available room resource filenames: ${roomNames.join(", ")}.`);
  }

  if (!contextLines.length) return messageChain;

  const nextChain = [...messageChain];
  const latestIndex = nextChain.length - 1;
  const latestMessage = nextChain[latestIndex];
  nextChain[latestIndex] = {
    ...latestMessage,
    content: `${latestMessage.content}\n\n[Room resource context]\n${contextLines
      .map((line) => `- ${line}`)
      .join("\n")}`.slice(0, 6000),
  };

  return nextChain;
}

function roomCorpusFingerprint(resources) {
  return JSON.stringify(
    resources
      .map((resource) => ({
        // File content hashes keep Intelligrate embedding tied to actual corpus changes.
        // Renaming or reordering a resource should not force an expensive re-embed.
        contentHash: resource.contentHash || "",
        url: resourceUrlForChatbot(resource),
        name: resource.originalName || resource.title || resource.storageName || "",
        size: resource.size || 0,
      }))
      .sort((a, b) => `${a.contentHash}:${a.url}`.localeCompare(`${b.contentHash}:${b.url}`)),
  );
}

/**
 * Embeds supported room resources in Intelligrate's corpus.
 * A fingerprint cache avoids repeated embedding when room documents are unchanged.
 */
async function syncRoomResourcesWithChatbot(db, room, options: any = {}) {
  const force = Boolean(options.force);
  const supportedResources = db.resources.filter(
    (resource) => resource.roomId === room.id && !resource.deletedAt && isChatbotDocument(resource),
  );
  const fingerprint = roomCorpusFingerprint(supportedResources);
  const cachedFingerprint = room.resourceSyncFingerprint || roomCorpusSyncCache.get(room.id);

  if (!force && cachedFingerprint === fingerprint) {
    roomCorpusSyncCache.set(room.id, fingerprint);
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
    room.resourceSyncFingerprint = fingerprint;
    room.resourceSyncUpdatedAt = new Date().toISOString();
    await writeDb(db);
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
    room.resourceSyncFingerprint = fingerprint;
    room.resourceSyncUpdatedAt = new Date().toISOString();
    await writeDb(db);
  }

  return {
    result: Boolean(payload.result),
    success: payload.success || [],
    failed: payload.failed || [],
    totalChunks: Number(payload.total_chunks || 0),
  };
}

function createHttpError(status, message) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Validates an Intelligrate request and resolves attachment IDs into room-owned resources.
 * This keeps the chatbot service from seeing files outside the active room.
 */
function resolveBuddyMessagePayload(db, room, body) {
  const messageChain = normalizeBuddyMessageChain(body.messages);
  if (!messageChain.length || messageChain.at(-1).role !== "user") {
    throw createHttpError(400, "Send a question before asking Intelligrate.");
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
  const directResources = attachedResources.filter(isChatbotFileResource);
  const roomResources = db.resources.filter((resource) => resource.roomId === room.id);

  if (attachedResources.length && !directResources.length) {
    throw createHttpError(
      400,
      "Intelligrate can currently read one PDF, TXT, or DOCX attachment at a time.",
    );
  }

  // The chatbot service currently accepts one direct uploaded file. When a
  // message has multiple attachments, the files are already synced into the
  // room corpus, so the safest app-side path is to provide exact filenames and
  // let Intelligrate search the corpus instead of silently reading only one.
  const directResource = directResources.length === 1 ? directResources[0] : null;
  const enrichedMessageChain = withBuddyResourceContext(messageChain, {
    attachedResources,
    roomResources,
  });

  return {
    messageChain: enrichedMessageChain,
    directResource,
    attachedResources,
  };
}

function safeUploadPath(storageName) {
  const targetPath = path.resolve(uploadDir, storageName || "");
  const uploadRoot = path.resolve(uploadDir);

  if (!targetPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Invalid upload path.");
  }

  return targetPath;
}

/**
 * Backfills hashes/metadata for older file resources before dedupe checks run.
 * This keeps existing rooms compatible without requiring a one-off migration script.
 */
async function ensureRoomResourceFileMetadata(db, room) {
  let changed = false;

  for (const resource of db.resources) {
    if (resource.roomId !== room.id || resource.type !== "file" || !resource.storageName) continue;

    if (!resource.contentHash) {
      try {
        resource.contentHash = await hashUploadedFile(safeUploadPath(resource.storageName));
        changed = true;
      } catch (error) {
        console.warn(`[resources] Could not hash ${resource.storageName}: ${error.message}`);
      }
    }

    if (!resource.metadata || !Object.keys(resource.metadata).length) {
      resource.metadata = buildResourceMetadata({
        room,
        title: resource.originalName || resource.title || resource.storageName,
        sourceType: "file",
        mimeType: resource.mimeType,
        size: resource.size,
        url: resource.url,
      });
      changed = true;
    }
  }

  if (changed) {
    await writeDb(db);
  }
}

function chatbotUrl(pathname) {
  return new URL(pathname, `${chatbotBaseUrl}/`);
}

function chatbotWarmupUrl(pathname) {
  return new URL(pathname, `${chatbotWarmupBaseUrl}/`);
}

async function readChatbotPayload(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg || item.message || String(item)).join(" ")
      : payload.detail;
    throw new Error(detail || payload.message || "Intelligrate is not available right now.");
  }

  return payload;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function warmChatbotOnStartup() {
  const providerStatus = getBuddyProviderStatus();
  if (!providerStatus.available) {
    console.info("[buddy] Skipping chatbot warm-up because no LLM provider is configured.");
    return;
  }

  for (let attempt = 1; attempt <= chatbotWarmupAttempts; attempt += 1) {
    try {
      const startedAt = Date.now();
      console.info(
        `[buddy] Warming chatbot service (${attempt}/${chatbotWarmupAttempts})...`,
      );

      const response = await fetch(chatbotWarmupUrl("/health"), {
        signal: AbortSignal.timeout(chatbotWarmupTimeoutMs),
      });
      await readChatbotPayload(response);

      console.info(`[buddy] Chatbot warm-up succeeded in ${Date.now() - startedAt}ms.`);
      return;
    } catch (error) {
      console.warn(
        `[buddy] Chatbot warm-up failed (${attempt}/${chatbotWarmupAttempts}): ${error.message}`,
      );

      if (attempt < chatbotWarmupAttempts) {
        await wait(chatbotWarmupRetryDelayMs);
      }
    }
  }
}

async function readChatbotHealthWithRetry(timeoutMs = chatbotHealthTimeoutMs) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const remainingMs = Math.max(1_000, timeoutMs - (Date.now() - startedAt));

    try {
      console.info(
        `[buddy] Checking chatbot health (${attempt}, ${Math.ceil(remainingMs / 1000)}s left)...`,
      );

      const response = await fetch(chatbotWarmupUrl("/health"), {
        signal: AbortSignal.timeout(remainingMs),
      });
      return await readChatbotPayload(response);
    } catch (error) {
      lastError = error;

      if (Date.now() - startedAt >= timeoutMs) break;
      await wait(Math.min(chatbotWarmupRetryDelayMs, timeoutMs - (Date.now() - startedAt)));
    }
  }

  throw lastError || new Error("Intelligrate is not available right now.");
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

function cleanGeneratedBuddyTitle(value, fallback) {
  const cleaned = String(value || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback || "New Chat").slice(0, 60);
}

async function generateBuddyTitle(message) {
  const prompt = [
    "Generate a concise study chat title for this first user message.",
    "Return only the title, with no quotes, no markdown, and no explanation.",
    "Keep it under 6 words.",
    "",
    `Message: ${String(message || "").slice(0, 1200)}`,
  ].join("\n");
  const url = chatbotUrl("/predict");
  url.searchParams.set(
    "message_chain",
    JSON.stringify([{ role: "user", content: prompt }]),
  );

  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await readChatbotPayload(response);

  return cleanGeneratedBuddyTitle(payload.answer, "New Chat");
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

  const init: RequestInit = {
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

/**
 * Non-streaming Intelligrate request path retained for simpler API callers and debugging.
 */
async function askChatbot({ messageChain, roomId, resource }) {
  const { url, init } = await createChatbotPredictRequest("/predict", {
    messageChain,
    roomId,
    resource,
  });
  const response = await fetch(url, init);
  return readChatbotPayload(response);
}

/**
 * Streaming Intelligrate request path used by the web UI for token-by-token responses.
 */
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
    throw new Error("Intelligrate did not return a stream.");
  }

  return response;
}

/**
 * Shared room lookup helper for routes that need consistent 404 handling.
 */
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

function assertRoomOwner(db, roomId, userId, res) {
  const room = findRoomOr404(db, roomId, res);
  if (!room) return null;

  if (room.ownerId !== userId) {
    res.status(403).json({ message: "Only the room owner can manage this setting." });
    return null;
  }

  return room;
}

function normalizeSessionKind(value) {
  return ["meeting", "event", "deadline"].includes(value) ? value : "meeting";
}

function normalizeSessionVisibility(value) {
  return value === "private" ? "private" : "room";
}

function normalizeSessionColor(value) {
  return ["rose", "gold", "green", "iris", "foam"].includes(value) ? value : "";
}

function isSessionVisibleToUser(session, userId) {
  return session.visibility !== "private" || session.createdBy === userId;
}

function normalizeOptionalIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeAvailabilitySlots(value) {
  return (Array.isArray(value) ? value : [])
    .map((slot) => {
      const startAt = normalizeOptionalIso(slot?.startAt);
      const endAt = normalizeOptionalIso(slot?.endAt);
      if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return null;

      return {
        startAt,
        endAt,
        status: slot?.status === "ifNeeded" ? "ifNeeded" : "available",
      };
    })
    .filter(Boolean)
    .slice(0, 1_500);
}

function normalizeMinuteOfDay(value, fallback) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(24 * 60, Math.max(0, minutes));
}

function datePartsInTimeZone(value, timeZone = "Asia/Singapore") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(value, timeZone = "Asia/Singapore") {
  const parts = datePartsInTimeZone(value, timeZone);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesOfDay(value, timeZone = "Asia/Singapore") {
  const parts = datePartsInTimeZone(value, timeZone);
  if (!parts) return 0;
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function normalizeSelectedDates(value, rangeStart, rangeEnd) {
  const startKey = localDateKey(rangeStart);
  const endKey = localDateKey(rangeEnd);
  const dates = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      dates
        .map((date) => String(date || "").trim())
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .filter((date) => date >= startKey && date <= endKey),
    ),
  ).slice(0, 180);
}

function availabilitySlotAllowedForPoll(slot, poll) {
  const startMs = Date.parse(slot.startAt);
  const endMs = Date.parse(slot.endAt);
  if (startMs < Date.parse(poll.rangeStart) || endMs > Date.parse(poll.rangeEnd)) return false;

  const timeZone = poll.timezone || "Asia/Singapore";
  const selectedDates = Array.isArray(poll.selectedDates) ? poll.selectedDates : [];
  if (selectedDates.length && !selectedDates.includes(localDateKey(slot.startAt, timeZone))) return false;

  const startMinutes = minutesOfDay(slot.startAt, timeZone);
  const endMinutes = minutesOfDay(slot.endAt, timeZone);
  const dayStart = normalizeMinuteOfDay(poll.dayStartMinutes, 9 * 60);
  const dayEnd = normalizeMinuteOfDay(poll.dayEndMinutes, 17 * 60);
  return startMinutes >= dayStart && endMinutes <= dayEnd;
}

function normalizeCanvasHost(value) {
  const host = String(value || "canvas.nus.edu.sg")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
    const error = new Error("Enter a valid Canvas host.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  return host;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function fetchCanvasJson(host, accessToken, pathname, params = {}) {
  const url = new URL(`https://${host}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18_000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "Canvas rejected that access token."
          : payload?.errors?.[0]?.message || payload?.message || "Canvas did not return a successful response.";
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status === 401 || response.status === 403 ? 401 : 502;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
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

function refreshLiveUserProfile(user) {
  const profile = publicUser(user);

  io.sockets.sockets.forEach((socket) => {
    if (socket.user?.id === user.id) {
      socket.user = { ...socket.user, ...user };
    }
  });

  roomActivityByRoom.forEach((activityByUser) => {
    const activity = activityByUser.get(user.id);
    if (activity) activityByUser.set(user.id, { ...activity, user: profile });
  });

  spacePresenceByRoom.forEach((presenceBySocket) => {
    presenceBySocket.forEach((presence, presenceKey) => {
      if (presence.userId === user.id) {
        presenceBySocket.set(presenceKey, { ...presence, user: profile });
      }
    });
  });

  meetingPresenceByRoom.forEach((presenceByArea) => {
    presenceByArea.forEach((presenceByUser) => {
      const presence = presenceByUser.get(user.id);
      if (presence) presenceByUser.set(user.id, { ...presence, user: profile });
    });
  });

  return profile;
}

async function emitRoomUpdated(db, room) {
  const roomKey = `room:${room.id}`;
  io.sockets.sockets.forEach((socket) => {
    if (socket.rooms.has(roomKey)) {
      socket.emit("room:updated", roomDto(db, room, socket.user?.id));
    }
  });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
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
    avatarPreset: null,
    avatarUrl: "",
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

app.patch("/api/auth/me", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const name = String(req.body.name || "").trim();
  if (!name || name.length > 80) {
    return res.status(400).json({ message: "Display name must be 1 to 80 characters." });
  }

  try {
    user.name = name;
    user.avatarUrl = normalizeAvatarUrl(req.body.avatarUrl);
    user.avatarPreset = normalizeAvatarPreset(req.body.avatarPreset);
    await writeDb(db);

    const profile = refreshLiveUserProfile(user);
    db.rooms
      .filter((room) => isMember(room, user.id))
      .forEach((room) => {
        io.to(`room:${room.id}`).emit("user:profile-updated", {
          roomId: room.id,
          user: profile,
        });
      });

    res.json({ user: profile });
  } catch (error) {
    const profileError = error as Error & { status?: number };
    res
      .status(profileError.status || 400)
      .json({ message: profileError.message || "Unable to update profile." });
  }
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
    academicTerm: String(req.body.academicTerm || "").trim(),
    roomLogo: String(req.body.roomLogo || "").trim(),
    description: String(req.body.description || "").trim(),
    visibility,
    tags: normalizeTags(req.body.tags),
    theme: String(req.body.theme || "twilight"),
    background: String(req.body.background || "aurora"),
    worldConfig: normalizeWorldConfig(req.body.worldConfig),
    channels: ["general"],
    channelLayout: normalizeRoomChannelLayout([], ["general"]),
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
  room.academicTerm = String(req.body.academicTerm ?? room.academicTerm ?? "").trim();
  room.roomLogo = String(req.body.roomLogo ?? room.roomLogo ?? "").trim();
  room.description = String(req.body.description ?? room.description).trim();
  room.visibility = req.body.visibility === "private" ? "private" : "public";
  room.tags = normalizeTags(req.body.tags ?? room.tags);
  room.theme = String(req.body.theme || room.theme || "twilight");
  room.background = String(req.body.background || room.background || "aurora");
  if (Object.prototype.hasOwnProperty.call(req.body, "worldConfig")) {
    room.worldConfig = normalizeWorldConfig(req.body.worldConfig);
  }

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
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/rooms/:roomId/channels", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const channel = normalizeChannel(req.body.name);
  const type = req.body.type === "document" ? "document" : "text";
  const resourceId = type === "document" ? String(req.body.resourceId || "") : "";
  if (type === "document") {
    if (!resourceId) {
      return res.status(400).json({ message: "Choose a supported document for this channel." });
    }

    const resource = db.resources.find((candidate) => candidate.id === resourceId && candidate.roomId === room.id);
    if (!resource) return res.status(404).json({ message: "Resource not found." });
    if (!isDocumentChannelResource(resource)) {
      return res.status(400).json({
        message: documentChannelFileTypeMessage,
      });
    }
    await ensureOfficeResourceConversion(db, resource);
  }

  const newChannel = { name: channel, type, resourceId };
  room.channels = normalizeChannels([...(room.channels || []), newChannel]);
  room.channelLayout = normalizeRoomChannelLayout(room.channelLayout, room.channels);
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.status(201).json({ room: roomDto(db, room, req.user.id), channel });
});

app.patch("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const currentChannel = normalizeChannel(req.params.channel);
  const nextChannel = normalizeChannel(req.body.name);
  const channels = normalizeChannels(room.channels);

  if (currentChannel === "general") {
    return res.status(400).json({ message: "The general channel cannot be renamed." });
  }

  if (!channels.some((channel) => channel.name === currentChannel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  if (channels.some((channel) => channel.name === nextChannel) && nextChannel !== currentChannel) {
    return res.status(409).json({ message: "A channel with that name already exists." });
  }

  const renamedChannels = normalizeChannels(
    channels.map((channel) =>
      channel.name === currentChannel ? { ...channel, name: nextChannel } : channel,
    ),
  );
  room.channelLayout = normalizeRoomChannelLayout(
    renameChannelInRoomLayout(room.channelLayout, channels, currentChannel, nextChannel),
    renamedChannels,
  );
  room.channels = renamedChannels;
  room.updatedAt = new Date().toISOString();

  db.messages = db.messages.map((message) =>
    message.roomId === room.id && normalizeChannel(message.channel) === currentChannel
      ? { ...message, channel: nextChannel }
      : message,
  );
  db.annotations = db.annotations.map((annotation) =>
    annotation.roomId === room.id && normalizeChannel(annotation.channel) === currentChannel
      ? { ...annotation, channel: nextChannel, updatedAt: new Date().toISOString() }
      : annotation,
  );

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id), channel: nextChannel });
});

app.delete("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const channel = normalizeChannel(req.params.channel);
  const channels = normalizeChannels(room.channels);

  if (channel === "general") {
    return res.status(400).json({ message: "The general channel cannot be deleted." });
  }

  if (!channels.some((candidate) => candidate.name === channel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  room.channels = normalizeChannels(channels.filter((candidate) => candidate.name !== channel));
  room.channelLayout = normalizeRoomChannelLayout(room.channelLayout, room.channels);
  room.updatedAt = new Date().toISOString();
  db.messages = db.messages.filter(
    (message) => message.roomId !== room.id || normalizeChannel(message.channel) !== channel,
  );
  db.annotations = db.annotations.filter(
    (annotation) => annotation.roomId !== room.id || normalizeChannel(annotation.channel) !== channel,
  );

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id), channel: "general" });
});

app.patch("/api/rooms/:roomId/channel-layout", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  room.channelLayout = normalizeRoomChannelLayout(
    req.body?.channelLayout ?? req.body?.layout,
    room.channels,
  );
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId/channels/:channel/annotations", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotations = db.annotations
    .filter(
      (annotation) =>
        annotation.roomId === room.id &&
        normalizeChannel(annotation.channel) === channel.name,
    )
    .map(annotationDto);

  res.json({ annotations });
});

app.post("/api/rooms/:roomId/channels/:channel/annotations", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = createAnnotationRecord(room, channel, req.user, req.body);
  db.annotations.push(annotation);
  await writeDb(db);

  io.to(`room:${room.id}`).emit("annotation:new", annotation);
  res.status(201).json({ annotation });
});

app.patch("/api/rooms/:roomId/channels/:channel/annotations/:annotationId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  const result = updateAnnotationRecord(annotation, req.user, req.body);
  if (result.status) {
    return res.status(result.status).json({ message: result.message });
  }

  await writeDb(db);
  io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
  res.json({ annotation: result.annotation });
});

app.delete("/api/rooms/:roomId/channels/:channel/annotations/:annotationId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  if (getAnnotationAuthorId(annotation) !== req.user.id && room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the annotation author or room owner can delete it." });
  }

  db.annotations = db.annotations.filter((candidate) => candidate.id !== annotation.id);
  await writeDb(db);

  const payload = { id: annotation.id, channel: channel.name };
  io.to(`room:${room.id}`).emit("annotation:deleted", payload);
  res.json(payload);
});

app.post("/api/rooms/:roomId/channels/:channel/annotations/:annotationId/replies", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  const result = addAnnotationReply(annotation, req.user, req.body);
  if (result.status) {
    return res.status(result.status).json({ message: result.message });
  }

  await writeDb(db);
  io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
  res.status(201).json({ annotation: result.annotation, reply: result.reply });
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
  db.annotations = db.annotations.filter((annotation) => annotation.roomId !== room.id);
  db.sessions = db.sessions.filter((session) => session.roomId !== room.id);
  db.coordinatePolls = db.coordinatePolls.filter((poll) => poll.roomId !== room.id);
  db.coordinateResponses = db.coordinateResponses.filter((response) => response.roomId !== room.id);
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

  const includeDeleted = req.query.includeDeleted === "true";
  const deletedOnly = req.query.deleted === "true";
  const roomResources = db.resources.filter((resource) => {
    if (resource.roomId !== room.id) return false;
    if (deletedOnly) return Boolean(resource.deletedAt);
    return includeDeleted || !resource.deletedAt;
  });
  let conversionStateChanged = false;
  for (const resource of roomResources) {
    if (await ensureOfficeResourceConversion(db, resource)) {
      conversionStateChanged = true;
    }
  }
  if (conversionStateChanged) {
    await writeDb(db);
  }

  const resources = roomResources
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
    metadata: buildResourceMetadata({
      room,
      title,
      sourceType: "url",
      url,
    }),
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

    await ensureRoomResourceFileMetadata(db, room);

    const uploadedPath = safeUploadPath(req.file.filename);
    if (req.body.purpose === "document-channel" && !isDocumentChannelUploadFile(req.file)) {
      fs.rmSync(uploadedPath, { force: true });
      return res.status(400).json({ message: documentChannelFileTypeMessage });
    }

    const contentHash = await hashUploadedFile(uploadedPath);
    const resourceType = detectResourceType(req.file.mimetype, req.file.originalname);
    const existingResource = db.resources.find(
      (resource) =>
        resource.roomId === room.id &&
        resource.type === "file" &&
        resource.contentHash &&
        resource.contentHash === contentHash,
    );

    if (existingResource) {
      // The new bytes are redundant, so remove only the temporary duplicate upload.
      fs.rmSync(uploadedPath, { force: true });
      const wasDeleted = Boolean(existingResource.deletedAt);
      let existingChanged = false;
      if (wasDeleted) {
        // Re-uploading an identical deleted file restores the canonical record
        // instead of creating a hidden duplicate with the same content hash.
        existingResource.deletedAt = "";
        existingResource.folder = normalizeFolder(req.body.folder);
        existingResource.updatedAt = new Date().toISOString();
        existingChanged = true;
      }
      if (await ensureOfficeResourceConversion(db, existingResource)) {
        existingChanged = true;
      }
      if (existingChanged) {
        await writeDb(db);
      }
      return res.status(200).json({
        resource: resourceDto(db, existingResource),
        deduplicated: true,
        restored: wasDeleted,
        message: "This file already exists in the room.",
      });
    }

    const title = String(req.body.title || req.file.originalname).trim();
    const resource = {
      id: createId("res"),
      roomId: room.id,
      uploaderId: req.user.id,
      type: "file",
      title,
      folder: normalizeFolder(req.body.folder),
      originalName: req.file.originalname,
      storageName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      contentHash,
      pdfPath: "",
      conversionStatus: resourceType === "docx" || resourceType === "pptx" ? "pending" : "not-needed",
      resourceType,
      metadata: buildResourceMetadata({
        room,
        title: req.file.originalname || title,
        sourceType: "file",
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
      }),
      url: `/uploads/${req.file.filename}`,
      createdAt: new Date().toISOString(),
    };

    db.resources.push(resource);
    await writeDb(db);

    if (resourceType === "docx" || resourceType === "pptx") {
      res.status(201).json({ resource: resourceDto(db, resource) });
      startResourcePdfConversion({
        resourceId: resource.id,
        roomId: room.id,
        storageName: resource.storageName,
      });
      return;
    }

    res.status(201).json({ resource: resourceDto(db, resource) });
  },
);

app.get("/api/resources/:resourceId/file", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find((candidate) => candidate.id === req.params.resourceId);

  if (!resource || resource.deletedAt || resource.type !== "file" || !resource.storageName) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!room) {
    return res.status(404).json({ message: "Resource not found." });
  }

  if (!isMember(room, req.user.id)) {
    return res.status(403).json({ message: "Join the room to access this area." });
  }

  const filePath = safeUploadPath(resource.storageName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Resource file not found." });
  }

  const filename =
    String(resource.originalName || resource.title || resource.storageName)
      .replace(/[\r\n"]/g, "")
      .trim() || "document";
  res.type(resource.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  return res.sendFile(filePath);
});

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

  resource.deletedAt = resource.deletedAt || new Date().toISOString();
  resource.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.status(204).end();
});

app.patch("/api/resources/:resourceId/restore", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!room || (room.ownerId !== req.user.id && resource.uploaderId !== req.user.id)) {
    return res.status(403).json({ message: "You cannot restore this resource." });
  }

  resource.deletedAt = "";
  resource.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ resource: resourceDto(db, resource) });
});

app.delete("/api/resources/:resourceId/permanent", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!room || (room.ownerId !== req.user.id && resource.uploaderId !== req.user.id)) {
    return res.status(403).json({ message: "You cannot permanently delete this resource." });
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

  const providerStatus = getBuddyProviderStatus();
  if (!providerStatus.available) {
    return res.json({
      ok: false,
      ...providerStatus,
      setupRequired: true,
      canConfigure: room.ownerId === req.user.id,
    });
  }

  try {
    const payload = await readChatbotHealthWithRetry(chatbotHealthTimeoutMs);
    res.json({
      ok: true,
      ...providerStatus,
      service: payload.message || "Intelligrate",
      setupRequired: false,
      canConfigure: room.ownerId === req.user.id,
    });
  } catch (error) {
    console.warn(`[buddy] Health check failed for ${room.id}: ${error.message}`);
    res.json({
      ok: false,
      available: false,
      code: "service_unavailable",
      provider: providerStatus.provider,
      providerLabel: providerStatus.providerLabel,
      message: "Intelligrate is not available yet. Start the chatbot service and try again.",
      setupRequired: true,
      canConfigure: room.ownerId === req.user.id,
    });
  }
});

app.post("/api/rooms/:roomId/buddy/title", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  if (!assertBuddyProviderAvailable(res)) return;

  const message = String(req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({ message: "Provide a message to title." });
  }

  try {
    const title = await generateBuddyTitle(message);
    res.json({ title });
  } catch (error) {
    console.warn(`[buddy] Title generation failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to generate an Intelligrate chat title.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/embed", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  if (!assertBuddyProviderAvailable(res)) return;

  try {
    // Manual sync should still respect the corpus fingerprint so Intelligrate
    // is embedded only when the room's supported files actually changed.
    res.json(await syncRoomResourcesWithChatbot(db, room));
  } catch (error) {
    console.warn(`[buddy] Resource sync failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to sync room resources with Intelligrate.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  if (!assertBuddyProviderAvailable(res)) return;

  try {
    const { messageChain, directResource, attachedResources } = resolveBuddyMessagePayload(
      db,
      room,
      req.body,
    );
    await syncRoomResourcesWithChatbot(db, room);
    console.info(
      `[buddy] Asking room ${room.id} with ${
        directResource
          ? directResource.title
          : attachedResources.length
            ? `${attachedResources.length} synced attachment(s)`
            : "corpus only"
      }`,
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
      message: error.message || "Unable to get a response from Intelligrate.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message/stream", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  if (!assertBuddyProviderAvailable(res)) return;

  try {
    const { messageChain, directResource, attachedResources } = resolveBuddyMessagePayload(
      db,
      room,
      req.body,
    );

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    res.flush?.();

    const writeSse = (event, data = "") => {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      const lines = String(payload).split(/\r?\n/);
      res.write(`event: ${event}\n${lines.map((line) => `data: ${line}`).join("\n")}\n\n`);
      res.flush?.();
    };

    await syncRoomResourcesWithChatbot(db, room);

    console.info(
      `[buddy] Streaming room ${room.id} with ${
        directResource
          ? directResource.title
          : attachedResources.length
            ? `${attachedResources.length} synced attachment(s)`
            : "corpus only"
      }`,
    );
    const response = await streamChatbot({
      messageChain,
      roomId: room.id,
      resource: directResource,
    });

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
      message: error.message || "Unable to stream a response from Intelligrate.",
    });
  }
});

app.get("/api/rooms/:roomId/sessions", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const sessions = db.sessions
    .filter((session) => session.roomId === room.id)
    .filter((session) => isSessionVisibleToUser(session, req.user.id))
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
  const startsAtDate = new Date(startsAt);
  const endsAt = normalizeOptionalIso(req.body.endsAt);
  const kind = normalizeSessionKind(req.body.kind);
  const visibility = normalizeSessionVisibility(req.body.visibility);
  const color = normalizeSessionColor(req.body.color);

  if (!title || Number.isNaN(startsAtDate.getTime())) {
    return res.status(400).json({ message: "Event title and date/time are required." });
  }

  if (endsAt && Date.parse(endsAt) <= startsAtDate.getTime()) {
    return res.status(400).json({ message: "End time must be after the start time." });
  }

  const coordinatePollId = String(req.body.coordinatePollId || "").trim();
  const coordinatePoll = coordinatePollId
    ? db.coordinatePolls.find((poll) => poll.id === coordinatePollId && poll.roomId === room.id)
    : null;
  const allDay = Boolean(req.body.allDay);

  if (coordinatePollId && !coordinatePoll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (coordinatePollId && room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the owner can schedule a meetup window." });
  }

  const session = {
    id: createId("ses"),
    roomId: room.id,
    createdBy: req.user.id,
    title: title.slice(0, 140),
    agenda: String(req.body.agenda || "").trim(),
    startsAt: startsAtDate.toISOString(),
    endsAt,
    kind,
    visibility,
    location: String(req.body.location || "").trim().slice(0, 160),
    source: "manual",
    sourceId: "",
    metadata: {
      ...(coordinatePollId ? { coordinatePollId } : {}),
      ...(allDay ? { allDay: true } : {}),
      ...(color ? { color } : {}),
    },
    createdAt: new Date().toISOString(),
  };

  db.sessions.push(session);
  if (coordinatePoll) {
    coordinatePoll.scheduledSessionId = session.id;
    coordinatePoll.updatedAt = session.createdAt;
  }
  await writeDb(db);
  res.status(201).json({ session: sessionDto(db, session) });
});

app.get("/api/rooms/:roomId/coordinate", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  res.json(coordinateDto(db, room));
});

app.put("/api/rooms/:roomId/coordinate/poll", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const rangeStart = normalizeOptionalIso(req.body.rangeStart);
  const rangeEnd = normalizeOptionalIso(req.body.rangeEnd);
  const slotMinutes = Math.min(180, Math.max(15, Number(req.body.slotMinutes) || 60));
  const dayStartMinutes = normalizeMinuteOfDay(req.body.dayStartMinutes, 9 * 60);
  const dayEndMinutes = normalizeMinuteOfDay(req.body.dayEndMinutes, 17 * 60);

  if (!rangeStart || !rangeEnd || Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
    return res.status(400).json({ message: "Choose a valid Coordinate date range." });
  }

  if (dayEndMinutes <= dayStartMinutes) {
    return res.status(400).json({ message: "Meetup window end time must be after the start time." });
  }

  const selectedDates = normalizeSelectedDates(req.body.selectedDates, rangeStart, rangeEnd);
  const now = new Date().toISOString();
  const pollId = String(req.body.pollId || "").trim();
  const existingPoll = pollId
    ? db.coordinatePolls.find((poll) => poll.id === pollId && poll.roomId === room.id)
    : null;

  if (pollId && !existingPoll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (existingPoll?.scheduledSessionId) {
    return res.status(409).json({ message: "Scheduled meetup windows are locked. Delete the scheduled event first to reopen it." });
  }

  if (existingPoll) {
    existingPoll.title = String(req.body.title || "Group availability").trim().slice(0, 140);
    existingPoll.rangeStart = rangeStart;
    existingPoll.rangeEnd = rangeEnd;
    existingPoll.slotMinutes = slotMinutes;
    existingPoll.dayStartMinutes = dayStartMinutes;
    existingPoll.dayEndMinutes = dayEndMinutes;
    existingPoll.selectedDates = selectedDates;
    existingPoll.timezone = String(req.body.timezone || "Asia/Singapore").trim().slice(0, 80);
    existingPoll.updatedAt = now;
  } else {
    db.coordinatePolls.push({
      id: createId("cop"),
      roomId: room.id,
      createdBy: req.user.id,
      title: String(req.body.title || "Group availability").trim().slice(0, 140),
      rangeStart,
      rangeEnd,
      slotMinutes,
      dayStartMinutes,
      dayEndMinutes,
      selectedDates,
      timezone: String(req.body.timezone || "Asia/Singapore").trim().slice(0, 80),
      scheduledSessionId: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeDb(db);
  res.json(coordinateDto(db, room));
});

app.delete("/api/rooms/:roomId/coordinate/poll/:pollId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const poll = db.coordinatePolls.find((candidate) => candidate.id === req.params.pollId && candidate.roomId === room.id);
  if (!poll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (poll.scheduledSessionId) {
    return res.status(409).json({ message: "Delete the scheduled calendar event before deleting this meetup window." });
  }

  db.coordinatePolls = db.coordinatePolls.filter((candidate) => candidate.id !== poll.id);
  db.coordinateResponses = db.coordinateResponses.filter((response) => response.pollId !== poll.id);
  await writeDb(db);
  res.json(coordinateDto(db, room));
});

app.put("/api/rooms/:roomId/coordinate/availability", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const poll = db.coordinatePolls.find(
    (candidate) => candidate.id === req.body.pollId && candidate.roomId === room.id,
  );

  if (!poll) {
    return res.status(404).json({ message: "Create a Coordinate date range before saving availability." });
  }

  if (poll.scheduledSessionId) {
    return res.status(409).json({ message: "This meetup window has already been scheduled." });
  }

  const slots = normalizeAvailabilitySlots(req.body.slots).filter((slot) => availabilitySlotAllowedForPoll(slot, poll));
  const now = new Date().toISOString();
  const existingResponse = db.coordinateResponses.find(
    (response) => response.pollId === poll.id && response.userId === req.user.id,
  );

  if (!slots.length) {
    db.coordinateResponses = db.coordinateResponses.filter(
      (response) => !(response.pollId === poll.id && response.userId === req.user.id),
    );
    poll.updatedAt = now;
    await writeDb(db);
    return res.json(coordinateDto(db, room));
  }

  if (existingResponse) {
    existingResponse.slots = slots;
    existingResponse.updatedAt = now;
  } else {
    db.coordinateResponses.push({
      id: createId("cor"),
      pollId: poll.id,
      roomId: room.id,
      userId: req.user.id,
      slots,
      updatedAt: now,
    });
  }

  poll.updatedAt = now;
  await writeDb(db);
  res.json(coordinateDto(db, room));
});

app.post("/api/rooms/:roomId/integrations/canvas/courses", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const host = normalizeCanvasHost(req.body.host);
    const accessToken = String(req.body.accessToken || "").trim();
    if (!accessToken) {
      return res.status(400).json({ message: "Canvas access token is required." });
    }

    const payload = await fetchCanvasJson(host, accessToken, "/api/v1/courses", {
      enrollment_state: "active",
      per_page: 100,
    });
    const courses = (Array.isArray(payload) ? payload : [])
      .map((course) => ({
        id: String(course.id || ""),
        name: String(course.name || course.course_code || "Untitled course"),
        courseCode: String(course.course_code || ""),
        startAt: course.start_at || "",
        endAt: course.end_at || "",
      }))
      .filter((course) => course.id);

    res.json({ courses });
  } catch (err) {
    res.status(err.status || 502).json({ message: err.message || "Unable to connect to Canvas." });
  }
});

app.post("/api/rooms/:roomId/integrations/canvas/import", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const host = normalizeCanvasHost(req.body.host);
    const accessToken = String(req.body.accessToken || "").trim();
    const courseId = String(req.body.courseId || "").trim();
    const courseName = String(req.body.courseName || room.moduleCode || "Canvas").trim().slice(0, 140);

    if (!accessToken || !courseId) {
      return res.status(400).json({ message: "Canvas access token and course are required." });
    }

    const assignments = await fetchCanvasJson(
      host,
      accessToken,
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`,
      {
        per_page: 100,
      },
    );
    const existingSourceIds = new Set(
      db.sessions
        .filter((session) => session.roomId === room.id && session.source === "canvas")
        .map((session) => session.sourceId),
    );
    const now = new Date().toISOString();
    const importedSessions = [];

    (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
      const dueAt = normalizeOptionalIso(assignment?.due_at);
      const sourceId = `${courseId}:${assignment?.id || assignment?.html_url || assignment?.name || ""}`;
      if (!dueAt || existingSourceIds.has(sourceId)) return;

      const session = {
        id: createId("ses"),
        roomId: room.id,
        createdBy: req.user.id,
        title: String(assignment?.name || "Canvas deadline").trim().slice(0, 140),
        agenda: stripHtml(assignment?.description),
        startsAt: dueAt,
        endsAt: "",
        kind: "deadline",
        visibility: "room",
        location: courseName,
        source: "canvas",
        sourceId,
        metadata: {
          canvasHost: host,
          courseId,
          courseName,
          htmlUrl: assignment?.html_url || "",
        },
        createdAt: now,
      };

      db.sessions.push(session);
      importedSessions.push(session);
      existingSourceIds.add(sourceId);
    });

    room.integrations = {
      ...(room.integrations || {}),
      canvas: {
        connected: true,
        host,
        courseId,
        courseName,
        courseCode: String(req.body.courseCode || "").trim().slice(0, 80),
        connectedAt: room.integrations?.canvas?.connectedAt || now,
        lastSyncedAt: now,
        importedDeadlineCount:
          Number(room.integrations?.canvas?.importedDeadlineCount || 0) + importedSessions.length,
      },
    };
    room.updatedAt = now;

    await writeDb(db);
    res.status(201).json({
      imported: importedSessions.length,
      sessions: importedSessions.map((session) => sessionDto(db, session)),
      room: roomDto(db, room, req.user.id),
    });
  } catch (err) {
    res.status(err.status || 502).json({ message: err.message || "Unable to import Canvas deadlines." });
  }
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
  db.coordinatePolls = (db.coordinatePolls || []).map((poll) =>
    poll.scheduledSessionId === session.id ? { ...poll, scheduledSessionId: "", updatedAt: new Date().toISOString() } : poll,
  );
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

  socket.on("room:activity:set", async (payload, ack) => {
    try {
      const db = await readDb();
      const existingRoomActivity = findSocketRoomActivity(socket);
      const requestedRoomId = payload?.roomId || existingRoomActivity?.roomId;
      const room = db.rooms.find((candidate) => candidate.id === requestedRoomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before updating activity." });
        return;
      }

      const roomActivity = getRoomActivity(room.id);
      const previousActivity =
        existingRoomActivity?.roomId === room.id
          ? existingRoomActivity.activity
          : roomActivity.get(socket.user.id);
      const tabId = normalizeRoomActivityTab(payload?.tabId) || previousActivity?.tabId;
      if (!tabId) {
        ack?.({ ok: false, message: "Room activity tab is invalid." });
        return;
      }

      const profileStatus =
        payload?.profileStatus === undefined
          ? previousActivity?.profileStatus || "online"
          : normalizeProfileStatus(payload?.profileStatus);
      const hasDocumentChannel = Object.prototype.hasOwnProperty.call(payload || {}, "documentChannel");
      const hasDocumentPage = Object.prototype.hasOwnProperty.call(payload || {}, "documentPage");
      const rawDocumentChannel = String(payload?.documentChannel || "").trim();
      const documentChannel = hasDocumentChannel
        ? rawDocumentChannel
          ? normalizeChannel(rawDocumentChannel)
          : ""
        : previousActivity?.documentChannel;
      const documentPage = hasDocumentPage
        ? payload?.documentPage == null || payload?.documentPage === ""
          ? null
          : normalizeDocumentPage(payload?.documentPage, previousActivity?.documentPage)
        : previousActivity?.documentPage;
      const nextActivity = {
        ...previousActivity,
        profileStatus,
        roomId: room.id,
        userId: socket.user.id,
        user: publicUser(socket.user),
        tabId,
        socketId: socket.id,
        updatedAt: new Date().toISOString(),
      };

      if (tabId === "chat" && documentChannel && Number.isFinite(documentPage)) {
        nextActivity.documentChannel = documentChannel;
        nextActivity.documentPage = documentPage;
      } else {
        delete nextActivity.documentChannel;
        delete nextActivity.documentPage;
      }

      roomActivity.set(socket.user.id, nextActivity);

      socket.join(`room:${room.id}`);
      updateSocketSpaceProfileStatus(socket, room.id, profileStatus);
      updateSocketMeetingProfileStatus(socket, room.id, profileStatus);
      const members = serializeRoomActivity(room.id);
      io.to(`room:${room.id}`).emit("room:activity:state", {
        roomId: room.id,
        members,
      });
      emitMeetingSummary(room.id, socket);
      ack?.({ ok: true, members, meetings: serializeMeetingSummary(room.id) });
    } catch {
      ack?.({ ok: false, message: "Unable to update room activity right now." });
    }
  });

  socket.on("space:join", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before entering Limeets." });
        return;
      }

      const position = normalizeSpacePosition(payload?.position, DEFAULT_SPACE_TILE);
      const profileStatus = normalizeProfileStatus(payload?.profileStatus);
      const roomPresence = getSpacePresence(room.id);
      const presence = {
        presenceId: socket.id,
        profileStatus,
        roomId: room.id,
        userId: socket.user.id,
        user: publicUser(socket.user),
        position,
        socketId: socket.id,
        updatedAt: new Date().toISOString(),
      };

      socket.join(getSpaceRoomKey(room.id));
      roomPresence.set(socket.id, presence);

      const users = serializeSpacePresence(room.id);
      io.to(getSpaceRoomKey(room.id)).emit("space:state", {
        roomId: room.id,
        users,
      });
      ack?.({ ok: true, users, meetings: serializeMeetingSummary(room.id) });
    } catch {
      ack?.({ ok: false, message: "Unable to enter Limeets right now." });
    }
  });

  socket.on("space:move", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before moving in Limeets." });
        return;
      }

      const position = normalizeSpacePosition(payload?.position);
      if (!position) {
        ack?.({ ok: false, message: "Avatar position is invalid." });
        return;
      }

      const roomPresence = getSpacePresence(room.id);
      const currentPresence = roomPresence.get(socket.id);
      if (!currentPresence || currentPresence.socketId !== socket.id) {
        ack?.({ ok: false, message: "Enter Limeets before moving." });
        return;
      }
      const profileStatus = normalizeProfileStatus(payload?.profileStatus ?? currentPresence.profileStatus);

      const presence = {
        ...currentPresence,
        profileStatus,
        position,
        updatedAt: new Date().toISOString(),
      };

      roomPresence.set(socket.id, presence);
      if (profileStatus === "invisible") {
        io.to(getSpaceRoomKey(room.id)).emit("space:state", {
          roomId: room.id,
          users: serializeSpacePresence(room.id),
        });
      } else {
        socket.to(getSpaceRoomKey(room.id)).emit("space:user-moved", {
          presenceId: socket.id,
          profileStatus,
          roomId: room.id,
          userId: socket.user.id,
          user: publicUser(socket.user),
          position,
        });
      }
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to move in Limeets right now." });
    }
  });

  socket.on("space:leave", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Study Space room not found." });
        return;
      }

      removeSocketSpacePresence(socket, room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to leave Limeets right now." });
    }
  });

  socket.on("meeting:join", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before entering a Meeting Area." });
        return;
      }

      if (!areaId) {
        ack?.({ ok: false, message: "Meeting Area is invalid." });
        return;
      }

      const profileStatus = normalizeProfileStatus(payload?.profileStatus);
      removeSocketMeetingPresence(socket, room.id);

      const areaPresence = getMeetingAreaPresence(room.id, areaId);
      const presence = {
        roomId: room.id,
        areaId,
        profileStatus,
        userId: socket.user.id,
        user: publicUser(socket.user),
        media: normalizeMeetingMedia(payload?.media),
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
      };

      socket.join(getMeetingRoomKey(room.id, areaId));
      areaPresence.set(socket.user.id, presence);

      const users = serializeMeetingPresence(room.id, areaId);
      const { socketId: _socketId, ...publicPresence } = presence;
      if (profileStatus !== "invisible") {
        socket.to(getMeetingRoomKey(room.id, areaId)).emit("meeting:user-joined", {
          ...publicPresence,
        });
      }
      emitMeetingState(room.id, areaId);
      emitMeetingSummary(room.id);
      ack?.({ ok: true, users });
    } catch {
      ack?.({ ok: false, message: "Unable to join the Meeting Area right now." });
    }
  });

  socket.on("meeting:leave", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Meeting Area room not found." });
        return;
      }

      removeSocketMeetingPresence(socket, room.id, areaId);
      emitMeetingSummary(room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to leave the Meeting Area right now." });
    }
  });

  socket.on("meeting:media-state", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id) || !areaId) {
        ack?.({ ok: false, message: "Meeting Area is invalid." });
        return;
      }

      const areaPresence = meetingPresenceByRoom.get(room.id)?.get(areaId);
      const currentPresence = areaPresence?.get(socket.user.id);
      if (!currentPresence || currentPresence.socketId !== socket.id) {
        ack?.({ ok: false, message: "Join the Meeting Area before updating media." });
        return;
      }

      const media = normalizeMeetingMedia(payload?.media);
      areaPresence.set(socket.user.id, {
        ...currentPresence,
        media,
      });

      io.to(getMeetingRoomKey(room.id, areaId)).emit("meeting:user-media", {
        roomId: room.id,
        areaId,
        userId: socket.user.id,
        media,
      });
      emitMeetingSummary(room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to update media state right now." });
    }
  });

  socket.on("meeting:signal", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);
      const targetUserId = String(payload?.targetUserId || "").trim();
      const signal = normalizeMeetingSignal(payload?.signal);

      if (!room || !isMember(room, socket.user.id) || !areaId || !targetUserId || !signal) {
        ack?.({ ok: false, message: "Meeting signal is invalid." });
        return;
      }

      const areaPresence = meetingPresenceByRoom.get(room.id)?.get(areaId);
      const sender = areaPresence?.get(socket.user.id);
      const target = areaPresence?.get(targetUserId);
      if (!sender || sender.socketId !== socket.id || !target) {
        ack?.({ ok: false, message: "Meeting participant is unavailable." });
        return;
      }

      io.to(target.socketId).emit("meeting:signal", {
        roomId: room.id,
        areaId,
        fromUserId: socket.user.id,
        fromUser: publicUser(socket.user),
        signal,
      });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to relay meeting signal right now." });
    }
  });

  socket.on("annotation:create", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before annotating documents." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = createAnnotationRecord(room, channel, socket.user, payload);
      db.annotations.push(annotation);
      await writeDb(db);

      io.to(`room:${room.id}`).emit("annotation:new", annotation);
      ack?.({ ok: true, annotation });
    } catch {
      ack?.({ ok: false, message: "Unable to create the annotation right now." });
    }
  });

  socket.on("annotation:update", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before updating annotations." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = findAnnotationForChannel(db, room, channel, payload?.annotationId);
      if (!annotation) {
        ack?.({ ok: false, message: "Annotation not found." });
        return;
      }

      const result = updateAnnotationRecord(annotation, socket.user, payload);
      if (result.status) {
        ack?.({ ok: false, message: result.message });
        return;
      }

      await writeDb(db);
      io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
      ack?.({ ok: true, annotation: result.annotation });
    } catch {
      ack?.({ ok: false, message: "Unable to update the annotation right now." });
    }
  });

  socket.on("annotation:delete", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before deleting annotations." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = findAnnotationForChannel(db, room, channel, payload?.annotationId);
      if (!annotation) {
        ack?.({ ok: false, message: "Annotation not found." });
        return;
      }

      if (getAnnotationAuthorId(annotation) !== socket.user.id && room.ownerId !== socket.user.id) {
        ack?.({ ok: false, message: "Only the annotation author or room owner can delete it." });
        return;
      }

      db.annotations = db.annotations.filter((candidate) => candidate.id !== annotation.id);
      await writeDb(db);

      const deleted = { id: annotation.id, channel: channel.name };
      io.to(`room:${room.id}`).emit("annotation:deleted", deleted);
      ack?.({ ok: true, ...deleted });
    } catch {
      ack?.({ ok: false, message: "Unable to delete the annotation right now." });
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

  socket.on("message:update", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const message = db.messages.find((candidate) => candidate.id === payload?.messageId);

      if (!room || !message || message.roomId !== room.id || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Message not found." });
        return;
      }

      if (message.senderId !== socket.user.id) {
        ack?.({ ok: false, message: "You can only edit your own messages." });
        return;
      }

      const body = String(payload?.body || "").trim();
      if (!body) {
        ack?.({ ok: false, message: "Message cannot be empty." });
        return;
      }

      message.body = body.slice(0, 2000);
      message.updatedAt = new Date().toISOString();
      await writeDb(db);

      const dto = messageDto(db, message);
      io.to(`room:${room.id}`).emit("message:updated", dto);
      ack?.({ ok: true, message: dto });
    } catch {
      ack?.({ ok: false, message: "Unable to edit the message right now." });
    }
  });

  socket.on("message:delete", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const message = db.messages.find((candidate) => candidate.id === payload?.messageId);

      if (!room || !message || message.roomId !== room.id || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Message not found." });
        return;
      }

      if (message.senderId !== socket.user.id) {
        ack?.({ ok: false, message: "You can only delete your own messages." });
        return;
      }

      db.messages = db.messages.filter((candidate) => candidate.id !== message.id);
      await writeDb(db);

      io.to(`room:${room.id}`).emit("message:deleted", {
        id: message.id,
        roomId: room.id,
      });
      ack?.({ ok: true, id: message.id });
    } catch {
      ack?.({ ok: false, message: "Unable to delete the message right now." });
    }
  });

  socket.on("disconnect", () => {
    removeSocketSpacePresence(socket);
    removeSocketRoomActivity(socket);
    removeSocketMeetingPresence(socket);
  });
});

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)|socket\.io(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Something went wrong." });
});

await initDb();

server.listen(port, () => {
  console.info(
    `Diffriendtiate API running on http://127.0.0.1:${port} using ${storageMode()} storage`,
  );
  void warmChatbotOnStartup();
});
