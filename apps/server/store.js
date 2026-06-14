import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");
const databaseUrl = process.env.DATABASE_URL || "";

const initialDb = {
  users: [],
  rooms: [],
  messages: [],
  resources: [],
  sessions: [],
  buddyThreads: [],
};

// DATABASE_URL is the switch between quick local JSON storage and deployed PostgreSQL.
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl:
        process.env.DATABASE_SSL === "true" ||
        process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: false }
          : false,
    })
  : null;

export function storageMode() {
  return pool ? "postgres" : "json";
}

function normalizeDb(db) {
  return {
    users: db.users || [],
    rooms: (db.rooms || []).map((room) => ({
      ...room,
      channels: Array.isArray(room.channels) && room.channels.length
        ? room.channels
        : ["general"],
    })),
    messages: (db.messages || []).map((message) => ({
      ...message,
      channel: message.channel || "general",
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
    })),
    resources: (db.resources || []).map((resource) => ({
      ...resource,
      folder: resource.folder || "General",
    })),
    sessions: db.sessions || [],
    buddyThreads: (db.buddyThreads || []).map((thread) => ({
      ...thread,
      visibility: thread.visibility === "public" ? "public" : "private",
      messages: Array.isArray(thread.messages) ? thread.messages : [],
    })),
  };
}

function toIso(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function readJsonDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
  }

  const rawDb = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  return normalizeDb(rawDb.trim() ? JSON.parse(rawDb) : initialDb);
}

function writeJsonDb(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(normalizeDb(db), null, 2));
}

async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module_code TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
      tags TEXT[] NOT NULL DEFAULT '{}',
      theme TEXT NOT NULL DEFAULT 'twilight',
      background TEXT NOT NULL DEFAULT 'aurora',
      channels TEXT[] NOT NULL DEFAULT '{general}',
      password_hash TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invite_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'general',
      body TEXT NOT NULL,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('url', 'file')),
      title TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT 'General',
      original_name TEXT,
      storage_name TEXT,
      mime_type TEXT,
      size INTEGER,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agenda TEXT NOT NULL DEFAULT '',
      starts_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buddy_threads (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rooms_visibility ON rooms(visibility);
    CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_resources_room_created ON resources(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_room_starts ON sessions(room_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_buddy_threads_room_updated ON buddy_threads(room_id, updated_at);
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS background TEXT NOT NULL DEFAULT 'aurora'
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS password_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT '{general}'
  `);

  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'general'
  `);

  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'General'
  `);
}

async function seedPostgresFromJsonIfEmpty() {
  if (!fs.existsSync(dbPath)) return;

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0]?.count > 0) return;

  const db = readJsonDb();
  if (
    db.users.length ||
    db.rooms.length ||
    db.messages.length ||
    db.resources.length ||
    db.sessions.length ||
    db.buddyThreads.length
  ) {
    await writePostgresDb(db);
  }
}

export async function initDb() {
  if (!pool) {
    fs.mkdirSync(dataDir, { recursive: true });
    return;
  }

  // The server owns its minimal schema so a fresh Compose stack is ready on first boot.
  await initPostgres();
  await seedPostgresFromJsonIfEmpty();
}

export async function readDb() {
  if (!pool) return readJsonDb();

  const [users, rooms, messages, resources, sessions, buddyThreads] = await Promise.all([
    pool.query(`
      SELECT
        id,
        name,
        email,
        password_hash AS "passwordHash",
        created_at AS "createdAt"
      FROM users
      ORDER BY created_at ASC
    `),
    pool.query(`
      SELECT
        r.id,
        r.name,
        r.module_code AS "moduleCode",
        r.description,
        r.visibility,
        r.tags,
        r.theme,
        r.background,
        r.channels,
        r.password_hash AS "passwordHash",
        r.owner_id AS "ownerId",
        r.invite_code AS "inviteCode",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        COALESCE(
          ARRAY_AGG(rm.user_id ORDER BY rm.joined_at)
            FILTER (WHERE rm.user_id IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS "memberIds"
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        sender_id AS "senderId",
        channel,
        body,
        attachments,
        created_at AS "createdAt"
      FROM messages
      ORDER BY created_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        uploader_id AS "uploaderId",
        type,
        title,
        folder,
        original_name AS "originalName",
        storage_name AS "storageName",
        mime_type AS "mimeType",
        size,
        url,
        created_at AS "createdAt"
      FROM resources
      ORDER BY created_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        created_by AS "createdBy",
        title,
        agenda,
        starts_at AS "startsAt",
        created_at AS "createdAt"
      FROM sessions
      ORDER BY starts_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        owner_id AS "ownerId",
        title,
        visibility,
        messages,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM buddy_threads
      ORDER BY updated_at DESC
    `),
  ]);

  return normalizeDb({
    users: users.rows.map((user) => ({
      ...user,
      createdAt: toIso(user.createdAt),
    })),
    rooms: rooms.rows.map((room) => ({
      ...room,
      tags: room.tags || [],
      memberIds: room.memberIds || [],
      createdAt: toIso(room.createdAt),
      updatedAt: toIso(room.updatedAt),
    })),
    messages: messages.rows.map((message) => ({
      ...message,
      createdAt: toIso(message.createdAt),
    })),
    resources: resources.rows.map((resource) => ({
      ...resource,
      createdAt: toIso(resource.createdAt),
    })),
    sessions: sessions.rows.map((session) => ({
      ...session,
      startsAt: toIso(session.startsAt),
      createdAt: toIso(session.createdAt),
    })),
    buddyThreads: buddyThreads.rows.map((thread) => ({
      ...thread,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      createdAt: toIso(thread.createdAt),
      updatedAt: toIso(thread.updatedAt),
    })),
  });
}

export async function writeDb(db) {
  if (!pool) {
    writeJsonDb(db);
    return;
  }

  await writePostgresDb(normalizeDb(db));
}

async function writePostgresDb(db) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Keep writes atomic while the route layer works with the normalized app snapshot.
    await client.query("DELETE FROM buddy_threads");
    await client.query("DELETE FROM sessions");
    await client.query("DELETE FROM resources");
    await client.query("DELETE FROM messages");
    await client.query("DELETE FROM room_members");
    await client.query("DELETE FROM rooms");
    await client.query("DELETE FROM users");

    for (const user of db.users) {
      await client.query(
        `
          INSERT INTO users (id, name, email, password_hash, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [user.id, user.name, user.email, user.passwordHash, user.createdAt],
      );
    }

    for (const room of db.rooms) {
      await client.query(
        `
          INSERT INTO rooms (
            id, name, module_code, description, visibility, tags, theme,
            background, channels, password_hash, owner_id, invite_code, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          room.id,
          room.name,
          room.moduleCode,
          room.description || "",
          room.visibility,
          room.tags || [],
          room.theme || "twilight",
          room.background || "aurora",
          room.channels?.length ? room.channels : ["general"],
          room.passwordHash || null,
          room.ownerId,
          room.inviteCode,
          room.createdAt,
          room.updatedAt,
        ],
      );

      for (const userId of room.memberIds || []) {
        await client.query(
          `
            INSERT INTO room_members (room_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [room.id, userId],
        );
      }
    }

    for (const message of db.messages) {
      await client.query(
        `
          INSERT INTO messages (id, room_id, sender_id, channel, body, attachments, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          message.id,
          message.roomId,
          message.senderId,
          message.channel || "general",
          message.body,
          JSON.stringify(message.attachments || []),
          message.createdAt,
        ],
      );
    }

    for (const resource of db.resources) {
      await client.query(
        `
          INSERT INTO resources (
            id, room_id, uploader_id, type, title, folder, original_name, storage_name,
            mime_type, size, url, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          resource.id,
          resource.roomId,
          resource.uploaderId,
          resource.type,
          resource.title,
          resource.folder || "General",
          resource.originalName || null,
          resource.storageName || null,
          resource.mimeType || null,
          resource.size || null,
          resource.url,
          resource.createdAt,
        ],
      );
    }

    for (const session of db.sessions) {
      await client.query(
        `
          INSERT INTO sessions (
            id, room_id, created_by, title, agenda, starts_at, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          session.id,
          session.roomId,
          session.createdBy,
          session.title,
          session.agenda || "",
          session.startsAt,
          session.createdAt,
        ],
      );
    }

    for (const thread of db.buddyThreads || []) {
      await client.query(
        `
          INSERT INTO buddy_threads (
            id, room_id, owner_id, title, visibility, messages, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          thread.id,
          thread.roomId,
          thread.ownerId,
          thread.title,
          thread.visibility === "public" ? "public" : "private",
          JSON.stringify(thread.messages || []),
          thread.createdAt,
          thread.updatedAt,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
