import {
  ArrowLeft,
  Box,
  ChevronRight,
  DoorOpen,
  Eraser,
  Eye,
  EyeOff,
  Grid2X2,
  Hand,
  Image as ImageIcon,
  Layers,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  MousePointer,
  Navigation,
  Paintbrush,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../api.ts";
import { getBackground } from "../../../constants.ts";
import {
  CUSTOM_WORLD_MAP_ID,
  makeTileKey,
  normalizeWorldConfig,
  parseTileKey,
} from "./worldConfig.ts";
import {
  LIMEETS_AVATAR_SPRITES,
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
  getAvatarFrame,
  getDirectionFromDelta,
  getFramePosition,
  findTilePath,
  tileToWorldPoint,
  worldPointToTile,
} from "./gatherMovement.ts";

const CAMERA_MIN_SCALE = 0.22;
const CAMERA_MAX_SCALE = 5.2;
const CAMERA_ZOOM_STEP = 1.16;
const MOVE_EMIT_INTERVAL_MS = 120;
const PAN_DRAG_THRESHOLD_PX = 5;
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
    description: "Pan the world without moving your avatar.",
  },
  inspect: {
    title: "Inspect Tile",
    description: "Select a tile or object on the map to review what is placed there.",
  },
  objects: {
    title: "Add Object to Your World",
    description: "Search, choose an object, then stamp it on the map.",
  },
  rooms: {
    title: "Rooms",
    description: "Create, rename, switch, or remove connected world rooms.",
  },
  setup: {
    title: "World Setup",
    description: "Adjust the map size and background image.",
  },
  special: {
    title: "Special Tiles",
    description: "Paint collision, spawn, teleport, or meeting-area markers.",
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
    description: "Move players to another room tile.",
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
    description: "Mark tiles that automatically join voice and video.",
    icon: Grid2X2,
  },
];

const ERASER_TARGETS = [
  { id: "all", label: "Everything", icon: Trash2 },
  { id: "floor", label: "Floor", icon: Layers },
  { id: "above_floor", label: "Above", icon: ImageIcon },
  { id: "object", label: "Objects", icon: Box },
  { id: "special", label: "Special", icon: MapPin },
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

function getRoomFromWorld(world) {
  return (
    world.rooms.find((room) => room.id === world.activeRoomId) ||
    world.rooms[0] ||
    { id: CUSTOM_WORLD_MAP_ID, name: "World", tilemap: {} }
  );
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
        return {
          x: clamp(saved.x, 0, getWorldSize(world).width),
          y: clamp(saved.y, 0, getWorldSize(world).height),
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
  const point = tileToWorldPoint(spawn, world.tileSize);
  return {
    ...point,
    direction: "down",
    frame: getAvatarFrame("down", false, 0),
    moving: false,
    path: [],
  };
}

function serializePlayerPosition(player, world, worldRoom) {
  const tile = worldPointToTile(player, world.columns, world.rows, world.tileSize);
  return {
    mapId: CUSTOM_WORLD_MAP_ID,
    worldRoomId: worldRoom.id,
    col: tile.x,
    row: tile.y,
    x: Number(player.x.toFixed(2)),
    y: Number(player.y.toFixed(2)),
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

  const direction = ["down", "left", "right", "up"].includes(raw.direction)
    ? raw.direction
    : "down";

  return {
    ...presence,
    position: {
      x,
      y,
      direction,
      frame: getAvatarFrame(direction, Boolean(raw.moving), performance.now()),
      moving: Boolean(raw.moving),
      worldRoomId: raw.worldRoomId || CUSTOM_WORLD_MAP_ID,
    },
  };
}

function getPresenceKey(presence) {
  return presence?.presenceId || presence?.socketId || presence?.userId || "";
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

function Avatar({ className = "", name, player, spriteUrl, status = "Online" }) {
  const frame = getFramePosition(player.frame || 1);

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
        <span aria-hidden="true" />
        {name}
      </div>
      <div
        aria-label={`${name} avatar, ${status}`}
        className="limeets-gather-avatar-sprite"
        role="img"
        style={{
          "--avatar-sheet": `url("${spriteUrl}")`,
          "--avatar-offset-x": `${-frame.x}px`,
          "--avatar-offset-y": `${-frame.y}px`,
        }}
      />
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
      title={label}
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
  onMeetingAreaChange,
  onNavigate,
  onWorldChanged,
  room,
  roomActivityMembers = [],
  socket,
  spaceContext,
  user,
}) {
  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const worldRoomRef = useRef(null);
  const playerRef = useRef(null);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const keysRef = useRef(new Set());
  const blockedTilesRef = useRef(new Set());
  const lastEmitRef = useRef(0);
  const meetingAreaRef = useRef("");
  const lastPresenceSnapshotRef = useRef("");
  const lastSpaceJoinRetryRef = useRef(0);
  const panRef = useRef(null);
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
  const [dragPreview, setDragPreview] = useState(null);
  const [notice, setNotice] = useState("");
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
  const [searchTerm, setSearchTerm] = useState("");
  const [teleportDraft, setTeleportDraft] = useState({ roomId: CUSTOM_WORLD_MAP_ID, x: 0, y: 0 });

  const isOwner = Boolean(room?.isOwner);
  const avatarSprite = LIMEETS_AVATAR_SPRITES[0];
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
    return clamp(
      Math.max(viewportSize.width / world.width, viewportSize.height / world.height),
      CAMERA_MIN_SCALE,
      CAMERA_MAX_SCALE,
    );
  }, [viewportSize.height, viewportSize.width, world.height, world.width]);
  const selectedTile = useMemo(
    () => (selectedTileKey ? worldRoom.tilemap?.[selectedTileKey] || null : null),
    [selectedTileKey, worldRoom.tilemap],
  );
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
    setEditorPanel("objects");
  }, [room?.id, room?.worldConfig]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    roomIdRef.current = room?.id;
  }, [room?.id]);

  useEffect(
    () => () => {
      meetingAreaRef.current = "";
      onMeetingAreaChange?.(null);
    },
    [onMeetingAreaChange],
  );

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
  }, []);

  const constrainCamera = useCallback(
    (nextCamera) => {
      const viewport = viewportRef.current;
      if (!viewport) return nextCamera;

      const rect = viewport.getBoundingClientRect();
      const scaledWidth = world.width * nextCamera.scale;
      const scaledHeight = world.height * nextCamera.scale;
      const edgePaddingX = editorOpen && isOwner ? Math.min(520, Math.max(240, rect.width * 0.28)) : 96;
      const edgePaddingY = editorOpen && isOwner ? Math.min(260, Math.max(140, rect.height * 0.18)) : 96;
      const clampAxis = (position, viewportLength, scaledLength, padding) => {
        if (scaledLength + padding * 2 <= viewportLength) return (viewportLength - scaledLength) / 2;
        return clamp(position, viewportLength - scaledLength - padding, padding);
      };

      return {
        ...nextCamera,
        x: clampAxis(nextCamera.x, rect.width, scaledWidth, edgePaddingX),
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
      const nextCamera = constrainCamera({
        scale,
        x: rect.width / 2 - point.x * scale,
        y: rect.height / 2 - point.y * scale,
      });
      cameraRef.current = nextCamera;
      setCamera(nextCamera);
    },
    [constrainCamera, fitScale],
  );

  useEffect(() => {
    const nextPlayer = getInitialPlayer(world, worldRoom, room);
    playerRef.current = nextPlayer;
    setPlayer(nextPlayer);
    if (viewportSize.width && viewportSize.height) centerCameraOn(nextPlayer, fitScale);
  }, [
    centerCameraOn,
    fitScale,
    room?.id,
    viewportSize.height,
    viewportSize.width,
    world.columns,
    world.rows,
    world.tileSize,
    worldRoom.id,
  ]);

  useEffect(() => {
    if (viewportSize.width && viewportSize.height && playerRef.current) {
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
        roomId: activeRoomId,
        position,
      },
      (ack) => {
        if (ack?.ok || performance.now() - lastSpaceJoinRetryRef.current < 2000) return;

        lastSpaceJoinRetryRef.current = performance.now();
        activeSocket.emit("space:join", {
          roomId: activeRoomId,
          position,
        });
      },
    );
  }, []);

  useEffect(() => {
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
      } else if (currentPlayer.path?.length) {
        const target = currentPlayer.path[0];
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

      const moving = vectorX !== 0 || vectorY !== 0;
      const speed =
        AVATAR_SPEED_PX_PER_SECOND *
        (keysRef.current.has("Shift") ? AVATAR_RUN_MULTIPLIER : 1);

      if (moving) {
        const length = Math.hypot(vectorX, vectorY) || 1;
        const unitX = vectorX / length;
        const unitY = vectorY / length;
        const nextX = currentPlayer.x + unitX * speed * deltaSeconds;
        const nextY = currentPlayer.y + unitY * speed * deltaSeconds;
        const nextTile = worldPointToTile(
          { x: nextX, y: nextY },
          currentWorld.columns,
          currentWorld.rows,
          currentWorld.tileSize,
        );
        const nextKey = makeTileKey(nextTile.x, nextTile.y);

        if (!blocked.has(nextKey)) {
          currentPlayer.x = clamp(nextX, 0, currentWorld.width);
          currentPlayer.y = clamp(nextY, 0, currentWorld.height);
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
      const tileData = currentWorldRoom.tilemap?.[makeTileKey(currentTile.x, currentTile.y)];
      const nextMeetingAreaId = tileData?.privateAreaId || "";

      if (meetingAreaRef.current !== nextMeetingAreaId) {
        meetingAreaRef.current = nextMeetingAreaId;
        onMeetingAreaChange?.(
          nextMeetingAreaId
            ? {
                areaId: nextMeetingAreaId,
                tile: currentTile,
                worldRoomId: currentWorldRoom.id,
              }
            : null,
        );
      }

      if (tileData?.teleporter && moving) {
        const destinationRoom =
          currentWorld.rooms.find((candidate) => candidate.id === tileData.teleporter.roomId) ||
          currentWorldRoom;
        const point = tileToWorldPoint(tileData.teleporter, currentWorld.tileSize);
        currentPlayer.x = point.x;
        currentPlayer.y = point.y;
        currentPlayer.path = [];
        applyWorldUpdate(
          (current) => ({
            ...current,
            activeRoomId: destinationRoom.id,
          }),
          { snapshot: false },
        );
      } else if (tileData?.portal?.tabId && tileData.portal.tabId !== "space") {
        onNavigate?.(tileData.portal.tabId);
      }

      const nextPlayer = { ...currentPlayer };
      playerRef.current = nextPlayer;
      setPlayer(nextPlayer);

      if (moving && followPlayerRef.current && viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect();
        const currentCamera = cameraRef.current;
        setCameraState({
          ...currentCamera,
          x: currentCamera.x + (rect.width / 2 - nextPlayer.x * currentCamera.scale - currentCamera.x) * 0.16,
          y: currentCamera.y + (rect.height / 2 - nextPlayer.y * currentCamera.scale - currentCamera.y) * 0.16,
        });
      }

      persistAndBroadcast(nextPlayer, now);
      animationFrame = window.requestAnimationFrame(tick);
    }

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [applyWorldUpdate, onMeetingAreaChange, onNavigate, persistAndBroadcast, setCameraState]);

  useEffect(() => {
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
  }, [editorOpen, redoWorld, undoWorld]);

  useEffect(() => {
    if (!socket || !room?.id || !playerReady) return undefined;

    function isCurrentPresence(presence) {
      const presenceId = getPresenceKey(presence);
      return presenceId ? presenceId === socket.id : presence?.userId === user?.id;
    }

    function joinSpace() {
      if (!playerRef.current || !socket.connected) return;

      const joinPayload = {
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
          position: payload.position,
        },
        worldRef.current || world,
      );
      const nextKey = getPresenceKey(normalized);

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

    socket.on("connect", joinSpace);
    socket.on("space:state", handleSpaceState);
    socket.on("space:user-moved", handleUserMoved);
    socket.on("space:user-left", handleUserLeft);

    return () => {
      socket.emit("space:leave", { roomId: room.id });
      socket.off("connect", joinSpace);
      socket.off("space:state", handleSpaceState);
      socket.off("space:user-moved", handleUserMoved);
      socket.off("space:user-left", handleUserLeft);
    };
  }, [playerReady, room?.id, socket, user?.id, world, worldRoom]);

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

  const placeSingleTile = useCallback(
    (tile, privateAreaId = "") => {
      if (!isOwner) return;

      if (selectedSpecial) {
        if (selectedSpecial === "spawn") {
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

  const applyTileAction = useCallback(
    (tiles) => {
      if (!tiles.length) return;
      const privateAreaId = selectedSpecial === "private" ? `private-${Date.now()}` : "";
      applyWorldUpdate((current) => {
        const next = clone(current);
        const activeRoom = next.rooms.find((candidate) => candidate.id === next.activeRoomId);
        if (!activeRoom) return next;

        if (activeTool === "erase") {
          const removedPlacements = new Set();
          tiles.forEach((tile) => {
            const key = makeTileKey(tile.x, tile.y);

            if (eraserTarget === "special") {
              const entry = clearTileEntry(activeRoom.tilemap[key] || {}, "special");
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

            const entry = clearTileEntry(activeRoom.tilemap[key] || {}, eraserTarget);
            if (Object.keys(entry).length) activeRoom.tilemap[key] = entry;
            else delete activeRoom.tilemap[key];
          });
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
      playerRef.current.path = path.slice(1).map((step) => tileToWorldPoint(step, world.tileSize));
      followPlayerRef.current = true;
    },
    [blockedTiles, world.columns, world.rows, world.tileSize],
  );

  const handleViewportPointerDown = useCallback(
    (event) => {
      if (event.target.closest(MAP_OVERLAY_SELECTOR)) {
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;

      const tile = getTileFromEvent(event);
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
    [getTileFromEvent],
  );

  const handleViewportPointerMove = useCallback(
    (event) => {
      updateHover(event);

      const currentTile = getTileFromEvent(event);
      const forceSinglePreview =
        activeTool !== "select" &&
        (selectedSpecial === "spawn" ||
          selectedSpecial === "teleport" ||
          (!selectedSpecial && selectedLayer === "object"));
      if (dragTileRef.current && currentTile && editorOpen && paintMode === "rectangle" && !forceSinglePreview) {
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
      getTileFromEvent,
      paintMode,
      selectedAsset,
      selectedLayer,
      selectedSpecial,
      setCameraState,
      updateHover,
    ],
  );

  const handleViewportPointerUp = useCallback(
    (event) => {
      const pan = panRef.current;
      const startTile = dragTileRef.current;
      const endTile = getTileFromEvent(event);
      panRef.current = null;
      dragTileRef.current = null;
      setDragPreview(null);
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      if (event.target.closest(MAP_OVERLAY_SELECTOR)) {
        return;
      }
      if (pan?.dragged || event.button !== 0 || !endTile) return;

      if (editorOpen && isOwner) {
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
          const tiles = paintMode === "rectangle" ? rectangleTiles(startTile, endTile) : [endTile];
          applyTileAction(tiles);
          return;
        }
        if (activeTool === "select") {
          if (
            paintMode === "rectangle" &&
            startTile &&
            (startTile.x !== endTile.x || startTile.y !== endTile.y)
          ) {
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
      editorOpen,
      getTileFromEvent,
      isOwner,
      paintMode,
      selectedAsset,
      selectedLayer,
      selectedSpecial,
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
        applyWorldUpdate((current) => ({
          ...current,
          backgroundImage:
            typeof reader.result === "string" && reader.result.startsWith("data:image/")
              ? reader.result
              : current.backgroundImage,
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
      const payload = await api.updateRoom(room.id, {
        worldConfig: normalizeWorldConfig(draftWorldRef.current),
      });
      setWorldSaved(true);
      setSaveState("saved");
      onWorldChanged?.(payload.room);
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch (error) {
      setSaveState("error");
      setNotice(error?.message || "Unable to save this world right now.");
      window.setTimeout(() => setSaveState("idle"), 2200);
    }
  }, [isOwner, onWorldChanged, room?.id]);

  const createWorldRoom = useCallback(() => {
    applyWorldUpdate((current) => {
      let counter = current.rooms.length + 1;
      let name = `Room ${counter}`;
      const names = new Set(current.rooms.map((item) => item.name.toLowerCase()));
      while (names.has(name.toLowerCase())) {
        counter += 1;
        name = `Room ${counter}`;
      }
      const id = `world-room-${Date.now()}`;
      return {
        ...current,
        activeRoomId: id,
        rooms: [...current.rooms, { id, name, tilemap: {} }],
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
      return {
        ...current,
        activeRoomId: nextActiveId,
        rooms: remaining,
        spawnpoint:
          current.spawnpoint.roomId === current.activeRoomId
            ? { roomId: nextActiveId, x: Math.floor(current.columns / 2), y: Math.floor(current.rows / 2) }
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
      applyWorldUpdate(
        (current) => ({
          ...current,
          [key]: Number(value),
        }),
        { snapshot: false },
      );
    },
    [applyWorldUpdate],
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

    return (
      <div className={`limeets-gather-special-layer ${showGizmos ? "" : "hidden"}`} aria-hidden="true">
        {Object.entries(worldRoom.tilemap || {}).flatMap(([key, tile]) => {
          const parsed = parseTileKey(key);
          if (!parsed) return [];
          const items = [];
          if (tile.impassable) items.push("impassable");
          if (tile.teleporter) items.push("teleport");
          if (tile.privateAreaId) items.push("private");
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
    if (!editorOpen || activeTool === "select" || activeTool === "pan" || !tiles.length) return null;
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
          ) : (
            <div>
              <h2>{panelCopy.title}</h2>
              <p>{panelCopy.description}</p>
            </div>
          )}
        </header>

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
                <p className="limeets-gather-empty">No assets yet.</p>
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
                <p className="limeets-gather-empty">No matching assets.</p>
              ) : null}
            </div>
          ) : null}

          {editorPanel === "special" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
            <div className="limeets-gather-special-list">
              {SPECIAL_TILES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={selectedSpecial === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => {
                      setSelectedSpecial(item.id);
                      setSelectedAsset(null);
                      setActiveTool("paint");
                      setEditorPanel("special");
                      if (item.id === "private") setPaintMode("rectangle");
                    }}
                    type="button"
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            </section>
          ) : null}

          {editorPanel === "special" && selectedSpecial === "teleport" ? (
            <section className="limeets-gather-section">
              <h3>Teleport destination</h3>
              <label className="limeets-gather-field">
                <span>Room</span>
                <select
                  onChange={(event) => setTeleportDraft((draft) => ({ ...draft, roomId: event.target.value }))}
                  value={teleportDraft.roomId}
                >
                  {world.rooms.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="limeets-gather-two-cols">
                <label className="limeets-gather-field">
                  <span>X</span>
                  <input
                    max={world.columns - 1}
                    min={0}
                    onChange={(event) => setTeleportDraft((draft) => ({ ...draft, x: event.target.value }))}
                    type="number"
                    value={teleportDraft.x}
                  />
                </label>
                <label className="limeets-gather-field">
                  <span>Y</span>
                  <input
                    max={world.rows - 1}
                    min={0}
                    onChange={(event) => setTeleportDraft((draft) => ({ ...draft, y: event.target.value }))}
                    type="number"
                    value={teleportDraft.y}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {editorPanel === "inspect" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <h3>
                {selectedPlacementInfo
                  ? "Selected asset"
                  : selectedTileKeys.length > 1
                    ? `${selectedTileKeys.length} tiles selected`
                    : selectedTileKey
                      ? "Selected tile"
                      : "No selection"}
              </h3>
              <p className="limeets-gather-muted">
                {selectedPlacementInfo?.origin
                  ? `${selectedPlacementInfo.asset.label} at ${selectedPlacementInfo.origin.x},${selectedPlacementInfo.origin.y}`
                  : selectedTileKeys.length > 1
                    ? "Rectangle selection is active. Use clear selected tiles to remove everything inside it."
                    : selectedTileKey || "Use the select tool, then click a tile or object on the map."}
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
                      To back
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
                      To front
                    </button>
                  </div>
                  <button
                    className="limeets-gather-danger"
                    onClick={deleteSelectedPlacement}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Delete selected asset
                  </button>
                </>
              ) : null}

              {selectedTilePlacements.length > 1 ? (
                <div className="limeets-gather-stack-list">
                  <strong>Tile stack</strong>
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
                  Clear selected tiles
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
                    Clear tile
                  </button>
                </>
              ) : null}
            </section>
          ) : null}

          {editorPanel === "erase" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <h3>Eraser</h3>
              <p className="limeets-gather-muted">
                Click a tile to clear it, or enable rectangle mode to clear a dragged area.
              </p>
            </section>
          ) : null}

          {editorPanel === "hand" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
              <h3>Hand tool</h3>
              <p className="limeets-gather-muted">
                Drag the world to pan around without placing tiles or moving your avatar.
              </p>
            </section>
          ) : null}

          {editorPanel === "rooms" ? (
            <section className="limeets-gather-section limeets-gather-section-first">
            <label className="limeets-gather-field">
              <span>Current room</span>
              <select
                onChange={(event) =>
                  applyWorldUpdate((current) => ({ ...current, activeRoomId: event.target.value }), {
                    snapshot: false,
                  })
                }
                value={world.activeRoomId}
              >
                {world.rooms.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="limeets-gather-field">
              <span>Room name</span>
              <input onChange={(event) => renameActiveWorldRoom(event.target.value)} value={worldRoom.name} />
            </label>
            <div className="limeets-gather-button-row">
              <button onClick={createWorldRoom} type="button">
                <Plus size={16} />
                New room
              </button>
              <button disabled={world.rooms.length <= 1} onClick={deleteActiveWorldRoom} type="button">
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </section>
          ) : null}

          {editorPanel === "setup" ? (
          <section className="limeets-gather-section limeets-gather-section-first">
            <div className="limeets-gather-two-cols">
              <label className="limeets-gather-field">
                <span>Columns</span>
                <input
                  max={256}
                  min={12}
                  onChange={(event) => changeWorldSize("columns", event.target.value)}
                  type="number"
                  value={world.columns}
                />
              </label>
              <label className="limeets-gather-field">
                <span>Rows</span>
                <input
                  max={256}
                  min={10}
                  onChange={(event) => changeWorldSize("rows", event.target.value)}
                  type="number"
                  value={world.rows}
                />
              </label>
            </div>
            <label className="limeets-gather-file">
              <ImageIcon size={18} />
              Choose background image
              <input accept="image/*" onChange={(event) => applyBackgroundFile(event.target.files?.[0])} type="file" />
            </label>
          </section>
          ) : null}
        </div>

        </div>

        <footer className="limeets-gather-savebar">
          <span>{worldSaved ? "Saved" : "Unsaved world changes"}</span>
          <button disabled={saveState === "saving"} onClick={saveWorld} type="button">
            <Save size={16} />
            {saveState === "saving" ? "Saving" : "Save World"}
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

  const renderCurrentActionPanel = () => {
    if (!editorOpen || !isOwner) return null;

    const selectedSpecialTile = SPECIAL_TILES.find((item) => item.id === selectedSpecial);
    const SelectedSpecialIcon = selectedSpecialTile?.icon;
    const eraserTargetConfig = ERASER_TARGETS.find((target) => target.id === eraserTarget) || ERASER_TARGETS[0];
    const EraserTargetIcon = eraserTargetConfig.icon;
    const showSelectMode = activeTool === "select" && editorPanel === "inspect";
    const assetSupportsRectangle =
      Boolean(selectedAsset) &&
      activeTool === "paint" &&
      canAssetUseLayer(selectedAsset, selectedLayer) &&
      selectedLayer !== "object";
    const specialSupportsRectangle =
      selectedSpecial === "impassable" || selectedSpecial === "private";

    if (!selectedAsset && !selectedSpecialTile && activeTool !== "erase" && !showSelectMode) return null;

    return (
      <div className="limeets-gather-current-action" aria-live="polite">
        {showSelectMode ? (
          <>
            <MousePointer className="limeets-gather-current-icon" size={22} />
            <div className="limeets-gather-current-copy">
              <strong>Select</strong>
              <span>{paintMode === "rectangle" ? "Drag to select tiles." : "Click to inspect a tile or asset."}</span>
            </div>
            {renderPaintModeControls("Select mode")}
          </>
        ) : null}

        {selectedAsset && activeTool === "paint" ? (
          <>
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
              title="Clear selected asset"
              type="button"
            >
              <X size={16} />
            </button>
            {renderLayerTargetControls()}
            {assetSupportsRectangle ? renderPaintModeControls("Placement mode") : null}
            {selectedColorOptions.length > 1 ? (
              <div className="limeets-gather-option-row" aria-label="Asset colours">
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
              <div className="limeets-gather-direction-row" aria-label="Asset direction">
                {selectedDirectionOptions.map((option) => (
                  <button
                    className={option.direction === selectedAsset.direction ? "selected" : ""}
                    key={`${option.id}-direction`}
                    onClick={() => handleSelectAsset(option)}
                    type="button"
                  >
                    {option.direction || "default"}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {selectedSpecialTile && SelectedSpecialIcon && activeTool === "paint" ? (
          <>
            <SelectedSpecialIcon className="limeets-gather-current-icon" size={22} />
            <div className="limeets-gather-current-copy">
              <strong>{selectedSpecialTile.title}</strong>
              <span>{selectedSpecialTile.description}</span>
            </div>
            <button
              className="limeets-gather-current-close"
              onClick={() => setSelectedSpecial("")}
              title="Clear special tile"
              type="button"
            >
              <X size={16} />
            </button>
            {specialSupportsRectangle ? renderPaintModeControls("Special tile mode") : null}
          </>
        ) : null}

        {!selectedAsset && !selectedSpecialTile && activeTool === "erase" ? (
          <>
            <EraserTargetIcon className="limeets-gather-current-icon" size={22} />
            <div className="limeets-gather-current-copy">
              <strong>Erase {eraserTargetConfig.label}</strong>
              <span>{paintMode === "rectangle" ? "Drag to clear a rectangle." : "Click a tile to clear it."}</span>
            </div>
            <button
              className="limeets-gather-current-close"
              onClick={() => {
                setActiveTool("select");
                setEditorPanel("inspect");
              }}
              title="Stop erasing"
              type="button"
            >
              <X size={16} />
            </button>
            {renderPaintModeControls("Erase mode")}
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
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`limeets-gather-root ${editorOpen && isOwner ? "editor-open" : ""}`}>
      <div
        className="limeets-gather-viewport"
        onDoubleClick={handleViewportDoubleClick}
        onPointerDown={handleViewportPointerDown}
        onPointerLeave={() => setHoveredTile(null)}
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
          {renderSpecialTiles()}
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
                name={getDisplayName(member.user)}
                player={member.position}
                spriteUrl={avatarSprite}
                status="Online"
              />
            ))}

          {player ? (
            <Avatar name={currentUserName} player={player} spriteUrl={avatarSprite} status="You" />
          ) : null}
        </div>

        <div className="limeets-gather-hud">
          <strong>{worldRoom.name}</strong>
          <span>
            X {hoveredTile?.x ?? "-"} / Y {hoveredTile?.y ?? "-"}
          </span>
          <span>{roomActivityMembers.length || 1} active</span>
          <span>{spaceContext?.activeChatChannel || "#general"}</span>
        </div>

        {notice ? <div className="limeets-gather-toast">{notice}</div> : null}

        {renderCurrentActionPanel()}

        {isOwner && !editorOpen ? (
          <button className="limeets-gather-open-editor" onClick={() => setEditorOpen(true)} type="button">
            <Settings2 size={17} />
            Customise World
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
                  setSelectedCategoryPath("");
                }}
              >
                <Eraser size={20} />
              </ToolButton>
            </div>

            <div className="limeets-gather-tool-group">
              <ToolButton
                active={editorPanel === "special"}
                label="Special tiles"
                onClick={() => {
                  setEditorPanel("special");
                  setActiveTool("paint");
                  setSelectedAsset(null);
                  setSelectedCategoryPath("");
                }}
              >
                <MapPin size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "rooms"}
                label="Rooms"
                onClick={() => {
                  setEditorPanel("rooms");
                  setSelectedCategoryPath("");
                }}
              >
                <DoorOpen size={20} />
              </ToolButton>
              <ToolButton
                active={editorPanel === "setup"}
                label="Setup"
                onClick={() => {
                  setEditorPanel("setup");
                  setSelectedCategoryPath("");
                }}
              >
                <Settings2 size={20} />
              </ToolButton>
              <ToolButton
                active={showGizmos}
                label={showGizmos ? "Hide special tiles" : "Show special tiles"}
                onClick={() => setShowGizmos((visible) => !visible)}
              >
                {showGizmos ? <Eye size={20} /> : <EyeOff size={20} />}
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
            aria-label="Show my location"
            onClick={() => {
              followPlayerRef.current = true;
              if (playerRef.current) centerCameraOn(playerRef.current);
            }}
            title="Show my location"
            type="button"
          >
            <Navigation size={18} />
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => zoomAt(cameraRef.current.scale * CAMERA_ZOOM_STEP)}
            title="Zoom in"
            type="button"
          >
            <Plus size={18} />
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => zoomAt(cameraRef.current.scale / CAMERA_ZOOM_STEP)}
            title="Zoom out"
            type="button"
          >
            <Minus size={18} />
          </button>
          <button
            aria-label="Fit world"
            onClick={() => {
              if (Math.abs(cameraRef.current.scale - fitScale) < 0.01 && playerRef.current) {
                centerCameraOn(playerRef.current, Math.min(1.5, CAMERA_MAX_SCALE));
              } else {
                const nextCamera = {
                  scale: fitScale,
                  x: (viewportSize.width - world.width * fitScale) / 2,
                  y: (viewportSize.height - world.height * fitScale) / 2,
                };
                setCameraState(nextCamera);
              }
            }}
            title="Fit world"
            type="button"
          >
            {Math.abs(camera.scale - fitScale) < 0.01 ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button aria-label="More options" disabled title="More options" type="button">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {renderEditorPanel()}
    </div>
  );
}
