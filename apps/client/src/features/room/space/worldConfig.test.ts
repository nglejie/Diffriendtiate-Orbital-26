import { describe, expect, it } from "vitest";
import {
  CUSTOM_WORLD_MAP_ID,
  makeTileKey,
  normalizeWorldConfig,
  normalizeWorldTile,
  parseTileKey,
} from "./worldConfig.ts";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("worldConfig", () => {
  it("creates a safe default world when no saved config exists", () => {
    // A newly-created World must always be enterable, even before the owner
    // chooses a background or adds objects.
    const config = normalizeWorldConfig(null);

    expect(config).toMatchObject({
      activeRoomId: CUSTOM_WORLD_MAP_ID,
      columns: 64,
      enabled: true,
      rows: 40,
      tileSize: 32,
      version: 2,
    });
    expect(config.rooms).toHaveLength(1);
    expect(config.spawnpoint).toEqual({
      roomId: CUSTOM_WORLD_MAP_ID,
      x: 32,
      y: 20,
    });
  });

  it("keeps each zone's size, background, tilemap, and active zone separate", () => {
    // Guards against the regression where editing one zone background leaked
    // into every other zone in the virtual world.
    const config = normalizeWorldConfig({
      activeRoomId: "library",
      backgroundImage: "not-a-data-url",
      rooms: [
        {
          id: CUSTOM_WORLD_MAP_ID,
          name: "World",
          backgroundImage: tinyPng,
          columns: 30,
          rows: 22,
          tilemap: {
            "1,1": { floor: "tile:wood", object: ["chair", "plant"] },
          },
        },
        {
          id: "library",
          name: "Infilenite",
          backgroundImage: "",
          columns: 18,
          rows: 14,
          tilemap: {
            "4,3": { above_floor: ["rug"], object: "legacy-bookshelf" },
          },
        },
      ],
      spawnpoint: { roomId: "library", x: 9, y: 7 },
    });

    expect(config.activeRoomId).toBe("library");
    expect(config.columns).toBe(18);
    expect(config.rows).toBe(14);
    expect(config.backgroundImage).toBe("");
    expect(config.rooms[0].backgroundImage).toBe(tinyPng);
    expect(config.rooms[1].tilemap["4,3"]).toMatchObject({
      above_floor: ["rug"],
      object: ["legacy-bookshelf"],
    });
  });

  it("allows in-progress zone names while editing but supplies fallbacks for missing names", () => {
    // Blank names are allowed in the editor; save logic can later auto-name the
    // zone. Trailing spaces are also allowed while typing, because trimming on
    // every keystroke prevents owners from entering multi-word names.
    const config = normalizeWorldConfig({
      rooms: [
        { id: "blank", name: "", columns: 12, rows: 10 },
        { id: "draft", name: "Lecture ", columns: 12, rows: 10 },
        { id: "missing", columns: 12, rows: 10 },
      ],
    });

    expect(config.rooms[0].name).toBe("");
    expect(config.rooms[1].name).toBe("Lecture ");
    expect(config.rooms[2].name).toBe("Zone 3");
  });

  it("normalizes tile entries and drops malformed or out-of-bounds placements", () => {
    const config = normalizeWorldConfig({
      columns: 12,
      rows: 10,
      rooms: [
        {
          id: "world",
          columns: 12,
          rows: 10,
          tilemap: {
            " 2, 3 ": {
              floor: "floor-a",
              above_floor: [{ assetId: "rug-a" }, "rug-b"],
              object: [{ id: "desk-a" }, ""],
              impassable: true,
              teleporter: { roomId: "world", x: 99, y: -3 },
              portal: { tabId: "resources" },
              openUrl: "https://example.com",
            },
            "50,50": { floor: "outside" },
            nope: { object: "bad" },
          },
        },
      ],
    });

    expect(config.rooms[0].tilemap).toEqual({
      "2,3": {
        above_floor: ["rug-a", "rug-b"],
        floor: "floor-a",
        impassable: true,
        object: ["desk-a"],
        openUrl: "https://example.com",
        portal: { label: "Infilenite", tabId: "resources" },
        teleporter: { roomId: "world", x: 11, y: 0 },
      },
    });
  });

  it("migrates old collisions, objects, private areas, and tab zones into the tilemap", () => {
    // Older saved worlds used separate arrays. This protects users' existing
    // worlds when the editor normalizes into layered tile data.
    const config = normalizeWorldConfig({
      columns: 12,
      rows: 10,
      collisions: ["1,1"],
      objects: [{ assetId: "desk", col: 2, row: 2 }],
      privateAreas: [{ id: "huddle", bounds: { col: 3, row: 3, width: 2, height: 1 } }],
      zones: [{ tabId: "chat", bounds: { col: 5, row: 5, width: 1, height: 2 } }],
    });
    const tilemap = config.rooms[0].tilemap;

    expect(tilemap["1,1"].impassable).toBe(true);
    expect(tilemap["2,2"].object).toEqual(["desk"]);
    expect(tilemap["3,3"].privateAreaId).toBe("huddle");
    expect(tilemap["4,3"].privateAreaId).toBe("huddle");
    expect(tilemap["5,5"].portal).toEqual({ label: "Convolution", tabId: "chat" });
    expect(tilemap["5,6"].portal).toEqual({ label: "Convolution", tabId: "chat" });
  });

  it("normalizes Meeting Area effects, destinations, and navigate targets", () => {
    const config = normalizeWorldConfig({
      activeRoomId: "world",
      rooms: [{ id: "world", columns: 20, rows: 20 }],
      privateAreas: [
        {
          id: "meeting",
          label: "Nautical Huddle",
          bounds: { x: 18, y: 18, width: 9, height: 9 },
          destination: { roomId: "world", x: 99, y: 99 },
          effects: { entryExit: true, meeting: true, openLink: true, teleport: true },
          properties: [{ type: "openWebsite", url: "https://example.com" }, null],
          tabId: "buddy",
        },
      ],
    });

    expect(config.privateAreas[0]).toMatchObject({
      bounds: { col: 18, height: 2, row: 18, width: 2 },
      destination: { roomId: "world", x: 19, y: 19 },
      effects: {
        entryExit: true,
        impassable: false,
        meeting: true,
        openLink: true,
        teleport: true,
      },
      name: "Nautical Huddle",
      properties: [{ type: "openWebsite", url: "https://example.com" }],
      tabId: "buddy",
    });
  });

  it("parses tile keys and clamps world tiles to the selected zone bounds", () => {
    expect(makeTileKey(2.4, 3.6)).toBe("2,4");
    expect(parseTileKey(" 02, -3 ")).toEqual({ key: "2,-3", x: 2, y: -3 });
    expect(parseTileKey("2 / 3")).toBeNull();
    expect(normalizeWorldTile({ roomId: "zone", x: 99, y: -5 }, 10, 8))
      .toEqual({ roomId: "zone", x: 9, y: 0 });
  });
});
