import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const serverRootDir = path.basename(runtimeDir) === "dist" ? path.dirname(runtimeDir) : runtimeDir;
const dataDir = process.env.DIFFRIENDTIATE_DATA_DIR || path.join(serverRootDir, "data");
const dbPath = path.join(dataDir, "db.json");
const databaseUrl = process.env.DATABASE_URL || "";

const initialDb = {
  users: [],
  rooms: [],
  messages: [],
  resources: [],
  annotations: [],
  sessions: [],
  coordinatePolls: [],
  coordinateResponses: [],
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

const DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID = "default-text-channels";

function normalizeStoredChannelName(value) {
  const name =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? value.name
        : "";

  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

function normalizeStoredChannelLayout(layout, channels = []) {
  const channelNames = [];
  const channelSet = new Set();

  for (const channel of ["general", ...channels]) {
    const name = normalizeStoredChannelName(channel);
    if (!name || channelSet.has(name)) continue;
    channelSet.add(name);
    channelNames.push(name);
  }

  const seenChannels = new Set();
  const categories = Array.isArray(layout)
    ? layout
        .filter((category) => category && typeof category === "object" && category.id && category.name)
        .map((category) => ({
          id: String(category.id).slice(0, 80),
          name: String(category.name).trim().slice(0, 80) || "Text Channels",
          channels: Array.isArray(category.channels)
            ? category.channels
                .map(normalizeStoredChannelName)
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

export function storageMode() {
  return pool ? "postgres" : "json";
}

/**
 * Normalizes persisted records into the shape expected by the rest of the server.
 * This lets older JSON files continue working after new fields are introduced.
 */
function normalizeDb(db) {
  return {
    users: (db.users || []).map((user) => ({
      ...user,
      avatarPreset:
        user.avatarPreset && typeof user.avatarPreset === "object" && !Array.isArray(user.avatarPreset)
          ? user.avatarPreset
          : null,
      avatarUrl: user.avatarUrl || "",
      authProviders:
        user.authProviders && typeof user.authProviders === "object" && !Array.isArray(user.authProviders)
          ? user.authProviders
          : {},
      emailVerified: user.emailVerified === false ? false : true,
      emailVerification:
        user.emailVerification && typeof user.emailVerification === "object" && !Array.isArray(user.emailVerification)
          ? user.emailVerification
          : null,
      passwordReset:
        user.passwordReset && typeof user.passwordReset === "object" && !Array.isArray(user.passwordReset)
          ? user.passwordReset
          : null,
    })),
    rooms: (db.rooms || []).map((room) => {
      const channels = (Array.isArray(room.channels) ? room.channels : ["general"]).map((channel) =>
        typeof channel === "string"
          ? { name: channel, type: "text", resourceId: "" }
          : {
              name: String(channel?.name || "general"),
              type: channel?.type === "document" ? "document" : "text",
              resourceId: String(channel?.resourceId || ""),
            },
      );

      return {
        ...room,
        academicTerm: room.academicTerm || "",
        roomLogo: room.roomLogo || "",
        worldConfig:
          room.worldConfig && typeof room.worldConfig === "object" && !Array.isArray(room.worldConfig)
            ? room.worldConfig
            : {},
        integrations:
          room.integrations && typeof room.integrations === "object" && !Array.isArray(room.integrations)
            ? room.integrations
            : {},
        resourceSyncFingerprint: room.resourceSyncFingerprint || "",
        resourceSyncUpdatedAt: room.resourceSyncUpdatedAt || "",
        channels,
        channelLayout: normalizeStoredChannelLayout(room.channelLayout, channels),
      };
    }),
    messages: (db.messages || []).map((message) => ({
      ...message,
      channel: message.channel || "general",
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
    })),
    resources: (db.resources || []).map((resource) => ({
      ...resource,
      folder: resource.folder || "General",
      contentHash: resource.contentHash || "",
      updatedAt: resource.updatedAt || resource.createdAt || new Date().toISOString(),
      originalFolder: resource.originalFolder || "",
      deletedById: resource.deletedById || "",
      deletedAt: resource.deletedAt || "",
      pdfPath: String(resource.pdfPath || ""),
      pdfConversionVersion: String(resource.pdfConversionVersion || ""),
      conversionStatus: ["pending", "done", "failed", "not-needed"].includes(resource.conversionStatus)
        ? resource.conversionStatus
        : "not-needed",
      resourceType: ["pdf", "docx", "pptx", "image", "other"].includes(resource.resourceType)
        ? resource.resourceType
        : "other",
      metadata:
        resource.metadata && typeof resource.metadata === "object" && !Array.isArray(resource.metadata)
          ? resource.metadata
          : {},
    })),
    annotations: (db.annotations || []).map((annotation) => ({
      id: annotation.id,
      roomId: annotation.roomId,
      channel: annotation.channel,
      resourceId: annotation.resourceId,
      position: annotation.position || {},
      content: annotation.content || {},
      comment: annotation.comment || "",
      annotationType: ["question", "key-point", "definition", "mistake", "insight", "general"].includes(
        annotation.annotationType,
      )
        ? annotation.annotationType
        : "general",
      resolved: Boolean(annotation.resolved),
      author: annotation.author || {},
      replies: Array.isArray(annotation.replies) ? annotation.replies : [],
      createdAt: annotation.createdAt || new Date().toISOString(),
      updatedAt: annotation.updatedAt || annotation.createdAt || new Date().toISOString(),
    })),
    sessions: (db.sessions || []).map((session) => ({
      ...session,
      agenda: session.agenda || "",
      endsAt: session.endsAt || "",
      kind: ["meeting", "event", "deadline"].includes(session.kind) ? session.kind : "meeting",
      visibility: session.visibility === "private" ? "private" : "room",
      location: session.location || "",
      source: session.source || "manual",
      sourceId: session.sourceId || "",
      metadata:
        session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
          ? session.metadata
          : {},
    })),
    coordinatePolls: (db.coordinatePolls || []).map((poll) => ({
      ...poll,
      title: poll.title || "Group availability",
      slotMinutes: Number.isFinite(Number(poll.slotMinutes)) ? Number(poll.slotMinutes) : 60,
      dayStartMinutes: Number.isFinite(Number(poll.dayStartMinutes)) ? Number(poll.dayStartMinutes) : 9 * 60,
      dayEndMinutes: Number.isFinite(Number(poll.dayEndMinutes)) ? Number(poll.dayEndMinutes) : 17 * 60,
      selectedDates: Array.isArray(poll.selectedDates) ? poll.selectedDates : [],
      timezone: poll.timezone || "Asia/Singapore",
      scheduledSessionId: poll.scheduledSessionId || "",
    })),
    coordinateResponses: (db.coordinateResponses || []).map((response) => ({
      ...response,
      slots: Array.isArray(response.slots) ? response.slots : [],
    })),
    buddyThreads: (db.buddyThreads || []).map((thread) => ({
      ...thread,
      visibility: thread.visibility === "public" ? "public" : "private",
      messages: Array.isArray(thread.messages) ? thread.messages : [],
    })),
  };
}

/**
 * Converts user-provided or stored timestamps into ISO strings for consistent API output.
 */
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

/**
 * Creates the PostgreSQL schema used in deployed environments.
 */
async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT TRUE,
      email_verification JSONB,
      password_reset JSONB,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module_code TEXT NOT NULL,
      academic_term TEXT NOT NULL DEFAULT '',
      room_logo TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
      tags TEXT[] NOT NULL DEFAULT '{}',
      theme TEXT NOT NULL DEFAULT 'twilight',
      background TEXT NOT NULL DEFAULT 'aurora',
      world_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      integrations JSONB NOT NULL DEFAULT '{}'::jsonb,
      channels JSONB NOT NULL DEFAULT '[{"name":"general","type":"text","resourceId":""}]'::jsonb,
      channel_layout JSONB NOT NULL DEFAULT '[]'::jsonb,
      password_hash TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invite_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      resource_sync_fingerprint TEXT NOT NULL DEFAULT '',
      resource_sync_updated_at TIMESTAMPTZ
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
      content_hash TEXT NOT NULL DEFAULT '',
      pdf_path TEXT NOT NULL DEFAULT '',
      pdf_conversion_version TEXT NOT NULL DEFAULT '',
      conversion_status TEXT NOT NULL DEFAULT 'not-needed',
      resource_type TEXT NOT NULL DEFAULT 'other',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      url TEXT NOT NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      original_folder TEXT NOT NULL DEFAULT '',
      deleted_by_id TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      position JSONB NOT NULL DEFAULT '{}',
      content JSONB NOT NULL DEFAULT '{}',
      comment TEXT NOT NULL DEFAULT '',
      annotation_type TEXT NOT NULL DEFAULT 'general',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      author JSONB NOT NULL DEFAULT '{}',
      replies JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agenda TEXT NOT NULL DEFAULT '',
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ,
      kind TEXT NOT NULL DEFAULT 'meeting',
      visibility TEXT NOT NULL DEFAULT 'room',
      location TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coordinate_polls (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      range_start TIMESTAMPTZ NOT NULL,
      range_end TIMESTAMPTZ NOT NULL,
      slot_minutes INTEGER NOT NULL DEFAULT 60,
      day_start_minutes INTEGER NOT NULL DEFAULT 540,
      day_end_minutes INTEGER NOT NULL DEFAULT 1020,
      selected_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
      timezone TEXT NOT NULL DEFAULT 'Asia/Singapore',
      scheduled_session_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coordinate_responses (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES coordinate_polls(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slots JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (poll_id, user_id)
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
    CREATE INDEX IF NOT EXISTS idx_coordinate_polls_room_updated ON coordinate_polls(room_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_coordinate_responses_poll ON coordinate_responses(poll_id);
    CREATE INDEX IF NOT EXISTS idx_buddy_threads_room_updated ON buddy_threads(room_id, updated_at);
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS background TEXT NOT NULL DEFAULT 'aurora'
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS world_config JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS integrations JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS academic_term TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS room_logo TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS password_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '[{"name":"general","type":"text","resourceId":""}]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS channel_layout JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE rooms
      ALTER COLUMN channels DROP DEFAULT
  `);

  await pool.query(`
    ALTER TABLE rooms
      ALTER COLUMN channels TYPE JSONB USING (
        CASE
          WHEN jsonb_typeof(to_jsonb(channels)) = 'array' THEN to_jsonb(channels)
          ELSE '["general"]'::jsonb
        END
      )
  `);

  await pool.query(`
    ALTER TABLE rooms
      ALTER COLUMN channels SET DEFAULT '[{"name":"general","type":"text","resourceId":""}]'::jsonb,
      ALTER COLUMN channels SET NOT NULL
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS resource_sync_fingerprint TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS resource_sync_updated_at TIMESTAMPTZ
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
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'meeting',
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'room',
      ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE coordinate_polls
      ADD COLUMN IF NOT EXISTS day_start_minutes INTEGER NOT NULL DEFAULT 540,
      ADD COLUMN IF NOT EXISTS day_end_minutes INTEGER NOT NULL DEFAULT 1020,
      ADD COLUMN IF NOT EXISTS selected_dates JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'General'
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS pdf_path TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS pdf_conversion_version TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS conversion_status TEXT NOT NULL DEFAULT 'not-needed'
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'other'
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS original_folder TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS deleted_by_id TEXT NOT NULL DEFAULT ''
  `);

  // Existing databases need the content_hash column before Postgres can parse this index.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resources_room_hash
      ON resources(room_id, content_hash)
      WHERE content_hash <> ''
  `);

  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_preset JSONB");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_providers JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification JSONB");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset JSONB");
}

/**
 * Migrates local JSON seed data into PostgreSQL only when the database is empty.
 */
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
    db.annotations.length ||
    db.sessions.length ||
    db.coordinatePolls.length ||
    db.coordinateResponses.length ||
    db.buddyThreads.length
  ) {
    await writePostgresDb(db);
  }
}

/**
 * Initializes either JSON storage or PostgreSQL depending on DATABASE_URL.
 */
export async function initDb() {
  if (!pool) {
    fs.mkdirSync(dataDir, { recursive: true });
    return;
  }

  // The server owns its minimal schema so a fresh Compose stack is ready on first boot.
  await initPostgres();
  await seedPostgresFromJsonIfEmpty();
}

/**
 * Reads the complete logical database. The app is small enough for this shape now,
 * while the normalization step keeps JSON and PostgreSQL callers identical.
 */
export async function readDb() {
  if (!pool) return readJsonDb();

  const [users, rooms, messages, resources, annotations, sessions, coordinatePolls, coordinateResponses, buddyThreads] = await Promise.all([
    pool.query(`
      SELECT
        id,
        name,
        email,
        avatar_url AS "avatarUrl",
        avatar_preset AS "avatarPreset",
        auth_providers AS "authProviders",
        email_verified AS "emailVerified",
        email_verification AS "emailVerification",
        password_reset AS "passwordReset",
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
        r.academic_term AS "academicTerm",
        r.room_logo AS "roomLogo",
        r.description,
        r.visibility,
        r.tags,
        r.theme,
        r.background,
        r.world_config AS "worldConfig",
        r.integrations,
        r.channels,
        r.channel_layout AS "channelLayout",
        r.password_hash AS "passwordHash",
        r.owner_id AS "ownerId",
        r.invite_code AS "inviteCode",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        r.resource_sync_fingerprint AS "resourceSyncFingerprint",
        r.resource_sync_updated_at AS "resourceSyncUpdatedAt",
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
        content_hash AS "contentHash",
        pdf_path AS "pdfPath",
        pdf_conversion_version AS "pdfConversionVersion",
        conversion_status AS "conversionStatus",
        resource_type AS "resourceType",
        metadata,
        url,
        deleted_at AS "deletedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        original_folder AS "originalFolder",
        deleted_by_id AS "deletedById"
      FROM resources
      ORDER BY created_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        channel,
        resource_id AS "resourceId",
        position,
        content,
        comment,
        annotation_type AS "annotationType",
        resolved,
        author,
        replies,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM annotations
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
        ends_at AS "endsAt",
        kind,
        visibility,
        location,
        source,
        source_id AS "sourceId",
        metadata,
        created_at AS "createdAt"
      FROM sessions
      ORDER BY starts_at ASC
    `),
    pool.query(`
      SELECT
        id,
        room_id AS "roomId",
        created_by AS "createdBy",
        title,
        range_start AS "rangeStart",
        range_end AS "rangeEnd",
        slot_minutes AS "slotMinutes",
        day_start_minutes AS "dayStartMinutes",
        day_end_minutes AS "dayEndMinutes",
        selected_dates AS "selectedDates",
        timezone,
        scheduled_session_id AS "scheduledSessionId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM coordinate_polls
      ORDER BY updated_at DESC
    `),
    pool.query(`
      SELECT
        id,
        poll_id AS "pollId",
        room_id AS "roomId",
        user_id AS "userId",
        slots,
        updated_at AS "updatedAt"
      FROM coordinate_responses
      ORDER BY updated_at DESC
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
      resourceSyncUpdatedAt: toIso(room.resourceSyncUpdatedAt),
    })),
    messages: messages.rows.map((message) => ({
      ...message,
      createdAt: toIso(message.createdAt),
    })),
    resources: resources.rows.map((resource) => ({
      ...resource,
      createdAt: toIso(resource.createdAt),
      updatedAt: toIso(resource.updatedAt),
      deletedAt: toIso(resource.deletedAt),
    })),
    annotations: annotations.rows.map((annotation) => ({
      ...annotation,
      createdAt: toIso(annotation.createdAt),
      updatedAt: toIso(annotation.updatedAt),
    })),
    sessions: sessions.rows.map((session) => ({
      ...session,
      startsAt: toIso(session.startsAt),
      endsAt: toIso(session.endsAt),
      createdAt: toIso(session.createdAt),
    })),
    coordinatePolls: coordinatePolls.rows.map((poll) => ({
      ...poll,
      rangeStart: toIso(poll.rangeStart),
      rangeEnd: toIso(poll.rangeEnd),
      createdAt: toIso(poll.createdAt),
      updatedAt: toIso(poll.updatedAt),
    })),
    coordinateResponses: coordinateResponses.rows.map((response) => ({
      ...response,
      slots: Array.isArray(response.slots) ? response.slots : [],
      updatedAt: toIso(response.updatedAt),
    })),
    buddyThreads: buddyThreads.rows.map((thread) => ({
      ...thread,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      createdAt: toIso(thread.createdAt),
      updatedAt: toIso(thread.updatedAt),
    })),
  });
}

/**
 * Persists the complete logical database back to the active storage backend.
 */
export async function writeDb(db) {
  if (!pool) {
    writeJsonDb(db);
    return;
  }

  await writePostgresDb(normalizeDb(db));
}

/**
 * Replaces PostgreSQL table contents in one transaction so related records stay in sync.
 */
async function writePostgresDb(db) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Keep writes atomic while the route layer works with the normalized app snapshot.
    await client.query("DELETE FROM buddy_threads");
    await client.query("DELETE FROM coordinate_responses");
    await client.query("DELETE FROM coordinate_polls");
    await client.query("DELETE FROM sessions");
    await client.query("DELETE FROM annotations");
    await client.query("DELETE FROM resources");
    await client.query("DELETE FROM messages");
    await client.query("DELETE FROM room_members");
    await client.query("DELETE FROM rooms");
    await client.query("DELETE FROM users");

    for (const user of db.users) {
      await client.query(
        `
          INSERT INTO users (
            id, name, email, avatar_url, avatar_preset, auth_providers,
            email_verified, email_verification, password_reset, password_hash, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          user.id,
          user.name,
          user.email,
          user.avatarUrl || "",
          JSON.stringify(user.avatarPreset || null),
          JSON.stringify(user.authProviders || {}),
          user.emailVerified !== false,
          JSON.stringify(user.emailVerification || null),
          JSON.stringify(user.passwordReset || null),
          user.passwordHash,
          user.createdAt,
        ],
      );
    }

    for (const room of db.rooms) {
      await client.query(
        `
          INSERT INTO rooms (
            id, name, module_code, academic_term, room_logo, description, visibility, tags, theme,
          background, world_config, channels, channel_layout, password_hash, owner_id, invite_code, created_at, updated_at,
            integrations,
            resource_sync_fingerprint, resource_sync_updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
          )
        `,
        [
          room.id,
          room.name,
          room.moduleCode,
          room.academicTerm || "",
          room.roomLogo || "",
          room.description || "",
          room.visibility,
          room.tags || [],
          room.theme || "twilight",
          room.background || "aurora",
          JSON.stringify(room.worldConfig || {}),
          JSON.stringify(room.channels?.length ? room.channels : [{ name: "general", type: "text", resourceId: "" }]),
          JSON.stringify(room.channelLayout || []),
          room.passwordHash || null,
          room.ownerId,
          room.inviteCode,
          room.createdAt,
          room.updatedAt,
          JSON.stringify(room.integrations || {}),
          room.resourceSyncFingerprint || "",
          room.resourceSyncUpdatedAt || null,
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
            mime_type, size, content_hash, pdf_path, pdf_conversion_version,
            conversion_status, resource_type, metadata, url, deleted_at, created_at,
            updated_at, original_folder, deleted_by_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22
          )
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
          resource.contentHash || "",
          resource.pdfPath || "",
          resource.pdfConversionVersion || "",
          resource.conversionStatus || "not-needed",
          resource.resourceType || "other",
          JSON.stringify(resource.metadata || {}),
          resource.url,
          resource.deletedAt || null,
          resource.createdAt,
          resource.updatedAt || resource.createdAt,
          resource.originalFolder || "",
          resource.deletedById || "",
        ],
      );
    }

    for (const annotation of db.annotations || []) {
      await client.query(
        `
          INSERT INTO annotations (
            id, room_id, channel, resource_id, position, content, comment,
            annotation_type, resolved, author, replies, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          annotation.id,
          annotation.roomId,
          annotation.channel,
          annotation.resourceId || "",
          JSON.stringify(annotation.position || {}),
          JSON.stringify(annotation.content || {}),
          annotation.comment || "",
          annotation.annotationType || "general",
          Boolean(annotation.resolved),
          JSON.stringify(annotation.author || {}),
          JSON.stringify(Array.isArray(annotation.replies) ? annotation.replies : []),
          annotation.createdAt,
          annotation.updatedAt,
        ],
      );
    }

    for (const session of db.sessions) {
      await client.query(
        `
          INSERT INTO sessions (
            id, room_id, created_by, title, agenda, starts_at, ends_at, kind,
            visibility, location, source, source_id, metadata, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          session.id,
          session.roomId,
          session.createdBy,
          session.title,
          session.agenda || "",
          session.startsAt,
          session.endsAt || null,
          session.kind || "meeting",
          session.visibility === "private" ? "private" : "room",
          session.location || "",
          session.source || "manual",
          session.sourceId || "",
          JSON.stringify(session.metadata || {}),
          session.createdAt,
        ],
      );
    }

    for (const poll of db.coordinatePolls || []) {
      await client.query(
        `
          INSERT INTO coordinate_polls (
            id, room_id, created_by, title, range_start, range_end, slot_minutes,
            day_start_minutes, day_end_minutes, selected_dates, timezone,
            scheduled_session_id, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          poll.id,
          poll.roomId,
          poll.createdBy,
          poll.title || "Group availability",
          poll.rangeStart,
          poll.rangeEnd,
          poll.slotMinutes || 60,
          poll.dayStartMinutes || 9 * 60,
          poll.dayEndMinutes || 17 * 60,
          JSON.stringify(Array.isArray(poll.selectedDates) ? poll.selectedDates : []),
          poll.timezone || "Asia/Singapore",
          poll.scheduledSessionId || "",
          poll.createdAt,
          poll.updatedAt,
        ],
      );
    }

    for (const response of db.coordinateResponses || []) {
      await client.query(
        `
          INSERT INTO coordinate_responses (
            id, poll_id, room_id, user_id, slots, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (poll_id, user_id) DO UPDATE SET
            slots = EXCLUDED.slots,
            updated_at = EXCLUDED.updated_at
        `,
        [
          response.id,
          response.pollId,
          response.roomId,
          response.userId,
          JSON.stringify(Array.isArray(response.slots) ? response.slots : []),
          response.updatedAt,
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
