export const themePresets = [
  {
    id: "twilight",
    name: "Twilight Room",
    description: "Deep violet room lighting with a rose accent.",
    colors: ["#1a0628", "#7b3bb2", "#ff78a6"],
  },
  {
    id: "rose",
    name: "Rose Archive",
    description: "Soft parchment panels with warm rose trims.",
    colors: ["#351244", "#c04d91", "#ffd3bd"],
  },
  {
    id: "sunset",
    name: "Sunset Quest",
    description: "A punchier coral palette for task-heavy groups.",
    colors: ["#3a1751", "#f06f8f", "#ffb86b"],
  },
  {
    id: "starlight",
    name: "Starlight Notes",
    description: "Cool lavender highlights with gold note accents.",
    colors: ["#22103c", "#9d7bff", "#ffe88a"],
  },
  {
    id: "meadow",
    name: "Meadow Focus",
    description: "Gentler greens and peach tones for calm sessions.",
    colors: ["#10251f", "#60b48a", "#ffd8a8"],
  },
  {
    id: "midnight",
    name: "Midnight Desk",
    description: "Quiet dark surfaces for late-night study rooms.",
    colors: ["#0d111c", "#5169c8", "#9de7ff"],
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Light pink highlights for softer study rooms.",
    colors: ["#271827", "#ff8ab3", "#ffe0ed"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Blue-green tones for long focus sessions.",
    colors: ["#071a2b", "#1c8fb8", "#9be7ff"],
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm firelit accents for late-night sprints.",
    colors: ["#22100d", "#c7483a", "#ffc06b"],
  },
  {
    id: "mono",
    name: "Monochrome",
    description: "Minimal black, grey, and white surfaces.",
    colors: ["#0c0d10", "#595f6b", "#f4f4f5"],
  },
];

const gradientBackgroundPresets = [
  {
    id: "aurora",
    name: "Aurora",
    type: "Gradient",
    environment: "Dream",
    color: "Purple",
    description: "A dreamy gradient space for general study groups.",
    css: "radial-gradient(circle at 18% 16%, rgba(255, 120, 166, 0.44), transparent 34%), radial-gradient(circle at 85% 18%, rgba(157, 123, 255, 0.32), transparent 30%), linear-gradient(135deg, #100519 0%, #271039 48%, #6c2a75 100%)",
  },
  {
    id: "paper",
    name: "Paper Board",
    type: "Gradient",
    environment: "Minimal",
    color: "Light",
    description: "Clean parchment room for content-heavy modules.",
    css: "linear-gradient(135deg, #fff5ed 0%, #ffe5f0 50%, #ead4ff 120%)",
  },
  {
    id: "night",
    name: "Night Desk",
    type: "Gradient",
    environment: "Night",
    color: "Blue",
    description: "Minimal dark workspace with crisp blue highlights.",
    css: "radial-gradient(circle at 20% 18%, rgba(81, 105, 200, 0.42), transparent 30%), linear-gradient(135deg, #090d16 0%, #141b2d 52%, #283a68 100%)",
  },
  {
    id: "mint",
    name: "Mint Frost",
    type: "Gradient",
    environment: "Minimal",
    color: "Green",
    description: "A crisp mint gradient for a lighter room.",
    css: "radial-gradient(circle at 28% 22%, rgba(193, 255, 228, 0.65), transparent 13rem), linear-gradient(135deg, #eafff6 0%, #bdebdc 48%, #78aee2 120%)",
  },
  {
    id: "peach",
    name: "Peach Cloud",
    type: "Gradient",
    environment: "Dream",
    color: "Warm",
    description: "Soft peach and pink tones for friendly groups.",
    css: "radial-gradient(circle at 35% 36%, rgba(255, 195, 120, 0.68), transparent 10rem), linear-gradient(135deg, #ffe8d6 0%, #ffb5ce 46%, #9f7cff 120%)",
  },
  {
    id: "matrix",
    name: "Matrix",
    type: "Gradient",
    environment: "Focus",
    color: "Green",
    description: "Dark green terminal-inspired focus mode.",
    css: "linear-gradient(90deg, rgba(87, 255, 154, 0.08) 1px, transparent 1px), linear-gradient(180deg, rgba(87, 255, 154, 0.08) 1px, transparent 1px), linear-gradient(135deg, #04110b 0%, #0c2518 62%, #10452b 100%)",
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
    color: "Blue",
    description: "Layered night hills inspired by quiet virtual rooms.",
    css: "radial-gradient(circle at 50% 10%, rgba(255, 255, 255, 0.6), transparent 2rem), radial-gradient(circle at 20% 28%, rgba(127, 151, 255, 0.28), transparent 18rem), linear-gradient(180deg, #060b1c 0%, #17254c 48%, #0a1025 49%, #050712 100%)",
  },
  {
    id: "rain-city",
    name: "Rain City",
    type: "Scene",
    environment: "Rain",
    color: "Blue",
    description: "A calm rainy city mood for quiet revision.",
    css: "linear-gradient(90deg, rgba(255, 111, 74, 0.24) 0 2%, transparent 2% 18%, rgba(255, 111, 74, 0.18) 18% 21%, transparent 21%), radial-gradient(circle at 75% 12%, rgba(157, 231, 255, 0.28), transparent 32%), linear-gradient(135deg, #101724 0%, #26364b 52%, #5a6c7e 100%)",
  },
  {
    id: "waterfall",
    name: "Waterfall",
    type: "Scene",
    environment: "Nature",
    color: "Blue",
    description: "Cool water tones with soft mountain mist.",
    css: "radial-gradient(circle at 58% 26%, rgba(235, 255, 255, 0.6), transparent 10rem), radial-gradient(circle at 25% 22%, rgba(255, 112, 112, 0.22), transparent 9rem), linear-gradient(135deg, #102233 0%, #5d8495 50%, #d9eef1 100%)",
  },
  {
    id: "forest-path",
    name: "Forest Path",
    type: "Scene",
    environment: "Nature",
    color: "Green",
    description: "Fresh green backdrop for relaxed collaboration.",
    css: "radial-gradient(circle at 24% 14%, rgba(223, 255, 154, 0.36), transparent 30%), radial-gradient(circle at 78% 34%, rgba(255, 230, 156, 0.24), transparent 16rem), linear-gradient(135deg, #10251f 0%, #23533f 55%, #ffcb9a 125%)",
  },
  {
    id: "library",
    name: "Library",
    type: "Scene",
    environment: "Interior",
    color: "Warm",
    description: "Warm, paper-like study space with soft shelves.",
    css: "radial-gradient(circle at 20% 15%, rgba(255, 232, 138, 0.34), transparent 30%), linear-gradient(135deg, #2b1737 0%, #70435e 48%, #ffd3bd 120%)",
  },
  {
    id: "cafe",
    name: "Cafe Glow",
    type: "Scene",
    environment: "Interior",
    color: "Warm",
    description: "Warm cafe-like lighting for casual group sessions.",
    css: "radial-gradient(circle at 22% 22%, rgba(255, 193, 116, 0.48), transparent 13rem), radial-gradient(circle at 80% 18%, rgba(255, 91, 120, 0.24), transparent 12rem), linear-gradient(135deg, #21110f 0%, #70422f 58%, #f0a05d 130%)",
  },
  {
    id: "lofi",
    name: "Lofi Desk",
    type: "Scene",
    environment: "Interior",
    color: "Purple",
    description: "Muted neon desk ambience for late work.",
    css: "radial-gradient(circle at 72% 18%, rgba(255, 114, 166, 0.36), transparent 15rem), radial-gradient(circle at 20% 70%, rgba(74, 189, 255, 0.24), transparent 14rem), linear-gradient(135deg, #120f1d 0%, #30214a 58%, #50304e 100%)",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    type: "Scene",
    environment: "Night",
    color: "Purple",
    description: "A starry study sky for imaginative rooms.",
    css: "radial-gradient(circle at 14% 18%, rgba(255,255,255,0.8) 0 1px, transparent 2px), radial-gradient(circle at 70% 22%, rgba(255,255,255,0.7) 0 1px, transparent 2px), radial-gradient(circle at 44% 60%, rgba(255, 118, 184, 0.22), transparent 18rem), linear-gradient(135deg, #020617 0%, #181437 54%, #421f58 100%)",
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
      const [a = "#0f1117", b = "#7c5cff", c = "#ef5d93"] = colors;
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
