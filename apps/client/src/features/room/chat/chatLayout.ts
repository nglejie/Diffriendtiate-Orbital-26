export const DEFAULT_CATEGORY_ID = "default-text-channels";
export const DRAFTS_VIEW_ID = "__drafts__";

/**
 * Returns the server-backed channel list in a safe shape. Older local state or
 * partial API responses should never make the Chat tab fail to render.
 */
function normalizeChannelList(channels) {
  if (!Array.isArray(channels)) return ["general"];
  const cleaned = channels.filter((channel) => typeof channel === "string" && channel.trim());
  return cleaned.length ? cleaned : ["general"];
}

/** Keeps category rows safe before any drag/drop or rename operation touches them. */
function normalizeLayoutRows(layout) {
  return Array.isArray(layout)
    ? layout
        .filter((category) => category?.id && category?.name)
        .map((category) => ({
          id: category.id,
          name: category.name,
          channels: Array.isArray(category.channels) ? category.channels : [],
        }))
    : [];
}

/**
 * Keeps the channel sidebar resilient when the server only stores a flat
 * channel list. The client can own ordering/categories without risking message
 * delivery, because each channel name still maps back to the server.
 */
export function normalizeChannelLayout(savedLayout, channels = []) {
  const normalizedChannels = normalizeChannelList(channels);
  const seen = new Set();
  const categories = normalizeLayoutRows(savedLayout).map((category) => ({
    ...category,
    channels: category.channels.filter((channel) => {
      const exists = normalizedChannels.includes(channel);
      if (!exists || seen.has(channel)) return false;
      seen.add(channel);
      return true;
    }),
  }));

  const uncategorized = normalizedChannels.filter((channel) => !seen.has(channel));
  const defaultIndex = categories.findIndex((category) => category.id === DEFAULT_CATEGORY_ID);

  if (defaultIndex >= 0) {
    categories[defaultIndex] = {
      ...categories[defaultIndex],
      channels: [...categories[defaultIndex].channels, ...uncategorized],
    };
  } else {
    categories.unshift({
      id: DEFAULT_CATEGORY_ID,
      name: "Text Channels",
      channels: uncategorized,
    });
  }

  // Empty custom categories are intentional: users should be able to create a
  // category first, then drag channels into it later without the layout pruning
  // the category away on the next render.
  return categories;
}

/** Creates a stable local category id that is readable during debugging. */
export function createCategoryId(name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `category-${slug || "untitled"}-${Date.now().toString(36)}`;
}

/** Adds a newly-created server channel to the target local sidebar category. */
export function addChannelToCategory(layout, channel, categoryId = DEFAULT_CATEGORY_ID) {
  return normalizeLayoutRows(layout).map((category) =>
    category.id === categoryId
      ? { ...category, channels: [...category.channels.filter((item) => item !== channel), channel] }
      : { ...category, channels: category.channels.filter((item) => item !== channel) },
  );
}

/**
 * Moves an existing channel between categories after a drag-and-drop action.
 * When beforeChannel is supplied, the moved channel is inserted directly above
 * that target so users can reorder channels inside the same category too.
 */
export function moveChannelToCategory(layout, channel, categoryId, beforeChannel = "") {
  const normalized = normalizeLayoutRows(layout).map((category) => ({
    ...category,
    channels: category.channels.filter((item) => item !== channel),
  }));

  return normalized.map((category) => {
    if (category.id !== categoryId) return category;

    const nextChannels = [...category.channels];
    const insertIndex = beforeChannel ? nextChannels.indexOf(beforeChannel) : -1;

    if (insertIndex >= 0) {
      nextChannels.splice(insertIndex, 0, channel);
    } else {
      nextChannels.push(channel);
    }

    return { ...category, channels: nextChannels };
  });
}

/** Keeps local category ordering valid when the server returns a renamed channel. */
export function renameChannelInLayout(layout, oldChannel, newChannel) {
  return normalizeLayoutRows(layout).map((category) => ({
    ...category,
    channels: category.channels.map((channel) =>
      channel === oldChannel ? newChannel : channel,
    ),
  }));
}

/** Removes a deleted server channel from the local category layout. */
export function removeChannelFromLayout(layout, removedChannel) {
  return normalizeLayoutRows(layout).map((category) => ({
    ...category,
    channels: category.channels.filter((channel) => channel !== removedChannel),
  }));
}

/** Normalises user-entered channel names into Discord-like lowercase slugs. */
export function normalizeChannelName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

/** Finds the category label shown beside a draft in the sidebar. */
export function getCategoryNameForChannel(layout, channel) {
  const safeLayout = Array.isArray(layout) ? layout : [];

  return (
    safeLayout.find((category) => Array.isArray(category.channels) && category.channels.includes(channel))?.name ||
    "Text Channels"
  );
}
