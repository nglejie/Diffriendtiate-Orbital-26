import { ROSELY_PALETTE, ROSE_PINE_PALETTE } from "./theme.ts";

const rosely = ROSELY_PALETTE;
const rosePine = ROSE_PINE_PALETTE;

export const themePresets = [
  {
    id: "twilight",
    name: "Rose Pine",
    description: "The main dark palette with Love and Rose accents.",
    colors: [rosePine.base, rosePine.love, rosePine.rose],
  },
  {
    id: "rose",
    name: "Rose Pine Bloom",
    description: "Rose, gold, and overlay tones from the dark palette.",
    colors: [rosePine.overlay, rosePine.rose, rosePine.gold],
  },
  {
    id: "sunset",
    name: "Rosely Warmth",
    description: "Warm Rosely pink and yellow highlights.",
    colors: [rosely.sugarSwizzle, rosely.morningGlory, rosely.meadowlark],
  },
  {
    id: "starlight",
    name: "Rosely Orchid",
    description: "Radiant orchid with soft lavender support.",
    colors: [rosely.blackBeauty, rosely.radiantOrchid, rosely.lavenderFog],
  },
  {
    id: "meadow",
    name: "Rosely Mauve Gold",
    description: "Rosely mauve with warm gold emphasis.",
    colors: [rosely.sugarSwizzle, rosely.mauve, rosely.warmGold],
  },
  {
    id: "midnight",
    name: "Rose Pine Love",
    description: "Quiet Rose Pine surfaces with Love and Rose accents.",
    colors: [rosePine.base, rosePine.love, rosePine.rose],
  },
  {
    id: "sakura",
    name: "Rosely Quartz",
    description: "Rose Quartz and Barely Pink for softer rooms.",
    colors: [rosely.sugarSwizzle, rosely.roseQuartz, rosely.barelyPink],
  },
  {
    id: "ocean",
    name: "Rosely Mauve",
    description: "A lighter mauve and lupine Rosely focus palette.",
    colors: [rosely.sugarSwizzle, rosely.mauve, rosely.lupine],
  },
  {
    id: "ember",
    name: "Rose Pine Gold",
    description: "Gold and love accents over Rose Pine surfaces.",
    colors: [rosePine.surface, rosePine.gold, rosePine.love],
  },
  {
    id: "mono",
    name: "Rosely Greys",
    description: "The Rosely greyscale range for a calmer room.",
    colors: [rosely.blackBeauty, rosely.graniteGray, rosely.sugarSwizzle],
  },
];

const gradientBackgroundPresets = [
  {
    id: "aurora",
    name: "Aurora",
    type: "Gradient",
    environment: "Dream",
    color: "Purple",
    description: "A Rose Pine gradient space for general study groups.",
    css: "radial-gradient(circle at 18% 16%, color-mix(in srgb, var(--rose-pine-love) 34%, transparent), transparent 34%), radial-gradient(circle at 85% 18%, color-mix(in srgb, var(--rose-pine-rose) 28%, transparent), transparent 30%), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 48%, var(--rose-pine-overlay) 100%)",
  },
  {
    id: "paper",
    name: "Paper Board",
    type: "Gradient",
    environment: "Minimal",
    color: "Light",
    description: "Clean Rosely room for content-heavy modules.",
    css: "linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-7) 50%, var(--rosely-b) 120%)",
  },
  {
    id: "night",
    name: "Night Desk",
    type: "Gradient",
    environment: "Night",
    color: "Pink",
    description: "Minimal Rose Pine workspace with Love highlights.",
    css: "radial-gradient(circle at 20% 18%, color-mix(in srgb, var(--rose-pine-love) 28%, transparent), transparent 30%), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 52%, var(--rose-pine-overlay) 100%)",
  },
  {
    id: "mint",
    name: "Mauve Frost",
    type: "Gradient",
    environment: "Minimal",
    color: "Purple",
    description: "A crisp Rosely mauve gradient for a lighter room.",
    css: "radial-gradient(circle at 28% 22%, color-mix(in srgb, var(--rosely-mauve) 24%, transparent), transparent 13rem), linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-7) 48%, var(--rosely-a) 120%)",
  },
  {
    id: "peach",
    name: "Peach Cloud",
    type: "Gradient",
    environment: "Dream",
    color: "Warm",
    description: "Soft Rosely pink and yellow tones for friendly groups.",
    css: "radial-gradient(circle at 35% 36%, color-mix(in srgb, var(--rosely-f) 36%, transparent), transparent 10rem), linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-5) 46%, var(--rosely-a) 120%)",
  },
  {
    id: "matrix",
    name: "Love Grid",
    type: "Gradient",
    environment: "Focus",
    color: "Pink",
    description: "Rose Pine Love grid lines for a focused workspace.",
    css: "linear-gradient(90deg, color-mix(in srgb, var(--rose-pine-love) 10%, transparent) 1px, transparent 1px), linear-gradient(180deg, color-mix(in srgb, var(--rose-pine-love) 10%, transparent) 1px, transparent 1px), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 62%, var(--rose-pine-overlay) 100%)",
  },
];

const ambientWorldPath = (fileName) =>
  `url('/backgrounds/ambient-worlds/${fileName}') center / cover no-repeat`;

const ambientWorld = ({ id, name, type = "Scenic", environment, color, file }) => ({
  id,
  name,
  type,
  environment,
  color,
  description: `${name} ambient world background.`,
  css: ambientWorldPath(file),
});

const ambientWorldBackgroundPresets = [
  ambientWorld({
    id: "autumn-streets",
    name: "Autumn Streets",
    environment: "Urban",
    color: "Warm",
    file: "autumn-streets.jpg",
  }),
  ambientWorld({
    id: "beachside",
    name: "Beachside",
    environment: "Coast",
    color: "Blue",
    file: "beachside.jpg",
  }),
  ambientWorld({
    id: "clouds",
    name: "Clouds",
    environment: "Sky",
    color: "Pastel",
    file: "clouds.jpg",
  }),
  ambientWorld({
    id: "green-mountain-top",
    name: "Green Mountain Top",
    environment: "Nature",
    color: "Green",
    file: "green-mountain-top.jpg",
  }),
  ambientWorld({
    id: "home-mountain",
    name: "Home Mountain",
    environment: "Nature",
    color: "Purple",
    file: "home-mountain.jpg",
  }),
  ambientWorld({
    id: "lofi-cafe",
    name: "LoFi Cafe",
    environment: "Interior",
    color: "Purple",
    file: "lofi-cafe.jpg",
  }),
  ambientWorld({
    id: "midnight-workspace",
    name: "Midnight Workspace",
    environment: "Interior",
    color: "Blue",
    file: "midnight-workspace.jpg",
  }),
  ambientWorld({
    id: "mountain-night",
    name: "Mountain Night",
    environment: "Nature",
    color: "Blue",
    file: "mountain-night.jpg",
  }),
  ambientWorld({
    id: "mountain-sunset",
    name: "Mountain Sunset",
    environment: "Nature",
    color: "Warm",
    file: "mountain-sunset.jpg",
  }),
  ambientWorld({
    id: "night-street",
    name: "Night Street",
    environment: "Urban",
    color: "Purple",
    file: "night-street.jpg",
  }),
  ambientWorld({
    id: "railway",
    name: "Railway",
    environment: "Urban",
    color: "Warm",
    file: "railway.jpg",
  }),
  ambientWorld({
    id: "snowy-mountain",
    name: "Snowy Mountain",
    environment: "Nature",
    color: "Blue",
    file: "snowy-mountain.jpg",
  }),
  ambientWorld({
    id: "street",
    name: "Street",
    environment: "Urban",
    color: "Warm",
    file: "street.jpg",
  }),
  ambientWorld({
    id: "valley-house",
    name: "Valley House",
    environment: "Nature",
    color: "Green",
    file: "valley-house.jpg",
  }),
  ambientWorld({
    id: "cartoon-castle",
    name: "Cartoon Castle",
    type: "Cartoon",
    environment: "Fantasy",
    color: "Purple",
    file: "cartoon-castle.jpg",
  }),
  ambientWorld({
    id: "painting-castle",
    name: "Painting Castle",
    type: "Painting",
    environment: "Fantasy",
    color: "Warm",
    file: "painting-castle.jpg",
  }),
  ambientWorld({
    id: "painting-countryside",
    name: "Painting Countryside",
    type: "Painting",
    environment: "Nature",
    color: "Green",
    file: "painting-countryside.jpg",
  }),
  ambientWorld({
    id: "painting-disco-elysium",
    name: "Painting Disco Elysium",
    type: "Painting",
    environment: "Urban",
    color: "Warm",
    file: "painting-disco-elysium.jpg",
  }),
  ambientWorld({
    id: "painting-pond",
    name: "Painting Pond",
    type: "Painting",
    environment: "Nature",
    color: "Green",
    file: "painting-pond.jpg",
  }),
  ambientWorld({
    id: "pixel-arcade-city",
    name: "Pixel Arcade City",
    type: "Pixel",
    environment: "Urban",
    color: "Neon",
    file: "pixel-arcade-city.jpg",
  }),
  ambientWorld({
    id: "pixel-bloom-paradise",
    name: "Pixel Bloom Paradise",
    type: "Pixel",
    environment: "Nature",
    color: "Pink",
    file: "pixel-bloom-paradise.jpg",
  }),
  ambientWorld({
    id: "pixel-mountain-road",
    name: "Pixel Mountain Road",
    type: "Pixel",
    environment: "Nature",
    color: "Blue",
    file: "pixel-mountain-road.jpg",
  }),
  ambientWorld({
    id: "pixel-workshop",
    name: "Pixel Workshop",
    type: "Pixel",
    environment: "Interior",
    color: "Warm",
    file: "pixel-workshop.jpg",
  }),
];

export const backgroundPresets = [
  ...gradientBackgroundPresets,
  ...ambientWorldBackgroundPresets,
];

const legacyBackgroundPresets = [
  // Older room records may still reference these ids even though they are no longer selectable.
  {
    id: "poster-dusk",
    name: "Starlit Dusk",
    type: "Scene",
    environment: "Night",
    color: "Purple",
    description: "A purple starry backdrop that matches the app's current visual direction.",
    css: "url('/backgrounds/diffriendtiate-dusk.png') center / cover no-repeat",
  },
  {
    id: "moon-valley",
    name: "Moon Valley",
    type: "Scene",
    environment: "Night",
    color: "Purple",
    description: "Layered night hills inspired by quiet virtual rooms.",
    css: "radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--rose-pine-rose) 48%, transparent), transparent 2rem), radial-gradient(circle at 20% 28%, color-mix(in srgb, var(--rose-pine-love) 22%, transparent), transparent 18rem), linear-gradient(180deg, var(--rose-pine-base) 0%, var(--rose-pine-overlay) 48%, var(--rose-pine-surface) 49%, var(--rose-pine-base) 100%)",
  },
  {
    id: "rain-city",
    name: "Rain City",
    type: "Scene",
    environment: "Rain",
    color: "Pink",
    description: "A calm rainy city mood for quiet revision.",
    css: "linear-gradient(90deg, color-mix(in srgb, var(--rose-pine-love) 24%, transparent) 0 2%, transparent 2% 18%, color-mix(in srgb, var(--rose-pine-love) 18%, transparent) 18% 21%, transparent 21%), radial-gradient(circle at 75% 12%, color-mix(in srgb, var(--rose-pine-gold) 18%, transparent), transparent 32%), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 52%, var(--rose-pine-overlay) 100%)",
  },
  {
    id: "waterfall",
    name: "Waterfall",
    type: "Scene",
    environment: "Nature",
    color: "Pink",
    description: "Cool water tones with soft mountain mist.",
    css: "radial-gradient(circle at 58% 26%, color-mix(in srgb, var(--rosely-5) 36%, var(--rosely-3)), transparent 10rem), radial-gradient(circle at 25% 22%, color-mix(in srgb, var(--rosely-4) 24%, transparent), transparent 9rem), linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-7) 50%, var(--rosely-a) 100%)",
  },
  {
    id: "forest-path",
    name: "Forest Path",
    type: "Scene",
    environment: "Nature",
    color: "Warm",
    description: "Warm Rosely backdrop for relaxed collaboration.",
    css: "radial-gradient(circle at 24% 14%, color-mix(in srgb, var(--rosely-warm-gold) 24%, transparent), transparent 30%), radial-gradient(circle at 78% 34%, color-mix(in srgb, var(--rosely-mauve) 18%, transparent), transparent 16rem), linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-7) 55%, var(--rosely-warm-gold) 125%)",
  },
  {
    id: "library",
    name: "Library",
    type: "Scene",
    environment: "Interior",
    color: "Warm",
    description: "Warm, paper-like study space with soft shelves.",
    css: "radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--rosely-f) 34%, transparent), transparent 30%), linear-gradient(135deg, var(--rosely-3) 0%, var(--rosely-8) 48%, var(--rosely-5) 120%)",
  },
  {
    id: "cafe",
    name: "Cafe Glow",
    type: "Scene",
    environment: "Interior",
    color: "Warm",
    description: "Warm cafe-like lighting for casual group sessions.",
    css: "radial-gradient(circle at 22% 22%, color-mix(in srgb, var(--rose-pine-gold) 38%, transparent), transparent 13rem), radial-gradient(circle at 80% 18%, color-mix(in srgb, var(--rose-pine-love) 24%, transparent), transparent 12rem), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 58%, var(--rose-pine-gold) 130%)",
  },
  {
    id: "lofi",
    name: "Lofi Desk",
    type: "Scene",
    environment: "Interior",
    color: "Purple",
    description: "Muted neon desk ambience for late work.",
    css: "radial-gradient(circle at 72% 18%, color-mix(in srgb, var(--rose-pine-love) 36%, transparent), transparent 15rem), radial-gradient(circle at 20% 70%, color-mix(in srgb, var(--rose-pine-rose) 22%, transparent), transparent 14rem), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 58%, var(--rose-pine-overlay) 100%)",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    type: "Scene",
    environment: "Night",
    color: "Purple",
    description: "A starry study sky for imaginative rooms.",
    css: "radial-gradient(circle at 14% 18%, color-mix(in srgb, var(--rose-pine-text) 80%, transparent) 0 1px, transparent 2px), radial-gradient(circle at 70% 22%, color-mix(in srgb, var(--rose-pine-text) 70%, transparent) 0 1px, transparent 2px), radial-gradient(circle at 44% 60%, color-mix(in srgb, var(--rose-pine-love) 22%, transparent), transparent 18rem), linear-gradient(135deg, var(--rose-pine-base) 0%, var(--rose-pine-surface) 54%, var(--rose-pine-overlay) 100%)",
  },
];

const allBackgroundPresets = [...backgroundPresets, ...legacyBackgroundPresets];

export const moduleCodeOptions = [
  "CS1010S",
  "CS1231S",
  "CS2030S",
  "CS2040S",
  "CS2100",
  "CS2101",
  "CS2103T",
  "CP2106",
  "CS2109S",
  "CS3230",
  "CS3243",
  "CS3244",
  "CS4248",
  "IS1108",
  "IS2101",
  "MA1521",
  "MA2001",
  "ST2334",
  "BT2102",
  "GER1000",
];

export const defaultCustomBackgroundColors = [
  rosePine.base,
  rosePine.rose,
  rosePine.love,
];

export const emptyRoomForm = {
  name: "",
  moduleCode: "",
  academicTerm: "",
  description: "",
  visibility: "public",
  password: "",
  tags: "",
  theme: "twilight",
  background: "aurora",
  roomLogo: "",
  worldConfig: {
    enabled: true,
    version: 1,
    backgroundImage: "",
    tileSize: 32,
    columns: 64,
    rows: 40,
    spawn: { mapId: "custom-world", col: 6, row: 6 },
    collisions: [],
    objects: [],
    privateAreas: [],
    zones: [],
  },
};

export function getTheme(themeId) {
  return themePresets.find((theme) => theme.id === themeId) || themePresets[0];
}

export function createCustomBackgroundValue({ name, colors }) {
  return `custom:${encodeURIComponent(JSON.stringify({ name, colors }))}`;
}

export function createCustomImageBackgroundValue({ name, dataUrl }) {
  return `image:${encodeURIComponent(JSON.stringify({ name, dataUrl }))}`;
}

export function getBackground(backgroundId) {
  if (String(backgroundId || "").startsWith("image:")) {
    try {
      const payload = JSON.parse(
        decodeURIComponent(String(backgroundId).replace(/^image:/, "")),
      );

      if (!payload.dataUrl) return backgroundPresets[0];

      return {
        id: backgroundId,
        name: payload.name || "Uploaded Background",
        type: "Custom",
        environment: "Custom",
        color: "Custom",
        description: "Uploaded room background.",
        css: `url("${payload.dataUrl}") center / cover no-repeat`,
      };
    } catch {
      return backgroundPresets[0];
    }
  }

  if (String(backgroundId || "").startsWith("custom:")) {
    try {
      const payload = JSON.parse(
        decodeURIComponent(String(backgroundId).replace(/^custom:/, "")),
      );
      const colors = Array.isArray(payload.colors) ? payload.colors : [];
      const [a = rosePine.base, b = rosePine.rose, c = rosePine.love] = colors;
      return {
        id: backgroundId,
        name: payload.name || "Custom Theme",
        type: "Custom",
        environment: "Custom",
        color: "Custom",
        description: "Your own custom gradient.",
        css: `radial-gradient(circle at 24% 18%, ${c}88, transparent 15rem), linear-gradient(135deg, ${a} 0%, ${b} 55%, ${c} 125%)`,
      };
    } catch {
      return backgroundPresets[0];
    }
  }

  return (
    allBackgroundPresets.find((background) => background.id === backgroundId) ||
    backgroundPresets[0]
  );
}
