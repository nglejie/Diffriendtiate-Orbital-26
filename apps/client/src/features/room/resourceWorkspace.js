const RESOURCE_TYPE_RULES = [
  { type: "Lecture Notes", patterns: [/lecture/i, /\blec\b/i, /slides?/i, /notes?/i, /week/i, /session/i] },
  { type: "Tutorial", patterns: [/tutorial/i, /\btut\b/i, /worksheet/i, /problem\s*set/i] },
  { type: "Past Year Paper", patterns: [/past/i, /\bpyp\b/i, /exam/i, /final/i, /midterm/i, /paper/i] },
  { type: "Cheatsheet", patterns: [/cheat/i, /summary/i, /formula/i, /quick\s*ref/i] },
  { type: "Assignment", patterns: [/assignment/i, /\bassg\b/i, /homework/i, /project/i] },
  { type: "Lab", patterns: [/\blab\b/i, /practical/i, /experiment/i] },
  { type: "Quiz", patterns: [/quiz/i, /test/i] },
];

export const RESOURCE_TYPES = [
  "All",
  "Lecture Notes",
  "Tutorial",
  "Past Year Paper",
  "Cheatsheet",
  "Assignment",
  "Lab",
  "Quiz",
  "Reference",
];

const COMMON_TOPIC_WORDS = new Set([
  "lecture",
  "lect",
  "notes",
  "note",
  "tutorial",
  "tut",
  "slides",
  "slide",
  "final",
  "midterm",
  "exam",
  "paper",
  "assignment",
  "lab",
  "quiz",
  "session",
  "week",
  "full",
  "copy",
  "official",
  "unofficial",
]);

/** Normalizes resource names so duplicate/version detection ignores punctuation. */
export function normalizeResourceName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\bv(?:ersion)?\s*\d+\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Returns the most stable display name available for a stored resource. */
export function getResourceDisplayName(resource) {
  return resource?.originalName || resource?.title || resource?.storageName || resource?.url || "Untitled resource";
}

/** Infers a student-friendly resource type from filenames until AI tagging is wired in. */
export function inferResourceType(resource) {
  const name = getResourceDisplayName(resource);
  const match = RESOURCE_TYPE_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(name)),
  );

  return match?.type || "Reference";
}

/** Extracts a readable topic label from the filename and module code. */
export function inferResourceTopic(resource, room) {
  const moduleCode = String(room?.moduleCode || "").toLowerCase();
  const baseName = normalizeResourceName(getResourceDisplayName(resource));
  const words = baseName
    .split(/\s+/)
    .filter((word) => word && word !== moduleCode && !COMMON_TOPIC_WORDS.has(word));

  return words.slice(0, 4).join(" ") || inferResourceType(resource);
}

/** Pulls a lightweight semantic tag set from type, topic, extension, and folder. */
export function buildResourceTags(resource, room) {
  const extension = getResourceDisplayName(resource).split(".").pop()?.toUpperCase();
  const tags = new Set([inferResourceType(resource), inferResourceTopic(resource, room)]);

  if (room?.moduleCode) tags.add(room.moduleCode.toUpperCase());
  if (room?.academicTerm) tags.add(room.academicTerm);
  if (resource.folder) tags.add(resource.folder);
  if (extension && extension.length <= 5) tags.add(extension);

  return Array.from(tags).filter(Boolean).slice(0, 6);
}

/** Adds derived metadata that the room UI can browse, filter, and search. */
export function enrichResources(resources = [], room) {
  const normalizedCounts = resources.reduce((counts, resource) => {
    const key = normalizeResourceName(getResourceDisplayName(resource));
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());

  return resources.map((resource) => {
    const title = getResourceDisplayName(resource);
    const normalizedName = normalizeResourceName(title);
    const serverMetadata = resource.metadata || {};
    const type = serverMetadata.resourceType || serverMetadata.type || inferResourceType(resource);
    const topic = serverMetadata.topic || inferResourceTopic(resource, room);
    const tags = Array.isArray(serverMetadata.tags)
      ? serverMetadata.tags.filter(Boolean).slice(0, 8)
      : buildResourceTags(resource, room);

    return {
      ...resource,
      displayName: title,
      metadata: {
        ...serverMetadata,
        type,
        resourceType: type,
        topic,
        contributor: resource.uploader?.name || "Unknown",
        module: serverMetadata.module || room?.moduleCode || "General",
        semester: serverMetadata.semester || room?.academicTerm || "Unspecified",
        version: serverMetadata.version || inferResourceVersion(title),
        duplicateCount: normalizedCounts.get(normalizedName) || 1,
        tags,
      },
      searchText: [
        title,
        resource.folder,
        resource.uploader?.name,
        type,
        topic,
        room?.moduleCode,
        room?.academicTerm,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
}

/** Finds version labels such as v2 or Version 3 without requiring server fields. */
export function inferResourceVersion(title = "") {
  const match = String(title).match(/\b(?:v|version)\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  return match ? `v${match[1]}` : "v1";
}

/** Filters enriched resources by folder, type, and semantic search text. */
export function filterResources(resources, { folder = "All files", query = "", type = "All" } = {}) {
  const normalizedQuery = query.trim().toLowerCase();

  return resources.filter((resource) => {
    const folderMatches = folder === "All files" || (resource.folder || "General") === folder;
    const typeMatches = type === "All" || resource.metadata.type === type;
    const queryMatches = !normalizedQuery || resource.searchText.includes(normalizedQuery);

    return folderMatches && typeMatches && queryMatches;
  });
}

/** Provides starter artifact threads so resources behave like study discussion hubs. */
export function createDefaultResourceThreads(resource) {
  if (!resource) return [];

  const isTutorial = /tutorial|\btut\b|problem/i.test(resource.displayName || resource.title || "");
  const baseThreads = isTutorial
    ? ["Q1 discussion", "Q2 discussion", "Q3 discussion", "Q4 discussion"]
    : ["Overview", "Questions", "Clarifications", "Reusable notes"];

  return baseThreads.map((title, index) => ({
    id: `${resource.id}-thread-${index + 1}`,
    title,
    acceptedAnswerId: "",
    comments: [],
  }));
}

/** Summarizes the resource library for dashboard-style counts. */
export function buildResourceStats(resources = []) {
  const types = new Set(resources.map((resource) => resource.metadata.type));
  const duplicateGroups = new Set(
    resources
      .filter((resource) => resource.metadata.duplicateCount > 1)
      .map((resource) => normalizeResourceName(resource.displayName)),
  );

  return {
    total: resources.length,
    types: types.size,
    duplicates: duplicateGroups.size,
  };
}
