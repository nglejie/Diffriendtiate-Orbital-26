import gatherDimensionsJson from "./limeetsGatherAssetDimensions.json";
import gatherManifestJson from "./limeetsGatherManifest.json";
import nonEmptyTileCellsJson from "./limeetsNonEmptyTileCells.json";

const OBJECT_BASE = "/assets/limeets/objects/";
const GATHER_ASSET_BASE = "/assets/limeets/gather-assets-full/";

export type LimeetsLayer = "floor" | "above_floor" | "object";
export type LimeetsAssetBucket = "tile" | "object";

export type LimeetsAsset = {
  id: string;
  label: string;
  baseLabel: string;
  category: string;
  src: string;
  width: number;
  height: number;
  blocks: boolean;
  bucket: LimeetsAssetBucket;
  defaultLayer: LimeetsLayer;
  allowedLayers: LimeetsLayer[];
  familyId: string;
  sheetCol?: number;
  sheetCols?: number;
  sheetRow?: number;
  sheetRows?: number;
  variantKey?: string;
  variantName?: string;
  variantHex?: string;
  direction?: string;
  layer?: LimeetsLayer;
};

type GatherManifest = {
  tiles?: Record<string, GatherManifestTilesheet>;
  objects?: Record<string, Record<string, GatherManifestObject>>;
};

type GatherManifestTilesheet = {
  sheet?: string;
  cols?: number;
  rows?: number;
  categories?: Array<{
    name?: string;
    row_start?: number;
    row_end?: number;
    tile_id_start?: number;
    tile_id_end?: number;
  }>;
};

type GatherManifestObject = {
  preview?: string;
  named_sprites?: string[];
  variants?: Array<{
    hex?: string;
    name?: string;
    sprites?: Record<string, string>;
  }>;
};

type GatherDimensions = Record<string, { width: number; height: number; tilesWide: number; tilesHigh: number }>;
type NonEmptyTileCells = Record<string, number[]>;

const gatherManifest = gatherManifestJson as GatherManifest;
const gatherDimensions = gatherDimensionsJson as GatherDimensions;
const nonEmptyTileCells = nonEmptyTileCellsJson as NonEmptyTileCells;

export const LIMEETS_AVATAR_SPRITES = [
  "/assets/limeets/workadventure/characters/female-01-1.png",
];

const MANUAL_OBJECT_ASSETS = [
  { id: "cozy-desk", label: "Cozy Desk", category: "Study", src: `${OBJECT_BASE}cozy-desk.png`, width: 3, height: 2, blocks: true },
  { id: "desk", label: "Desk", category: "Study", src: `${OBJECT_BASE}desk.png`, width: 3, height: 2, blocks: true },
  { id: "desktop", label: "Desktop", category: "Study", src: `${OBJECT_BASE}desktop.png`, width: 1, height: 2, blocks: true },
  { id: "laptop-down", label: "Laptop", category: "Study", src: `${OBJECT_BASE}laptop-down.png`, width: 1, height: 2, blocks: false },
  { id: "laptop-up", label: "Laptop Up", category: "Study", src: `${OBJECT_BASE}laptop-up.png`, width: 1, height: 1, blocks: false },
  { id: "whiteboard", label: "Whiteboard", category: "Study", src: `${OBJECT_BASE}whiteboard.png`, width: 2, height: 2, blocks: true },
  { id: "cozy-bookshelf", label: "Bookshelf", category: "Library", src: `${OBJECT_BASE}cozy-bookshelf.png`, width: 2, height: 2, blocks: true },
  { id: "books-stack", label: "Book Stack", category: "Library", src: `${OBJECT_BASE}books-stack.png`, width: 1, height: 1, blocks: false },
  { id: "book-open", label: "Open Book", category: "Library", src: `${OBJECT_BASE}book-open.png`, width: 1, height: 1, blocks: false },
  { id: "big-table", label: "Big Table", category: "Tables", src: `${OBJECT_BASE}big-table.png`, width: 6, height: 4, blocks: true },
  { id: "narrow-meeting-table", label: "Meeting Table", category: "Tables", src: `${OBJECT_BASE}narrow-meeting-table.png`, width: 2, height: 5, blocks: true },
  { id: "cozy-round-table", label: "Round Table", category: "Tables", src: `${OBJECT_BASE}cozy-round-table.png`, width: 1, height: 1, blocks: true },
  { id: "round-table", label: "Small Table", category: "Tables", src: `${OBJECT_BASE}round-table.png`, width: 1, height: 2, blocks: true },
  { id: "cozy-coffee-table", label: "Coffee Table", category: "Tables", src: `${OBJECT_BASE}cozy-coffee-table.png`, width: 2, height: 1, blocks: true },
  { id: "armchair-down", label: "Armchair", category: "Seats", src: `${OBJECT_BASE}armchair-down.png`, width: 1, height: 2, blocks: true },
  { id: "armchair-up", label: "Armchair Up", category: "Seats", src: `${OBJECT_BASE}armchair-up.png`, width: 1, height: 1, blocks: true },
  { id: "office-chair-down", label: "Office Chair", category: "Seats", src: `${OBJECT_BASE}office-chair-down.png`, width: 1, height: 1, blocks: true },
  { id: "office-chair-up", label: "Office Chair Up", category: "Seats", src: `${OBJECT_BASE}office-chair-up.png`, width: 1, height: 1, blocks: true },
  { id: "bench-down", label: "Bench", category: "Seats", src: `${OBJECT_BASE}bench-down.png`, width: 4, height: 1, blocks: true },
  { id: "bench-up", label: "Bench Up", category: "Seats", src: `${OBJECT_BASE}bench-up.png`, width: 4, height: 1, blocks: true },
  { id: "blue-couch-down", label: "Blue Couch", category: "Lounge", src: `${OBJECT_BASE}blue-couch-down.png`, width: 3, height: 2, blocks: true },
  { id: "red-couch", label: "Red Couch", category: "Lounge", src: `${OBJECT_BASE}red-couch.png`, width: 3, height: 2, blocks: true },
  { id: "pool-table", label: "Pool Table", category: "Lounge", src: `${OBJECT_BASE}pool-table.png`, width: 4, height: 2, blocks: true },
  { id: "record-player", label: "Record Player", category: "Lounge", src: `${OBJECT_BASE}record-player.png`, width: 1, height: 1, blocks: true },
  { id: "printer", label: "Printer", category: "Office", src: `${OBJECT_BASE}printer.png`, width: 2, height: 2, blocks: true },
  { id: "cozy-lamp", label: "Lamp", category: "Decor", src: `${OBJECT_BASE}cozy-lamp.png`, width: 1, height: 2, blocks: true },
  { id: "cozy-potted-plant", label: "Plant", category: "Decor", src: `${OBJECT_BASE}cozy-potted-plant.png`, width: 1, height: 1, blocks: true },
  { id: "potted-tree", label: "Potted Tree", category: "Decor", src: `${OBJECT_BASE}potted-tree.png`, width: 1, height: 2, blocks: true },
  { id: "fern", label: "Fern", category: "Decor", src: `${OBJECT_BASE}fern.png`, width: 1, height: 2, blocks: true },
].map((asset) => makeManualObjectAsset(asset));

function makeManualObjectAsset(asset: {
  id: string;
  label: string;
  category: string;
  src: string;
  width: number;
  height: number;
  blocks: boolean;
}): LimeetsAsset {
  return {
    ...asset,
    allowedLayers: ["object"],
    baseLabel: asset.label,
    bucket: "object",
    defaultLayer: "object",
    familyId: `manual:${asset.id}`,
    layer: "object",
  };
}

function encodeAssetPath(relativePath: string): string {
  return relativePath
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function gatherAssetUrl(relativePath: string): string {
  return `${GATHER_ASSET_BASE}${encodeAssetPath(relativePath)}`;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "asset";
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

const TITLE_CASE_CONNECTORS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const HEX_LABEL_PATTERN = /^#[0-9a-f]{6}$/i;

function toDisplayTitle(value: string | undefined): string {
  return String(value || "")
    .split("/")
    .map((segment) =>
      segment
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => {
          if (HEX_LABEL_PATTERN.test(word)) return word.toUpperCase();
          const lower = word.toLowerCase();
          if (index > 0 && TITLE_CASE_CONNECTORS.has(lower)) return lower;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" "),
    )
    .join("/");
}

function inferDirection(pathOrKey: string | undefined): string | undefined {
  if (!pathOrKey) return undefined;
  const lower = pathOrKey.toLowerCase();
  if (/(^|[_/-])down(\.|_|-|$)/.test(lower)) return "down";
  if (/(^|[_/-])up(\.|_|-|$)/.test(lower)) return "up";
  if (/(^|[_/-])left(\.|_|-|$)/.test(lower)) return "left";
  if (/(^|[_/-])right(\.|_|-|$)/.test(lower)) return "right";
  return undefined;
}

function inferManifestBucket(category: string): LimeetsAssetBucket {
  const normalized = category.toLowerCase();
  if (
    normalized.includes("rug") ||
    normalized.includes("mat") ||
    normalized.startsWith("wall decor") ||
    normalized.startsWith("wayfinding") ||
    normalized === "lighting/wall lights"
  ) {
    return "tile";
  }
  return "object";
}

function inferDefaultLayer(category: string, bucket: LimeetsAssetBucket): LimeetsLayer {
  if (bucket === "object") return "object";
  const normalized = category.toLowerCase();
  if (normalized.includes("floor") || normalized.includes("terrain")) return "floor";
  return "above_floor";
}

function allowedLayersFor(bucket: LimeetsAssetBucket): LimeetsLayer[] {
  return bucket === "tile" ? ["floor", "above_floor"] : ["object"];
}

function makeGatherObjectAsset(input: {
  category: string;
  label: string;
  relativePath: string;
  variantHex?: string;
  variantKey?: string;
  variantName?: string;
  direction?: string;
}): LimeetsAsset | null {
  const dimensions = gatherDimensions[input.relativePath];
  if (!dimensions || HEX_LABEL_PATTERN.test(input.label)) return null;

  const bucket = inferManifestBucket(input.category);
  const defaultLayer = inferDefaultLayer(input.category, bucket);
  const category = toDisplayTitle(input.category);
  const label = toDisplayTitle(input.label);
  const familyId = `gather:${slugify(category)}:${slugify(label)}`;
  const suffix = `${input.variantKey || "default"}:${input.direction || "default"}:${hashString(input.relativePath)}`;
  const id = `${familyId}:${slugify(suffix)}`;

  return {
    allowedLayers: allowedLayersFor(bucket),
    baseLabel: label,
    blocks: bucket === "object",
    bucket,
    category,
    defaultLayer,
    direction: input.direction,
    familyId,
    height: Math.max(1, Math.min(12, dimensions?.tilesHigh || 1)),
    id,
    label,
    layer: defaultLayer,
    src: gatherAssetUrl(input.relativePath),
    variantHex: input.variantHex,
    variantKey: input.variantKey,
    variantName: HEX_LABEL_PATTERN.test(input.variantName || "")
      ? input.variantName?.toUpperCase()
      : toDisplayTitle(input.variantName),
    width: Math.max(1, Math.min(12, dimensions?.tilesWide || 1)),
  };
}

function inferTileDefaultLayer(sheetName: string, categoryName: string): LimeetsLayer {
  const normalized = `${sheetName} ${categoryName}`.toLowerCase();
  if (normalized.includes("floor") || normalized.includes("terrain")) return "floor";
  return "above_floor";
}

function makeGatherTileAsset(input: {
  category: string;
  label: string;
  relativePath: string;
  sheetCols: number;
  sheetRows: number;
  tileId: number;
  defaultLayer: LimeetsLayer;
}): LimeetsAsset {
  const sheetCol = input.tileId % input.sheetCols;
  const sheetRow = Math.floor(input.tileId / input.sheetCols);
  const familyId = `tile:${slugify(input.category)}:${input.tileId}`;

  return {
    allowedLayers: ["floor", "above_floor"],
    baseLabel: input.label,
    blocks: false,
    bucket: "tile",
    category: input.category,
    defaultLayer: input.defaultLayer,
    familyId,
    height: 1,
    id: familyId,
    label: input.label,
    layer: input.defaultLayer,
    sheetCol,
    sheetCols: input.sheetCols,
    sheetRow,
    sheetRows: input.sheetRows,
    src: gatherAssetUrl(input.relativePath),
    width: 1,
  };
}

function buildGatherTileAssets(): LimeetsAsset[] {
  const assets: LimeetsAsset[] = [];

  Object.entries(gatherManifest.tiles || {}).forEach(([sheetName, sheet]) => {
    if (!sheet.sheet || !sheet.cols || !sheet.rows) return;
    const visibleTileIds = nonEmptyTileCells[sheet.sheet] ? new Set(nonEmptyTileCells[sheet.sheet]) : null;

    const fallbackCategory = {
      name: sheetName,
      tile_id_start: 0,
      tile_id_end: sheet.cols * sheet.rows - 1,
    };
    const categories = sheet.categories?.length ? sheet.categories : [fallbackCategory];

    categories.forEach((category) => {
      const start = Number.isFinite(category.tile_id_start) ? Number(category.tile_id_start) : Number(category.row_start || 0) * sheet.cols!;
      const end = Number.isFinite(category.tile_id_end)
        ? Number(category.tile_id_end)
        : (Number(category.row_end || sheet.rows! - 1) + 1) * sheet.cols! - 1;
      const categoryName = category.name || sheetName;
      const displaySheetName = toDisplayTitle(sheetName);
      const displayCategoryName = toDisplayTitle(categoryName);
      const pickerCategory = `${displaySheetName}/${displayCategoryName}`;
      const defaultLayer = inferTileDefaultLayer(sheetName, categoryName);

      for (let tileId = start; tileId <= end; tileId += 1) {
        if (visibleTileIds && !visibleTileIds.has(tileId)) continue;
        const row = Math.floor(tileId / sheet.cols!);
        if (row < 0 || row >= sheet.rows!) continue;
        assets.push(
          makeGatherTileAsset({
            category: pickerCategory,
            defaultLayer,
            label: `${displayCategoryName} ${tileId - start + 1}`,
            relativePath: sheet.sheet,
            sheetCols: sheet.cols,
            sheetRows: sheet.rows,
            tileId,
          }),
        );
      }
    });
  });

  return assets;
}

function buildGatherObjectAssets(): LimeetsAsset[] {
  const assets: LimeetsAsset[] = [];
  Object.entries(gatherManifest.objects || {}).forEach(([category, items]) => {
    Object.entries(items || {}).forEach(([label, item]) => {
      if (HEX_LABEL_PATTERN.test(label)) return;

      const variantSprites = item.variants?.flatMap((variant) =>
        Object.entries(variant.sprites || {}).map(([direction, relativePath]) =>
          makeGatherObjectAsset({
            category,
            direction: inferDirection(direction) || direction,
            label,
            relativePath,
            variantHex: variant.hex,
            variantKey: variant.hex || variant.name || "default",
            variantName: variant.name || variant.hex,
          }),
        ),
      ).filter((asset): asset is LimeetsAsset => Boolean(asset)) || [];

      if (variantSprites.length) {
        assets.push(...variantSprites);
        return;
      }

      const namedSprites = item.named_sprites?.length ? item.named_sprites : item.preview ? [item.preview] : [];
      namedSprites.forEach((relativePath) => {
        const asset = makeGatherObjectAsset({
          category,
          direction: inferDirection(relativePath),
          label,
          relativePath,
          variantKey: "default",
          variantName: "Default",
        });
        if (asset) assets.push(asset);
      });
    });
  });
  return assets;
}

function dedupeAssets(assets: LimeetsAsset[]): LimeetsAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export const LIMEETS_OBJECT_ASSETS = dedupeAssets([
  ...MANUAL_OBJECT_ASSETS,
  ...buildGatherTileAssets(),
  ...buildGatherObjectAssets(),
]);

export function getLimeetsAsset(assetId: string | null | undefined): LimeetsAsset | null {
  return LIMEETS_OBJECT_ASSETS.find((asset) => asset.id === assetId) || null;
}

export function canAssetUseLayer(asset: LimeetsAsset | null | undefined, layer: LimeetsLayer): boolean {
  return Boolean(asset?.allowedLayers.includes(layer));
}

export function getSmartLayerForAsset(asset: LimeetsAsset): LimeetsLayer {
  return asset.defaultLayer;
}

export function getLimeetsAssetsForLayer(layer: LimeetsLayer): LimeetsAsset[] {
  return LIMEETS_OBJECT_ASSETS.filter((asset) => canAssetUseLayer(asset, layer));
}

export function getAssetColorOptions(asset: LimeetsAsset | null | undefined): LimeetsAsset[] {
  if (!asset?.familyId) return [];
  const seen = new Set<string>();
  return LIMEETS_OBJECT_ASSETS.filter((candidate) => candidate.familyId === asset.familyId)
    .filter((candidate) => {
      const key = candidate.variantKey || candidate.variantName || candidate.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getAssetDirectionOptions(asset: LimeetsAsset | null | undefined): LimeetsAsset[] {
  if (!asset?.familyId) return [];
  const variantKey = asset.variantKey || "";
  const seen = new Set<string>();
  return LIMEETS_OBJECT_ASSETS.filter((candidate) => {
    if (candidate.familyId !== asset.familyId) return false;
    if ((candidate.variantKey || "") !== variantKey) return false;
    const key = candidate.direction || "default";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
