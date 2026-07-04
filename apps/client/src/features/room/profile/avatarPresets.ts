import avatarManifest from "./avatarManifest.json";

const GATHER_AVATAR_BASE = "/assets/limeets/avatars/gather/";

export type LimeetsAvatarCategory = "base" | "clothing" | "accessories" | "special";

export type LimeetsAvatarSelection = {
  itemId: string;
  variantId: string;
};

export type LimeetsAvatarSelections = Record<string, LimeetsAvatarSelection | null>;

export type LimeetsAvatarLayer = {
  backSrc?: string;
  label: string;
  slot: string;
  src: string;
};

export type LimeetsAvatarPreset = {
  category: LimeetsAvatarCategory;
  id: string;
  label: string;
  layers: LimeetsAvatarLayer[];
  selections: LimeetsAvatarSelections;
  version: 1;
};

type ManifestSlot = {
  items: Record<string, any>;
  label: string;
  layer: number;
  type: string;
};

type AvatarSlotGroup = {
  id: LimeetsAvatarCategory;
  label: string;
  slots: string[];
};

export const AVATAR_SLOT_GROUPS: AvatarSlotGroup[] = [
  { id: "base", label: "Base", slots: ["skin", "hair", "facial_hair"] },
  { id: "clothing", label: "Clothing", slots: ["top", "jacket", "bottom", "shoes"] },
  { id: "accessories", label: "Accessories", slots: ["hat", "glasses", "mobility", "others"] },
  { id: "special", label: "Special", slots: ["special_preset"] },
];

const REQUIRED_SLOTS = new Set(["skin", "hair", "top", "bottom", "shoes"]);

const DEFAULT_SELECTIONS: LimeetsAvatarSelections = {
  skin: { itemId: "typical", variantId: "3" },
  hair: { itemId: "short", variantId: "black" },
  facial_hair: null,
  top: { itemId: "t shirt", variantId: "blue" },
  bottom: { itemId: "pants", variantId: "black" },
  shoes: { itemId: "generic", variantId: "black" },
  jacket: null,
  hat: null,
  glasses: null,
  mobility: null,
};

const SKIN_SWATCHES: Record<string, string> = {
  "1": "#ffe2c4",
  "2": "#f4bd8b",
  "3": "#dd8a51",
  "4": "#b76535",
  "5": "#7d462b",
};

const COLOUR_SWATCHES: Record<string, string> = {
  auburn: "#8f4f3c",
  black: "#27232e",
  blond: "#eac56f",
  blue: "#4f8ee7",
  brown: "#875336",
  caramel: "#bd7b48",
  cream: "#ead9b3",
  "dirty blond": "#c2a36a",
  ginger: "#c86932",
  green: "#5da765",
  grey: "#90909a",
  indigo: "#55539d",
  magenta: "#c4599c",
  olive: "#80844e",
  orange: "#d66f32",
  pink: "#f18aaa",
  purple: "#8c69c9",
  red: "#d84d54",
  viridian: "#339c92",
  white: "#ebe7df",
  yellow: "#e5c54b",
};

function manifestSlots(): Record<string, ManifestSlot> {
  return ((avatarManifest as any).slots || {}) as Record<string, ManifestSlot>;
}

function assetUrl(path?: string) {
  return path ? `${GATHER_AVATAR_BASE}${path}` : "";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const VIRTUAL_SLOT_LABELS: Record<string, string> = {
  others: "Others",
  special_preset: "Presets",
};

export function getAvatarSlot(slotId: string) {
  return manifestSlots()[slotId] || null;
}

export function getAvatarSlotLabel(slotId: string) {
  return getAvatarSlot(slotId)?.label || VIRTUAL_SLOT_LABELS[slotId] || titleCase(slotId);
}

function getVariantMap(slotId: string, itemId: string): Record<string, any> {
  const item = getAvatarSlot(slotId)?.items?.[itemId];
  return item?.shades || item?.colours || {};
}

function getDefaultVariantId(slotId: string, itemId: string) {
  const variants = Object.keys(getVariantMap(slotId, itemId));
  if (!variants.length) return "";
  if (slotId === "skin" && variants.includes("3")) return "3";
  if (variants.includes("black")) return "black";
  if (variants.includes("blue")) return "blue";
  return variants[0];
}

export function getDefaultAvatarVariantId(slotId: string, itemId: string) {
  return getDefaultVariantId(slotId, itemId);
}

function getFirstItemId(slotId: string) {
  return Object.keys(getAvatarSlot(slotId)?.items || {})[0] || "";
}

function getChoice(slotId: string, itemId: string, variantId: string) {
  const variants = getVariantMap(slotId, itemId);
  return variants[variantId] || variants[getDefaultVariantId(slotId, itemId)] || null;
}

function sanitizeSelection(slotId: string, value: unknown): LimeetsAvatarSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (!REQUIRED_SLOTS.has(slotId)) return null;
    const itemId = getFirstItemId(slotId);
    return itemId ? { itemId, variantId: getDefaultVariantId(slotId, itemId) } : null;
  }

  const candidate = value as Partial<LimeetsAvatarSelection>;
  const slot = getAvatarSlot(slotId);
  const itemId = String(candidate.itemId || "");
  if (!slot?.items?.[itemId]) {
    return sanitizeSelection(slotId, null);
  }

  const defaultVariantId = getDefaultVariantId(slotId, itemId);
  const variantId = String(candidate.variantId || defaultVariantId);
  return {
    itemId,
    variantId: getVariantMap(slotId, itemId)[variantId] ? variantId : defaultVariantId,
  };
}

export function normalizeAvatarSelections(value: unknown): LimeetsAvatarSelections {
  const incoming =
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as any).selections || value)
      : {};

  return Object.fromEntries(
    Object.keys(manifestSlots()).map((slotId) => [
      slotId,
      sanitizeSelection(slotId, (incoming as Record<string, unknown>)[slotId]),
    ]),
  );
}

export function resolveAvatarLayers(selections: LimeetsAvatarSelections): LimeetsAvatarLayer[] {
  return Object.entries(selections)
    .map(([slotId, selection]) => {
      if (!selection) return null;

      const slot = getAvatarSlot(slotId);
      const item = slot?.items?.[selection.itemId];
      const choice = getChoice(slotId, selection.itemId, selection.variantId);
      if (!slot || !item || !choice?.front) return null;

      const itemLabel = item.label || titleCase(selection.itemId);
      const variantLabel = titleCase(selection.variantId);
      return {
        backSrc: assetUrl(choice.back),
        label: `${itemLabel} ${variantLabel}`.trim(),
        slot: slotId,
        src: assetUrl(choice.front),
        sort: Number(slot.layer || 0),
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.sort - b.sort)
    .map(({ sort: _sort, ...layer }: any) => layer);
}

export function normalizeLimeetsAvatarPreset(value: unknown): LimeetsAvatarPreset {
  const hasSelections =
    value && typeof value === "object" && !Array.isArray(value) && Boolean((value as any).selections);
  const selections = normalizeAvatarSelections(hasSelections ? value : DEFAULT_SELECTIONS);
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as any) : {};
  const layers = resolveAvatarLayers(selections);

  // Older saved profiles only stored rendered layers. Keep those renderable until the user saves a new avatar.
  if (!hasSelections && Array.isArray(candidate.layers) && candidate.layers.length) {
    const legacyLayers = candidate.layers
      .map((layer: any) => {
        const src = String(layer?.src || "");
        if (!src.startsWith(GATHER_AVATAR_BASE)) return null;
        return {
          backSrc: String(layer?.backSrc || ""),
          label: String(layer?.label || "Avatar layer").slice(0, 80),
          slot: String(layer?.slot || "layer").slice(0, 40),
          src,
        };
      })
      .filter(Boolean);

    if (legacyLayers.length) {
      return {
        category: "base",
        id: String(candidate.id || "legacy-avatar").slice(0, 80),
        label: String(candidate.label || "Avatar").slice(0, 80),
        layers: legacyLayers,
        selections,
        version: 1,
      };
    }
  }

  return {
    category: AVATAR_SLOT_GROUPS.find((group) => group.slots.includes("skin"))?.id || "base",
    id: `custom:${Object.entries(selections)
      .map(([slotId, selection]) =>
        selection ? `${slotId}:${selection.itemId}:${selection.variantId}` : `${slotId}:none`,
      )
      .join("|")}`,
    label: "Custom avatar",
    layers,
    selections,
    version: 1,
  };
}

export const DEFAULT_LIMEETS_AVATAR_PRESET = normalizeLimeetsAvatarPreset({
  selections: DEFAULT_SELECTIONS,
});

export function getGatherAvatarFrameIndex(direction = "down", moving = false, frame = 1) {
  // Gather avatar sheets are laid out as direction triplets:
  // standing, walk step A, walk step B.
  const walkCycle = [0, 1, 0, 2];
  const stepOffset = moving ? walkCycle[Math.floor(frame) % walkCycle.length] : 0;
  const baseByDirection: Record<string, number> = {
    down: 0,
    left: 3,
    up: 6,
    right: 9,
  };

  return (baseByDirection[direction] ?? baseByDirection.down) + stepOffset;
}

export function getAvatarSlotItems(slotId: string) {
  const slot = getAvatarSlot(slotId);
  return Object.entries(slot?.items || {}).map(([itemId, item]: [string, any]) => {
    const variantId = getDefaultVariantId(slotId, itemId);
    const choice = getChoice(slotId, itemId, variantId);
    return {
      id: itemId,
      label: item.label || titleCase(itemId),
      previewSrc: assetUrl(choice?.preview || item.preview),
    };
  });
}

export function getAvatarSlotChoices(slotId: string, itemId: string) {
  return Object.entries(getVariantMap(slotId, itemId)).map(([choiceId, choice]: [string, any]) => ({
    id: choiceId,
    label: titleCase(choiceId),
    previewSrc: assetUrl(choice?.preview),
    swatch: getAvatarChoiceSwatch(slotId, choiceId),
  }));
}

export function getAvatarChoiceSwatch(slotId: string, choiceId: string) {
  if (slotId === "skin") return SKIN_SWATCHES[choiceId] || "#d99a72";
  return COLOUR_SWATCHES[choiceId] || "#8e8aa9";
}

export function withAvatarSelection(
  avatar: LimeetsAvatarPreset,
  slotId: string,
  selection: LimeetsAvatarSelection | null,
) {
  const selections = {
    ...normalizeAvatarSelections(avatar),
    [slotId]: selection ? sanitizeSelection(slotId, selection) : null,
  };

  return normalizeLimeetsAvatarPreset({ selections });
}
