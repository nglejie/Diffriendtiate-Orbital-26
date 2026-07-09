import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Grid2X2,
  Hand,
  Image as ImageIcon,
  Layers,
  Lock,
  MapPin,
  MapPinned,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  MousePointer,
  Move,
  Navigation,
  Paintbrush,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  VectorSquare,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../api.ts";
import { getBackground } from "../../../constants.ts";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import { AvatarPreview } from "../profile/AvatarPreview.tsx";
import { normalizeLimeetsAvatarPreset } from "../profile/avatarPresets.ts";
import { normalizeProfileStatus } from "../profile/UserProfileControls.tsx";
import {
  CUSTOM_WORLD_MAP_ID,
  WORLD_ZONE_PRESETS,
  makeTileKey,
  normalizeWorldConfig,
  parseTileKey,
} from "./worldConfig.ts";
import {
  LIMEETS_OBJECT_ASSETS,
  canAssetUseLayer,
  getAssetColorOptions,
  getAssetDirectionOptions,
  getLimeetsAsset,
  getSmartLayerForAsset,
} from "./limeetsAssetCatalog.ts";
import type { LimeetsLayer } from "./limeetsAssetCatalog.ts";
import {
  AVATAR_RUN_MULTIPLIER,
  AVATAR_SPEED_PX_PER_SECOND,
  clampAvatarWorldPoint,
  getAvatarFrame,
  getDirectionFromDelta,
  findTilePath,
  tileToWorldPoint,
  worldPointToTile,
} from "./gatherMovement.ts";

const CAMERA_MIN_SCALE = 0.08;
const CAMERA_MAX_SCALE = 5.2;
const CAMERA_ZOOM_STEP = 1.16;
const FIT_WORLD_PADDING_PX = 56;
const EDITOR_FIT_RESERVED_WIDTH_PX = 536;
const MOVE_EMIT_INTERVAL_MS = 120;
const PAN_DRAG_THRESHOLD_PX = 5;
const AREA_ACTION_TOOLTIP_WIDTH = 224;
const EXPLORE_NOTICE_TEXT = "How about we explore the area ahead of us later?";
const MAP_OVERLAY_SELECTOR =
  ".limeets-gather-editor, .limeets-gather-toolbar, .limeets-gather-controls, .limeets-gather-open-editor, .limeets-gather-current-action";

const EDITOR_PANEL_COPY = {
  erase: {
    title: "Erase Tiles",
    description: "Remove placed tiles, objects, and special markers from the map.",
  },
  hand: {
    title: "Move Around",
    description: "Pan the domain without moving your avatar.",
  },
  inspect: {
    title: "Inspect Tile",
    description: "Select a tile or object on the map to review what is placed there.",
  },
  objects: {
    title: "Add Object to Your Domain",
    description: "Search, choose an object, then stamp it on the map.",
  },
  rooms: {
    title: "Setup & Zones",
    description: "Create zones, then set each zone's size, spawn, and background.",
  },
  special: {
    title: "Special Areas",
    description: "Draw named areas and stack movement, meeting, link, or teleport effects.",
  },
};

const SPECIAL_TILES = [
  {
    id: "impassable",
    title: "Impassable",
    description: "Players cannot walk through this tile.",
    icon: Lock,
  },
  {
    id: "teleport",
    title: "Teleport",
    description: "Move players to another zone tile.",
    icon: DoorOpen,
  },
  {
    id: "spawn",
    title: "Spawn",
    description: "Set the default entry tile.",
    icon: MapPin,
  },
  {
    id: "private",
    title: "Meeting Area",
    description: "Draw an area that can auto-join voice and video.",
    icon: Video,
  },
];

const DEFAULT_AREA_EFFECTS = {
  entryExit: false,
  impassable: false,
  meeting: false,
  openLink: false,
  teleport: false,
};

const NAVIGATION_AREA_OPTIONS = WORLD_ZONE_PRESETS.filter((preset) => preset.tabId !== "focus");
const DEFAULT_NAVIGATION_TAB = "chat";

const OPEN_LINK_INTERACTION_OPTIONS = [
  { value: "action", label: "Show Action Prompt" },
  { value: "enter", label: "Open When Entering" },
];

const AREA_PROPERTY_OPTIONS = [
  {
    id: "meeting",
    group: "session",
    title: "Meeting Area",
    description: "Join Limeets voice/video when a member enters.",
    icon: Video,
  },
  {
    id: "entryExit",
    group: "action",
    title: "Navigate",
    description: "Send members to a tab when they stop in this area.",
    icon: Navigation,
  },
  {
    id: "openLink",
    group: "action",
    title: "Open Link",
    description: "Attach a link interaction to the area.",
    icon: ExternalLink,
  },
  {
    id: "teleport",
    group: "movement",
    title: "Teleport",
    description: "Move members to another zone tile.",
    icon: DoorOpen,
  },
  {
    id: "impassable",
    group: "movement",
    title: "Block Movement",
    description: "Make the whole selected area impassable.",
    icon: Lock,
  },
];

export function getFirstEnabledAreaPropertyId(effects = {}, preferredId = "") {
  if (preferredId && effects?.[preferredId]) return preferredId;
  return AREA_PROPERTY_OPTIONS.find((option) => effects?.[option.id])?.id || "";
}

export function getEnabledAreaPropertyIds(effects = {}) {
  return AREA_PROPERTY_OPTIONS.filter((option) => effects?.[option.id]).map((option) => option.id);
}

const ERASER_TARGETS = [
  { id: "all", label: "Everything", icon: Trash2 },
  { id: "floor", label: "Floor", icon: Layers },
  { id: "above_floor", label: "Above", icon: ImageIcon },
  { id: "object", label: "Objects", icon: Box },
  { id: "special", label: "Areas", icon: Grid2X2 },
];

const LAYER_LABELS = {
  floor: "Floor",
  above_floor: "Above",
  object: "Object",
};

const KEY_TO_VECTOR = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  a: [-1, 0],
  d: [1, 0],
  s: [0, 1],
  w: [0, -1],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDisplayName(user) {
  return (
    String(user?.name || user?.email || "Member")
      .trim()
      .split("@")[0] || "Member"
  );
}

function getStorageKey(roomId) {
  return roomId ? `diffriendtiate:room:${roomId}:limeets-gather-player` : "";
}

function getAreaTriggerStorageKey(roomId) {
  return roomId ? `diffriendtiate:room:${roomId}:limeets-area-trigger` : "";
}

function getMeetingAreaVisibilityStorageKey(roomId) {
  return roomId ? `diffriendtiate:room:${roomId}:limeets-meeting-area-visibility` : "";
}

function readAreaTriggerStorage(roomId) {
  const storageKey = getAreaTriggerStorageKey(roomId);
  if (!storageKey || typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

function writeAreaTriggerStorage(roomId, areaId) {
  const storageKey = getAreaTriggerStorageKey(roomId);
  if (!storageKey || typeof window === "undefined") return;

  try {
    if (areaId) window.localStorage.setItem(storageKey, areaId);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Local UI state should never break the world if storage is unavailable.
  }
}

function readMeetingAreaVisibilityStorage(roomId) {
  const storageKey = getMeetingAreaVisibilityStorageKey(roomId);
  if (!storageKey || typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function writeMeetingAreaVisibilityStorage(roomId, visible) {
  const storageKey = getMeetingAreaVisibilityStorageKey(roomId);
  if (!storageKey || typeof window === "undefined") return;

  try {
    if (visible) window.localStorage.setItem(storageKey, "true");
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Local UI state should never break the world if storage is unavailable.
  }
}

function isTypingTarget(target) {
  const tagName = target?.tagName;
  return (
    target?.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getKeyboardKey(event) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function getWorldSize(world) {
  return {
    width: world.columns * world.tileSize,
    height: world.rows * world.tileSize,
  };
}

function getEditorReservedWidth(viewportWidth, editorOpen, isOwner) {
  if (!editorOpen || !isOwner) return 0;
  return Math.min(EDITOR_FIT_RESERVED_WIDTH_PX, Math.max(0, viewportWidth - 240));
}

function getVisibleViewportSize(viewportSize, editorOpen, isOwner) {
  const reservedWidth = getEditorReservedWidth(viewportSize.width, editorOpen, isOwner);
  return {
    reservedWidth,
    width: Math.max(1, viewportSize.width - reservedWidth),
    height: Math.max(1, viewportSize.height),
  };
}

function getZoneFallbackName(index) {
  return `Zone ${index + 1}`;
}

function prepareWorldForSave(worldConfig) {
  const normalized = normalizeWorldConfig(worldConfig);
  return {
    ...normalized,
    rooms: normalized.rooms.map((room, index) => ({
      ...room,
      name: String(room.name || "").trim() || getZoneFallbackName(index),
    })),
  };
}

function getRoomFromWorld(world) {
  return (
    world.rooms.find((room) => room.id === world.activeRoomId) ||
    world.rooms[0] ||
    { id: CUSTOM_WORLD_MAP_ID, name: "Domain", tilemap: {} }
  );
}

function getRoomBoundsForWorldPoint(world, worldRoomId) {
  const room =
    world.rooms.find((candidate) => candidate.id === worldRoomId) ||
    getRoomFromWorld(world);
  return {
    columns: Number(room?.columns || world.columns || 1),
    rows: Number(room?.rows || world.rows || 1),
  };
}

function clampPointToWorldRoom(point, world, worldRoomId = world?.activeRoomId) {
  const { columns, rows } = getRoomBoundsForWorldPoint(world, worldRoomId);
  return clampAvatarWorldPoint(point, columns, rows, world.tileSize);
}

function getBackgroundCss(room, world) {
  if (world.backgroundImage) {
    return `url("${world.backgroundImage}") center / 100% 100% no-repeat`;
  }

  return getBackground(room?.background).css;
}

function getRepresentativeAssets(assets) {
  const representedFamilies = new Set();

  return assets.filter((asset) => {
    const key = asset.familyId || asset.id;
    if (representedFamilies.has(key)) return false;
    representedFamilies.add(key);
    return true;
  });
}

function createCategoryNode({ id, label, parentPath = "", path = "" }) {
  return {
    assets: [],
    children: [],
    id,
    label,
    parentPath,
    path,
    thumbnailAsset: null,
  };
}

function addAssetToCategoryTree(root, asset) {
  const parts = String(asset.category || "Objects")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  let node = root;
  let parentPath = "";
  let path = "";

  parts.forEach((part) => {
    path = path ? `${path}/${part}` : part;
    let child = node.children.find((candidate) => candidate.path === path);
    if (!child) {
      child = createCategoryNode({ id: path, label: part, parentPath, path });
      node.children.push(child);
    }
    if (!child.thumbnailAsset) child.thumbnailAsset = asset;
    if (!node.thumbnailAsset) node.thumbnailAsset = asset;
    node = child;
    parentPath = path;
  });

  node.assets.push(asset);
  if (!node.thumbnailAsset) node.thumbnailAsset = asset;
}

function sortCategoryNode(node) {
  node.assets.sort((a, b) => a.label.localeCompare(b.label));
  node.children.sort((a, b) => {
    return a.label.localeCompare(b.label);
  });
  node.children.forEach(sortCategoryNode);
  return node;
}

function buildAssetCategoryTree(assets) {
  const representatives = getRepresentativeAssets(assets);
  const root = createCategoryNode({ id: "root", label: "Assets" });

  representatives.forEach((asset) => addAssetToCategoryTree(root, asset));
  root.assets = representatives;
  return sortCategoryNode(root);
}

function findCategoryNode(root, path) {
  if (!path) return root;
  const stack = [...root.children];
  while (stack.length) {
    const node = stack.shift();
    if (node.path === path) return node;
    stack.push(...node.children);
  }
  return root;
}

function getCategoryDescription(category) {
  const childCount = category.children.length;
  const assetCount = category.assets.length;
  if (childCount && assetCount) return `${childCount} folders · ${assetCount} images`;
  if (childCount) return `${childCount} folders`;
  return `${assetCount} Images`;
}

function getAssetDimensions(asset, layer) {
  if (!asset) return { width: 1, height: 1 };
  if (!canAssetUseLayer(asset, layer)) return { width: 1, height: 1 };
  return {
    width: Math.max(1, Number(asset.width) || 1),
    height: Math.max(1, Number(asset.height) || 1),
  };
}

function isStackLayer(layer) {
  return layer === "above_floor" || layer === "object";
}

function getLayerStack(tile, layer) {
  if (!tile) return [];
  const value = tile[layer];
  if (isStackLayer(layer)) return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  return value ? [value] : [];
}

function setLayerStack(entry, layer, stack) {
  const next = { ...entry };
  const cleanStack = stack.filter(Boolean);

  if (layer === "floor") {
    if (cleanStack[0]) next.floor = cleanStack[0];
    else delete next.floor;
    return next;
  }

  if (cleanStack.length) next[layer] = cleanStack;
  else delete next[layer];
  return next;
}

function getLayerSummary(tile, layer) {
  const stack = getLayerStack(tile, layer);
  if (!stack.length) return "empty";
  if (layer === "floor") return stack[0];
  return `${stack.length} asset${stack.length === 1 ? "" : "s"}`;
}

function removePlacementFromEntry(entry, placement) {
  if (!entry || !placement) return entry || {};
  const stack = getLayerStack(entry, placement.layer);
  if (!stack.length) return entry;
  return setLayerStack(
    entry,
    placement.layer,
    stack.filter((_, index) => index !== placement.index),
  );
}

function reorderPlacementStack(stack, index, action) {
  if (!Array.isArray(stack) || index < 0 || index >= stack.length) {
    return { index, stack: stack || [] };
  }

  const nextStack = [...stack];
  const [assetId] = nextStack.splice(index, 1);
  let nextIndex = index;

  if (action === "back") nextIndex = 0;
  if (action === "backward") nextIndex = Math.max(0, index - 1);
  if (action === "forward") nextIndex = Math.min(nextStack.length, index + 1);
  if (action === "front") nextIndex = nextStack.length;

  nextStack.splice(nextIndex, 0, assetId);
  return { index: nextIndex, stack: nextStack };
}

function getEraseLayerFilter(target) {
  if (target === "floor") return "floor";
  if (target === "above_floor") return "above_floor";
  if (target === "object") return "object";
  return "all";
}

function getTopPlacementAtTile(tilemap, targetTile, layerFilter = "all") {
  const layerOrder =
    layerFilter === "object"
      ? ["object"]
      : layerFilter === "above_floor"
        ? ["above_floor"]
        : layerFilter === "floor"
          ? ["floor"]
          : ["object", "above_floor", "floor"];

  for (const layer of layerOrder) {
    const placements = [];
    Object.entries(tilemap || {}).forEach(([key, tile]) => {
      const parsed = parseTileKey(key);
      if (!parsed) return;
      getLayerStack(tile, layer).forEach((assetId, index) => {
        const asset = getLimeetsAsset(assetId);
        const { width, height } = getAssetDimensions(asset, layer);
        if (
          targetTile.x >= parsed.x &&
          targetTile.y >= parsed.y &&
          targetTile.x < parsed.x + width &&
          targetTile.y < parsed.y + height
        ) {
          placements.push({
            asset,
            assetId,
            index,
            key: parsed.key,
            layer,
            origin: { x: parsed.x, y: parsed.y },
            tile,
          });
        }
      });
    });

    if (placements.length) return placements[placements.length - 1];
  }

  return null;
}

function getBlockedTiles(world, worldRoom) {
  const blocked = new Set();

  Object.entries(worldRoom.tilemap || {}).forEach(([key, tile]) => {
    const parsed = parseTileKey(key);
    if (!parsed) return;

    if (tile.impassable) {
      blocked.add(parsed.key);
    }

    getLayerStack(tile, "object").forEach((assetId) => {
      const asset = getLimeetsAsset(assetId);
      if (asset?.blocks === false) return;

      const { width, height } = getAssetDimensions(asset, "object");
      for (let y = parsed.y; y < parsed.y + height; y += 1) {
        for (let x = parsed.x; x < parsed.x + width; x += 1) {
          if (x >= 0 && y >= 0 && x < world.columns && y < world.rows) {
            blocked.add(makeTileKey(x, y));
          }
        }
      }
    });
  });

  return blocked;
}

function getInitialPlayer(world, worldRoom, room) {
  const storageKey = getStorageKey(room?.id);
  if (storageKey && typeof window !== "undefined") {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (
        saved?.worldRoomId === worldRoom.id &&
        Number.isFinite(saved.x) &&
        Number.isFinite(saved.y)
      ) {
        const point = clampPointToWorldRoom(saved, world, worldRoom.id);
        return {
          x: point.x,
          y: point.y,
          direction: saved.direction || "down",
          frame: getAvatarFrame(saved.direction || "down", false, 0),
          moving: false,
          path: [],
        };
      }
    } catch {
      // Ignore stale local state.
    }
  }

  const spawn =
    world.spawnpoint?.roomId === worldRoom.id
      ? { x: world.spawnpoint.x, y: world.spawnpoint.y }
      : { x: Math.floor(world.columns / 2), y: Math.floor(world.rows / 2) };
  const point = clampPointToWorldRoom(tileToWorldPoint(spawn, world.tileSize), world, worldRoom.id);
  return {
    ...point,
    direction: "down",
    frame: getAvatarFrame("down", false, 0),
    moving: false,
    path: [],
  };
}

function serializePlayerPosition(player, world, worldRoom) {
  const point = clampPointToWorldRoom(player, world, worldRoom.id);
  const tile = worldPointToTile(point, world.columns, world.rows, world.tileSize);
  return {
    mapId: CUSTOM_WORLD_MAP_ID,
    worldRoomId: worldRoom.id,
    col: tile.x,
    row: tile.y,
    x: Number(point.x.toFixed(2)),
    y: Number(point.y.toFixed(2)),
    direction: player.direction,
    moving: Boolean(player.moving),
  };
}

function normalizePresencePosition(presence, world) {
  const raw = presence?.position || {};
  let x = Number(raw.x);
  let y = Number(raw.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const tile = {
      x: Number.isFinite(Number(raw.col)) ? Number(raw.col) : 0,
      y: Number.isFinite(Number(raw.row)) ? Number(raw.row) : 0,
    };
    const point = tileToWorldPoint(tile, world.tileSize);
    x = point.x;
    y = point.y;
  }

  const worldRoomId = String(raw.worldRoomId || CUSTOM_WORLD_MAP_ID);
  const point = clampPointToWorldRoom({ x, y }, world, worldRoomId);
  const direction = ["down", "left", "right", "up"].includes(raw.direction)
    ? raw.direction
    : "down";

  return {
    ...presence,
    position: {
      x: point.x,
      y: point.y,
      direction,
      frame: getAvatarFrame(direction, Boolean(raw.moving), performance.now()),
      moving: Boolean(raw.moving),
      worldRoomId,
    },
  };
}

function getPresenceKey(presence) {
  return presence?.presenceId || presence?.socketId || presence?.userId || "";
}

function mergePresenceUser(presence, nextUser) {
  if (!presence?.user || !nextUser || presence.user.id !== nextUser.id) return presence;
  return {
    ...presence,
    user: { ...presence.user, ...nextUser },
  };
}

function rectangleTiles(start, end) {
  if (!start || !end) return [];
  const xStart = Math.min(start.x, end.x);
  const xEnd = Math.max(start.x, end.x);
  const yStart = Math.min(start.y, end.y);
  const yEnd = Math.max(start.y, end.y);
  const tiles = [];

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      tiles.push({ x, y });
    }
  }

  return tiles;
}

export function usesRectangleTileAction(activeTool, paintMode) {
  const tool = String(activeTool || "");
  return tool === "select" || tool === "erase" || paintMode === "rectangle";
}

function getAreaRectFromPoints(start, end, world) {
  if (!start || !end || !world) return null;

  const minX = clamp(Math.min(start.x, end.x), 0, world.width);
  const minY = clamp(Math.min(start.y, end.y), 0, world.height);
  const maxX = clamp(Math.max(start.x, end.x), 0, world.width);
  const maxY = clamp(Math.max(start.y, end.y), 0, world.height);
  const fallbackWidth = world.tileSize;
  const fallbackHeight = world.tileSize;
  const pixelWidth = Math.max(maxX - minX, fallbackWidth);
  const pixelHeight = Math.max(maxY - minY, fallbackHeight);
  const col = clamp(Math.floor(minX / world.tileSize), 0, world.columns - 1);
  const row = clamp(Math.floor(minY / world.tileSize), 0, world.rows - 1);
  const endCol = clamp(Math.ceil((minX + pixelWidth) / world.tileSize) - 1, col, world.columns - 1);
  const endRow = clamp(Math.ceil((minY + pixelHeight) / world.tileSize) - 1, row, world.rows - 1);

  return {
    bounds: {
      col,
      row,
      width: endCol - col + 1,
      height: endRow - row + 1,
    },
    pixel: {
      x: minX,
      y: minY,
      width: pixelWidth,
      height: pixelHeight,
    },
    tiles: rectangleTiles({ x: col, y: row }, { x: endCol, y: endRow }),
  };
}

function getPrivateAreaBounds(area) {
  const bounds = area?.bounds || area;
  const col = Number(bounds?.col ?? bounds?.x);
  const row = Number(bounds?.row ?? bounds?.y);
  const width = Number(bounds?.width ?? bounds?.w);
  const height = Number(bounds?.height ?? bounds?.h);
  if (![col, row, width, height].every(Number.isFinite)) return null;
  return { col, row, width, height };
}

export function normalizeExternalAreaUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(rawUrl)) {
    return `https://${rawUrl}`;
  }
  return "";
}

export function getAreaRectFromBounds(bounds, world) {
  if (!bounds || !world) return null;
  const col = clamp(Math.round(Number(bounds.col) || 0), 0, Math.max(0, world.columns - 1));
  const row = clamp(Math.round(Number(bounds.row) || 0), 0, Math.max(0, world.rows - 1));
  const width = clamp(Math.round(Number(bounds.width) || 1), 1, Math.max(1, world.columns - col));
  const height = clamp(Math.round(Number(bounds.height) || 1), 1, Math.max(1, world.rows - row));
  const endCol = col + width - 1;
  const endRow = row + height - 1;

  return {
    bounds: { col, row, width, height },
    pixel: {
      x: col * world.tileSize,
      y: row * world.tileSize,
      width: width * world.tileSize,
      height: height * world.tileSize,
    },
    tiles: rectangleTiles({ x: col, y: row }, { x: endCol, y: endRow }),
  };
}

export function getAreaEditModeAtPoint(point, area, world) {
  const bounds = getPrivateAreaBounds(area);
  const areaRect = getAreaRectFromBounds(bounds, world);
  if (!point || !areaRect?.pixel) return "";

  const { x, y, width, height } = areaRect.pixel;
  const right = x + width;
  const bottom = y + height;
  if (point.x < x || point.x > right || point.y < y || point.y > bottom) return "";

  const handleSize = clamp(world.tileSize * 0.35, 8, 18);
  const nearLeft = Math.abs(point.x - x) <= handleSize;
  const nearRight = Math.abs(point.x - right) <= handleSize;
  const nearTop = Math.abs(point.y - y) <= handleSize;
  const nearBottom = Math.abs(point.y - bottom) <= handleSize;

  if (nearTop && nearLeft) return "nw";
  if (nearTop && nearRight) return "ne";
  if (nearBottom && nearLeft) return "sw";
  if (nearBottom && nearRight) return "se";
  if (nearTop) return "n";
  if (nearRight) return "e";
  if (nearBottom) return "s";
  if (nearLeft) return "w";
  return "move";
}

export function getAreaCursorClass(mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const supportedModes = new Set(["draw", "move", "n", "e", "s", "w", "ne", "nw", "se", "sw"]);
  return supportedModes.has(normalizedMode) ? `limeets-area-cursor-${normalizedMode}` : "";
}

export function getAreaRectFromEditDrag(drag, point, world) {
  if (!drag?.startBounds || !drag?.startPoint || !point || !world) return null;

  const deltaCols = Math.round((point.x - drag.startPoint.x) / world.tileSize);
  const deltaRows = Math.round((point.y - drag.startPoint.y) / world.tileSize);
  const start = drag.startBounds;
  let col = start.col;
  let row = start.row;
  let width = start.width;
  let height = start.height;

  if (drag.mode === "move") {
    col = clamp(start.col + deltaCols, 0, Math.max(0, world.columns - start.width));
    row = clamp(start.row + deltaRows, 0, Math.max(0, world.rows - start.height));
    return getAreaRectFromBounds({ col, row, width, height }, world);
  }

  if (drag.mode.includes("w")) {
    const originalRight = start.col + start.width;
    col = clamp(start.col + deltaCols, 0, originalRight - 1);
    width = originalRight - col;
  }
  if (drag.mode.includes("e")) {
    const nextRight = clamp(start.col + start.width + deltaCols, start.col + 1, world.columns);
    width = nextRight - start.col;
  }
  if (drag.mode.includes("n")) {
    const originalBottom = start.row + start.height;
    row = clamp(start.row + deltaRows, 0, originalBottom - 1);
    height = originalBottom - row;
  }
  if (drag.mode.includes("s")) {
    const nextBottom = clamp(start.row + start.height + deltaRows, start.row + 1, world.rows);
    height = nextBottom - start.row;
  }

  return getAreaRectFromBounds({ col, row, width, height }, world);
}

function getAreaEffects(area) {
  return {
    ...DEFAULT_AREA_EFFECTS,
    ...(area?.effects && typeof area.effects === "object" ? area.effects : {}),
  };
}

function getAreaDestination(area, fallbackRoomId) {
  const destination = area?.destination || area?.teleporter || {};
  return {
    roomId: String(destination.roomId || destination.mapId || fallbackRoomId || CUSTOM_WORLD_MAP_ID),
    x: Number.isFinite(Number(destination.x ?? destination.col)) ? Number(destination.x ?? destination.col) : 0,
    y: Number.isFinite(Number(destination.y ?? destination.row)) ? Number(destination.y ?? destination.row) : 0,
  };
}

function getAreaNavigationTarget(area) {
  const target = String(area?.tabId || area?.targetTabId || area?.portal?.tabId || "").trim();
  return NAVIGATION_AREA_OPTIONS.some((option) => option.tabId === target)
    ? target
    : DEFAULT_NAVIGATION_TAB;
}

export function getAreaOpenLinkOptions(area) {
  const interaction = String(area?.openLinkInteraction || "").trim();
  return {
    interaction: OPEN_LINK_INTERACTION_OPTIONS.some((option) => option.value === interaction)
      ? interaction
      : "action",
    newTab: Boolean(area?.openLinkNewTab),
  };
}

export function openAreaLink(url, newTab = true) {
  const safeUrl = normalizeExternalAreaUrl(url);
  if (!safeUrl || typeof window === "undefined") return false;
  if (newTab) {
    window.open(safeUrl, "_blank", "noopener,noreferrer");
  } else {
    window.location.assign(safeUrl);
  }
  return true;
}

export function shouldRunLandingEffect({
  idleActionKey = "",
  lastIdleActionKey = "",
  moving = false,
  triggeredAreaId = "",
  triggerAreaId = "",
} = {}) {
  if (moving || !idleActionKey) return false;
  if (triggerAreaId && triggeredAreaId === triggerAreaId) return false;
  return idleActionKey !== lastIdleActionKey;
}

function getNavigationPreset(tabId) {
  return NAVIGATION_AREA_OPTIONS.find((option) => option.tabId === tabId) || NAVIGATION_AREA_OPTIONS[0];
}

function getAreaTiles(area, world) {
  const bounds = getPrivateAreaBounds(area);
  if (!bounds || !world) return [];
  const start = {
    x: clamp(bounds.col, 0, world.columns - 1),
    y: clamp(bounds.row, 0, world.rows - 1),
  };
  const end = {
    x: clamp(bounds.col + bounds.width - 1, start.x, world.columns - 1),
    y: clamp(bounds.row + bounds.height - 1, start.y, world.rows - 1),
  };
  return rectangleTiles(start, end);
}

function getAreaCenterTile(area, world) {
  const bounds = getPrivateAreaBounds(area);
  if (!bounds || !world) return { x: 0, y: 0 };
  return {
    x: clamp(Math.floor(bounds.col + bounds.width / 2), 0, world.columns - 1),
    y: clamp(Math.floor(bounds.row + bounds.height / 2), 0, world.rows - 1),
  };
}

export function buildAreaProperties(area) {
  const effects = getAreaEffects(area);
  const properties = [];
  if (effects.meeting) properties.push({ type: "meetingArea" });
  if (effects.entryExit) properties.push({ type: "navigate", tabId: getAreaNavigationTarget(area) });
  if (effects.openLink) {
    const openLink = getAreaOpenLinkOptions(area);
    properties.push({
      type: "openWebsite",
      newTab: openLink.newTab,
      trigger: openLink.interaction,
      url: normalizeExternalAreaUrl(area?.linkUrl),
    });
  }
  if (effects.teleport) properties.push({ type: "teleport", destination: area?.destination || null });
  if (effects.impassable) properties.push({ type: "impassable" });
  return properties;
}

function clearAreaTileEffects(worldConfig, area) {
  if (!worldConfig || !area?.id) return;
  const room = worldConfig.rooms?.find((candidate) => candidate.id === (area.roomId || worldConfig.activeRoomId));
  if (!room) return;

  const effects = getAreaEffects(area);
  const affectedKeys = new Set(getAreaTiles(area, worldConfig).map((tile) => makeTileKey(tile.x, tile.y)));
  Object.entries(room.tilemap || {}).forEach(([key, tile]) => {
    if (tile?.privateAreaId === area.id) affectedKeys.add(key);
  });

  affectedKeys.forEach((key) => {
    const entry = { ...(room.tilemap[key] || {}) };
    if (!Object.keys(entry).length) return;
    if (entry.privateAreaId === area.id) delete entry.privateAreaId;
    if (effects.entryExit) delete entry.entryExit;
    if (effects.entryExit) delete entry.portal;
    if (effects.openLink) delete entry.openUrl;
    if (effects.teleport) delete entry.teleporter;
    if (effects.impassable) delete entry.impassable;

    if (Object.keys(entry).length) room.tilemap[key] = entry;
    else delete room.tilemap[key];
  });
}

function materializeAreaTileEffects(worldConfig, area, previousArea = null) {
  if (!worldConfig || !area?.id) return;
  if (previousArea) clearAreaTileEffects(worldConfig, previousArea);

  const room = worldConfig.rooms?.find((candidate) => candidate.id === (area.roomId || worldConfig.activeRoomId));
  if (!room) return;

  const effects = getAreaEffects(area);
  const destination = getAreaDestination(area, worldConfig.activeRoomId);
  const navigationPreset = getNavigationPreset(getAreaNavigationTarget(area));
  getAreaTiles(area, worldConfig).forEach((tile) => {
    const key = makeTileKey(tile.x, tile.y);
    const entry = { ...(room.tilemap[key] || {}) };
    if (effects.meeting) entry.privateAreaId = area.id;
    if (effects.entryExit) {
      delete entry.entryExit;
      entry.portal = {
        tabId: navigationPreset.tabId,
        label: navigationPreset.label,
      };
    }
    const openUrl = normalizeExternalAreaUrl(area.linkUrl);
    if (effects.openLink && openUrl) entry.openUrl = openUrl;
    if (effects.teleport) entry.teleporter = destination;
    if (effects.impassable) entry.impassable = true;
    if (Object.keys(entry).length) room.tilemap[key] = entry;
    else delete room.tilemap[key];
  });
}

function getAreaAtPoint(point, world, worldRoomId) {
  if (!point || !world) return null;
  const candidates = (Array.isArray(world.privateAreas) ? world.privateAreas : []).filter(
    (area) => !area.roomId || area.roomId === worldRoomId,
  );

  return [...candidates].reverse().find((area) => {
    const bounds = getPrivateAreaBounds(area);
    if (!bounds) return false;
    const left = bounds.col * world.tileSize;
    const top = bounds.row * world.tileSize;
    const right = left + bounds.width * world.tileSize;
    const bottom = top + bounds.height * world.tileSize;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }) || null;
}

function areaContainsTile(area, tile) {
  const bounds = getPrivateAreaBounds(area);
  if (!bounds || !tile) return false;
  return (
    tile.x >= bounds.col &&
    tile.x < bounds.col + bounds.width &&
    tile.y >= bounds.row &&
    tile.y < bounds.row + bounds.height
  );
}

function getAreaAtTile(tile, world, worldRoomId) {
  if (!tile || !world) return null;
  const candidates = (Array.isArray(world.privateAreas) ? world.privateAreas : []).filter(
    (area) => !area.roomId || area.roomId === worldRoomId,
  );
  return [...candidates].reverse().find((area) => areaContainsTile(area, tile)) || null;
}

function areaRectContainsSpawn(areaRect, world) {
  const spawn = world?.spawnpoint;
  if (!areaRect?.tiles?.length || !spawn || spawn.roomId !== world?.activeRoomId) return false;
  return areaRect.tiles.some((tile) => tile.x === spawn.x && tile.y === spawn.y);
}

function tileContainsObject(tilemap, targetTile) {
  return getTopPlacementAtTile(tilemap, targetTile, "object");
}

function clearTileEntry(entry, target) {
  const next = { ...entry };

  if (target === "all" || target === "floor") delete next.floor;
  if (target === "all" || target === "above_floor") delete next.above_floor;
  if (target === "all" || target === "object") delete next.object;

  if (target === "all" || target === "special") {
    delete next.impassable;
    delete next.teleporter;
    delete next.privateAreaId;
    delete next.portal;
    delete next.entryExit;
    delete next.openUrl;
  }

  return next;
}

function canPlaceAssetAtTile(asset, layer, tile, world, tilemap) {
  if (!canAssetUseLayer(asset, layer)) return false;
  if (!world || !tile) return false;
  const { width, height } = getAssetDimensions(asset, layer);
  for (let y = tile.y; y < tile.y + height; y += 1) {
    for (let x = tile.x; x < tile.x + width; x += 1) {
      if (x < 0 || y < 0 || x >= world.columns || y >= world.rows) return false;

      if (layer !== "object") continue;

      const entry = tilemap?.[makeTileKey(x, y)];
      if (entry?.impassable) return false;
    }
  }

  return true;
}

function Avatar({ avatarPreset, className = "", name, player, status = "online" }) {
  const avatar = normalizeLimeetsAvatarPreset(avatarPreset);
  const statusClass = normalizeProfileStatus(status);

  return (
    <div
      className={`limeets-gather-avatar ${className}`}
      style={{
        "--avatar-x": `${player.x}px`,
        "--avatar-y": `${player.y}px`,
        zIndex: 2000 + Math.round(player.y),
      }}
    >
      <div className="limeets-gather-avatar-name">
        <span className={statusClass} aria-hidden="true" />
        {name}
      </div>
      <div
        aria-label={`${name} avatar, ${status}`}
        className="limeets-gather-avatar-sprite"
        role="img"
      >
        <AvatarPreview
          avatar={avatar}
          direction={player.direction || "down"}
          frame={player.frame ?? 0}
          moving={Boolean(player.moving)}
          size="world"
        />
      </div>
    </div>
  );
}

function ToolButton({ active, children, disabled = false, label, onClick }) {
  return (
    <button
      aria-label={label}
      className={active ? "active" : ""}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function LayerButton({ active, children, disabled = false, layer, onClick }) {
  return (
    <button
      className={active ? "active" : ""}
      disabled={disabled}
      onClick={() => onClick(layer)}
      type="button"
    >
      {children}
    </button>
  );
}

function FieldSelectMenu({ label, onChange, options, value }) {
  const selectedOption = options.find((option) => option.value === value) || options[0];

  return (
    <label className="limeets-gather-field">
      <span>{label}</span>
      <AppSelectMenu
        ariaLabel={label}
        className="field-select-menu academic-term-select limeets-gather-select-menu"
        onChange={onChange}
        options={options}
        placeholder={selectedOption?.label || "Select"}
        value={value}
      />
    </label>
  );
}

function CategoryRow({ category, onSelect }) {
  return (
    <button className="limeets-gather-category" onClick={() => onSelect(category)} type="button">
      <span className="limeets-gather-category-thumb">
        {category.thumbnailAsset ? <AssetPreview asset={category.thumbnailAsset} className="limeets-gather-category-preview" /> : <Box size={20} />}
      </span>
      <span>
        <strong>{category.label}</strong>
        <small>{getCategoryDescription(category)}</small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

function AssetButton({ asset, selected, onSelect }) {
  return (
    <button
      className={selected ? "selected" : ""}
      onClick={() => onSelect(asset)}
      title={asset.label}
      type="button"
    >
      <AssetPreview asset={asset} className="limeets-gather-asset-preview" />
      <span>{asset.label}</span>
    </button>
  );
}

function getCroppedAssetStyle(asset) {
  if (!asset?.sheetCols || !asset?.sheetRows || asset.sheetCol == null || asset.sheetRow == null) return null;
  return {
    backgroundImage: `url("${asset.src}")`,
    backgroundPosition: `${asset.sheetCols <= 1 ? 0 : (asset.sheetCol / (asset.sheetCols - 1)) * 100}% ${
      asset.sheetRows <= 1 ? 0 : (asset.sheetRow / (asset.sheetRows - 1)) * 100
    }%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${asset.sheetCols * 100}% ${asset.sheetRows * 100}%`,
  };
}

function AssetPreview({ asset, className = "", style = {} }) {
  const cropStyle = getCroppedAssetStyle(asset);
  if (cropStyle) {
    return (
      <span
        aria-hidden="true"
        className={`limeets-gather-cropped-asset ${className}`}
        style={{ ...style, ...cropStyle }}
      />
    );
  }

  return <img alt="" className={className} draggable="false" src={asset.src} style={style} />;
}

function TileSprite({ assetId, layer, tileSize }) {
  if (!assetId) return null;
  const asset = getLimeetsAsset(assetId);
  if (!asset?.src) return null;
  const { width, height } = getAssetDimensions(asset, layer);

  return (
    <AssetPreview
      asset={asset}
      className={`limeets-gather-tile-sprite layer-${layer}`}
      style={{
        height: `${height * tileSize}px`,
        width: `${width * tileSize}px`,
      }}
    />
  );
}

export function VirtualStudySpace({
  currentMeetingArea = null,
  isActive = true,
  onMeetingAreaChange,
  onNavigate,
  onWorldChanged,
  onWorldDirtyChange,
  profileStatus = "online",
  returnToSpawnSignal = 0,
  room,
  roomActivityMembers = [],
  socket,
  teleportTarget = null,
  user,
}) {
  const currentProfileStatus = normalizeProfileStatus(profileStatus);
  const currentMeetingAreaId = String(currentMeetingArea?.id || currentMeetingArea?.areaId || "");
  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const worldRoomRef = useRef(null);
  const playerRef = useRef(null);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const keysRef = useRef(new Set());
  const blockedTilesRef = useRef(new Set());
  const lastEmitRef = useRef(0);
  const meetingAreaRef = useRef("");
  const activeAreaRef = useRef("");
  const triggeredAreaRef = useRef("");
  const lastIdleActionKeyRef = useRef("");
  const lastPresenceSnapshotRef = useRef("");
  const lastSpaceJoinRetryRef = useRef(0);
  const lastReturnToSpawnSignalRef = useRef(0);
  const lastTeleportTargetRef = useRef("");
  const playerInitKeyRef = useRef("");
  const initialCameraKeyRef = useRef("");
  const panRef = useRef(null);
  const areaDragRef = useRef(null);
  const areaEditDragRef = useRef(null);
  const activeAreaLinkKeyRef = useRef("");
  const dragTileRef = useRef(null);
  const followPlayerRef = useRef(true);
  const socketRef = useRef(socket);
  const roomIdRef = useRef(room?.id);
  const draftWorldRef = useRef(normalizeWorldConfig(room?.worldConfig));
  const historyRef = useRef([]);
  const futureRef = useRef([]);

  const [draftWorld, setDraftWorld] = useState(() => normalizeWorldConfig(room?.worldConfig));
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [worldSaved, setWorldSaved] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [player, setPlayer] = useState(null);
  const [remoteMembers, setRemoteMembers] = useState([]);
  const [hoveredTile, setHoveredTile] = useState(null);
  const [areaPreview, setAreaPreview] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const [activeAreaLink, setActiveAreaLink] = useState(null);
  const [activeMeetingAreaId, setActiveMeetingAreaId] = useState("");
  const [showMeetingAreas, setShowMeetingAreas] = useState(() => readMeetingAreaVisibilityStorage(room?.id));
  const [areaActionTooltip, setAreaActionTooltip] = useState(null);
  const [areaCursorMode, setAreaCursorMode] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPanel, setEditorPanel] = useState("objects");
  const [activeTool, setActiveTool] = useState("select");
  const [paintMode, setPaintMode] = useState("single");
  const [eraserTarget, setEraserTarget] = useState("all");
  const [showGizmos, setShowGizmos] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<LimeetsLayer>("object");
  const [selectedSpecial, setSelectedSpecial] = useState("");
  const [selectedCategoryPath, setSelectedCategoryPath] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedTileKey, setSelectedTileKey] = useState("");
  const [selectedPlacement, setSelectedPlacement] = useState(null);
  const [selectedTileKeys, setSelectedTileKeys] = useState([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [collapsedAreaPropertyIds, setCollapsedAreaPropertyIds] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [teleportDraft, setTeleportDraft] = useState({ roomId: CUSTOM_WORLD_MAP_ID, x: 0, y: 0 });
  const [worldSizeDraft, setWorldSizeDraft] = useState({ columns: "", rows: "" });

  const isOwner = Boolean(room?.isOwner);
  const avatarPreset = normalizeLimeetsAvatarPreset(user?.avatarPreset);
  const currentUserName = getDisplayName(user);
  const playerReady = Boolean(player);

  const world = useMemo(() => {
    const normalized = normalizeWorldConfig(draftWorld);
    return {
      ...normalized,
      ...getWorldSize(normalized),
    };
  }, [draftWorld]);

  const worldRoom = useMemo(() => getRoomFromWorld(world), [world]);
  const worldRoomDisplayName = worldRoom.name === "World" ? "Domain" : worldRoom.name;
  const worldBackground = useMemo(() => getBackgroundCss(room, world), [room, world]);
  const blockedTiles = useMemo(() => getBlockedTiles(world, worldRoom), [world, worldRoom]);
  const assetCategoryTree = useMemo(() => buildAssetCategoryTree(LIMEETS_OBJECT_ASSETS), []);
  const selectedCategory = useMemo(
    () => findCategoryNode(assetCategoryTree, selectedCategoryPath),
    [assetCategoryTree, selectedCategoryPath],
  );
  const currentAssetCategory = selectedCategory || assetCategoryTree;
  const fitScale = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height || !world.width || !world.height) return 1;
    const visibleViewport = getVisibleViewportSize(viewportSize, editorOpen, isOwner);
    const paddedWidth = Math.max(1, visibleViewport.width - FIT_WORLD_PADDING_PX * 2);
    const paddedHeight = Math.max(1, visibleViewport.height - FIT_WORLD_PADDING_PX * 2);
    return clamp(
      Math.min(paddedWidth / world.width, paddedHeight / world.height),
      CAMERA_MIN_SCALE,
      CAMERA_MAX_SCALE,
    );
  }, [editorOpen, isOwner, viewportSize, world.height, world.width]);
  const selectedTile = useMemo(
    () => (selectedTileKey ? worldRoom.tilemap?.[selectedTileKey] || null : null),
    [selectedTileKey, worldRoom.tilemap],
  );
  const worldAreas = useMemo(
    () =>
      (Array.isArray(world.privateAreas) ? world.privateAreas : []).filter(
        (area) => !area.roomId || area.roomId === worldRoom.id,
      ),
    [world.privateAreas, worldRoom.id],
  );
  const selectedArea = useMemo(
    () => worldAreas.find((area) => area?.id === selectedAreaId) || null,
    [selectedAreaId, worldAreas],
  );
  const meetingAreas = useMemo(
    () => worldAreas.filter((area) => getAreaEffects(area).meeting),
    [worldAreas],
  );
  const activeMeetingArea = useMemo(
    () => meetingAreas.find((area) => area?.id === activeMeetingAreaId) || null,
    [activeMeetingAreaId, meetingAreas],
  );
  const selectedAreaEffects = useMemo(() => getAreaEffects(selectedArea), [selectedArea]);
  const selectedPlacementInfo = useMemo(() => {
    if (!selectedPlacement) return null;
    const tile = worldRoom.tilemap?.[selectedPlacement.key];
    const stack = getLayerStack(tile, selectedPlacement.layer);
    const assetId = stack[selectedPlacement.index];
    const asset = getLimeetsAsset(assetId);
    if (!assetId || !asset) return null;
    const parsed = parseTileKey(selectedPlacement.key);
    return {
      ...selectedPlacement,
      asset,
      assetId,
      origin: parsed ? { x: parsed.x, y: parsed.y } : null,
      stackLength: stack.length,
      tile,
    };
  }, [selectedPlacement, worldRoom.tilemap]);
  const selectedTilePlacements = useMemo(() => {
    if (!selectedTileKey || !selectedTile) return [];
    return ["object", "above_floor", "floor"].flatMap((layer) =>
      getLayerStack(selectedTile, layer)
        .map((assetId, index) => {
          const asset = getLimeetsAsset(assetId);
          if (!asset) return null;
          return {
            asset,
            assetId,
            index,
            key: selectedTileKey,
            layer,
          };
        })
        .filter(Boolean),
    );
  }, [selectedTile, selectedTileKey]);
  const filteredAssetMatches = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return [];
    return assetCategoryTree.assets.filter((asset) =>
      `${asset.label} ${asset.category}`.toLowerCase().includes(query),
    );
  }, [assetCategoryTree, searchTerm]);
  const visibleAssets = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (query) return filteredAssetMatches;
    if (currentAssetCategory.children.length) return [];
    return currentAssetCategory.assets;
  }, [currentAssetCategory, filteredAssetMatches, searchTerm]);
  const selectedColorOptions = useMemo(() => getAssetColorOptions(selectedAsset), [selectedAsset]);
  const selectedDirectionOptions = useMemo(() => getAssetDirectionOptions(selectedAsset), [selectedAsset]);
  const zoneOptions = useMemo(
    () =>
      world.rooms.map((candidate, index) => ({
        label: candidate.name || getZoneFallbackName(index),
        value: candidate.id,
      })),
    [world.rooms],
  );
  const navigationOptions = useMemo(
    () => NAVIGATION_AREA_OPTIONS.map((option) => ({ label: option.label, value: option.tabId })),
    [],
  );

  const handleSelectLayer = useCallback((layer: LimeetsLayer) => {
    if (selectedAsset && !canAssetUseLayer(selectedAsset, layer)) return;
    setSelectedLayer(layer);
    setSelectedSpecial("");
    setActiveTool("paint");
  }, [selectedAsset]);

  const handleSelectAsset = useCallback((nextAsset) => {
    setSelectedAsset(nextAsset);
    setSelectedLayer(getSmartLayerForAsset(nextAsset));
    setSelectedSpecial("");
    setActiveTool("paint");
  }, []);

  useEffect(() => {
    const normalized = normalizeWorldConfig(room?.worldConfig);
    setDraftWorld(normalized);
    draftWorldRef.current = normalized;
    historyRef.current = [];
    futureRef.current = [];
    setHistory([]);
    setFuture([]);
    setWorldSaved(true);
    setSelectedTileKey("");
    setSelectedPlacement(null);
    setSelectedTileKeys([]);
    setSelectedAsset(null);
    setSelectedCategoryPath("");
    setSelectedSpecial("");
    setSelectedAreaId("");
    setAreaPreview(null);
    setActiveMeetingAreaId("");
    setShowMeetingAreas(readMeetingAreaVisibilityStorage(room?.id));
    setEditorPanel("objects");
    meetingAreaRef.current = "";
    activeAreaRef.current = "";
    lastIdleActionKeyRef.current = "";
    triggeredAreaRef.current = readAreaTriggerStorage(room?.id);
  }, [room?.id, room?.worldConfig]);

  useEffect(() => {
    onWorldDirtyChange?.(!worldSaved);
  }, [onWorldDirtyChange, worldSaved]);

  useEffect(() => {
    if (!isOwner || worldSaved) return undefined;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isOwner, worldSaved]);

  useEffect(() => {
    if (selectedAreaId && !selectedArea) setSelectedAreaId("");
  }, [selectedArea, selectedAreaId]);

  useEffect(() => {
    if (activeMeetingAreaId && !activeMeetingArea) setActiveMeetingAreaId("");
  }, [activeMeetingArea, activeMeetingAreaId]);

  useEffect(() => {
    meetingAreaRef.current = currentMeetingAreaId;
    setActiveMeetingAreaId(currentMeetingAreaId);
  }, [currentMeetingAreaId]);

  const toggleMeetingAreaVisibility = useCallback(() => {
    setShowMeetingAreas((current) => {
      const next = !current;
      writeMeetingAreaVisibilityStorage(roomIdRef.current || room?.id, next);
      return next;
    });
  }, [room?.id]);

  useEffect(() => {
    if (!selectedArea) {
      setCollapsedAreaPropertyIds({});
      return;
    }
  }, [selectedAreaId, selectedArea]);

  useEffect(() => {
    setWorldSizeDraft({
      columns: String(world.columns),
      rows: String(world.rows),
    });
  }, [world.activeRoomId, world.columns, world.rows]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    roomIdRef.current = room?.id;
  }, [room?.id]);

  useEffect(() => {
    worldRef.current = world;
    worldRoomRef.current = worldRoom;
    blockedTilesRef.current = blockedTiles;
    draftWorldRef.current = world;
  }, [blockedTiles, world, worldRoom]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    if (!isActive) return undefined;
    if (!viewportRef.current) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [isActive]);

  const constrainCamera = useCallback(
    (nextCamera) => {
      const viewport = viewportRef.current;
      if (!viewport) return nextCamera;

      const rect = viewport.getBoundingClientRect();
      const scaledWidth = world.width * nextCamera.scale;
      const scaledHeight = world.height * nextCamera.scale;
      const reservedWidth = getEditorReservedWidth(rect.width, editorOpen, isOwner);
      const visibleWidth = Math.max(1, rect.width - reservedWidth);
      const edgePaddingX = editorOpen && isOwner ? Math.min(180, Math.max(88, visibleWidth * 0.12)) : 96;
      const edgePaddingY = editorOpen && isOwner ? Math.min(260, Math.max(140, rect.height * 0.18)) : 96;
      const clampAxis = (position, viewportLength, scaledLength, padding) => {
        if (scaledLength + padding * 2 <= viewportLength) return (viewportLength - scaledLength) / 2;
        return clamp(position, viewportLength - scaledLength - padding, padding);
      };

      return {
        ...nextCamera,
        x: clampAxis(nextCamera.x, visibleWidth, scaledWidth, edgePaddingX),
        y: clampAxis(nextCamera.y, rect.height, scaledHeight, edgePaddingY),
      };
    },
    [editorOpen, isOwner, world.height, world.width],
  );

  const centerCameraOn = useCallback(
    (point, nextScale = cameraRef.current.scale || fitScale || 1) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const scale = clamp(nextScale, fitScale, CAMERA_MAX_SCALE);
      const visibleViewport = getVisibleViewportSize(
        { width: rect.width, height: rect.height },
        editorOpen,
        isOwner,
      );
      const nextCamera = constrainCamera({
        scale,
        x: visibleViewport.width / 2 - point.x * scale,
        y: rect.height / 2 - point.y * scale,
      });
      cameraRef.current = nextCamera;
      setCamera(nextCamera);
    },
    [constrainCamera, editorOpen, fitScale, isOwner],
  );

  useEffect(() => {
    const initKey = `${room?.id || ""}:${worldRoom.id}:${world.columns}:${world.rows}:${world.tileSize}`;
    if (playerInitKeyRef.current === initKey && playerRef.current) return;

    playerInitKeyRef.current = initKey;
    initialCameraKeyRef.current = "";
    const nextPlayer = getInitialPlayer(world, worldRoom, room);
    playerRef.current = nextPlayer;
    setPlayer(nextPlayer);
  }, [
    room?.id,
    room?.worldConfig,
    world.columns,
    world.rows,
    world.tileSize,
    worldRoom.id,
  ]);

  useEffect(() => {
    const initKey = playerInitKeyRef.current;
    if (
      initKey &&
      initialCameraKeyRef.current !== initKey &&
      viewportSize.width &&
      viewportSize.height &&
      playerRef.current
    ) {
      initialCameraKeyRef.current = initKey;
      centerCameraOn(playerRef.current, fitScale);
    }
  }, [centerCameraOn, fitScale, viewportSize.height, viewportSize.width]);

  const setCameraState = useCallback(
    (nextCamera) => {
      const constrained = constrainCamera(nextCamera);
      cameraRef.current = constrained;
      setCamera(constrained);
    },
    [constrainCamera],
  );

  const applyWorldUpdate = useCallback((updater, { snapshot = true } = {}) => {
    setDraftWorld((current) => {
      const base = normalizeWorldConfig(current);
      const next = normalizeWorldConfig(typeof updater === "function" ? updater(clone(base)) : updater);
      if (snapshot) {
        const nextHistory = [...historyRef.current, clone(base)].slice(-60);
        historyRef.current = nextHistory;
        futureRef.current = [];
        setHistory(nextHistory);
        setFuture([]);
      }
      setWorldSaved(false);
      draftWorldRef.current = next;
      return next;
    });
  }, []);

  const undoWorld = useCallback(() => {
    const items = historyRef.current;
    if (!items.length) return;

    const previous = items[items.length - 1];
    const nextHistory = items.slice(0, -1);
    const nextFuture = [clone(draftWorldRef.current), ...futureRef.current].slice(0, 60);

    historyRef.current = nextHistory;
    futureRef.current = nextFuture;
    setHistory(nextHistory);
    setFuture(nextFuture);
    setDraftWorld(previous);
    draftWorldRef.current = previous;
    setWorldSaved(false);
  }, []);

  const redoWorld = useCallback(() => {
    const items = futureRef.current;
    if (!items.length) return;

    const next = items[0];
    const nextHistory = [...historyRef.current, clone(draftWorldRef.current)].slice(-60);
    const nextFuture = items.slice(1);

    historyRef.current = nextHistory;
    futureRef.current = nextFuture;
    setHistory(nextHistory);
    setFuture(nextFuture);
    setDraftWorld(next);
    draftWorldRef.current = next;
    setWorldSaved(false);
  }, []);

  const updateActiveRoomTile = useCallback(
    (tile, updater, options) => {
      applyWorldUpdate((current) => ({
        ...current,
        rooms: current.rooms.map((candidate) => {
          if (candidate.id !== current.activeRoomId) return candidate;
          const key = makeTileKey(tile.x, tile.y);
          const existing = candidate.tilemap[key] || {};
          const nextTile = updater({ ...existing }, current);
          const nextTilemap = { ...candidate.tilemap };

          if (!nextTile || !Object.keys(nextTile).length) {
            delete nextTilemap[key];
          } else {
            nextTilemap[key] = nextTile;
          }

          return { ...candidate, tilemap: nextTilemap };
        }),
      }), options);
    },
    [applyWorldUpdate],
  );

  const persistAndBroadcast = useCallback((nextPlayer, now = performance.now()) => {
    const currentWorld = worldRef.current;
    const currentWorldRoom = worldRoomRef.current;
    if (!currentWorld || !currentWorldRoom) return;

    const position = serializePlayerPosition(nextPlayer, currentWorld, currentWorldRoom);
    const snapshot = `${position.worldRoomId}:${position.x}:${position.y}:${position.direction}:${position.moving}`;

    if (snapshot === lastPresenceSnapshotRef.current && now - lastEmitRef.current < 1000) {
      return;
    }
    if (position.moving && now - lastEmitRef.current < MOVE_EMIT_INTERVAL_MS) {
      return;
    }

    lastPresenceSnapshotRef.current = snapshot;
    lastEmitRef.current = now;

    const storageKey = getStorageKey(roomIdRef.current);
    if (storageKey) {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          worldRoomId: currentWorldRoom.id,
          x: nextPlayer.x,
          y: nextPlayer.y,
          direction: nextPlayer.direction,
        }),
      );
    }

    const activeSocket = socketRef.current;
    const activeRoomId = roomIdRef.current;
    if (!activeSocket?.connected || !activeRoomId) return;

    activeSocket.emit(
      "space:move",
      {
        profileStatus: currentProfileStatus,
        roomId: activeRoomId,
        position,
      },
      (ack) => {
        if (ack?.ok || performance.now() - lastSpaceJoinRetryRef.current < 2000) return;

        lastSpaceJoinRetryRef.current = performance.now();
        activeSocket.emit("space:join", {
          profileStatus: currentProfileStatus,
          roomId: activeRoomId,
          position,
        });
      },
    );
  }, [currentProfileStatus]);

  const movePlayerToSpawn = useCallback(() => {
    const currentWorld = worldRef.current || world;
    const currentPlayer = playerRef.current;
    if (!currentWorld || !currentPlayer) return;

    const spawn = currentWorld.spawnpoint || {
      roomId: currentWorld.activeRoomId,
      x: Math.floor(currentWorld.columns / 2),
      y: Math.floor(currentWorld.rows / 2),
    };
    const spawnRoom =
      currentWorld.rooms.find((candidate) => candidate.id === spawn.roomId) ||
      currentWorld.rooms[0] ||
      worldRoomRef.current;
    const point = clampPointToWorldRoom(
      tileToWorldPoint({ x: spawn.x, y: spawn.y }, currentWorld.tileSize),
      currentWorld,
      spawnRoom?.id || currentWorld.activeRoomId,
    );
    const nextPlayer = {
      ...currentPlayer,
      ...point,
      direction: "down",
      frame: getAvatarFrame("down", false, 0),
      moving: false,
      path: [],
    };

    keysRef.current.clear();
    playerRef.current = nextPlayer;
    setPlayer(nextPlayer);
    followPlayerRef.current = true;
    meetingAreaRef.current = "";
    setActiveMeetingAreaId("");
    activeAreaRef.current = "";
    triggeredAreaRef.current = "";
    lastIdleActionKeyRef.current = "";
    writeAreaTriggerStorage(roomIdRef.current || room?.id, "");
    onMeetingAreaChange?.(null);

    if (spawnRoom?.id) {
      worldRoomRef.current = spawnRoom;
      if (spawnRoom.id !== currentWorld.activeRoomId) {
        applyWorldUpdate(
          (current) => ({
            ...current,
            activeRoomId: spawnRoom.id,
          }),
          { snapshot: false },
        );
      }
    }

    centerCameraOn(nextPlayer, cameraRef.current.scale || fitScale || 1);
    persistAndBroadcast(nextPlayer, performance.now() + MOVE_EMIT_INTERVAL_MS);
  }, [applyWorldUpdate, centerCameraOn, fitScale, onMeetingAreaChange, persistAndBroadcast, room?.id, world]);

  const movePlayerToTeleportTarget = useCallback(
    (target) => {
      const currentWorld = worldRef.current || world;
      const currentPlayer = playerRef.current;
      if (!currentWorld || !currentPlayer || !target) return;

      const destinationRoomId = String(target.worldRoomId || currentWorld.activeRoomId || CUSTOM_WORLD_MAP_ID);
      const destinationRoom =
        currentWorld.rooms.find((candidate) => candidate.id === destinationRoomId) ||
        currentWorld.rooms[0] ||
        worldRoomRef.current;
      const destinationColumns = Number(destinationRoom?.columns || currentWorld.columns || 1);
      const destinationRows = Number(destinationRoom?.rows || currentWorld.rows || 1);
      const tile = {
        x: clamp(Math.round(Number(target.x ?? target.col) || 0), 0, Math.max(0, destinationColumns - 1)),
        y: clamp(Math.round(Number(target.y ?? target.row) || 0), 0, Math.max(0, destinationRows - 1)),
      };
      const point = clampPointToWorldRoom(
        tileToWorldPoint(tile, currentWorld.tileSize),
        currentWorld,
        destinationRoom?.id || destinationRoomId,
      );
      const nextPlayer = {
        ...currentPlayer,
        ...point,
        direction: "down",
        frame: getAvatarFrame("down", false, 0),
        moving: false,
        path: [],
      };
      const area =
        (Array.isArray(currentWorld.privateAreas) ? currentWorld.privateAreas : []).find(
          (candidate) => candidate?.id === target.areaId,
        ) || null;

      keysRef.current.clear();
      playerRef.current = nextPlayer;
      setPlayer(nextPlayer);
      followPlayerRef.current = true;
      worldRoomRef.current = destinationRoom;
      lastIdleActionKeyRef.current = "";

      if (target.areaId) {
        meetingAreaRef.current = target.areaId;
        activeAreaRef.current = target.areaId;
        triggeredAreaRef.current = target.areaId;
        writeAreaTriggerStorage(roomIdRef.current || room?.id, target.areaId);
        onMeetingAreaChange?.({
          areaId: target.areaId,
          name: area?.name || area?.label || target.areaName || "Meeting Area",
          tile,
          worldRoomId: destinationRoom?.id || destinationRoomId,
        });
      }

      if (destinationRoom?.id && destinationRoom.id !== currentWorld.activeRoomId) {
        applyWorldUpdate(
          (current) => ({
            ...current,
            activeRoomId: destinationRoom.id,
          }),
          { snapshot: false },
        );
      }

      centerCameraOn(nextPlayer, cameraRef.current.scale || fitScale || 1);
      persistAndBroadcast(nextPlayer, performance.now() + MOVE_EMIT_INTERVAL_MS);
    },
    [applyWorldUpdate, centerCameraOn, fitScale, onMeetingAreaChange, persistAndBroadcast, room?.id, world],
  );

  useEffect(() => {
    if (!returnToSpawnSignal || returnToSpawnSignal <= lastReturnToSpawnSignalRef.current || !playerReady) {
      return;
    }

    lastReturnToSpawnSignalRef.current = returnToSpawnSignal;
    movePlayerToSpawn();
  }, [movePlayerToSpawn, playerReady, returnToSpawnSignal]);

  useEffect(() => {
    if (!teleportTarget || !playerReady) return;

    const targetKey = String(
      teleportTarget.requestedAt ||
        `${teleportTarget.worldRoomId || ""}:${teleportTarget.areaId || ""}:${teleportTarget.x}:${teleportTarget.y}`,
    );
    if (!targetKey || targetKey === lastTeleportTargetRef.current) return;

    lastTeleportTargetRef.current = targetKey;
    movePlayerToTeleportTarget(teleportTarget);
  }, [movePlayerToTeleportTarget, playerReady, teleportTarget]);

  useEffect(() => {
    if (!isActive) {
      keysRef.current.clear();
      return undefined;
    }

    let animationFrame = 0;
    let lastTick = performance.now();
    let walkingElapsedMs = 0;

    function tick(now) {
      const currentWorld = worldRef.current;
      const currentWorldRoom = worldRoomRef.current;
      const currentPlayer = playerRef.current;
      const blocked = blockedTilesRef.current;

      if (!currentWorld || !currentWorldRoom || !currentPlayer) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      const deltaSeconds = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;

      let vectorX = 0;
      let vectorY = 0;
      keysRef.current.forEach((key) => {
        const vector = KEY_TO_VECTOR[key];
        if (!vector) return;
        vectorX += vector[0];
        vectorY += vector[1];
      });

      const keyboardMoving = vectorX !== 0 || vectorY !== 0;
      if (keyboardMoving) {
        currentPlayer.path = [];
        followPlayerRef.current = true;
      } else if (currentPlayer.path?.length) {
        const target = clampPointToWorldRoom(currentPlayer.path[0], currentWorld, currentWorldRoom.id);
        const dx = target.x - currentPlayer.x;
        const dy = target.y - currentPlayer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 2) {
          currentPlayer.x = target.x;
          currentPlayer.y = target.y;
          currentPlayer.path.shift();
        } else {
          vectorX = dx / distance;
          vectorY = dy / distance;
        }
      }

      const moving = vectorX !== 0 || vectorY !== 0 || Boolean(currentPlayer.path?.length);
      const speed =
        AVATAR_SPEED_PX_PER_SECOND *
        (keysRef.current.has("Shift") ? AVATAR_RUN_MULTIPLIER : 1);

      if (moving) {
        const length = Math.hypot(vectorX, vectorY) || 1;
        const unitX = vectorX / length;
        const unitY = vectorY / length;
        const nextX = currentPlayer.x + unitX * speed * deltaSeconds;
        const nextY = currentPlayer.y + unitY * speed * deltaSeconds;
        const nextPoint = clampPointToWorldRoom(
          { x: nextX, y: nextY },
          currentWorld,
          currentWorldRoom.id,
        );
        const nextTile = worldPointToTile(
          nextPoint,
          currentWorld.columns,
          currentWorld.rows,
          currentWorld.tileSize,
        );
        const nextKey = makeTileKey(nextTile.x, nextTile.y);

        if (!blocked.has(nextKey)) {
          currentPlayer.x = nextPoint.x;
          currentPlayer.y = nextPoint.y;
        } else {
          currentPlayer.path = [];
        }

        currentPlayer.direction = getDirectionFromDelta(unitX, unitY, currentPlayer.direction);
        walkingElapsedMs += deltaSeconds * 1000;
        currentPlayer.frame = getAvatarFrame(currentPlayer.direction, true, walkingElapsedMs);
      } else {
        walkingElapsedMs = 0;
        currentPlayer.frame = getAvatarFrame(currentPlayer.direction, false, 0);
      }

      currentPlayer.moving = moving;
      const currentTile = worldPointToTile(
        currentPlayer,
        currentWorld.columns,
        currentWorld.rows,
        currentWorld.tileSize,
      );
      const currentTileKey = makeTileKey(currentTile.x, currentTile.y);
      const tileData = currentWorldRoom.tilemap?.[currentTileKey];
      const currentArea = getAreaAtPoint(currentPlayer, currentWorld, currentWorldRoom.id);
      const currentAreaId = currentArea?.id || "";
      const currentAreaEffects = getAreaEffects(currentArea);
      const currentAreaOpenLinkOptions = getAreaOpenLinkOptions(currentArea);
      const areaOpenUrl = currentAreaEffects.openLink
        ? normalizeExternalAreaUrl(currentArea?.linkUrl)
        : "";
      const tileOpenUrl = normalizeExternalAreaUrl(tileData?.openUrl);
      const openUrl = areaOpenUrl || tileOpenUrl;
      const effectiveOpenLinkOptions = areaOpenUrl
        ? currentAreaOpenLinkOptions
        : { interaction: "action", newTab: true };
      const currentAreaHasIdleEffect = Boolean(
        currentArea &&
          (currentAreaEffects.meeting ||
            currentAreaEffects.entryExit ||
            currentAreaEffects.teleport ||
            openUrl),
      );
      const triggerAreaId = currentAreaHasIdleEffect ? currentAreaId : "";
      const nextMeetingAreaId = currentAreaEffects.meeting ? currentAreaId : tileData?.privateAreaId || "";
      const nextMeetingArea =
        currentAreaEffects.meeting && currentArea
          ? currentArea
          : Array.isArray(currentWorld.privateAreas) && nextMeetingAreaId
          ? currentWorld.privateAreas.find((area) => area?.id === nextMeetingAreaId)
          : null;

      activeAreaRef.current = currentAreaId;
      if (triggeredAreaRef.current && triggeredAreaRef.current !== currentAreaId) {
        triggeredAreaRef.current = "";
        writeAreaTriggerStorage(roomIdRef.current, "");
      }

      if (moving) {
        activeAreaLinkKeyRef.current = "";
        lastIdleActionKeyRef.current = "";
        setActiveAreaLink(null);
      } else {
        const idleActionKey = [
          currentWorldRoom.id,
          currentTileKey,
          nextMeetingAreaId,
          tileData?.teleporter
            ? `${tileData.teleporter.roomId}:${tileData.teleporter.x}:${tileData.teleporter.y}`
            : "",
          tileData?.portal?.tabId || "",
          openUrl,
        ].join("|");

        const shouldRunEffect = shouldRunLandingEffect({
          idleActionKey,
          lastIdleActionKey: lastIdleActionKeyRef.current,
          moving,
          triggeredAreaId: triggeredAreaRef.current,
          triggerAreaId,
        });

        if (!shouldRunEffect) {
          lastIdleActionKeyRef.current = idleActionKey;
        } else if (lastIdleActionKeyRef.current !== idleActionKey) {
          if (triggerAreaId) {
            triggeredAreaRef.current = triggerAreaId;
            writeAreaTriggerStorage(roomIdRef.current, triggerAreaId);
          }

          lastIdleActionKeyRef.current = idleActionKey;

          const nextAreaLinkKey = openUrl
            ? `${currentWorldRoom.id}:${currentTileKey}:${openUrl}:${effectiveOpenLinkOptions.interaction}:${effectiveOpenLinkOptions.newTab ? "new" : "same"}`
            : "";

          activeAreaLinkKeyRef.current = nextAreaLinkKey;
          if (openUrl && effectiveOpenLinkOptions.interaction === "enter" && !editorOpen) {
            openAreaLink(openUrl, effectiveOpenLinkOptions.newTab);
            setActiveAreaLink(null);
          } else {
            setActiveAreaLink(
              openUrl && effectiveOpenLinkOptions.interaction === "action"
                ? {
                    label: currentArea?.name || currentArea?.label || "Area Link",
                    newTab: effectiveOpenLinkOptions.newTab,
                    url: openUrl,
                  }
                : null,
            );
          }

          if (meetingAreaRef.current !== nextMeetingAreaId) {
            meetingAreaRef.current = nextMeetingAreaId;
            setActiveMeetingAreaId(nextMeetingAreaId);
            onMeetingAreaChange?.(
              nextMeetingAreaId
                ? {
                    areaId: nextMeetingAreaId,
                    name: nextMeetingArea?.name || nextMeetingArea?.label || "Meeting Area",
                    tile: currentTile,
                    worldRoomId: currentWorldRoom.id,
                  }
                : null,
            );
          }

          const areaDestination = currentAreaEffects.teleport
            ? getAreaDestination(currentArea, currentWorld.activeRoomId)
            : null;
          const destination = areaDestination || tileData?.teleporter || null;
          const destinationTabId = currentAreaEffects.entryExit
            ? getAreaNavigationTarget(currentArea)
            : tileData?.portal?.tabId || "";

          if (destination) {
            const destinationRoom =
              currentWorld.rooms.find((candidate) => candidate.id === destination.roomId) ||
              currentWorldRoom;
            const point = clampPointToWorldRoom(
              tileToWorldPoint(destination, currentWorld.tileSize),
              currentWorld,
              destinationRoom.id,
            );
            currentPlayer.x = point.x;
            currentPlayer.y = point.y;
            currentPlayer.path = [];
            lastIdleActionKeyRef.current = "";
            applyWorldUpdate(
              (current) => ({
                ...current,
                activeRoomId: destinationRoom.id,
              }),
              { snapshot: false },
            );
          } else if (destinationTabId && destinationTabId !== "space") {
            onNavigate?.(destinationTabId);
          }
        }
      }

      const nextPlayer = { ...currentPlayer };
      playerRef.current = nextPlayer;
      setPlayer(nextPlayer);

      if (moving && followPlayerRef.current && viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect();
        const currentCamera = cameraRef.current;
        const visibleViewport = getVisibleViewportSize(
          { width: rect.width, height: rect.height },
          editorOpen,
          isOwner,
        );
        setCameraState({
          ...currentCamera,
          x: currentCamera.x + (visibleViewport.width / 2 - nextPlayer.x * currentCamera.scale - currentCamera.x) * 0.16,
          y: currentCamera.y + (rect.height / 2 - nextPlayer.y * currentCamera.scale - currentCamera.y) * 0.16,
        });
      }

      persistAndBroadcast(nextPlayer, now);
      animationFrame = window.requestAnimationFrame(tick);
    }

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [applyWorldUpdate, editorOpen, isActive, isOwner, onMeetingAreaChange, onNavigate, persistAndBroadcast, setCameraState]);

  useEffect(() => {
    if (!isActive) {
      keysRef.current.clear();
      return undefined;
    }

    function handleKeyDown(event) {
      const key = getKeyboardKey(event);
      const code = String(event.code || "").toLowerCase();
      const isUndoKey = key === "z" || code === "keyz";
      const isRedoKey = key === "y" || code === "keyy";

      if (editorOpen && !isTypingTarget(event.target) && (event.ctrlKey || event.metaKey)) {
        if (isUndoKey && !event.shiftKey) {
          event.preventDefault();
          undoWorld();
          return;
        }
        if (isRedoKey || (isUndoKey && event.shiftKey)) {
          event.preventDefault();
          redoWorld();
          return;
        }
      }

      if (isTypingTarget(event.target)) return;
      if (!KEY_TO_VECTOR[key] && key !== "Shift") return;
      keysRef.current.add(key);
      event.preventDefault();
    }

    function handleKeyUp(event) {
      keysRef.current.delete(getKeyboardKey(event));
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [editorOpen, isActive, redoWorld, undoWorld]);

  useEffect(() => {
    if (!socket || !room?.id || !playerReady) return undefined;

    function isCurrentPresence(presence) {
      const presenceId = getPresenceKey(presence);
      return presenceId ? presenceId === socket.id : presence?.userId === user?.id;
    }

    function joinSpace() {
      if (!playerRef.current || !socket.connected) return;

      const joinPayload = {
        profileStatus: currentProfileStatus,
        roomId: room.id,
        position: serializePlayerPosition(
          playerRef.current,
          worldRef.current || world,
          worldRoomRef.current || worldRoom,
        ),
      };

      socket.emit("space:join", joinPayload, (ack) => {
        if (ack?.ok && Array.isArray(ack.users)) {
          setRemoteMembers(
            ack.users
              .filter((presence) => !isCurrentPresence(presence))
              .filter((presence) => normalizeProfileStatus(presence.profileStatus || "online") !== "invisible")
              .map((presence) => normalizePresencePosition(presence, worldRef.current || world)),
          );
        }
      });
    }

    joinSpace();

    function handleSpaceState(payload) {
      if (payload?.roomId !== room.id || !Array.isArray(payload.users)) return;
      setRemoteMembers(
        payload.users
          .filter((presence) => !isCurrentPresence(presence))
          .filter((presence) => normalizeProfileStatus(presence.profileStatus || "online") !== "invisible")
          .map((presence) => normalizePresencePosition(presence, worldRef.current || world)),
      );
    }

    function handleUserMoved(payload) {
      if (payload?.roomId !== room.id || isCurrentPresence(payload)) return;
      const normalized = normalizePresencePosition(
        {
          presenceId: payload.presenceId,
          userId: payload.userId,
          user: payload.user,
          profileStatus: payload.profileStatus,
          position: payload.position,
        },
        worldRef.current || world,
      );
      const nextKey = getPresenceKey(normalized);
      if (normalizeProfileStatus(normalized.profileStatus || "online") === "invisible") {
        setRemoteMembers((current) => current.filter((member) => getPresenceKey(member) !== nextKey));
        return;
      }

      setRemoteMembers((current) => [
        ...current.filter((member) => getPresenceKey(member) !== nextKey),
        normalized,
      ]);
    }

    function handleUserLeft(payload) {
      if (payload?.roomId !== room.id) return;
      const leavingKey = getPresenceKey(payload);
      setRemoteMembers((current) =>
        current.filter((member) =>
          leavingKey ? getPresenceKey(member) !== leavingKey : member.userId !== payload.userId,
        ),
      );
    }

    function handleProfileUpdated(payload) {
      if (payload?.roomId !== room.id || !payload.user?.id) return;
      setRemoteMembers((current) =>
        current.map((member) => mergePresenceUser(member, payload.user)),
      );
    }

    socket.on("connect", joinSpace);
    socket.on("space:state", handleSpaceState);
    socket.on("space:user-moved", handleUserMoved);
    socket.on("space:user-left", handleUserLeft);
    socket.on("user:profile-updated", handleProfileUpdated);

    return () => {
      // Keep avatar presence alive when switching room tabs; socket disconnect cleans it up on room exit.
      socket.off("connect", joinSpace);
      socket.off("space:state", handleSpaceState);
      socket.off("space:user-moved", handleUserMoved);
      socket.off("space:user-left", handleUserLeft);
      socket.off("user:profile-updated", handleProfileUpdated);
    };
  }, [currentProfileStatus, playerReady, room?.id, socket, user?.id, world, worldRoom]);

  const getPointFromEvent = useCallback((event) => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    return {
      x: (event.clientX - rect.left - currentCamera.x) / currentCamera.scale,
      y: (event.clientY - rect.top - currentCamera.y) / currentCamera.scale,
    };
  }, []);

  const getTileFromEvent = useCallback(
    (event) => {
      const point = getPointFromEvent(event);
      if (!point) return null;
      if (point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height) {
        return null;
      }
      return worldPointToTile(point, world.columns, world.rows, world.tileSize);
    },
    [getPointFromEvent, world.columns, world.height, world.rows, world.tileSize, world.width],
  );

  const updateHover = useCallback(
    (event) => {
      setHoveredTile(getTileFromEvent(event));
    },
    [getTileFromEvent],
  );

  const updateAreaCursorFromEvent = useCallback(
    (event) => {
      if (!editorOpen || !isOwner || activeTool !== "area") {
        setAreaCursorMode("");
        return;
      }

      if (event.target.closest(MAP_OVERLAY_SELECTOR)) {
        setAreaCursorMode("");
        return;
      }

      const activeEditDrag = areaEditDragRef.current;
      if (activeEditDrag?.mode) {
        setAreaCursorMode(activeEditDrag.mode);
        return;
      }

      if (areaDragRef.current) {
        setAreaCursorMode("draw");
        return;
      }

      const point = getPointFromEvent(event);
      const editMode = selectedArea ? getAreaEditModeAtPoint(point, selectedArea, world) : "";
      setAreaCursorMode(editMode || "draw");
    },
    [activeTool, editorOpen, getPointFromEvent, isOwner, selectedArea, world],
  );

  const showAreaActionTooltip = useCallback((option, target) => {
    const editor = target.closest(".limeets-gather-editor");
    if (!editor) return;

    const editorRect = editor.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const idealLeft =
      targetRect.left + targetRect.width / 2 - editorRect.left - AREA_ACTION_TOOLTIP_WIDTH / 2;
    const left = clamp(
      idealLeft,
      10,
      Math.max(10, editorRect.width - AREA_ACTION_TOOLTIP_WIDTH - 10),
    );
    const top = clamp(targetRect.bottom - editorRect.top + 10, 10, Math.max(10, editorRect.height - 108));
    const arrowLeft = clamp(
      targetRect.left + targetRect.width / 2 - editorRect.left - left,
      16,
      AREA_ACTION_TOOLTIP_WIDTH - 16,
    );

    setAreaActionTooltip({
      arrowLeft,
      description: option.description,
      id: option.id,
      left,
      title: option.title,
      top,
    });
  }, []);

  const hideAreaActionTooltip = useCallback(() => {
    setAreaActionTooltip(null);
  }, []);

  const placeSingleTile = useCallback(
    (tile, privateAreaId = "") => {
      if (!isOwner) return;

      if (selectedSpecial) {
        if (selectedSpecial === "spawn") {
          if (getAreaAtTile(tile, draftWorldRef.current, draftWorldRef.current?.activeRoomId)) {
            setNotice("Spawn cannot be placed inside an area.");
            window.setTimeout(() => setNotice(""), 1800);
            return;
          }

          applyWorldUpdate((current) => ({
            ...current,
            spawnpoint: { roomId: current.activeRoomId, x: tile.x, y: tile.y },
            spawn: { mapId: current.activeRoomId, col: tile.x, row: tile.y },
          }));
          return;
        }

        updateActiveRoomTile(tile, (entry, current) => {
          if (selectedSpecial === "impassable") return { ...entry, impassable: true };
          if (selectedSpecial === "private") {
            return { ...entry, privateAreaId: privateAreaId || `private-${Date.now()}` };
          }
          if (selectedSpecial === "teleport") {
            return {
              ...entry,
              teleporter: {
                roomId: teleportDraft.roomId || current.activeRoomId,
                x: Number(teleportDraft.x) || 0,
                y: Number(teleportDraft.y) || 0,
              },
            };
          }
          return entry;
        });
        return;
      }

      if (!selectedAsset || !canAssetUseLayer(selectedAsset, selectedLayer)) return;
      if (!canPlaceAssetAtTile(selectedAsset, selectedLayer, tile, worldRef.current, worldRoomRef.current?.tilemap)) {
        setNotice("That object needs a clear space.");
        window.setTimeout(() => setNotice(""), 1800);
        return;
      }

      updateActiveRoomTile(tile, (entry) => {
        const currentStack = getLayerStack(entry, selectedLayer);
        const nextStack = selectedLayer === "floor"
          ? [selectedAsset.id]
          : [...currentStack, selectedAsset.id];
        return setLayerStack(entry, selectedLayer, nextStack);
      });
    },
    [
      applyWorldUpdate,
      isOwner,
      selectedAsset,
      selectedLayer,
      selectedSpecial,
      teleportDraft.roomId,
      teleportDraft.x,
      teleportDraft.y,
      updateActiveRoomTile,
    ],
  );

  const eraseSingleTile = useCallback(
    (tile, target = "all") => {
      applyWorldUpdate((current) => {
        const next = clone(current);
        const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
        if (!activeRoom) return next;

        const key = makeTileKey(tile.x, tile.y);
        if (target === "tile") {
          const entry = clearTileEntry(activeRoom.tilemap[key] || {}, "all");
          if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
          else delete activeRoom.tilemap[key];
          return next;
        }

        if (target === "special") {
          const entry = clearTileEntry(activeRoom.tilemap[key] || {}, "special");
          if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
          else delete activeRoom.tilemap[key];
          return next;
        }

        const placement = getTopPlacementAtTile(activeRoom.tilemap, tile, getEraseLayerFilter(target));
        if (placement) {
          const entry = removePlacementFromEntry(activeRoom.tilemap[placement.key] || {}, placement);
          if (Object.keys(entry).length) activeRoom.tilemap[placement.key] = entry;
          else delete activeRoom.tilemap[placement.key];
          return next;
        }

        const entry = clearTileEntry(activeRoom.tilemap[key] || {}, target);
        if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
        else delete activeRoom.tilemap[key];

        return next;
      });
      setSelectedPlacement(null);
    },
    [applyWorldUpdate],
  );

  const deleteSelectedPlacement = useCallback(() => {
    if (!selectedPlacementInfo) return;

    applyWorldUpdate((current) => {
      const next = clone(current);
      const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
      if (!activeRoom) return next;

      const entry = removePlacementFromEntry(
        activeRoom.tilemap[selectedPlacementInfo.key] || {},
        selectedPlacementInfo,
      );
      if (Object.keys(entry).length) activeRoom.tilemap[selectedPlacementInfo.key] = entry;
      else delete activeRoom.tilemap[selectedPlacementInfo.key];
      return next;
    });

    setSelectedPlacement(null);
  }, [applyWorldUpdate, selectedPlacementInfo]);

  const reorderSelectedPlacement = useCallback(
    (action) => {
      if (!selectedPlacementInfo || !isStackLayer(selectedPlacementInfo.layer)) return;

      const currentStack = getLayerStack(selectedPlacementInfo.tile, selectedPlacementInfo.layer);
      const ordered = reorderPlacementStack(currentStack, selectedPlacementInfo.index, action);
      const nextIndex = ordered.index;

      applyWorldUpdate((current) => {
        const next = clone(current);
        const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
        if (!activeRoom) return next;

        const tile = activeRoom.tilemap[selectedPlacementInfo.key] || {};
        const stack = getLayerStack(tile, selectedPlacementInfo.layer);
        const nextStack = reorderPlacementStack(stack, selectedPlacementInfo.index, action).stack;
        const entry = setLayerStack(tile, selectedPlacementInfo.layer, nextStack);
        if (Object.keys(entry).length) activeRoom.tilemap[selectedPlacementInfo.key] = entry;
        else delete activeRoom.tilemap[selectedPlacementInfo.key];
        return next;
      });

      setSelectedPlacement((current) =>
        current?.key === selectedPlacementInfo.key && current?.layer === selectedPlacementInfo.layer
          ? { ...current, index: nextIndex }
          : current,
      );
    },
    [applyWorldUpdate, selectedPlacementInfo],
  );

  const clearSelectedTiles = useCallback(() => {
    const parsedTiles = selectedTileKeys.map(parseTileKey).filter(Boolean);
    if (!parsedTiles.length) return;

    applyWorldUpdate((current) => {
      const next = clone(current);
      const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
      if (!activeRoom) return next;

      parsedTiles.forEach((tile) => {
        delete activeRoom.tilemap[tile.key];
      });

      return next;
    });

    setSelectedPlacement(null);
    setSelectedTileKey("");
    setSelectedTileKeys([]);
  }, [applyWorldUpdate, selectedTileKeys]);

  const createAreaFromRect = useCallback(
    (areaRect) => {
      if (!areaRect?.tiles?.length || !isOwner) return;

      if (areaRectContainsSpawn(areaRect, draftWorldRef.current)) {
        setNotice("Areas cannot include the spawn tile.");
        window.setTimeout(() => setNotice(""), 1800);
        return;
      }

      const areaId = `area-${Date.now()}`;
      const existingCount = Array.isArray(draftWorldRef.current?.privateAreas)
        ? draftWorldRef.current.privateAreas.length
        : 0;
      const areaName = `Area ${existingCount + 1}`;

      applyWorldUpdate((current) => {
        const next = clone(current);
        const area = {
          id: areaId,
          label: areaName,
          name: areaName,
          roomId: next.activeRoomId,
          bounds: areaRect.bounds,
          effects: { ...DEFAULT_AREA_EFFECTS },
          properties: [],
          linkUrl: "",
          tabId: DEFAULT_NAVIGATION_TAB,
          destination: { roomId: next.activeRoomId, x: 0, y: 0 },
        };

        next.privateAreas = [
          ...(Array.isArray(next.privateAreas) ? next.privateAreas : []),
          area,
        ].slice(-48);

        return next;
      });

      setSelectedAreaId(areaId);
      setSelectedPlacement(null);
      setSelectedTileKey("");
      setSelectedTileKeys([]);
    },
    [applyWorldUpdate, isOwner],
  );

  const updateSelectedArea = useCallback(
    (updater, options = {}) => {
      if (!selectedAreaId || !isOwner) return;

      applyWorldUpdate((current) => {
        const next = clone(current);
        const areas = Array.isArray(next.privateAreas) ? next.privateAreas : [];
        const areaIndex = areas.findIndex((area) => area?.id === selectedAreaId);
        if (areaIndex < 0) return next;

        const previousArea = clone(areas[areaIndex]);
        const updatedDraft =
          typeof updater === "function"
            ? updater(clone(areas[areaIndex]), next)
            : { ...areas[areaIndex], ...updater };
        const rawLabel = updatedDraft.name ?? updatedDraft.label;
        const label = rawLabel == null ? "Area" : String(rawLabel).slice(0, 72);
        const effects = getAreaEffects(updatedDraft);
        const updatedArea = {
          ...updatedDraft,
          id: previousArea.id,
          label,
          name: label,
          roomId: String(updatedDraft.roomId || previousArea.roomId || next.activeRoomId),
          bounds: updatedDraft.bounds || previousArea.bounds,
          destination: getAreaDestination(updatedDraft, next.activeRoomId),
          effects,
          linkUrl: String(updatedDraft.linkUrl || "").trim().slice(0, 500),
          tabId: getAreaNavigationTarget(updatedDraft),
        };
        updatedArea.properties = buildAreaProperties(updatedArea);

        areas[areaIndex] = updatedArea;
        next.privateAreas = areas;
        materializeAreaTileEffects(next, updatedArea, previousArea);
        return next;
      }, options);
    },
    [applyWorldUpdate, isOwner, selectedAreaId],
  );

  const addSelectedAreaProperty = useCallback(
    (propertyId) => {
      hideAreaActionTooltip();
      setCollapsedAreaPropertyIds((current) => ({
        ...current,
        [propertyId]: false,
      }));
      if (selectedAreaEffects[propertyId]) return;

      updateSelectedArea((area) => {
        const nextArea = {
          ...area,
          effects: {
            ...getAreaEffects(area),
            [propertyId]: true,
          },
        };

        if (propertyId === "openLink") {
          const openLink = getAreaOpenLinkOptions(area);
          nextArea.openLinkInteraction = openLink.interaction;
          nextArea.openLinkNewTab = openLink.newTab;
        }

        return nextArea;
      });
    },
    [hideAreaActionTooltip, selectedAreaEffects, updateSelectedArea],
  );

  const removeSelectedAreaProperty = useCallback(
    (propertyId) => {
      setCollapsedAreaPropertyIds((current) => {
        const next = { ...current };
        delete next[propertyId];
        return next;
      });
      updateSelectedArea((area) => ({
        ...area,
        effects: {
          ...getAreaEffects(area),
          [propertyId]: false,
        },
      }));
    },
    [updateSelectedArea],
  );

  const toggleSelectedAreaPropertyCollapse = useCallback((propertyId) => {
    setCollapsedAreaPropertyIds((current) => ({
      ...current,
      [propertyId]: !current[propertyId],
    }));
  }, []);

  const deleteSelectedArea = useCallback(() => {
    if (!selectedAreaId || !isOwner) return;

    applyWorldUpdate((current) => {
      const next = clone(current);
      const areas = Array.isArray(next.privateAreas) ? next.privateAreas : [];
      const area = areas.find((candidate) => candidate?.id === selectedAreaId);
      if (area) clearAreaTileEffects(next, area);
      next.privateAreas = areas.filter((candidate) => candidate?.id !== selectedAreaId);
      return next;
    });

    setSelectedAreaId("");
    setSelectedTileKeys([]);
  }, [applyWorldUpdate, isOwner, selectedAreaId]);

  const applyTileAction = useCallback(
    (tiles) => {
      if (!tiles.length) return;
      if (
        selectedSpecial === "spawn" &&
        tiles.some((tile) => getAreaAtTile(tile, draftWorldRef.current, draftWorldRef.current?.activeRoomId))
      ) {
        setNotice("Spawn cannot be placed inside an area.");
        window.setTimeout(() => setNotice(""), 1800);
        return;
      }

      const privateAreaId = selectedSpecial === "private" ? `private-${Date.now()}` : "";
      applyWorldUpdate((current) => {
        const next = clone(current);
        const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
        if (!activeRoom) return next;

        if (activeTool === "erase") {
          const removedPlacements = new Set();
          const removedAreaIds = new Set();
          tiles.forEach((tile) => {
            const key = makeTileKey(tile.x, tile.y);
            const existingEntry = activeRoom.tilemap[key] || {};

            if (eraserTarget === "special") {
              if (existingEntry.privateAreaId) removedAreaIds.add(existingEntry.privateAreaId);
              const entry = clearTileEntry(existingEntry, "special");
              if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
              else delete activeRoom.tilemap[key];
              return;
            }

            const placement = getTopPlacementAtTile(activeRoom.tilemap, tile, getEraseLayerFilter(eraserTarget));
            if (placement) {
              const placementKey = `${placement.key}:${placement.layer}:${placement.index}`;
              if (removedPlacements.has(placementKey)) return;
              removedPlacements.add(placementKey);
              const entry = removePlacementFromEntry(activeRoom.tilemap[placement.key] || {}, placement);
              if (Object.keys(entry).length) activeRoom.tilemap[placement.key] = entry;
              else delete activeRoom.tilemap[placement.key];
              return;
            }

            if (eraserTarget === "all" && existingEntry.privateAreaId) {
              removedAreaIds.add(existingEntry.privateAreaId);
            }
            const entry = clearTileEntry(existingEntry, eraserTarget);
            if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
            else delete activeRoom.tilemap[key];
          });

          if (removedAreaIds.size) {
            Object.entries(activeRoom.tilemap).forEach(([key, entry]) => {
              if (!removedAreaIds.has(entry?.privateAreaId)) return;
              const nextEntry = { ...entry };
              delete nextEntry.privateAreaId;
              delete nextEntry.entryExit;
              delete nextEntry.openUrl;
              if (Object.keys(nextEntry).length) activeRoom.tilemap[key] = nextEntry;
              else delete activeRoom.tilemap[key];
            });
            next.privateAreas = (Array.isArray(next.privateAreas) ? next.privateAreas : []).filter(
              (area) => !removedAreaIds.has(area?.id),
            );
          }
          return next;
        }

        const placeableAsset =
          selectedAsset && canAssetUseLayer(selectedAsset, selectedLayer) ? selectedAsset : null;

        tiles.forEach((tile) => {
          const key = makeTileKey(tile.x, tile.y);
          const entry = { ...(activeRoom.tilemap[key] || {}) };

          if (selectedSpecial === "spawn") {
            next.spawnpoint = { roomId: next.activeRoomId, x: tile.x, y: tile.y };
            next.spawn = { mapId: next.activeRoomId, col: tile.x, row: tile.y };
          } else if (selectedSpecial === "impassable") {
            entry.impassable = true;
          } else if (selectedSpecial === "private") {
            entry.privateAreaId = privateAreaId;
          } else if (selectedSpecial === "teleport") {
            entry.teleporter = {
              roomId: teleportDraft.roomId || next.activeRoomId,
              x: Number(teleportDraft.x) || 0,
              y: Number(teleportDraft.y) || 0,
            };
          } else if (
            placeableAsset &&
            canPlaceAssetAtTile(placeableAsset, selectedLayer, tile, next, activeRoom.tilemap)
          ) {
            const currentStack = getLayerStack(entry, selectedLayer);
            const nextStack = selectedLayer === "floor"
              ? [placeableAsset.id]
              : [...currentStack, placeableAsset.id];
            const nextEntry = setLayerStack(entry, selectedLayer, nextStack);
            Object.keys(entry).forEach((entryKey) => delete entry[entryKey]);
            Object.assign(entry, nextEntry);
          }

          if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
          else delete activeRoom.tilemap[key];
        });

        return next;
      });
      if (activeTool === "erase") {
        setSelectedPlacement(null);
      }
    },
    [activeTool, applyWorldUpdate, eraserTarget, selectedAsset, selectedLayer, selectedSpecial, teleportDraft],
  );

  const movePlayerToTile = useCallback(
    (tile) => {
      if (!playerRef.current) return;
      const start = worldPointToTile(playerRef.current, world.columns, world.rows, world.tileSize);
      const path = findTilePath(start, tile, blockedTiles, world.columns, world.rows);
      if (!path.length) return;
      playerRef.current.path = path
        .slice(1)
        .map((step) => clampPointToWorldRoom(tileToWorldPoint(step, world.tileSize), world, worldRoom.id));
      followPlayerRef.current = true;
    },
    [blockedTiles, world, worldRoom.id],
  );

  const handleViewportPointerDown = useCallback(
    (event) => {
      if (event.target.closest(MAP_OVERLAY_SELECTOR)) {
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;

      const tile = getTileFromEvent(event);
      const point = getPointFromEvent(event);
      if (
        point &&
        editorOpen &&
        isOwner &&
        event.button === 0 &&
        activeTool === "area"
      ) {
        const editMode = selectedArea ? getAreaEditModeAtPoint(point, selectedArea, world) : "";
        if (editMode) {
          const bounds = getPrivateAreaBounds(selectedArea);
          const areaRect = getAreaRectFromBounds(bounds, world);
          areaEditDragRef.current = {
            areaId: selectedArea.id,
            mode: editMode,
            startBounds: bounds,
            startPoint: point,
          };
          setAreaCursorMode(editMode);
          if (areaRect) {
            setAreaPreview({
              ...areaRect.pixel,
              label: editMode === "move" ? "Move area" : "Resize area",
            });
          }
          dragTileRef.current = null;
          panRef.current = null;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.preventDefault();
          return;
        }

        const clickedArea = getAreaAtPoint(point, world, worldRoom.id);
        if (!clickedArea) {
          areaDragRef.current = point;
          setAreaCursorMode("draw");
          setAreaPreview({
            x: point.x,
            y: point.y,
            width: world.tileSize,
            height: world.tileSize,
            label: "New area",
          });
        }
      }
      dragTileRef.current = tile;
      panRef.current = {
        button: event.button,
        camera: cameraRef.current,
        dragged: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [
      activeTool,
      editorOpen,
      getPointFromEvent,
      getTileFromEvent,
      isOwner,
      selectedArea,
      world,
      worldRoom.id,
    ],
  );

  const handleViewportPointerMove = useCallback(
    (event) => {
      updateHover(event);
      updateAreaCursorFromEvent(event);

      const editDrag = areaEditDragRef.current;
      if (
        editDrag &&
        editorOpen &&
        activeTool === "area"
      ) {
        const point = getPointFromEvent(event);
        const areaRect = getAreaRectFromEditDrag(editDrag, point, world);
        if (areaRect) {
          setAreaPreview({
            ...areaRect.pixel,
            label: editDrag.mode === "move" ? "Move area" : "Resize area",
          });
        }
        event.preventDefault();
        return;
      }

      const areaStart = areaDragRef.current;
      if (
        areaStart &&
        editorOpen &&
        activeTool === "area"
      ) {
        const point = getPointFromEvent(event);
        const areaRect = getAreaRectFromPoints(areaStart, point, world);
        if (areaRect) setAreaPreview(areaRect.pixel);
      }

      const currentTile = getTileFromEvent(event);
      const forceSinglePreview =
        activeTool === "paint" &&
        (selectedSpecial === "spawn" ||
          selectedSpecial === "teleport" ||
          (!selectedSpecial && selectedLayer === "object"));
      if (
        dragTileRef.current &&
        currentTile &&
        editorOpen &&
        activeTool !== "area" &&
        usesRectangleTileAction(activeTool, paintMode) &&
        !forceSinglePreview &&
        selectedSpecial !== "private"
      ) {
        setDragPreview({ start: dragTileRef.current, end: currentTile });
      }

      const pan = panRef.current;
      if (!pan) return;

      const deltaX = event.clientX - pan.startX;
      const deltaY = event.clientY - pan.startY;
      const shouldPan =
        pan.button === 1 ||
        activeTool === "pan" ||
        (!editorOpen && pan.button === 0);

      if (!shouldPan) return;
      if (!pan.dragged && Math.hypot(deltaX, deltaY) < PAN_DRAG_THRESHOLD_PX) return;

      pan.dragged = true;
      followPlayerRef.current = false;
      setCameraState({
        ...pan.camera,
        x: pan.camera.x + deltaX,
        y: pan.camera.y + deltaY,
      });
      event.preventDefault();
    },
    [
      activeTool,
      editorOpen,
      getPointFromEvent,
      getTileFromEvent,
      paintMode,
      selectedAsset,
      selectedLayer,
      selectedSpecial,
      setCameraState,
      updateAreaCursorFromEvent,
      updateHover,
      world,
    ],
  );

  const handleViewportPointerUp = useCallback(
    (event) => {
      const pan = panRef.current;
      const areaStart = areaDragRef.current;
      const areaEditDrag = areaEditDragRef.current;
      const startTile = dragTileRef.current;
      const endTile = getTileFromEvent(event);
      const endPoint = getPointFromEvent(event);
      panRef.current = null;
      areaDragRef.current = null;
      areaEditDragRef.current = null;
      dragTileRef.current = null;
      setDragPreview(null);
      setAreaPreview(null);
      if (editorOpen && isOwner && activeTool === "area") {
        const nextEditMode = selectedArea ? getAreaEditModeAtPoint(endPoint, selectedArea, world) : "";
        setAreaCursorMode(nextEditMode || "draw");
      } else {
        setAreaCursorMode("");
      }
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      if (event.target.closest(MAP_OVERLAY_SELECTOR)) {
        return;
      }
      if (areaEditDrag && editorOpen && isOwner && activeTool === "area") {
        const nextRect = getAreaRectFromEditDrag(areaEditDrag, endPoint, world);
        const sameBounds =
          nextRect &&
          areaEditDrag.startBounds &&
          nextRect.bounds.col === areaEditDrag.startBounds.col &&
          nextRect.bounds.row === areaEditDrag.startBounds.row &&
          nextRect.bounds.width === areaEditDrag.startBounds.width &&
          nextRect.bounds.height === areaEditDrag.startBounds.height;

        if (nextRect && !sameBounds) {
          if (areaRectContainsSpawn(nextRect, draftWorldRef.current)) {
            setNotice("Areas cannot include the spawn tile.");
            window.setTimeout(() => setNotice(""), 1800);
          } else {
            updateSelectedArea((area) => ({
              ...area,
              bounds: nextRect.bounds,
            }));
          }
        }
        return;
      }
      if (pan?.dragged || event.button !== 0) return;

      if (editorOpen && isOwner) {
        if (activeTool === "area") {
          if (!endPoint) return;
          const areaRect = areaStart ? getAreaRectFromPoints(areaStart, endPoint, world) : null;
          const dragDistance = areaStart
            ? Math.hypot(endPoint.x - areaStart.x, endPoint.y - areaStart.y)
            : 0;

          if (areaStart && areaRect && dragDistance >= PAN_DRAG_THRESHOLD_PX) {
            createAreaFromRect(areaRect);
          } else {
            const area = getAreaAtPoint(endPoint, world, worldRoom.id);
            setSelectedAreaId(area?.id || "");
            setSelectedPlacement(null);
            setSelectedTileKey("");
            setSelectedTileKeys([]);
          }
          return;
        }

        if (!endTile) return;

        if (activeTool === "paint") {
          const forceSingleTile =
            selectedSpecial === "spawn" ||
            selectedSpecial === "teleport" ||
            (!selectedSpecial && selectedLayer === "object");
          const tiles = paintMode === "rectangle" && !forceSingleTile
            ? rectangleTiles(startTile, endTile)
            : [endTile];
          applyTileAction(tiles);
          return;
        }
        if (activeTool === "erase") {
          const tiles = rectangleTiles(startTile, endTile);
          applyTileAction(tiles);
          return;
        }
        if (activeTool === "select") {
          if (startTile && (startTile.x !== endTile.x || startTile.y !== endTile.y)) {
            const tiles = rectangleTiles(startTile, endTile);
            setSelectedPlacement(null);
            setSelectedTileKey("");
            setSelectedTileKeys(tiles.map((tile) => makeTileKey(tile.x, tile.y)));
            return;
          }

          const placement = getTopPlacementAtTile(worldRoom.tilemap, endTile);
          setSelectedPlacement(
            placement
              ? {
                  index: placement.index,
                  key: placement.key,
                  layer: placement.layer,
                }
              : null,
          );
          setSelectedTileKey(placement?.key || makeTileKey(endTile.x, endTile.y));
          setSelectedTileKeys([makeTileKey(endTile.x, endTile.y)]);
        }
      }
    },
    [
      activeTool,
      applyTileAction,
      createAreaFromRect,
      editorOpen,
      getPointFromEvent,
      getTileFromEvent,
      isOwner,
      paintMode,
      selectedAsset,
      selectedArea,
      selectedLayer,
      selectedSpecial,
      updateSelectedArea,
      world,
      worldRoom.id,
      worldRoom.tilemap,
    ],
  );

  const handleViewportDoubleClick = useCallback(
    (event) => {
      if (event.target.closest(MAP_OVERLAY_SELECTOR)) return;
      if (editorOpen && isOwner) return;
      const tile = getTileFromEvent(event);
      if (!tile) {
        setNotice(EXPLORE_NOTICE_TEXT);
        window.setTimeout(() => setNotice(""), 2200);
        return;
      }
      movePlayerToTile(tile);
    },
    [editorOpen, getTileFromEvent, isOwner, movePlayerToTile],
  );

  const handleViewportContextMenu = useCallback(
    (event) => {
      if (event.target.closest(MAP_OVERLAY_SELECTOR)) return;
      event.preventDefault();
      if (editorOpen && isOwner) return;

      const tile = getTileFromEvent(event);
      if (!tile) {
        setNotice(EXPLORE_NOTICE_TEXT);
        window.setTimeout(() => setNotice(""), 2200);
        return;
      }

      movePlayerToTile(tile);
    },
    [editorOpen, getTileFromEvent, isOwner, movePlayerToTile],
  );

  const zoomAt = useCallback(
    (nextScale, origin = null) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const currentCamera = cameraRef.current;
      const scale = clamp(nextScale, fitScale, CAMERA_MAX_SCALE);
      const originX = origin?.x ?? rect.width / 2;
      const originY = origin?.y ?? rect.height / 2;
      const worldX = (originX - currentCamera.x) / currentCamera.scale;
      const worldY = (originY - currentCamera.y) / currentCamera.scale;
      setCameraState({
        scale,
        x: originX - worldX * scale,
        y: originY - worldY * scale,
      });
    },
    [fitScale, setCameraState],
  );

  const handleWheel = useCallback(
    (event) => {
      if (event.target.closest(".limeets-gather-editor, .limeets-gather-toolbar")) return;
      event.preventDefault();
      const rect = viewportRef.current.getBoundingClientRect();
      const direction = event.deltaY > 0 ? 1 / CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP;
      zoomAt(cameraRef.current.scale * direction, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [zoomAt],
  );

  const applyBackgroundFile = useCallback(
    (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const backgroundImage =
          typeof reader.result === "string" && reader.result.startsWith("data:image/")
            ? reader.result
            : "";
        if (!backgroundImage) return;
        applyWorldUpdate((current) => ({
          ...current,
          rooms: current.rooms.map((candidate) =>
            candidate.id === current.activeRoomId
              ? { ...candidate, backgroundImage }
              : candidate,
          ),
        }));
      };
      reader.readAsDataURL(file);
    },
    [applyWorldUpdate],
  );

  const saveWorld = useCallback(async () => {
    if (!room?.id || !isOwner) return;
    setSaveState("saving");
    try {
      const worldConfig = prepareWorldForSave(draftWorldRef.current);
      const payload = await api.updateRoom(room.id, {
        worldConfig,
      });
      draftWorldRef.current = worldConfig;
      setDraftWorld(worldConfig);
      setWorldSaved(true);
      setSaveState("saved");
      onWorldChanged?.(payload.room);
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch (error) {
      setSaveState("error");
      setNotice(error?.message || "Unable to save this domain right now.");
      window.setTimeout(() => setSaveState("idle"), 2200);
    }
  }, [isOwner, onWorldChanged, room?.id]);

  const createWorldRoom = useCallback(() => {
    applyWorldUpdate((current) => {
      let counter = current.rooms.length + 1;
      let name = `Zone ${counter}`;
      const names = new Set(current.rooms.map((item) => item.name.toLowerCase()));
      while (names.has(name.toLowerCase())) {
        counter += 1;
        name = `Zone ${counter}`;
      }
      const id = `world-room-${Date.now()}`;
      const activeRoom = current.rooms.find((candidate) => candidate.id === current.activeRoomId);
      return {
        ...current,
        activeRoomId: id,
        rooms: [
          ...current.rooms,
          {
            id,
            name,
            backgroundImage: activeRoom?.backgroundImage || current.backgroundImage || "",
            columns: activeRoom?.columns || current.columns,
            rows: activeRoom?.rows || current.rows,
            tilemap: {},
          },
        ],
      };
    });
  }, [applyWorldUpdate]);

  const deleteActiveWorldRoom = useCallback(() => {
    if (world.rooms.length <= 1) return;
    applyWorldUpdate((current) => {
      const remaining = current.rooms.filter((candidate) => candidate.id !== current.activeRoomId);
      const nextActiveId = remaining[0]?.id || CUSTOM_WORLD_MAP_ID;
      remaining.forEach((candidate) => {
        Object.values(candidate.tilemap).forEach((tile) => {
          if (tile.teleporter?.roomId === current.activeRoomId) delete tile.teleporter;
        });
      });
      const nextActiveRoom = remaining.find((candidate) => candidate.id === nextActiveId) || remaining[0];
      return {
        ...current,
        activeRoomId: nextActiveId,
        rooms: remaining,
        spawnpoint:
          current.spawnpoint.roomId === current.activeRoomId
            ? {
                roomId: nextActiveId,
                x: Math.floor((nextActiveRoom?.columns || current.columns) / 2),
                y: Math.floor((nextActiveRoom?.rows || current.rows) / 2),
              }
            : current.spawnpoint,
      };
    });
  }, [applyWorldUpdate, world.rooms.length]);

  const renameActiveWorldRoom = useCallback(
    (name) => {
      applyWorldUpdate(
        (current) => ({
          ...current,
          rooms: current.rooms.map((candidate) =>
            candidate.id === current.activeRoomId ? { ...candidate, name: name.slice(0, 72) } : candidate,
          ),
        }),
        { snapshot: false },
      );
    },
    [applyWorldUpdate],
  );

  const changeWorldSize = useCallback(
    (key, value) => {
      const nextValue = Number(value);
      applyWorldUpdate(
        (current) => ({
          ...current,
          [key]: nextValue,
          rooms: current.rooms.map((candidate) =>
            candidate.id === current.activeRoomId ? { ...candidate, [key]: nextValue } : candidate,
          ),
        }),
        { snapshot: false },
      );
    },
    [applyWorldUpdate],
  );

  const updateWorldSizeDraft = useCallback((key, value) => {
    const digits = String(value || "").replace(/[^\d]/g, "").slice(0, 3);
    setWorldSizeDraft((current) => ({ ...current, [key]: digits }));
  }, []);

  const commitWorldSizeDraft = useCallback(
    (key) => {
      const min = key === "columns" ? 12 : 10;
      const currentValue = key === "columns" ? world.columns : world.rows;
      const rawValue = String(worldSizeDraft[key] || "").trim();

      if (!rawValue) {
        setWorldSizeDraft((current) => ({ ...current, [key]: String(currentValue) }));
        return;
      }

      const parsed = Number(rawValue);
      const nextValue = Number.isFinite(parsed)
        ? clamp(Math.round(parsed), min, 256)
        : currentValue;

      setWorldSizeDraft((current) => ({ ...current, [key]: String(nextValue) }));
      if (nextValue !== currentValue) changeWorldSize(key, nextValue);
    },
    [changeWorldSize, world.columns, world.rows, worldSizeDraft],
  );

  const handleWorldSizeKeyDown = useCallback(
    (event, key) => {
      if (event.key === "Enter") {
        commitWorldSizeDraft(key);
        event.currentTarget.blur();
      }
      if (event.key === "Escape") {
        setWorldSizeDraft((current) => ({
          ...current,
          [key]: String(key === "columns" ? world.columns : world.rows),
        }));
        event.currentTarget.blur();
      }
    },
    [commitWorldSizeDraft, world.columns, world.rows],
  );

  const renderTileLayer = (layer) => (
    <div className={`limeets-gather-layer layer-${layer}`} aria-hidden="true">
      {Object.entries(worldRoom.tilemap || {}).flatMap(([key, tile]) => {
        const stack = getLayerStack(tile, layer);
        if (!stack.length) return [];
        const parsed = parseTileKey(key);
        if (!parsed) return [];
        return stack.map((assetId, index) => (
          <div
            className="limeets-gather-tile"
            key={`${layer}-${key}-${index}-${assetId}`}
            style={{
              left: `${parsed.x * world.tileSize}px`,
              top: `${parsed.y * world.tileSize}px`,
              zIndex:
                layer === "object"
                  ? 100 + parsed.y * 10 + index
                  : layer === "above_floor"
                    ? 50 + index
                    : undefined,
            }}
          >
            <TileSprite assetId={assetId} layer={layer} tileSize={world.tileSize} />
          </div>
        ));
      })}
    </div>
  );

  const renderSpecialTiles = () => {
    const activeSpawn =
      world.spawnpoint?.roomId === worldRoom.id
        ? { x: world.spawnpoint.x, y: world.spawnpoint.y }
        : null;
    const configuredAreas = worldAreas;
    const configuredAreaIds = new Set(configuredAreas.map((area) => area.id));

    return (
      <div className={`limeets-gather-special-layer ${showGizmos ? "" : "hidden"}`} aria-hidden="true">
        {areaPreview ? (
          <div
            className="limeets-gather-area-gizmo draft"
            style={{
              left: `${areaPreview.x}px`,
              top: `${areaPreview.y}px`,
              height: `${areaPreview.height}px`,
              width: `${areaPreview.width}px`,
            }}
          >
            <span>{areaPreview.label || "New area"}</span>
          </div>
        ) : null}
        {configuredAreas.map((area) => {
          const bounds = getPrivateAreaBounds(area);
          if (!bounds) return null;
          return (
            <div
              className={`limeets-gather-area-gizmo ${area.id === selectedAreaId ? "selected" : ""}`}
              key={`area-${area.id}`}
              style={{
                left: `${bounds.col * world.tileSize}px`,
                top: `${bounds.row * world.tileSize}px`,
                height: `${bounds.height * world.tileSize}px`,
                width: `${bounds.width * world.tileSize}px`,
              }}
            >
              <span>{area.name || area.label || "Meeting Area"}</span>
              {area.id === selectedAreaId ? (
                <>
                  {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => (
                    <i className={`limeets-gather-area-resize-handle ${handle}`} key={handle} />
                  ))}
                  <div className="limeets-gather-area-gizmo-hint">
                    <Move size={12} />
                    Move or resize
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
        {Object.entries(worldRoom.tilemap || {}).flatMap(([key, tile]) => {
          const parsed = parseTileKey(key);
          if (!parsed) return [];
          const items = [];
          if (tile.impassable) items.push("impassable");
          if (tile.teleporter) items.push("teleport");
          if (tile.privateAreaId && !configuredAreaIds.has(tile.privateAreaId)) items.push("private");
          return items.map((type) => (
            <div
              className={`limeets-gather-special-tile ${type}`}
              key={`${type}-${key}`}
              style={{
                left: `${parsed.x * world.tileSize}px`,
                top: `${parsed.y * world.tileSize}px`,
                height: `${world.tileSize}px`,
                width: `${world.tileSize}px`,
              }}
            />
          ));
        })}
        {activeSpawn ? (
          <div
            className="limeets-gather-special-tile spawn"
            key={`spawn-${worldRoom.id}`}
            style={{
              left: `${activeSpawn.x * world.tileSize}px`,
              top: `${activeSpawn.y * world.tileSize}px`,
              height: `${world.tileSize}px`,
              width: `${world.tileSize}px`,
            }}
          />
        ) : null}
      </div>
    );
  };

  const renderGhost = () => {
    const tiles = dragPreview ? rectangleTiles(dragPreview.start, dragPreview.end) : hoveredTile ? [hoveredTile] : [];
    if (!editorOpen || activeTool === "select" || activeTool === "pan" || activeTool === "area" || !tiles.length) return null;
    if (activeTool === "erase" && dragPreview) {
      const minX = Math.min(dragPreview.start.x, dragPreview.end.x);
      const minY = Math.min(dragPreview.start.y, dragPreview.end.y);
      const maxX = Math.max(dragPreview.start.x, dragPreview.end.x);
      const maxY = Math.max(dragPreview.start.y, dragPreview.end.y);

      return (
        <div className="limeets-gather-ghost-layer" aria-hidden="true">
          <div
            className="limeets-gather-ghost erase-rect"
            style={{
              left: `${minX * world.tileSize}px`,
              top: `${minY * world.tileSize}px`,
              height: `${(maxY - minY + 1) * world.tileSize}px`,
              width: `${(maxX - minX + 1) * world.tileSize}px`,
            }}
          >
            <span>Erase</span>
          </div>
        </div>
      );
    }
    const asset =
      activeTool === "paint" && canAssetUseLayer(selectedAsset, selectedLayer) && !selectedSpecial
        ? selectedAsset
        : null;
    const span = getAssetDimensions(asset, selectedLayer);
    const isBlocked = (tile) => {
      if (selectedSpecial) return false;
      return !canPlaceAssetAtTile(asset, selectedLayer, tile, world, worldRoom.tilemap);
    };

    return (
      <div className="limeets-gather-ghost-layer" aria-hidden="true">
        {tiles.map((tile) => (
          <div
            className={`limeets-gather-ghost ${isBlocked(tile) ? "blocked" : ""}`}
            key={makeTileKey(tile.x, tile.y)}
            style={{
              left: `${tile.x * world.tileSize}px`,
              top: `${tile.y * world.tileSize}px`,
              height: `${span.height * world.tileSize}px`,
              width: `${span.width * world.tileSize}px`,
            }}
          >
            {asset?.src ? <AssetPreview asset={asset} className="limeets-gather-ghost-preview" /> : null}
          </div>
        ))}
      </div>
    );
  };

  const renderSelectionLayer = () => {
    if (!editorOpen || !isOwner) return null;

    const dragTiles =
      activeTool === "select" && dragPreview
        ? rectangleTiles(dragPreview.start, dragPreview.end)
        : [];
    const tileKeys = dragTiles.length
      ? dragTiles.map((tile) => makeTileKey(tile.x, tile.y))
      : selectedTileKeys;
    const uniqueTiles = [...new Set(tileKeys)]
      .map(parseTileKey)
      .filter(Boolean);
    const selectedPlacementDimensions = selectedPlacementInfo
      ? getAssetDimensions(selectedPlacementInfo.asset, selectedPlacementInfo.layer)
      : null;

    if (!uniqueTiles.length && !selectedPlacementInfo) return null;

    return (
      <div className="limeets-gather-selection-layer" aria-hidden="true">
        {uniqueTiles.map((tile) => (
          <div
            className="limeets-gather-selection-tile"
            key={`selected-${tile.key}`}
            style={{
              left: `${tile.x * world.tileSize}px`,
              top: `${tile.y * world.tileSize}px`,
              height: `${world.tileSize}px`,
              width: `${world.tileSize}px`,
            }}
          />
        ))}
        {selectedPlacementInfo?.origin && selectedPlacementDimensions ? (
          <div
            className="limeets-gather-placement-outline"
            style={{
              left: `${selectedPlacementInfo.origin.x * world.tileSize}px`,
              top: `${selectedPlacementInfo.origin.y * world.tileSize}px`,
              height: `${selectedPlacementDimensions.height * world.tileSize}px`,
              width: `${selectedPlacementDimensions.width * world.tileSize}px`,
            }}
          />
        ) : null}
      </div>
    );
  };

  const renderEditorPanel = () => {
    if (!editorOpen || !isOwner) return null;
    const hasCategory = editorPanel === "objects" && selectedCategoryPath;
    const isEditingArea = editorPanel === "special" && Boolean(selectedArea);
    const enabledAreaProperties = isEditingArea
      ? AREA_PROPERTY_OPTIONS.filter((option) => selectedAreaEffects[option.id])
      : [];
    const panelCopy = hasCategory
      ? {
          title: selectedCategory.label,
          description: getCategoryDescription(selectedCategory),
        }
      : EDITOR_PANEL_COPY[editorPanel] || EDITOR_PANEL_COPY.objects;

    return (
      <aside
        className="limeets-gather-editor"
        data-panel={editorPanel}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="limeets-gather-editor-header">
          {hasCategory ? (
            <button
              className="limeets-gather-back"
              onClick={() => {
                setSelectedCategoryPath(selectedCategory.parentPath || "");
                setSearchTerm("");
              }}
              type="button"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          ) : isEditingArea ? (
            <div className="limeets-gather-area-editor-heading">
              <button
                className="limeets-gather-back"
                onClick={() => setSelectedAreaId("")}
                type="button"
              >
                <ArrowLeft size={16} />
                All Areas
              </button>
            </div>
          ) : (
            <div>
              <h2>{panelCopy.title}</h2>
              <p>{panelCopy.description}</p>
            </div>
          )}
        </header>

        <div className="limeets-gather-editor-action-slot">
          {renderCurrentActionPanel("in-editor")}
        </div>

        <div className="limeets-gather-editor-main">
        {editorPanel === "objects" ? (
          <>
            <label className="limeets-gather-search">
              <Search size={18} />
              <input
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search"
                value={searchTerm}
              />
            </label>

          </>
        ) : null}

        <div className="limeets-gather-editor-scroll">
          {editorPanel === "objects" && !searchTerm.trim() && currentAssetCategory.children.length ? (
            <div className="limeets-gather-category-list">
              {currentAssetCategory.children.map((category) => (
                <CategoryRow
                  category={category}
                  key={category.id}
                  onSelect={(nextCategory) => setSelectedCategoryPath(nextCategory.path)}
                />
              ))}
              {!currentAssetCategory.children.length ? (
                <p className="limeets-gather-empty">No Assets Yet.</p>
              ) : null}
            </div>
          ) : null}

          {editorPanel === "objects" && (searchTerm.trim() || !currentAssetCategory.children.length) ? (
            <div>
              <div className="limeets-gather-asset-grid">
                {visibleAssets.map((asset) => (
                  <AssetButton
                    asset={asset}
                    key={asset.id}
                    onSelect={handleSelectAsset}
                    selected={selectedAsset?.id === asset.id}
                  />
                ))}
              </div>
              {!visibleAssets.length ? (
                <p className="limeets-gather-empty">No Matching Assets.</p>
              ) : null}
            </div>
          ) : null}

          {editorPanel === "special" ? (
            <section className="limeets-gather-section limeets-gather-section-first limeets-gather-area-editor">
              {!selectedArea ? (
                <div className="limeets-gather-area-toolbar">
                  <button
                    className="limeets-gather-inline-toggle"
                    onClick={() => setShowGizmos((visible) => !visible)}
                    type="button"
                  >
                    {showGizmos ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showGizmos ? "Hide Special Layers" : "Show Special Layers"}
                  </button>
                </div>
              ) : null}

              {selectedArea ? (
                <div className="limeets-gather-area-selected">
                  <div className="limeets-gather-area-action-grid selected-area-actions" aria-label="Area Functions">
                    {AREA_PROPERTY_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const propertyId = option.id as keyof typeof DEFAULT_AREA_EFFECTS;
                      const active = Boolean(selectedAreaEffects[propertyId]);
                      return (
                        <button
                          aria-label={`${option.title}. ${option.description}`}
                          className={active ? "active" : ""}
                          key={option.id}
                          onBlur={hideAreaActionTooltip}
                          onClick={() => addSelectedAreaProperty(propertyId)}
                          onFocus={(event) => showAreaActionTooltip(option, event.currentTarget)}
                          onPointerEnter={(event) => showAreaActionTooltip(option, event.currentTarget)}
                          onPointerLeave={hideAreaActionTooltip}
                          type="button"
                        >
                          <Icon size={19} />
                        </button>
                      );
                    })}
                    <button
                      aria-label="Delete Area. Remove this area from the domain."
                      className="danger"
                      onBlur={hideAreaActionTooltip}
                      onClick={deleteSelectedArea}
                      onFocus={(event) =>
                        showAreaActionTooltip(
                          {
                            description: "Remove this area from the domain.",
                            id: "deleteArea",
                            title: "Delete Area",
                          },
                          event.currentTarget,
                        )
                      }
                      onPointerEnter={(event) =>
                        showAreaActionTooltip(
                          {
                            description: "Remove this area from the domain.",
                            id: "deleteArea",
                            title: "Delete Area",
                          },
                          event.currentTarget,
                        )
                      }
                      onPointerLeave={hideAreaActionTooltip}
                      type="button"
                    >
                      <Trash2 size={19} />
                    </button>
                  </div>

                  <label className="limeets-gather-field">
                    <span>Area Name</span>
                    <input
                      onChange={(event) =>
                        updateSelectedArea(
                          (area) => ({ ...area, name: event.target.value, label: event.target.value }),
                          { snapshot: false },
                        )
                      }
                      placeholder="e.g. Nautical Huddle"
                      value={selectedArea.name || selectedArea.label || ""}
                    />
                  </label>

                  {enabledAreaProperties.length ? (
                    <div className="limeets-gather-area-property-stack" aria-label="Enabled Area Functions">
                      {enabledAreaProperties.map((property) => {
                        const PropertyIcon = property.icon;
                        const propertyId = property.id as keyof typeof DEFAULT_AREA_EFFECTS;
                        const hasPropertyBody =
                          property.id === "entryExit" || property.id === "openLink" || property.id === "teleport";
                        const collapsed = Boolean(collapsedAreaPropertyIds[propertyId]);
                        const areaDestination = getAreaDestination(selectedArea, world.activeRoomId);
                        const openLink = getAreaOpenLinkOptions(selectedArea);
                        return (
                          <article className="limeets-gather-area-property-card stacked" data-property={property.id} key={property.id}>
                            <header className="limeets-gather-area-property-card-header">
                              {hasPropertyBody ? (
                                <button
                                  aria-expanded={!collapsed}
                                  className="limeets-gather-area-property-collapse"
                                  onClick={() => toggleSelectedAreaPropertyCollapse(propertyId)}
                                  type="button"
                                >
                                  <PropertyIcon size={18} />
                                  <span>
                                    <strong>{property.title}</strong>
                                  </span>
                                  {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                </button>
                              ) : (
                                <div className="limeets-gather-area-property-collapse static">
                                  <PropertyIcon size={18} />
                                  <span>
                                    <strong>{property.title}</strong>
                                  </span>
                                </div>
                              )}
                              <button
                                aria-label={`Remove ${property.title}`}
                                className="limeets-gather-area-property-remove"
                                onClick={() => removeSelectedAreaProperty(property.id)}
                                type="button"
                              >
                                <X size={16} />
                              </button>
                            </header>

                            {hasPropertyBody && !collapsed ? (
                              <div className="limeets-gather-area-property-body">
                                {property.id === "entryExit" ? (
                                  <FieldSelectMenu
                                    label="Destination"
                                    onChange={(value) =>
                                      updateSelectedArea((area) => ({
                                        ...area,
                                        tabId: value,
                                      }))
                                    }
                                    options={navigationOptions}
                                    value={getAreaNavigationTarget(selectedArea)}
                                  />
                                ) : null}

                                {property.id === "openLink" ? (
                                  <>
                                    <FieldSelectMenu
                                      label="Interaction"
                                      onChange={(value) =>
                                        updateSelectedArea((area) => ({
                                          ...area,
                                          openLinkInteraction: value,
                                        }))
                                      }
                                      options={OPEN_LINK_INTERACTION_OPTIONS}
                                      value={openLink.interaction}
                                    />
                                    <label className="limeets-gather-field">
                                      <span>Link URL</span>
                                      <input
                                        onChange={(event) =>
                                          updateSelectedArea(
                                            (area) => ({ ...area, linkUrl: event.target.value }),
                                            { snapshot: false },
                                          )
                                        }
                                        placeholder="https://..."
                                        value={selectedArea.linkUrl || ""}
                                      />
                                    </label>
                                    <div className="limeets-gather-open-link-options">
                                      <label className="limeets-gather-check-row">
                                        <input
                                          checked={openLink.newTab}
                                          onChange={(event) =>
                                            updateSelectedArea((area) => ({
                                              ...area,
                                              openLinkNewTab: event.target.checked,
                                            }))
                                          }
                                          type="checkbox"
                                        />
                                        <span>Open in new tab</span>
                                      </label>
                                    </div>
                                  </>
                                ) : null}

                                {property.id === "teleport" ? (
                                  <>
                                    <FieldSelectMenu
                                      label="Zone"
                                      onChange={(value) =>
                                        updateSelectedArea((area) => ({
                                          ...area,
                                          destination: {
                                            ...getAreaDestination(area, world.activeRoomId),
                                            roomId: value,
                                          },
                                        }))
                                      }
                                      options={zoneOptions}
                                      value={areaDestination.roomId}
                                    />
                                    <div className="limeets-gather-two-cols">
                                      <label className="limeets-gather-field">
                                        <span>X</span>
                                        <input
                                          max={world.columns - 1}
                                          min={0}
                                          onChange={(event) =>
                                            updateSelectedArea((area) => ({
                                              ...area,
                                              destination: {
                                                ...getAreaDestination(area, world.activeRoomId),
                                                x: Number(event.target.value) || 0,
                                              },
                                            }))
                                          }
                                          type="number"
                                          value={areaDestination.x}
                                        />
                                      </label>
                                      <label className="limeets-gather-field">
                                        <span>Y</span>
                                        <input
                                          max={world.rows - 1}
                                          min={0}
                                          onChange={(event) =>
                                            updateSelectedArea((area) => ({
                                              ...area,
                                              destination: {
                                                ...getAreaDestination(area, world.activeRoomId),
                                                y: Number(event.target.value) || 0,
                                              },
                                            }))
                                          }
                                          type="number"
                                          value={areaDestination.y}
                                        />
                                      </label>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="limeets-gather-area-list-card">
                  <div className="limeets-gather-area-list-heading">
                    <strong>Existing Areas</strong>
                    <span>{worldAreas.length} {worldAreas.length === 1 ? "area" : "areas"}</span>
                  </div>
                  <div className="limeets-gather-area-list">
                    {worldAreas.map((area) => (
                      <button key={area.id} onClick={() => setSelectedAreaId(area.id)} type="button">
                        <Grid2X2 size={17} />
                        <span>
                          <strong>{area.name || area.label || "Area"}</strong>
                          <small>
                            {getAreaTiles(area, world).length} tiles - {buildAreaProperties(area).length || "No"} properties
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                    {!worldAreas.length ? (
                      <p className="limeets-gather-empty">No Areas Yet. Drag on the map to create one.</p>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {editorPanel === "inspect" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <h3>
                {selectedPlacementInfo
                  ? "Selected Asset"
                  : selectedTileKeys.length > 1
                    ? `${selectedTileKeys.length} Tiles Selected`
                    : selectedTileKey
                      ? "Selected Tile"
                      : "No Selection"}
              </h3>
              <p className="limeets-gather-muted">
                {selectedPlacementInfo?.origin
                  ? `${selectedPlacementInfo.asset.label} at ${selectedPlacementInfo.origin.x},${selectedPlacementInfo.origin.y}`
                  : selectedTileKeys.length > 1
                    ? "Rectangle selection is active. Use clear selected tiles to remove everything inside it."
                    : selectedTileKey || "Click a tile or drag a rectangle to inspect the map."}
              </p>

              {selectedPlacementInfo ? (
                <>
                  <div className="limeets-gather-selected-asset">
                    <AssetPreview
                      asset={selectedPlacementInfo.asset}
                      className="limeets-gather-selected-asset-preview"
                    />
                    <div>
                      <strong>{selectedPlacementInfo.asset.baseLabel || selectedPlacementInfo.asset.label}</strong>
                      <span>{LAYER_LABELS[selectedPlacementInfo.layer]} layer</span>
                      <span>
                        Stack {selectedPlacementInfo.index + 1} of {selectedPlacementInfo.stackLength}
                      </span>
                    </div>
                  </div>
                  <div className="limeets-gather-order-controls">
                    <button
                      disabled={!isStackLayer(selectedPlacementInfo.layer) || selectedPlacementInfo.index <= 0}
                      onClick={() => reorderSelectedPlacement("back")}
                      type="button"
                    >
                      To Back
                    </button>
                    <button
                      disabled={!isStackLayer(selectedPlacementInfo.layer) || selectedPlacementInfo.index <= 0}
                      onClick={() => reorderSelectedPlacement("backward")}
                      type="button"
                    >
                      Backward
                    </button>
                    <button
                      disabled={
                        !isStackLayer(selectedPlacementInfo.layer) ||
                        selectedPlacementInfo.index >= selectedPlacementInfo.stackLength - 1
                      }
                      onClick={() => reorderSelectedPlacement("forward")}
                      type="button"
                    >
                      Forward
                    </button>
                    <button
                      disabled={
                        !isStackLayer(selectedPlacementInfo.layer) ||
                        selectedPlacementInfo.index >= selectedPlacementInfo.stackLength - 1
                      }
                      onClick={() => reorderSelectedPlacement("front")}
                      type="button"
                    >
                      To Front
                    </button>
                  </div>
                  <button
                    className="limeets-gather-danger"
                    onClick={deleteSelectedPlacement}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Delete Selected Asset
                  </button>
                </>
              ) : null}

              {selectedTilePlacements.length > 1 ? (
                <div className="limeets-gather-stack-list">
                  <strong>Tile Stack</strong>
                  {selectedTilePlacements.map((placement) => (
                    <button
                      className={
                        selectedPlacementInfo?.layer === placement.layer &&
                        selectedPlacementInfo?.index === placement.index
                          ? "selected"
                          : ""
                      }
                      key={`${placement.layer}-${placement.index}-${placement.assetId}`}
                      onClick={() =>
                        setSelectedPlacement({
                          index: placement.index,
                          key: placement.key,
                          layer: placement.layer,
                        })
                      }
                      type="button"
                    >
                      <AssetPreview asset={placement.asset} className="limeets-gather-stack-preview" />
                      <span>
                        <b>{placement.asset.baseLabel || placement.asset.label}</b>
                        <small>{LAYER_LABELS[placement.layer]} layer</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedTileKeys.length > 1 ? (
                <button
                  className="limeets-gather-danger"
                  onClick={clearSelectedTiles}
                  type="button"
                >
                  <Trash2 size={16} />
                  Clear Selected Tiles
                </button>
              ) : null}

              {selectedTileKey && !selectedPlacementInfo ? (
                <>
                  <div className="limeets-gather-status-list">
                    <span>Floor: {getLayerSummary(selectedTile, "floor")}</span>
                    <span>Above: {getLayerSummary(selectedTile, "above_floor")}</span>
                    <span>Object: {getLayerSummary(selectedTile, "object")}</span>
                    <span>{selectedTile?.impassable ? "Impassable" : "Passable"}</span>
                  </div>
                  <button
                    className="limeets-gather-danger"
                    onClick={() => {
                      const parsed = parseTileKey(selectedTileKey);
                      if (parsed) eraseSingleTile(parsed, "tile");
                    }}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Clear Tile
                  </button>
                </>
              ) : null}
            </section>
          ) : null}

          {editorPanel === "erase" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <div className="limeets-gather-editor-control-card">
                <strong>Erase Target</strong>
                <div className="limeets-gather-eraser-targets compact" aria-label="Erase target">
                  {ERASER_TARGETS.map((target) => {
                    const Icon = target.icon;
                    return (
                      <button
                        className={eraserTarget === target.id ? "active" : ""}
                        key={target.id}
                        onClick={() => setEraserTarget(target.id)}
                        type="button"
                      >
                        <Icon size={15} />
                        {target.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {editorPanel === "hand" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
            </section>
          ) : null}

          {editorPanel === "rooms" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <FieldSelectMenu
                label="Current Zone"
                onChange={(value) =>
                  applyWorldUpdate((current) => ({ ...current, activeRoomId: value }), {
                    snapshot: false,
                  })
                }
                options={zoneOptions}
                value={world.activeRoomId}
              />
              <label className="limeets-gather-field">
                <span>Zone Name</span>
                <input
                  onChange={(event) => renameActiveWorldRoom(event.target.value)}
                  placeholder={getZoneFallbackName(
                    Math.max(0, world.rooms.findIndex((candidate) => candidate.id === worldRoom.id)),
                  )}
                  value={worldRoom.name}
                />
              </label>
              <div className="limeets-gather-button-row">
                <button onClick={createWorldRoom} type="button">
                  <Plus size={16} />
                  New Zone
                </button>
                <button disabled={world.rooms.length <= 1} onClick={deleteActiveWorldRoom} type="button">
                  <Trash2 size={16} />
                  Delete Zone
                </button>
              </div>

              <article className="limeets-gather-area-property-card stacked">
                <div>
                  <strong>Spawn Tile</strong>
                  <span>
                    Current: {world.spawnpoint?.roomId === worldRoom.id ? `${world.spawnpoint.x},${world.spawnpoint.y}` : "another zone"}
                  </span>
                </div>
                <div className="limeets-gather-button-row single">
                  <button
                    className={selectedSpecial === "spawn" && activeTool === "paint" ? "active" : ""}
                    onClick={() => {
                      setActiveTool("paint");
                      setEditorPanel("rooms");
                      setPaintMode("single");
                      setSelectedAsset(null);
                      setSelectedSpecial("spawn");
                      setSelectedCategoryPath("");
                    }}
                    type="button"
                  >
                    <MapPin size={16} />
                    Set Spawn Tile
                  </button>
                </div>
              </article>
              <div className="limeets-gather-two-cols">
                <label className="limeets-gather-field">
                  <span>Columns</span>
                  <input
                    inputMode="numeric"
                    onBlur={() => commitWorldSizeDraft("columns")}
                    onChange={(event) => updateWorldSizeDraft("columns", event.target.value)}
                    onKeyDown={(event) => handleWorldSizeKeyDown(event, "columns")}
                    placeholder="Columns"
                    type="text"
                    value={worldSizeDraft.columns}
                  />
                </label>
                <label className="limeets-gather-field">
                  <span>Rows</span>
                  <input
                    inputMode="numeric"
                    onBlur={() => commitWorldSizeDraft("rows")}
                    onChange={(event) => updateWorldSizeDraft("rows", event.target.value)}
                    onKeyDown={(event) => handleWorldSizeKeyDown(event, "rows")}
                    placeholder="Rows"
                    type="text"
                    value={worldSizeDraft.rows}
                  />
                </label>
              </div>
              <label className="limeets-gather-file">
                <ImageIcon size={18} />
                Choose Background Image
                <input accept="image/*" onChange={(event) => applyBackgroundFile(event.target.files?.[0])} type="file" />
              </label>
            </section>
          ) : null}
        </div>

        </div>

        {areaActionTooltip ? (
          <div
            className="limeets-gather-area-action-tooltip"
            role="tooltip"
            style={{
              "--limeets-area-tooltip-arrow-left": `${areaActionTooltip.arrowLeft}px`,
              left: `${areaActionTooltip.left}px`,
              top: `${areaActionTooltip.top}px`,
            }}
          >
            <strong>{areaActionTooltip.title}</strong>
            <small>{areaActionTooltip.description}</small>
          </div>
        ) : null}

        <footer className="limeets-gather-savebar">
          <span>{worldSaved ? "Saved" : "Unsaved Domain Changes"}</span>
          <button disabled={saveState === "saving"} onClick={saveWorld} type="button">
            <Save size={16} />
            {saveState === "saving" ? "Saving" : "Save Domain"}
          </button>
        </footer>
      </aside>
    );
  };

  const renderLayerTargetControls = () => {
    if (!selectedAsset) return null;

    return (
      <div className="limeets-gather-action-segment" aria-label="Target layer">
        <LayerButton
          active={selectedLayer === "floor"}
          disabled={!canAssetUseLayer(selectedAsset, "floor")}
          layer="floor"
          onClick={handleSelectLayer}
        >
          <Layers size={15} />
          Floor
        </LayerButton>
        <LayerButton
          active={selectedLayer === "above_floor"}
          disabled={!canAssetUseLayer(selectedAsset, "above_floor")}
          layer="above_floor"
          onClick={handleSelectLayer}
        >
          <ImageIcon size={15} />
          Above
        </LayerButton>
        <LayerButton
          active={selectedLayer === "object"}
          disabled={!canAssetUseLayer(selectedAsset, "object")}
          layer="object"
          onClick={handleSelectLayer}
        >
          <Box size={15} />
          Object
        </LayerButton>
      </div>
    );
  };

  const renderPaintModeControls = (label = "Paint mode") => (
    <div className="limeets-gather-action-segment" aria-label={label}>
      <button className={paintMode === "single" ? "active" : ""} onClick={() => setPaintMode("single")} type="button">
        Single
      </button>
      <button className={paintMode === "rectangle" ? "active" : ""} onClick={() => setPaintMode("rectangle")} type="button">
        Rectangle
      </button>
    </div>
  );

  const renderCurrentActionPanel = (variant = "") => {
    if (!editorOpen || !isOwner) return null;

    const assetSupportsRectangle =
      Boolean(selectedAsset) &&
      activeTool === "paint" &&
      canAssetUseLayer(selectedAsset, selectedLayer) &&
      selectedLayer !== "object";

    if (!selectedAsset || activeTool !== "paint") return null;

    return (
      <div className={`limeets-gather-current-action${variant ? ` ${variant}` : ""}`} aria-live="polite">
        <AssetPreview asset={selectedAsset} className="limeets-gather-current-thumb" />
        <div className="limeets-gather-current-copy">
          <strong>{selectedAsset.baseLabel}</strong>
          <span>
            {selectedAsset.variantName ? `${selectedAsset.variantName}${selectedAsset.direction ? ` - ${selectedAsset.direction}` : ""}. ` : ""}
            Placing on {LAYER_LABELS[selectedLayer].toLowerCase()}.
          </span>
        </div>
        <button
          className="limeets-gather-current-close"
          onClick={() => {
            setSelectedAsset(null);
            setSelectedSpecial("");
          }}
          title="Clear Selected Asset"
          type="button"
        >
          <X size={16} />
        </button>
        {renderLayerTargetControls()}
        {assetSupportsRectangle ? renderPaintModeControls("Placement Mode") : null}
        {selectedColorOptions.length > 1 ? (
          <div className="limeets-gather-option-row" aria-label="Asset Colours">
            {selectedColorOptions.map((option) => (
              <button
                aria-label={option.variantName || option.variantHex || "Variant"}
                className={option.variantKey === selectedAsset.variantKey ? "selected" : ""}
                key={`${option.id}-color`}
                onClick={() => {
                  const matchingDirection = getAssetDirectionOptions(option).find(
                    (candidate) => candidate.direction === selectedAsset.direction,
                  );
                  handleSelectAsset(matchingDirection || option);
                }}
                title={option.variantName || option.variantHex || "Variant"}
                type="button"
              >
                <span
                  className="limeets-gather-swatch"
                  style={{ background: option.variantHex || "rgba(255, 255, 255, 0.72)" }}
                />
              </button>
            ))}
          </div>
        ) : null}
        {selectedDirectionOptions.length > 1 ? (
          <div className="limeets-gather-direction-row" aria-label="Asset Direction">
            {selectedDirectionOptions.map((option) => (
              <button
                className={option.direction === selectedAsset.direction ? "selected" : ""}
                key={`${option.id}-direction`}
                onClick={() => handleSelectAsset(option)}
                type="button"
              >
                {option.direction || "Default"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderAreaLinkPrompt = () => {
    if (!activeAreaLink || editorOpen) return null;

    return (
      <div className="limeets-gather-current-action limeets-gather-link-action" aria-live="polite">
        <ExternalLink className="limeets-gather-current-icon" size={22} />
        <div className="limeets-gather-current-copy">
          <strong>{activeAreaLink.label || "Open Link"}</strong>
          <span>This area has a linked page.</span>
        </div>
        <button
          className="limeets-gather-link-open"
          onClick={() => openAreaLink(activeAreaLink.url, activeAreaLink.newTab)}
          type="button"
        >
          Open Link
        </button>
      </div>
    );
  };

  const renderMeetingAreaSpotlight = () => {
    if (editorOpen || !activeMeetingArea) return null;

    const areaRect = getAreaRectFromBounds(getPrivateAreaBounds(activeMeetingArea), world);
    const rect = areaRect?.pixel;
    if (!rect) return null;

    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const segments = [
      { id: "top", left: 0, top: 0, width: world.width, height: rect.y },
      { id: "bottom", left: 0, top: bottom, width: world.width, height: Math.max(0, world.height - bottom) },
      { id: "left", left: 0, top: rect.y, width: rect.x, height: rect.height },
      { id: "right", left: right, top: rect.y, width: Math.max(0, world.width - right), height: rect.height },
    ].filter((segment) => segment.width > 0 && segment.height > 0);

    return (
      <div className="limeets-gather-meeting-spotlight" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={segment.id}
            style={{
              height: `${segment.height}px`,
              left: `${segment.left}px`,
              top: `${segment.top}px`,
              width: `${segment.width}px`,
            }}
          />
        ))}
      </div>
    );
  };

  const renderMeetingAreaVisibilityLayer = () => {
    if (editorOpen || (!showMeetingAreas && !activeMeetingAreaId) || !meetingAreas.length) return null;

    return (
      <div className="limeets-gather-meeting-areas-layer" aria-hidden="true">
        {meetingAreas.map((area) => {
          const areaRect = getAreaRectFromBounds(getPrivateAreaBounds(area), world);
          const rect = areaRect?.pixel;
          if (!rect) return null;

          return (
            <span
              className={`limeets-gather-meeting-area-highlight${
                area.id === activeMeetingAreaId ? " active" : ""
              }`}
              key={area.id}
              style={{
                height: `${rect.height}px`,
                left: `${rect.x}px`,
                top: `${rect.y}px`,
                width: `${rect.width}px`,
              }}
            >
              <span>{area.name || area.label || "Meeting Area"}</span>
            </span>
          );
        })}
      </div>
    );
  };

  const areaCursorClass = getAreaCursorClass(
    editorOpen && isOwner && activeTool === "area" ? areaCursorMode || "draw" : "",
  );
  const viewportCursorClass =
    editorOpen && isOwner && editorPanel === "inspect" && activeTool === "select"
      ? "limeets-select-cursor"
      : areaCursorClass;

  return (
    <div className={`limeets-gather-root ${editorOpen && isOwner ? "editor-open" : ""}`}>
      <div
        className={`limeets-gather-viewport${viewportCursorClass ? ` ${viewportCursorClass}` : ""}`}
        onContextMenu={handleViewportContextMenu}
        onDoubleClick={handleViewportDoubleClick}
        onPointerDown={handleViewportPointerDown}
        onPointerLeave={() => {
          setHoveredTile(null);
          setAreaCursorMode("");
        }}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onWheel={handleWheel}
        ref={viewportRef}
        role="application"
      >
        <div
          className="limeets-gather-map"
          style={{
            "--limeets-camera-x": `${camera.x}px`,
            "--limeets-camera-y": `${camera.y}px`,
            "--limeets-camera-scale": camera.scale,
            "--limeets-tile-size": `${world.tileSize}px`,
            "--limeets-world-height": `${world.height}px`,
            "--limeets-world-width": `${world.width}px`,
            background: worldBackground,
          }}
        >
          <div className="limeets-gather-grid" />
          {renderTileLayer("floor")}
          {renderTileLayer("above_floor")}
          {renderTileLayer("object")}
          {editorOpen && isOwner ? renderSpecialTiles() : null}
          {renderGhost()}
          {renderSelectionLayer()}

          {hoveredTile ? (
            <div
              className="limeets-gather-hover"
              style={{
                left: `${hoveredTile.x * world.tileSize}px`,
                top: `${hoveredTile.y * world.tileSize}px`,
                height: `${world.tileSize}px`,
                width: `${world.tileSize}px`,
              }}
            />
          ) : null}

          {remoteMembers
            .filter((member) => member.position.worldRoomId === worldRoom.id)
            .map((member) => (
              <Avatar
                className="remote"
                key={getPresenceKey(member)}
                avatarPreset={member.user?.avatarPreset}
                name={getDisplayName(member.user)}
                player={member.position}
                status={member.profileStatus || "online"}
              />
            ))}

          {player ? (
            <Avatar
              avatarPreset={avatarPreset}
              name={currentUserName}
              player={player}
              status={currentProfileStatus}
            />
          ) : null}

          {renderMeetingAreaSpotlight()}
          {renderMeetingAreaVisibilityLayer()}
        </div>

        <div className="limeets-gather-hud">
          <strong>{worldRoomDisplayName}</strong>
          <span>
            X {hoveredTile?.x ?? "-"} / Y {hoveredTile?.y ?? "-"}
          </span>
        </div>

        {notice ? (
          <div className="limeets-gather-toast" role="status" aria-live="polite">
            {notice}
          </div>
        ) : null}

        {renderAreaLinkPrompt()}

        {isOwner && !editorOpen ? (
          <button className="limeets-gather-open-editor" onClick={() => setEditorOpen(true)} type="button">
            <Settings2 size={17} />
            Customise
          </button>
        ) : null}

        {editorOpen && isOwner ? (
          <div className="limeets-gather-toolbar" aria-label="Map editor tools">
            <div className="limeets-gather-tool-group">
              <ToolButton active={false} label="Close" onClick={() => setEditorOpen(false)}>
                <X size={20} />
              </ToolButton>
            </div>

            <div className="limeets-gather-tool-group">
              <ToolButton
                active={editorPanel === "objects" && activeTool === "paint"}
                label="Objects"
                onClick={() => {
                  setEditorPanel("objects");
                  setActiveTool("paint");
                  setSelectedSpecial("");
                }}
              >
                <Paintbrush size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "inspect" && activeTool === "select"}
                label="Select"
                onClick={() => {
                  setEditorPanel("inspect");
                  setActiveTool("select");
                  setSelectedCategoryPath("");
                }}
              >
                <MousePointer size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "hand" && activeTool === "pan"}
                label="Hand"
                onClick={() => {
                  setEditorPanel("hand");
                  setActiveTool("pan");
                  setSelectedCategoryPath("");
                }}
              >
                <Hand size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "erase" && activeTool === "erase"}
                label="Eraser"
                onClick={() => {
                  setEditorPanel("erase");
                  setActiveTool("erase");
                  setSelectedAsset(null);
                  setSelectedSpecial("");
                  setSelectedCategoryPath("");
                }}
              >
                <Eraser size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "special" && activeTool === "area"}
                label="Area Editor"
                onClick={() => {
                  setEditorPanel("special");
                  setActiveTool("area");
                  setSelectedAsset(null);
                  setSelectedSpecial("");
                  setSelectedCategoryPath("");
                }}
              >
                <Grid2X2 size={20} />
              </ToolButton>
            </div>

            <div className="limeets-gather-tool-group">
              <ToolButton
                active={editorPanel === "rooms"}
                label="Setup & Zones"
                onClick={() => {
                  setEditorPanel("rooms");
                  setSelectedCategoryPath("");
                }}
              >
                <DoorOpen size={20} />
              </ToolButton>
            </div>

            <div className="limeets-gather-tool-group">
              <ToolButton active={false} disabled={!history.length} label="Undo" onClick={undoWorld}>
                <Undo2 size={20} />
              </ToolButton>
              <ToolButton active={false} disabled={!future.length} label="Redo" onClick={redoWorld}>
                <Redo2 size={20} />
              </ToolButton>
            </div>
          </div>
        ) : null}

        <div className="limeets-gather-controls" aria-label="Limeets controls">
          <button
            aria-label="Go to my location"
            data-tooltip="Go To My Location"
            onClick={() => {
              followPlayerRef.current = true;
              if (playerRef.current) centerCameraOn(playerRef.current);
            }}
            type="button"
          >
            <MapPinned size={18} />
          </button>
          <button
            aria-label={showMeetingAreas ? "Hide Meeting Areas" : "Show Meeting Areas"}
            aria-pressed={showMeetingAreas}
            className={showMeetingAreas ? "active" : ""}
            data-tooltip={showMeetingAreas ? "Hide Meeting Areas" : "Show Meeting Areas"}
            onClick={toggleMeetingAreaVisibility}
            type="button"
          >
            <span className={`limeets-gather-vector-icon${showMeetingAreas ? "" : " off"}`} aria-hidden="true">
              <VectorSquare size={18} />
            </span>
          </button>
          <button
            aria-label="Zoom in"
            data-tooltip="Zoom In"
            onClick={() => zoomAt(cameraRef.current.scale * CAMERA_ZOOM_STEP)}
            type="button"
          >
            <Plus size={18} />
          </button>
          <button
            aria-label="Zoom out"
            data-tooltip="Zoom Out"
            onClick={() => zoomAt(cameraRef.current.scale / CAMERA_ZOOM_STEP)}
            type="button"
          >
            <Minus size={18} />
          </button>
          <button
            aria-label="Fit zone"
            data-tooltip="Fit Zone"
            onClick={() => {
              if (Math.abs(cameraRef.current.scale - fitScale) < 0.01 && playerRef.current) {
                centerCameraOn(playerRef.current, Math.min(1.5, CAMERA_MAX_SCALE));
              } else {
                const visibleViewport = getVisibleViewportSize(viewportSize, editorOpen, isOwner);
                const nextCamera = {
                  scale: fitScale,
                  x: (visibleViewport.width - world.width * fitScale) / 2,
                  y: (viewportSize.height - world.height * fitScale) / 2,
                };
                setCameraState(nextCamera);
              }
            }}
            type="button"
          >
            {Math.abs(camera.scale - fitScale) < 0.01 ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            aria-disabled="true"
            aria-label="More options"
            className="disabled"
            data-tooltip="More Options"
            onClick={(event) => event.preventDefault()}
            type="button"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {renderEditorPanel()}
    </div>
  );
}
