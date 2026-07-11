export const CUSTOM_WORLD_MAP_ID = "custom-world";
const DEFAULT_WORLD_COLUMNS = 64;
const DEFAULT_WORLD_ROWS = 40;

export const WORLD_LAYERS = ["floor", "above_floor", "object"];

export const SPECIAL_TILE_TYPES = [
  "impassable",
  "teleport",
  "spawn",
  "private",
];

export const WORLD_ZONE_PRESETS = [
  { tabId: "space", label: "Domain", description: "Virtual domain" },
  { tabId: "focus", label: "Home", description: "Room board and overview" },
  { tabId: "chat", label: "Convolution", description: "Group discussion" },
  { tabId: "resources", label: "Infilenite", description: "Library and resources" },
  { tabId: "buddy", label: "Intelligrate", description: "Assistant workspace" },
  { tabId: "calendar", label: "Coordidate", description: "Schedule area" },
];

export const DEFAULT_WORLD_ROOM = {
  id: CUSTOM_WORLD_MAP_ID,
  name: "Domain",
  backgroundImage: "",
  columns: DEFAULT_WORLD_COLUMNS,
  rows: DEFAULT_WORLD_ROWS,
  tilemap: {},
};

export const DEFAULT_CUSTOM_WORLD_CONFIG = {
  enabled: true,
  version: 2,
  backgroundImage: "",
  tileSize: 32,
  columns: DEFAULT_WORLD_COLUMNS,
  rows: DEFAULT_WORLD_ROWS,
  activeRoomId: CUSTOM_WORLD_MAP_ID,
  spawnpoint: { roomId: CUSTOM_WORLD_MAP_ID, x: 32, y: 20 },
  rooms: [DEFAULT_WORLD_ROOM],
  collisions: [],
  objects: [],
  privateAreas: [],
  zones: [],
};

const TILE_KEY_PATTERN = /^-?\d+,-?\d+$/;

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function safeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeBackgroundImage(value) {
  const image = safeString(value);
  return image.startsWith("data:image/") ? image : "";
}

export function makeTileKey(x, y) {
  return `${Math.round(Number(x) || 0)},${Math.round(Number(y) || 0)}`;
}

export function parseTileKey(key) {
  const normalized = String(key || "").replace(/\s+/g, "");
  if (!TILE_KEY_PATTERN.test(normalized)) return null;
  const [x, y] = normalized.split(",").map(Number);
  return { x, y, key: `${x},${y}` };
}

export function normalizeWorldTile(
  value,
  columns,
  rows,
  fallback = DEFAULT_CUSTOM_WORLD_CONFIG.spawnpoint,
) {
  return {
    roomId: safeString(value?.roomId || value?.mapId || fallback.roomId, CUSTOM_WORLD_MAP_ID),
    x: clampInteger(value?.x ?? value?.col, 0, columns - 1, fallback.x ?? fallback.col ?? 0),
    y: clampInteger(value?.y ?? value?.row, 0, rows - 1, fallback.y ?? fallback.row ?? 0),
  };
}

function normalizeLayerValue(value) {
  const assetId = safeString(value);
  return assetId.length <= 256 ? assetId : assetId.slice(0, 256);
}

function normalizeLayerStack(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeLayerValue(typeof item === "string" ? item : item?.assetId || item?.id))
      .filter(Boolean)
      .slice(0, 64);
  }

  const legacyValue = normalizeLayerValue(value);
  return legacyValue ? [legacyValue] : [];
}

function normalizeTeleporter(value, columns, rows, fallbackRoomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    roomId: safeString(value.roomId || value.mapId || fallbackRoomId, fallbackRoomId).slice(0, 64),
    x: clampInteger(value.x ?? value.col, 0, columns - 1, 0),
    y: clampInteger(value.y ?? value.row, 0, rows - 1, 0),
  };
}

function normalizePortal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preset = WORLD_ZONE_PRESETS.find((item) => item.tabId === value.tabId);
  if (!preset) return null;
  return {
    tabId: preset.tabId,
    label: safeString(value.label || preset.label, preset.label).slice(0, 72),
  };
}

function normalizeTileEntry(value, columns, rows, roomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const tile = {};
  const floorValue = normalizeLayerValue(value.floor);
  if (floorValue) tile.floor = floorValue;

  ["above_floor", "object"].forEach((layer) => {
    const layerStack = normalizeLayerStack(value[layer]);
    if (layerStack.length) tile[layer] = layerStack;
  });

  if (value.impassable === true) tile.impassable = true;

  const privateAreaId = safeString(value.privateAreaId);
  if (privateAreaId) tile.privateAreaId = privateAreaId.slice(0, 72);

  const teleporter = normalizeTeleporter(value.teleporter, columns, rows, roomId);
  if (teleporter) tile.teleporter = teleporter;

  const portal = normalizePortal(value.portal);
  if (portal) tile.portal = portal;

  const openUrl = safeString(value.openUrl || value.linkUrl).slice(0, 500);
  if (openUrl) tile.openUrl = openUrl;

  if (value.entryExit === true) tile.entryExit = true;

  return Object.keys(tile).length ? tile : null;
}

function normalizeTilemap(tilemap, columns, rows, roomId) {
  const normalized = {};
  const source = tilemap && typeof tilemap === "object" && !Array.isArray(tilemap) ? tilemap : {};

  Object.entries(source).forEach(([rawKey, value]) => {
    const parsed = parseTileKey(rawKey);
    if (!parsed) return;
    if (parsed.x < 0 || parsed.y < 0 || parsed.x >= columns || parsed.y >= rows) return;

    const tile = normalizeTileEntry(value, columns, rows, roomId);
    if (tile) normalized[parsed.key] = tile;
  });

  return normalized;
}

function normalizeRoom(value, index, columns, rows, backgroundImage) {
  const room = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackId = index === 0 ? CUSTOM_WORLD_MAP_ID : `world-room-${index + 1}`;
  const id = safeString(room.id || room.roomId || room.mapId || fallbackId, fallbackId).slice(0, 64);
  const roomColumns = clampInteger(room.columns, 12, 256, columns);
  const roomRows = clampInteger(room.rows, 10, 256, rows);
  const rawName = room.name ?? room.label;
  const name = rawName == null
    ? (index === 0 ? "Domain" : `Zone ${index + 1}`)
    : String(rawName).slice(0, 72);

  return {
    id,
    name,
    backgroundImage: normalizeBackgroundImage(room.backgroundImage) || backgroundImage,
    columns: roomColumns,
    rows: roomRows,
    tilemap: normalizeTilemap(room.tilemap, roomColumns, roomRows, id),
  };
}

function normalizeAreaEffects(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    entryExit: source.entryExit === true,
    impassable: source.impassable === true,
    meeting: source.meeting === true,
    openLink: source.openLink === true,
    teleport: source.teleport === true,
  };
}

function normalizeAreaTabId(value) {
  const tabId = safeString(value);
  return WORLD_ZONE_PRESETS.some((preset) => preset.tabId === tabId && tabId !== "focus")
    ? tabId
    : "chat";
}

function normalizeOpenLinkInteraction(value) {
  return safeString(value) === "enter" ? "enter" : "action";
}

function normalizeAreaProperties(value) {
  return (Array.isArray(value) ? value : [])
    .map((property) => {
      if (!property || typeof property !== "object" || Array.isArray(property)) return null;
      const type = safeString(property.type).slice(0, 48);
      if (!type) return null;
      return {
        ...property,
        type,
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizePrivateArea(value, index, columns, rows, fallbackRoomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
  const col = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
  const row = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
  const width = clampInteger(bounds.width ?? bounds.w, 1, columns - col, 1);
  const height = clampInteger(bounds.height ?? bounds.h, 1, rows - row, 1);
  const rawLabel = value.name ?? value.label;
  const label = rawLabel == null ? "Area" : String(rawLabel).slice(0, 72);
  const roomId = safeString(value.roomId || value.mapId || fallbackRoomId, fallbackRoomId).slice(0, 64);
  const destination = normalizeTeleporter(value.destination || value.teleporter, columns, rows, roomId);

  return {
    id: safeString(value.id || `area-${index + 1}`, `area-${index + 1}`).slice(0, 64),
    label,
    name: label,
    roomId,
    bounds: { col, row, width, height },
    effects: normalizeAreaEffects(value.effects),
    properties: normalizeAreaProperties(value.properties),
    linkUrl: safeString(value.linkUrl || value.url).slice(0, 500),
    openLinkInteraction: normalizeOpenLinkInteraction(value.openLinkInteraction),
    openLinkNewTab: value.openLinkNewTab === true,
    tabId: normalizeAreaTabId(value.tabId || value.targetTabId || value.portal?.tabId),
    destination: destination || { roomId, x: 0, y: 0 },
  };
}

function ensureTile(tilemap, x, y) {
  const key = makeTileKey(x, y);
  tilemap[key] = tilemap[key] || {};
  return tilemap[key];
}

function migrateLegacyTilemap(config, columns, rows) {
  const tilemap = {};

  (Array.isArray(config.collisions) ? config.collisions : []).forEach((collision) => {
    const parsed = parseTileKey(collision);
    if (!parsed) return;
    if (parsed.x < 0 || parsed.y < 0 || parsed.x >= columns || parsed.y >= rows) return;
    ensureTile(tilemap, parsed.x, parsed.y).impassable = true;
  });

  (Array.isArray(config.objects) ? config.objects : []).forEach((object) => {
    const assetId = normalizeLayerValue(object?.assetId);
    if (!assetId) return;
    const x = clampInteger(object.col ?? object.x, 0, columns - 1, 0);
    const y = clampInteger(object.row ?? object.y, 0, rows - 1, 0);
    ensureTile(tilemap, x, y).object = assetId;
  });

  (Array.isArray(config.privateAreas) ? config.privateAreas : []).forEach((area, index) => {
    const bounds = area?.bounds || {};
    const x = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
    const y = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
    const width = clampInteger(bounds.width ?? bounds.w, 1, columns - x, 1);
    const height = clampInteger(bounds.height ?? bounds.h, 1, rows - y, 1);
    const id = safeString(area?.id || `private-${index + 1}`, `private-${index + 1}`);

    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        ensureTile(tilemap, col, row).privateAreaId = id;
      }
    }
  });

  (Array.isArray(config.zones) ? config.zones : []).forEach((zone) => {
    const portal = normalizePortal(zone);
    if (!portal) return;
    const bounds = zone?.bounds || {};
    const x = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
    const y = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
    const width = clampInteger(bounds.width ?? bounds.w, 1, columns - x, 1);
    const height = clampInteger(bounds.height ?? bounds.h, 1, rows - y, 1);

    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) {
        ensureTile(tilemap, col, row).portal = portal;
      }
    }
  });

  return tilemap;
}

function normalizeLegacyArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeWorldConfig(value) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const columns = clampInteger(config.columns, 12, 256, DEFAULT_CUSTOM_WORLD_CONFIG.columns);
  const rows = clampInteger(config.rows, 10, 256, DEFAULT_CUSTOM_WORLD_CONFIG.rows);
  const backgroundImage = normalizeBackgroundImage(config.backgroundImage);
  const hasExplicitRooms = Array.isArray(config.rooms) && config.rooms.length > 0;

  const sourceRooms = hasExplicitRooms
    ? config.rooms
    : [
        {
          ...DEFAULT_WORLD_ROOM,
          backgroundImage,
          columns,
          rows,
          tilemap: migrateLegacyTilemap(config, columns, rows),
        },
      ];

  const rooms = sourceRooms
    .map((room, index) => normalizeRoom(room, index, columns, rows, !hasExplicitRooms && index === 0 ? backgroundImage : ""))
    .filter((room) => room.id)
    .slice(0, 24);

  if (!rooms.length) rooms.push(normalizeRoom(DEFAULT_WORLD_ROOM, 0, columns, rows, backgroundImage));

  const activeRoomId = rooms.some((room) => room.id === config.activeRoomId)
    ? safeString(config.activeRoomId)
    : rooms[0].id;
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || rooms[0];
  const activeColumns = activeRoom.columns || columns;
  const activeRows = activeRoom.rows || rows;
  const activeBackgroundImage = activeRoom.backgroundImage || "";

  const fallbackSpawn = {
    roomId: rooms[0].id,
    x: Math.floor((rooms[0].columns || columns) / 2),
    y: Math.floor((rooms[0].rows || rows) / 2),
  };
  const spawnSource = config.spawnpoint || config.spawn || fallbackSpawn;
  const spawnRoomId = safeString(spawnSource?.roomId || spawnSource?.mapId || fallbackSpawn.roomId, fallbackSpawn.roomId);
  const spawnRoom = rooms.find((room) => room.id === spawnRoomId) || rooms[0];
  const spawnpoint = normalizeWorldTile(
    { ...spawnSource, roomId: spawnRoom.id },
    spawnRoom.columns || columns,
    spawnRoom.rows || rows,
    {
      roomId: spawnRoom.id,
      x: Math.floor((spawnRoom.columns || columns) / 2),
      y: Math.floor((spawnRoom.rows || rows) / 2),
    },
  );
  if (!rooms.some((room) => room.id === spawnpoint.roomId)) {
    spawnpoint.roomId = rooms[0].id;
  }

  const privateAreas = normalizeLegacyArray(config.privateAreas)
    .map((area, index) => {
      const roomId = safeString(area?.roomId || area?.mapId || activeRoomId, activeRoomId).slice(0, 64);
      const areaRoom = rooms.find((room) => room.id === roomId) || activeRoom;
      return normalizePrivateArea(
        { ...area, roomId: areaRoom.id },
        index,
        areaRoom.columns || activeColumns,
        areaRoom.rows || activeRows,
        areaRoom.id,
      );
    })
    .filter(Boolean)
    .slice(0, 48);

  return {
    ...DEFAULT_CUSTOM_WORLD_CONFIG,
    ...config,
    enabled: config.enabled !== false,
    version: 2,
    backgroundImage: activeBackgroundImage,
    tileSize: clampInteger(config.tileSize, 24, 72, DEFAULT_CUSTOM_WORLD_CONFIG.tileSize),
    columns: activeColumns,
    rows: activeRows,
    activeRoomId,
    spawnpoint,
    spawn: {
      mapId: spawnpoint.roomId,
      col: spawnpoint.x,
      row: spawnpoint.y,
    },
    rooms,
    collisions: normalizeLegacyArray(config.collisions),
    objects: normalizeLegacyArray(config.objects),
    privateAreas,
    zones: normalizeLegacyArray(config.zones),
  };
}
