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

  return {
    id: room.id,
    name: room.name,
    moduleCode: room.moduleCode,
    description: room.description,
    visibility: room.visibility,
    tags: room.tags || [],
    theme: room.theme,
    inviteCode: isMember(room, userId) ? room.inviteCode : null,
    owner: publicUser(owner),
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
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
  };
}

function resourceDto(db, resource) {
  return {
    ...resource,
    uploader: publicUser(db.users.find((user) => user.id === resource.uploaderId)),
  };
}

function sessionDto(db, session) {
  return {
    ...session,
    creator: publicUser(db.users.find((user) => user.id === session.createdBy)),
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
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

  if (!name || !moduleCode) {
    return res.status(400).json({ message: "Room name and module code are required." });
  }

  const room = {
    id: createId("room"),
    name,
    moduleCode,
    description: String(req.body.description || "").trim(),
    visibility: req.body.visibility === "private" ? "private" : "public",
    tags: normalizeTags(req.body.tags),
    theme: String(req.body.theme || "twilight"),
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
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  io.to(`room:${room.id}`).emit("room:updated", roomDto(db, room, req.user.id));
  res.json({ room: roomDto(db, room, req.user.id) });
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
  await writeDb(db);

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
  if (!body) {
    return res.status(400).json({ message: "Message cannot be empty." });
  }

  const message = {
    id: createId("msg"),
    roomId: room.id,
    senderId: req.user.id,
    body: body.slice(0, 2000),
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

  if (!title || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ message: "Provide a title and a valid http(s) URL." });
  }

  const resource = {
    id: createId("res"),
    roomId: room.id,
    uploaderId: req.user.id,
    type: "url",
    title,
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
      if (!body) {
        ack?.({ ok: false, message: "Message cannot be empty." });
        return;
      }

      const message = {
        id: createId("msg"),
        roomId: room.id,
        senderId: socket.user.id,
        body: body.slice(0, 2000),
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
