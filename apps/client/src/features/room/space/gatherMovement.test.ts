import { describe, expect, it } from "vitest";
import {
  AVATAR_ANIMATION_FPS,
  TILE_SIZE,
  clampAvatarWorldPoint,
  findTilePath,
  getAvatarFrame,
  getDirectionFromDelta,
  getFramePosition,
  tileToWorldPoint,
  worldPointToTile,
} from "./gatherMovement.ts";
import { makeTileKey } from "./worldConfig.ts";

describe("gatherMovement", () => {
  it("maps tile centres and pointer coordinates to the intended tile", () => {
    // Protects click/right-click movement from the one-tile targeting offset that
    // can happen when avatar height is mixed up with the tile foot position.
    expect(tileToWorldPoint({ x: 4, y: 7 })).toEqual({
      x: 4 * TILE_SIZE + TILE_SIZE / 2,
      y: 7 * TILE_SIZE + TILE_SIZE / 2,
    });

    expect(worldPointToTile({ x: 4 * TILE_SIZE + 1, y: 7 * TILE_SIZE + 1 }, 12, 12))
      .toEqual({ x: 4, y: 7 });
    expect(worldPointToTile({ x: 9999, y: -50 }, 12, 12))
      .toEqual({ x: 11, y: 0 });
  });

  it("clamps avatar anchors so the rendered sprite cannot leave the world bounds", () => {
    // The world avatar is taller than a tile. Clamping to 0 would let the
    // sprite's head render outside the map border at the top edge.
    expect(clampAvatarWorldPoint({ x: -120, y: -80 }, 6, 5, TILE_SIZE))
      .toEqual({ x: 24, y: 58 });
    expect(clampAvatarWorldPoint({ x: 999, y: 999 }, 6, 5, TILE_SIZE))
      .toEqual({ x: 168, y: 160 });
    expect(clampAvatarWorldPoint({ x: 80, y: 92 }, 6, 5, TILE_SIZE))
      .toEqual({ x: 80, y: 92 });
  });

  it("keeps avatar bounds deterministic on very small worlds", () => {
    expect(clampAvatarWorldPoint({ x: -1, y: -1 }, 1, 1, TILE_SIZE))
      .toEqual({ x: 16, y: 32 });
    expect(clampAvatarWorldPoint({ x: 999, y: 999 }, 1, 1, TILE_SIZE))
      .toEqual({ x: 16, y: 32 });
  });

  it("chooses the dominant movement direction", () => {
    // Keeps the avatar facing consistent for WASD and path-following movement.
    expect(getDirectionFromDelta(8, 2)).toBe("right");
    expect(getDirectionFromDelta(-8, 2)).toBe("left");
    expect(getDirectionFromDelta(2, -8)).toBe("up");
    expect(getDirectionFromDelta(2, 8)).toBe("down");
    expect(getDirectionFromDelta(0, 0, "left")).toBe("left");
  });

  it("advances animation frames at the configured walking cadence", () => {
    // The frame number is later translated by avatar presets into Gather's
    // standing/step-A/standing/step-B cycle, so this cadence must stay stable.
    const frameDuration = 1000 / AVATAR_ANIMATION_FPS;

    expect(getAvatarFrame("down", false, frameDuration * 8)).toBe(0);
    expect(getAvatarFrame("down", true, 0)).toBe(0);
    expect(getAvatarFrame("down", true, frameDuration)).toBe(1);
    expect(getAvatarFrame("down", true, frameDuration * 2)).toBe(2);
  });

  it("translates frame indexes into spritesheet offsets", () => {
    expect(getFramePosition(0)).toEqual({ x: 0, y: 0 });
    expect(getFramePosition(1)).toEqual({ x: 32, y: 0 });
    expect(getFramePosition(3)).toEqual({ x: 0, y: 32 });
  });

  it("finds a path around blocked tiles without walking through objects", () => {
    // A wall at x=2 has one doorway at y=3. The route must go through that gap,
    // which covers the collision behaviour used by object and wall placement.
    const blocked = new Set([
      makeTileKey(2, 0),
      makeTileKey(2, 1),
      makeTileKey(2, 2),
      makeTileKey(2, 4),
    ]);

    const path = findTilePath({ x: 0, y: 0 }, { x: 4, y: 0 }, blocked, 5, 5);

    expect(path.at(0)).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 4, y: 0 });
    expect(path).toContainEqual({ x: 2, y: 3 });
    expect(path.some((tile) => blocked.has(makeTileKey(tile.x, tile.y)))).toBe(false);
  });

  it("refuses blocked or unreachable destinations", () => {
    const blockedDestination = new Set([makeTileKey(1, 0)]);
    expect(findTilePath({ x: 0, y: 0 }, { x: 1, y: 0 }, blockedDestination, 3, 3))
      .toEqual([]);

    const sealedStart = new Set([
      makeTileKey(1, 0),
      makeTileKey(0, 1),
    ]);
    expect(findTilePath({ x: 0, y: 0 }, { x: 2, y: 2 }, sealedStart, 3, 3))
      .toEqual([]);
  });
});
