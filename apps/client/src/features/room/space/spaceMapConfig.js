export const worldTabs = {
  buddy: "Intelligrate",
  calendar: "Coordidate",
  chat: "Convolution",
  focus: "Home",
  resources: "Infilenite",
  space: "Limeets",
};

export const spaceMapConfig = {
  columns: 48,
  rows: 30,
  startTile: { col: 20, row: 12 },
  areas: [
    {
      id: "private-space",
      label: "Private Space",
      kind: "private",
      bounds: { col: 10, row: 1, w: 12, h: 6 },
      activityTile: { col: 16, row: 4 },
      disabledLabel: "Private rooms are not available yet.",
    },
    {
      id: "home",
      label: "Home",
      kind: "home",
      tabId: "focus",
      bounds: { col: 24, row: 0, w: 5, h: 5 },
      activityTile: { col: 26, row: 3 },
      description: "Open the room board and module overview.",
    },
    {
      id: "coordidate",
      label: "Coordidate",
      sublabel: "Previously called Calendar",
      kind: "coordidate",
      tabId: "calendar",
      bounds: { col: 31, row: 1, w: 12, h: 6 },
      activityTile: { col: 37, row: 4 },
      disabledLabel: "Coordidate is still being rebuilt.",
    },
    {
      id: "meeting-1",
      label: "Meeting Room #1",
      kind: "meeting",
      bounds: { col: 3, row: 7, w: 6, h: 7 },
      activityTile: { col: 6, row: 10 },
      disabledLabel: "Voice and video rooms are planned later.",
    },
    {
      id: "meeting-2",
      label: "Meeting Room #2",
      kind: "meeting",
      bounds: { col: 3, row: 14, w: 6, h: 7 },
      activityTile: { col: 6, row: 17 },
      disabledLabel: "Voice and video rooms are planned later.",
    },
    {
      id: "meeting-3",
      label: "Meeting Room #3",
      kind: "meeting",
      bounds: { col: 40, row: 7, w: 6, h: 7 },
      activityTile: { col: 43, row: 10 },
      disabledLabel: "Voice and video rooms are planned later.",
    },
    {
      id: "meeting-4",
      label: "Meeting Room #4",
      kind: "meeting",
      bounds: { col: 40, row: 14, w: 6, h: 7 },
      activityTile: { col: 43, row: 17 },
      disabledLabel: "Voice and video rooms are planned later.",
    },
    {
      id: "commons",
      label: "Team Commons",
      kind: "commons",
      bounds: { col: 9, row: 7, w: 31, h: 14 },
      activityTile: { col: 24, row: 13 },
    },
    {
      id: "limeets",
      label: "Limeets",
      sublabel: "Starting Area",
      kind: "limeets",
      tabId: "space",
      bounds: { col: 15, row: 10, w: 10, h: 6 },
      activityTile: { col: 20, row: 13 },
      description: "Start in the shared world before heading into a room tool.",
    },
    {
      id: "convolution",
      label: "Convolution",
      kind: "convolution",
      tabId: "chat",
      bounds: { col: 28, row: 10, w: 11, h: 6 },
      activityTile: { col: 33, row: 13 },
      description: "Open the active room chat channel.",
    },
    {
      id: "infilenite",
      label: "Infilenite",
      sublabel: "Previously called Resources",
      kind: "infilenite",
      tabId: "resources",
      bounds: { col: 9, row: 21, w: 21, h: 8 },
      activityTile: { col: 19, row: 25 },
      description: "Browse the latest room files and folders.",
    },
    {
      id: "intelligrate",
      label: "Intelligrate",
      kind: "intelligrate",
      tabId: "buddy",
      bounds: { col: 30, row: 21, w: 13, h: 8 },
      activityTile: { col: 36, row: 25 },
      description: "Open the room assistant workspace.",
    },
  ],
};

export function isTileInsideBounds(tile, bounds) {
  return (
    tile.col >= bounds.col &&
    tile.col < bounds.col + bounds.w &&
    tile.row >= bounds.row &&
    tile.row < bounds.row + bounds.h
  );
}

export function getAreaForTile(tile) {
  return [...spaceMapConfig.areas]
    .reverse()
    .find((area) => isTileInsideBounds(tile, area.bounds));
}

export function getActivityTileForTab(tabId) {
  return (
    spaceMapConfig.areas.find((area) => area.tabId === tabId)?.activityTile ||
    spaceMapConfig.startTile
  );
}
