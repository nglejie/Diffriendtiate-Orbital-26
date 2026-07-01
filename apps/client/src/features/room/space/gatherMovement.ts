import { makeTileKey } from "./worldConfig.ts";

export const TILE_SIZE = 32;
export const AVATAR_FRAME_WIDTH = 32;
export const AVATAR_FRAME_HEIGHT = 32;
export const AVATAR_SPEED_PX_PER_SECOND = 190;
export const AVATAR_RUN_MULTIPLIER = 1.8;
export const AVATAR_ANIMATION_FPS = 10;

export const IDLE_FRAMES = {
  down: 1,
  left: 4,
  right: 7,
  up: 10,
};

const WALK_FRAMES = {
  down: [0, 1, 2, 1],
  left: [3, 4, 5, 4],
  right: [6, 7, 8, 7],
  up: [9, 10, 11, 10],
};

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export function getFramePosition(frame) {
  return {
    x: (frame % 3) * AVATAR_FRAME_WIDTH,
    y: Math.floor(frame / 3) * AVATAR_FRAME_HEIGHT,
  };
}

export function getDirectionFromDelta(dx, dy, fallback = "down") {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function getAvatarFrame(direction, moving, elapsedMs) {
  if (!moving) return IDLE_FRAMES[direction] ?? IDLE_FRAMES.down;
  const frames = WALK_FRAMES[direction] || WALK_FRAMES.down;
  const frameDuration = 1000 / AVATAR_ANIMATION_FPS;
  return frames[Math.floor(elapsedMs / frameDuration) % frames.length];
}

export function tileToWorldPoint(tile, tileSize = TILE_SIZE) {
  return {
    x: tile.x * tileSize + tileSize / 2,
    y: tile.y * tileSize + tileSize * 0.72,
  };
}

export function worldPointToTile(point, columns, rows, tileSize = TILE_SIZE) {
  return {
    x: Math.min(columns - 1, Math.max(0, Math.floor(point.x / tileSize))),
    y: Math.min(rows - 1, Math.max(0, Math.floor(point.y / tileSize))),
  };
}

export function findTilePath(start, end, blockedTiles, columns, rows, maxAttempts = 10000) {
  const startKey = makeTileKey(start.x, start.y);
  const endKey = makeTileKey(end.x, end.y);
  if (startKey === endKey) return [start];
  if (blockedTiles.has(endKey)) return [];

  const queue = [[start, [start]]];
  const visited = new Set(blockedTiles);
  visited.add(startKey);
  let attempts = 0;

  while (queue.length) {
    if (attempts >= maxAttempts) return [];
    attempts += 1;

    const [tile, path] = queue.shift();
    for (const [dx, dy] of DIRECTIONS) {
      const next = { x: tile.x + dx, y: tile.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= columns || next.y >= rows) continue;

      const nextKey = makeTileKey(next.x, next.y);
      if (visited.has(nextKey)) continue;
      if (nextKey === endKey) return [...path, next];

      visited.add(nextKey);
      queue.push([next, [...path, next]]);
    }
  }

  return [];
}
