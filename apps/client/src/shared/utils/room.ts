/**
 * Builds the visible member list from owner, room members, and the current user.
 * The map prevents duplicate rows when the owner also appears in the member list.
 */
export function buildVisibleMembers(room, user) {
  const memberMap = new Map();
  const owner = room.owner || {};

  if (owner.id) {
    memberMap.set(owner.id, owner);
  }

  (room.members || []).forEach((member) => {
    if (member?.id) memberMap.set(member.id, member);
  });

  if (user?.id && !memberMap.has(user.id)) {
    memberMap.set(user.id, user);
  }

  return Array.from(memberMap.values()).map((member) => {
    const name = member.name || member.email || "Member";
    const isOwner = member.id === owner.id;

    return {
      avatarUrl: member.avatarUrl || member.avatar || member.photoUrl || "",
      email: member.email || "",
      id: member.id,
      name,
      initial: getInitial(name),
      role: isOwner ? "Owner" : member.id === user.id ? "You" : "Member",
      owner: isOwner,
    };
  });
}

/**
 * Returns a stable one-letter avatar fallback for people without profile images.
 */
export function getInitial(value) {
  return String(value || "U").trim()[0]?.toUpperCase() || "U";
}

/**
 * Converts a stored room resource into the lightweight attachment shape used by
 * chat and Intelligrate messages.
 */
export function resourceToAttachment(resource) {
  return {
    id: resource.id,
    title: resource.title || resource.originalName || "Attachment",
    originalName: resource.originalName || resource.title || "Attachment",
    url: resource.url,
    type: resource.type || "file",
    mimeType: resource.mimeType || resource.type || "",
    size: resource.size || 0,
  };
}

/**
 * Returns the Sunday-start week for the calendar view, shifted by week offset.
 */
export function getWeekStart(baseDate, offset = 0) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay() + offset * 7);
  return date;
}

/**
 * Expands a week start date into the seven visible calendar day columns.
 */
export function buildWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
}

/**
 * Compares dates at day precision so calendar sessions are not affected by time.
 */
export function isSameDate(left, right) {
  return left.toDateString() === right.toDateString();
}

/**
 * Checks whether a session belongs in a specific day/hour calendar grid slot.
 */
export function sessionFallsInSlot(session, day, hour) {
  const startsAt = new Date(session.startsAt);
  return isSameDate(startsAt, day) && startsAt.getHours() === hour;
}

/**
 * Formats the month label shown above the weekly calendar.
 */
export function formatMonthYear(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Formats the compact weekday labels used as calendar column headers.
 */
export function formatWeekday(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

/**
 * Formats a session timestamp as a local time for the calendar and side panel.
 */
export function formatTimeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Formats a full local date/time for session summaries.
 */
export function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * Converts byte counts into compact human-readable labels for resource rows.
 */
export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
