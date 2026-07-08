import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../api.ts";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import { FieldTooltipTrigger } from "../../dashboard/DashboardComponents.tsx";
import {
  formatTimeOnly,
  getInitial,
  isSameDate,
} from "../../../shared/utils/room.ts";

const DEFAULT_COORDINATE_TIMEZONE = "Asia/Singapore";
const CALENDAR_DAY_START_HOUR = 0;
const CALENDAR_DAY_END_HOUR = 24;
const DEFAULT_POLL_START_MINUTES = 9 * 60;
const DEFAULT_POLL_END_MINUTES = 17 * 60;
const CALENDAR_SLOT_MINUTES = 30;
const CALENDAR_HOUR_ROW_HEIGHT = 64;
const MONTH_VISIBLE_EVENT_LIMIT = 2;
const MAX_POLL_DAYS = 180;
const EVENT_KINDS = [
  { id: "meeting", label: "Meeting" },
  { id: "event", label: "Event" },
  { id: "deadline", label: "Deadline" },
];
const CALENDAR_VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];
const POLL_SLOT_OPTIONS = [15, 30, 60, 90, 120];
const EVENT_COLOR_OPTIONS = [
  { id: "rose", label: "Rose", value: "#eb6f92" },
  { id: "gold", label: "Gold", value: "#f6c177" },
  { id: "green", label: "Green", value: "#3aa875" },
  { id: "iris", label: "Iris", value: "#c4a7e7" },
  { id: "foam", label: "Foam", value: "#9ccfd8" },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function minutesOfDay(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function timeLabelFromMinutes(minutes) {
  return formatTimeLabel(new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

function dateWithMinutes(value, minutes) {
  const date = startOfDay(value);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function dateInputToIsoAtMinutes(value, minutes) {
  return dateWithMinutes(dateInputValueToDate(value), minutes).toISOString();
}

function dateKeyToIsoAtMinutes(value, minutes) {
  return dateWithMinutes(dateInputValueToDate(value), minutes).toISOString();
}

function toTimeSelectValue(minutes) {
  const safeMinutes = Math.min(24 * 60, Math.max(0, Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function timeValueToMinutes(value, fallback) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes));
}

function getPollStartMinutes(poll) {
  return Number.isFinite(Number(poll?.dayStartMinutes)) ? Number(poll.dayStartMinutes) : DEFAULT_POLL_START_MINUTES;
}

function getPollEndMinutes(poll) {
  return Number.isFinite(Number(poll?.dayEndMinutes)) ? Number(poll.dayEndMinutes) : DEFAULT_POLL_END_MINUTES;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTimeOptions(step = 30) {
  const options = [];
  for (let minutes = 0; minutes <= 24 * 60; minutes += step) {
    options.push({
      label: minutes === 24 * 60 ? "12 AM Next Day" : timeLabelFromMinutes(minutes),
      value: minutes,
    });
  }
  return options;
}

function toDateInputValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeLocalInputValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function dateTimeLocalInputValueToDate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return new Date(text);

  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    0,
  );
}

function dateTimeLocalInputValueToIso(value) {
  const date = dateTimeLocalInputValueToDate(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateInputValueToDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return startOfDay(new Date(year, month - 1, day));
}

function constraintDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? dateInputValueToDate(text) : startOfDay(text);
}

function formatCompactDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatTimeLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return minutes ? `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}` : `${displayHour} ${suffix}`;
}

function formatDayMonth(value, includeYear = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  return `${date.getDate()} ${month}${includeYear ? ` ${date.getFullYear()}` : ""}`;
}

function clampDateToRange(value, rangeStart, rangeEnd) {
  const date = startOfDay(value);
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  if (Number.isNaN(date.getTime())) return start;
  if (!Number.isNaN(start.getTime()) && date < start) return start;
  if (!Number.isNaN(end.getTime()) && date > end) return end;
  return date;
}

function clampDateToPoll(value, poll) {
  if (!poll?.rangeStart || !poll?.rangeEnd) return startOfDay(value);
  return clampDateToRange(value, poll.rangeStart, poll.rangeEnd);
}

function formatDateRange(start, end) {
  if (!start || !end) return "";
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "";

  if (isSameDate(startDate, endDate)) {
    return formatDayMonth(startDate, true);
  }

  const includeStartYear = startDate.getFullYear() !== endDate.getFullYear();
  const includeEndYear = startDate.getFullYear() !== endDate.getFullYear();
  const startLabel = formatDayMonth(startDate, includeStartYear);
  const endLabel = formatDayMonth(endDate, includeEndYear);
  return `${startLabel} – ${endLabel}`;
}

function formatDateTimeCompact(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${formatDayMonth(date)}, ${formatTimeLabel(date)}`;
}

function formatDateTimeFull(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${formatDayMonth(date, true)}, ${formatTimeLabel(date)}`;
}

function formatWindowSchedule(poll) {
  if (!poll) return "";
  return `${formatDateRange(poll.rangeStart, poll.rangeEnd)}, ${timeLabelFromMinutes(getPollStartMinutes(poll))} – ${timeLabelFromMinutes(getPollEndMinutes(poll))}`;
}

function formatWindowCardSchedule(poll) {
  if (!poll) return "";
  return `${formatDateRange(poll.rangeStart, poll.rangeEnd)}, ${timeLabelFromMinutes(getPollStartMinutes(poll))} – ${timeLabelFromMinutes(getPollEndMinutes(poll))}`;
}

function formatDayHeader(value) {
  const date = new Date(value);
  return {
    date: formatDayMonth(date),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
  };
}

function formatMonthTitle(value) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(value);
}

function formatSlotRange(slot) {
  return `${formatTimeOnly(slot.startAt)} – ${formatTimeOnly(slot.endAt)}`;
}

function getDefaultPollForm() {
  const today = new Date();
  const end = addDays(today, 6);
  const selectedDates = dateKeysInRange(today, end);

  return {
    title: "Group Meeting",
    rangeStart: toDateInputValue(today),
    rangeEnd: toDateInputValue(end),
    dayStartMinutes: DEFAULT_POLL_START_MINUTES,
    dayEndMinutes: DEFAULT_POLL_END_MINUTES,
    selectedDates,
    slotMinutes: 30,
  };
}

function dateKeysInRange(start, end) {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

  const selectedDates = [];
  for (let day = new Date(startDate); day <= endDate && selectedDates.length < MAX_POLL_DAYS; day = addDays(day, 1)) {
    selectedDates.push(localDateKey(day));
  }
  return selectedDates;
}

function createPollForm(poll) {
  if (!poll) return getDefaultPollForm();
  const rangeStart = toDateInputValue(poll.rangeStart);
  const rangeEnd = toDateInputValue(poll.rangeEnd);
  const selectedDates = asArray(poll.selectedDates)
    .map((date) => String(date || "").trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));

  return {
    title: poll.title || "Group Meeting",
    rangeStart,
    rangeEnd,
    dayStartMinutes: getPollStartMinutes(poll),
    dayEndMinutes: getPollEndMinutes(poll),
    selectedDates: selectedDates.length ? selectedDates : dateKeysInRange(rangeStart, rangeEnd),
    slotMinutes: poll.slotMinutes || 30,
  };
}

function buildPollDays(poll) {
  if (!poll?.rangeStart || !poll?.rangeEnd) return [];

  const rangeStart = new Date(poll.rangeStart);
  const rangeEnd = new Date(poll.rangeEnd);
  const slotMinutes = Number(poll.slotMinutes) || 30;
  const dayStartMinutes = getPollStartMinutes(poll);
  const dayEndMinutes = getPollEndMinutes(poll);
  const selectedDates = new Set(asArray(poll.selectedDates));
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return [];

  const firstDay = startOfDay(rangeStart);
  const days = [];

  for (let day = new Date(firstDay); day <= rangeEnd && days.length < MAX_POLL_DAYS; day = addDays(day, 1)) {
    if (selectedDates.size && !selectedDates.has(localDateKey(day))) continue;
    const slots = [];

    for (let minutes = dayStartMinutes; minutes < dayEndMinutes; minutes += slotMinutes) {
      const start = new Date(day);
      start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      const end = addMinutes(start, slotMinutes);

      if (start >= rangeStart && end <= rangeEnd) {
        slots.push({
          key: start.toISOString(),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        });
      }
    }

    days.push({
      key: day.toISOString(),
      date: day.toISOString(),
      slots,
    });
  }

  return days.filter((day) => day.slots.length);
}

function buildPollWeekDays(poll, cursorDate) {
  if (!poll?.rangeStart || !poll?.rangeEnd) return [];

  const rangeStart = new Date(poll.rangeStart);
  const rangeEnd = new Date(poll.rangeEnd);
  const slotMinutes = Number(poll.slotMinutes) || 30;
  const dayStartMinutes = getPollStartMinutes(poll);
  const dayEndMinutes = getPollEndMinutes(poll);
  const selectedDates = new Set(asArray(poll.selectedDates));
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) return [];

  const clampedCursor = clampDateToPoll(cursorDate, poll);
  const weekStart = startOfWeek(clampedCursor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  return days.map((day) => {
    const slots = [];

    if (selectedDates.size && !selectedDates.has(localDateKey(day))) {
      return {
        key: day.toISOString(),
        date: day.toISOString(),
        inRange: false,
        slots,
      };
    }

    for (let minutes = dayStartMinutes; minutes < dayEndMinutes; minutes += slotMinutes) {
      const start = new Date(day);
      start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      const end = addMinutes(start, slotMinutes);

      if (start >= rangeStart && end <= rangeEnd) {
        slots.push({
          key: start.toISOString(),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        });
      }
    }

    return {
      key: day.toISOString(),
      date: day.toISOString(),
      inRange: day >= startOfDay(rangeStart) && day <= startOfDay(rangeEnd),
      slots,
    };
  });
}

function flattenSlots(days) {
  return days.flatMap((day) => day.slots);
}

function buildCalendarDays(view, cursorDate) {
  if (view === "day") return [startOfDay(cursorDate)];
  if (view === "week") {
    const weekStart = startOfWeek(cursorDate);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }
  return [];
}

function buildTimeSlots(days, slotMinutes = CALENDAR_SLOT_MINUTES) {
  const rows = [];

  for (let minutes = CALENDAR_DAY_START_HOUR * 60; minutes < CALENDAR_DAY_END_HOUR * 60; minutes += 60) {
    rows.push({
      key: String(minutes),
      label: formatTimeLabel(new Date(2026, 0, 1, Math.floor(minutes / 60), 0)),
      slots: days.map((day) => {
        const hourStart = new Date(day);
        hourStart.setHours(Math.floor(minutes / 60), 0, 0, 0);
        return Array.from({ length: 60 / slotMinutes }, (_, index) => {
          const start = addMinutes(hourStart, index * slotMinutes);
          const end = addMinutes(start, slotMinutes);
          return {
            key: start.toISOString(),
            startAt: start.toISOString(),
            endAt: end.toISOString(),
          };
        });
      }),
    });
  }

  return rows;
}

function buildAvailabilityRows(days, slotMinutes) {
  const rows = [];
  const firstSlot = days.flatMap((day) => day.slots).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const lastSlot = days.flatMap((day) => day.slots).sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0];
  const startMinutes = firstSlot ? minutesOfDay(firstSlot.startAt) : DEFAULT_POLL_START_MINUTES;
  const endMinutes = lastSlot ? minutesOfDay(lastSlot.endAt) : DEFAULT_POLL_END_MINUTES;

  for (let minutes = startMinutes; minutes < endMinutes; minutes += slotMinutes) {
    rows.push({
      key: String(minutes),
      label: formatTimeLabel(new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60)),
      slots: days.map((day) => day.slots.find((slot) => minutesOfDay(slot.startAt) === minutes) || null),
    });
  }

  return rows.filter((row) => row.slots.some(Boolean));
}

function buildMonthDays(cursorDate) {
  const firstOfMonth = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    return {
      key: date.toISOString(),
      date,
      inMonth: date.getMonth() === cursorDate.getMonth(),
    };
  });
}

function buildSlotStatusMap(response) {
  return Object.fromEntries(
    asArray(response?.slots)
      .filter((slot) => slot?.startAt)
      .map((slot) => [slot.startAt, slot.status === "ifNeeded" ? "ifNeeded" : "available"]),
  );
}

function sessionKindLabel(kind) {
  return EVENT_KINDS.find((item) => item.id === kind)?.label || "Meeting";
}

function getMeetingAreas(room) {
  return asArray(room?.worldConfig?.privateAreas)
    .filter((area) => area?.effects?.meeting)
    .map((area) => ({
      id: area.id,
      label: area.name || area.label || "Meeting Area",
    }));
}

function createEventDraft(startAt = new Date(), overrides = {}) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const end = addMinutes(safeStart, 60);
  const defaultColor =
    overrides.kind === "deadline"
      ? "gold"
      : overrides.kind === "event"
        ? "iris"
        : "rose";

  return {
    title: "",
    kind: "meeting",
    color: defaultColor,
    allDay: false,
    startsAt: toDateTimeLocalInputValue(safeStart),
    endsAt: toDateTimeLocalInputValue(end),
    visibility: "room",
    location: "",
    agenda: "",
    ...overrides,
  };
}

function sessionIsAllDay(session) {
  return Boolean(session?.metadata?.allDay);
}

function sessionEndDate(session) {
  const start = new Date(session.startsAt);
  const explicitEnd = session.endsAt ? new Date(session.endsAt) : null;
  if (explicitEnd && !Number.isNaN(explicitEnd.getTime())) return explicitEnd;
  return addMinutes(start, session.kind === "deadline" ? 30 : 60);
}

function sessionColorValue(sessionOrDraft) {
  const colorId = sessionOrDraft?.metadata?.color || sessionOrDraft?.color || "";
  return EVENT_COLOR_OPTIONS.find((option) => option.id === colorId)?.value || EVENT_COLOR_OPTIONS[0].value;
}

function sessionIntersectsDate(session, date) {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const startsAt = new Date(session.startsAt);
  const endsAt = sessionEndDate(session);
  return startsAt < dayEnd && endsAt > dayStart;
}

function sessionsForDate(sessions, date) {
  return asArray(sessions)
    .filter((session) => isSameDate(new Date(session.startsAt), date))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

function statusForSlot(response, slot) {
  const match = asArray(response?.slots).find((candidate) => candidate.startAt === slot.startAt);
  return match?.status === "ifNeeded" ? "ifNeeded" : match ? "available" : "";
}

function buildCoordinateMembers(room, user) {
  const memberMap = new Map();
  const owner = room?.owner || {};

  function remember(member, ownerFlag = false) {
    if (!member?.id) return;
    const existing = memberMap.get(member.id) || {};
    memberMap.set(member.id, {
      ...existing,
      ...member,
      owner: existing.owner || ownerFlag,
    });
  }

  remember(owner, true);
  asArray(room?.members).forEach((member) => remember(member, member?.id === owner.id));
  remember(user, user?.id === owner.id);

  return Array.from(memberMap.values()).map((member) => {
    const name = member.name || member.email || "Member";
    return {
      ...member,
      id: member.id,
      name,
      initial: getInitial(name),
      role: member.owner ? "Owner" : member.id === user?.id ? "You" : "Member",
    };
  });
}

function layoutTimedSessions(sessions, date) {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const segments = asArray(sessions)
    .filter((session) => !sessionIsAllDay(session) && sessionIntersectsDate(session, date))
    .map((session) => {
      const startsAt = new Date(session.startsAt);
      const endsAt = sessionEndDate(session);
      const clippedStart = startsAt < dayStart ? dayStart : startsAt;
      const clippedEnd = endsAt > dayEnd ? dayEnd : endsAt;
      const startMinute = Math.max(0, minutesOfDay(clippedStart));
      const endMinute = Math.min(24 * 60, Math.max(startMinute + 20, minutesOfDay(clippedEnd) || 24 * 60));
      return {
        session,
        startMinute,
        endMinute,
        column: 0,
        columnCount: 1,
      };
    })
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const groups = [];
  let group = [];
  let groupEnd = -1;
  segments.forEach((segment) => {
    if (group.length && segment.startMinute >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.endMinute);
  });
  if (group.length) groups.push(group);

  groups.forEach((items) => {
    const columns = [];
    items.forEach((item) => {
      let columnIndex = columns.findIndex((endMinute) => endMinute <= item.startMinute);
      if (columnIndex === -1) {
        columnIndex = columns.length;
        columns.push(item.endMinute);
      } else {
        columns[columnIndex] = item.endMinute;
      }
      item.column = columnIndex;
    });
    items.forEach((item) => {
      item.columnCount = columns.length;
    });
  });

  return segments;
}

function getPollResponseCount(poll, responses) {
  return asArray(responses).filter((response) => response.pollId === poll?.id).length;
}

export function CoordinatePanel({
  coordinate,
  onChanged,
  onCoordinateChanged,
  onError,
  room,
  sessions = [],
  user,
}) {
  const members = useMemo(() => buildCoordinateMembers(room, user), [room, user]);
  const meetingAreas = useMemo(() => getMeetingAreas(room), [room]);
  const polls = useMemo(() => {
    const payloadPolls = asArray(coordinate?.polls);
    const fallbackPoll = coordinate?.poll ? [coordinate.poll] : [];
    return (payloadPolls.length ? payloadPolls : fallbackPoll)
      .filter((candidate) => candidate?.id)
      .sort((a, b) => Date.parse(a.rangeStart || a.createdAt || 0) - Date.parse(b.rangeStart || b.createdAt || 0));
  }, [coordinate?.poll, coordinate?.polls]);
  const responses = asArray(coordinate?.responses);
  const activePolls = useMemo(() => polls.filter((candidate) => !candidate.scheduledSessionId), [polls]);
  const [view, setView] = useState("week");
  const [cursorDate, setCursorDate] = useState(new Date());
  const [editingAvailability, setEditingAvailability] = useState(false);
  const [showBestTimes, setShowBestTimes] = useState(false);
  const [showPollOptions, setShowPollOptions] = useState(false);
  const [selectedPollId, setSelectedPollId] = useState("");
  const [editingPollId, setEditingPollId] = useState("");
  const [availabilityInspectorMode, setAvailabilityInspectorMode] = useState("windows");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [hoveredSlotKey, setHoveredSlotKey] = useState("");
  const [hoveredSlotPoint, setHoveredSlotPoint] = useState(null);
  const [pollForm, setPollForm] = useState(() => createPollForm(null));
  const [slotStatusDraft, setSlotStatusDraft] = useState({});
  const [availabilityDirty, setAvailabilityDirty] = useState(false);
  const [savingPoll, setSavingPoll] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState(() => createEventDraft());
  const [eventSaving, setEventSaving] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const draggingRef = useRef(false);
  const dragStartSlotRef = useRef(null);
  const dragPaintStatusRef = useRef("");
  const selectedPoll = activePolls.find((candidate) => candidate.id === selectedPollId) || activePolls[0] || null;
  const poll = selectedPoll;
  const pollResponses = useMemo(
    () => responses.filter((response) => response.pollId === selectedPoll?.id),
    [responses, selectedPoll?.id],
  );
  const pollDays = useMemo(() => buildPollDays(selectedPoll), [selectedPoll]);
  const visiblePollDays = useMemo(
    () => buildPollWeekDays(selectedPoll, cursorDate),
    [cursorDate, selectedPoll],
  );
  const pollSlots = useMemo(() => flattenSlots(pollDays), [pollDays]);
  const selectedMemberSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const currentUserResponse = pollResponses.find((response) => response.userId === user?.id);
  const responseByUser = useMemo(
    () => new Map(pollResponses.map((response) => [response.userId, response])),
    [pollResponses],
  );
  const slotLookup = useMemo(
    () => new Map(pollSlots.map((slot) => [slot.startAt, slot])),
    [pollSlots],
  );
  const visibleSlotPositions = useMemo(() => {
    const positions = new Map();
    const byPosition = new Map();
    const slotMinutes = Number(selectedPoll?.slotMinutes) || 30;
    const dayStartMinutes = getPollStartMinutes(selectedPoll);
    visiblePollDays.forEach((day, columnIndex) => {
      day.slots.forEach((slot) => {
        const rowIndex = Math.round((minutesOfDay(slot.startAt) - dayStartMinutes) / slotMinutes);
        const position = { rowIndex, columnIndex };
        positions.set(slot.startAt, position);
        byPosition.set(`${rowIndex}:${columnIndex}`, slot);
      });
    });
    return { positions, byPosition };
  }, [selectedPoll, visiblePollDays]);
  const calendarDays = useMemo(() => buildCalendarDays(view, cursorDate), [view, cursorDate]);
  const calendarRows = useMemo(() => buildTimeSlots(calendarDays), [calendarDays]);
  const monthDays = useMemo(() => buildMonthDays(cursorDate), [cursorDate]);
  const toolbarTitle = useMemo(() => {
    if (view === "availability" && selectedPoll) {
      return visiblePollDays.length
        ? formatDateRange(visiblePollDays[0].date, visiblePollDays[visiblePollDays.length - 1].date)
        : formatDateRange(selectedPoll.rangeStart, selectedPoll.rangeEnd);
    }
    if (view === "availability" && poll) return formatDateRange(poll.rangeStart, poll.rangeEnd);
    if (view === "availability") return "Availability";
    if (view === "month") return formatMonthTitle(cursorDate);
    if (view === "day") {
      const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(cursorDate);
      return `${weekday}, ${formatDayMonth(cursorDate, true)}`;
    }
    return formatDateRange(calendarDays[0], calendarDays[calendarDays.length - 1]);
  }, [calendarDays, cursorDate, poll, view]);
  const visibleSessions = asArray(sessions);

  useEffect(() => {
    if (!activePolls.length) {
      setSelectedPollId("");
      setShowPollOptions(room?.isOwner ? showPollOptions : false);
      return;
    }

    setSelectedPollId((current) =>
      activePolls.some((candidate) => candidate.id === current) ? current : activePolls[0].id,
    );
  }, [activePolls, room?.isOwner, showPollOptions]);

  useEffect(() => {
    if (!selectedPoll || view !== "availability") return;
    setCursorDate((current) => clampDateToPoll(current, selectedPoll));
  }, [selectedPoll?.id, selectedPoll?.rangeStart, selectedPoll?.rangeEnd, view]);

  useEffect(() => {
    if (!showPollOptions) return;
    const editingPoll = activePolls.find((candidate) => candidate.id === editingPollId);
    setPollForm(createPollForm(editingPoll || null));
  }, [activePolls, editingPollId, showPollOptions]);

  useEffect(() => {
    const memberIds = members.map((member) => member.id).filter(Boolean);
    setSelectedMemberIds((current) => {
      const next = current.filter((id) => memberIds.includes(id));
      return next.length ? next : memberIds;
    });
  }, [members]);

  useEffect(() => {
    setSlotStatusDraft(buildSlotStatusMap(currentUserResponse));
    setAvailabilityDirty(false);
  }, [currentUserResponse?.id, currentUserResponse?.updatedAt, poll?.id]);

  useEffect(() => {
    function stopDrag() {
      draggingRef.current = false;
      dragStartSlotRef.current = null;
      dragPaintStatusRef.current = "";
    }

    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, []);

  function openNewWindowForm() {
    setEditingPollId("");
    setPollForm(getDefaultPollForm());
    setShowPollOptions(true);
  }

  function openAvailabilityWindowDetails(nextPoll) {
    if (!nextPoll?.id) return;
    setSelectedPollId(nextPoll.id);
    setCursorDate(clampDateToPoll(new Date(nextPoll.rangeStart), nextPoll));
    setEditingAvailability(false);
    setAvailabilityInspectorMode("details");
  }

  function returnToAvailabilityWindows() {
    setEditingAvailability(false);
    setAvailabilityInspectorMode("windows");
  }

  function openEditWindowForm(nextPoll = selectedPoll) {
    if (!nextPoll) {
      openNewWindowForm();
      return;
    }

    setEditingPollId(nextPoll.id);
    setPollForm(createPollForm(nextPoll));
    setShowPollOptions(true);
  }

  async function savePoll(event) {
    event.preventDefault();
    setSavingPoll(true);

    try {
      const selectedDates = asArray(pollForm.selectedDates).slice().sort();
      const firstDate = selectedDates[0] || pollForm.rangeStart;
      const lastDate = selectedDates[selectedDates.length - 1] || pollForm.rangeEnd || firstDate;
      const payload = await api.saveCoordinatePoll(room.id, {
        pollId: editingPollId || undefined,
        title: pollForm.title,
        rangeStart: dateKeyToIsoAtMinutes(firstDate, Number(pollForm.dayStartMinutes) || DEFAULT_POLL_START_MINUTES),
        rangeEnd: dateKeyToIsoAtMinutes(lastDate, Number(pollForm.dayEndMinutes) || DEFAULT_POLL_END_MINUTES),
        slotMinutes: Number(pollForm.slotMinutes) || 30,
        dayStartMinutes: Number(pollForm.dayStartMinutes) || DEFAULT_POLL_START_MINUTES,
        dayEndMinutes: Number(pollForm.dayEndMinutes) || DEFAULT_POLL_END_MINUTES,
        selectedDates,
        timezone: DEFAULT_COORDINATE_TIMEZONE,
      });
      onCoordinateChanged(payload);
      const savedPoll =
        asArray(payload.polls).find((candidate) => candidate.id === editingPollId) ||
        asArray(payload.polls)
          .slice()
          .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] ||
        payload.poll;
      if (savedPoll?.id) {
        setSelectedPollId(savedPoll.id);
        setCursorDate(clampDateToPoll(new Date(savedPoll.rangeStart), savedPoll));
        setAvailabilityInspectorMode("details");
      }
      setEditingPollId("");
      setShowPollOptions(false);
      setView("availability");
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingPoll(false);
    }
  }

  async function deletePoll() {
    if (!editingPollId) return;
    setSavingPoll(true);

    try {
      const payload = await api.deleteCoordinatePoll(room.id, editingPollId);
      onCoordinateChanged(payload);
      setEditingPollId("");
      setAvailabilityInspectorMode("windows");
      setShowPollOptions(false);
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingPoll(false);
    }
  }

  function toggleEveryoneSelected() {
    const memberIds = members.map((member) => member.id).filter(Boolean);
    setSelectedMemberIds((current) => (current.length === memberIds.length ? [] : memberIds));
  }

  function toggleMember(memberId) {
    setSelectedMemberIds((current) => {
      if (current.includes(memberId)) {
        return current.filter((id) => id !== memberId);
      }
      return [...current, memberId];
    });
  }

  function nextAvailabilityStatus(currentStatus) {
    if (currentStatus === "available") return "ifNeeded";
    if (currentStatus === "ifNeeded") return "";
    return "available";
  }

  function paintSlots(slots, status) {
    const uniqueSlots = slots.filter(Boolean);
    if (!uniqueSlots.length) return;

    setSlotStatusDraft((current) => {
      const next = { ...current };
      uniqueSlots.forEach((slot) => {
        if (!status) delete next[slot.startAt];
        else next[slot.startAt] = status;
      });
      return next;
    });
    setAvailabilityDirty(true);
  }

  function getDragRangeSlots(startSlot, endSlot) {
    const start = visibleSlotPositions.positions.get(startSlot?.startAt);
    const end = visibleSlotPositions.positions.get(endSlot?.startAt);
    if (!start || !end) return [endSlot].filter(Boolean);

    const rowStart = Math.min(start.rowIndex, end.rowIndex);
    const rowEnd = Math.max(start.rowIndex, end.rowIndex);
    const columnStart = Math.min(start.columnIndex, end.columnIndex);
    const columnEnd = Math.max(start.columnIndex, end.columnIndex);
    const slots = [];

    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      for (let columnIndex = columnStart; columnIndex <= columnEnd; columnIndex += 1) {
        const slot = visibleSlotPositions.byPosition.get(`${rowIndex}:${columnIndex}`);
        if (slot) slots.push(slot);
      }
    }

    return slots;
  }

  function paintDragRange(slot) {
    const startSlot = dragStartSlotRef.current || slot;
    paintSlots(getDragRangeSlots(startSlot, slot), dragPaintStatusRef.current);
  }

  function handleAvailabilityPointerDown(event, slot) {
    if (!editingAvailability) return;
    event.preventDefault();
    draggingRef.current = true;
    dragStartSlotRef.current = slot;
    dragPaintStatusRef.current = event.button === 2 ? "" : nextAvailabilityStatus(slotStatusDraft[slot.startAt] || "");
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    paintSlots([slot], dragPaintStatusRef.current);
  }

  function handleAvailabilityPointerEnter(slot) {
    if (!draggingRef.current || !editingAvailability) return;
    paintDragRange(slot);
  }

  function handleAvailabilityPointerMove(event, slot) {
    if (!draggingRef.current || !editingAvailability) return;
    event.preventDefault();

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.("[data-slot-start]");
    const targetSlot = target?.getAttribute("data-slot-start");
    paintDragRange(slotLookup.get(targetSlot) || slot);
  }

  function handleAvailabilitySlotHover(slotKey, event = null) {
    setHoveredSlotKey(slotKey);
    setHoveredSlotPoint(
      slotKey && event
        ? {
            x: event.clientX,
            y: event.clientY,
          }
        : null,
    );
  }

  async function saveAvailability() {
    if (!poll) return;
    setSavingAvailability(true);

    try {
      const slots = Object.entries(slotStatusDraft)
        .map(([startAt, status]) => {
          const slot = slotLookup.get(startAt);
          return slot ? { startAt, endAt: slot.endAt, status } : null;
        })
        .filter(Boolean);
      const payload = await api.saveCoordinateAvailability(room.id, {
        pollId: poll.id,
        slots,
      });
      onCoordinateChanged(payload);
      setEditingAvailability(false);
      setAvailabilityDirty(false);
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingAvailability(false);
    }
  }

  async function deleteAvailability() {
    if (!poll) return;
    setSavingAvailability(true);

    try {
      const payload = await api.saveCoordinateAvailability(room.id, {
        pollId: poll.id,
        slots: [],
      });
      onCoordinateChanged(payload);
      setSlotStatusDraft({});
      setEditingAvailability(false);
      setAvailabilityDirty(false);
    } catch (err) {
      onError(err.message);
    } finally {
      setSavingAvailability(false);
    }
  }

  function beginAvailabilityEdit() {
    setSlotStatusDraft(buildSlotStatusMap(currentUserResponse));
    setAvailabilityDirty(false);
    setEditingAvailability(true);
    setAvailabilityInspectorMode("details");
  }

  function cancelAvailabilityEdit() {
    setSlotStatusDraft(buildSlotStatusMap(currentUserResponse));
    setAvailabilityDirty(false);
    setEditingAvailability(false);
  }

  function getSlotAvailability(slot) {
    const selectedResponses = pollResponses.filter((response) => selectedMemberSet.has(response.userId));
    if (!selectedMemberIds.length) {
      return {
        available: [],
        ifNeeded: [],
        possible: 0,
        score: 0,
        heat: 0,
        names: "",
      };
    }
    const statuses = selectedResponses
      .map((response) => {
        const status = statusForSlot(response, slot);
        return status ? { response, status } : null;
      })
      .filter(Boolean);
    const available = statuses.filter((item) => item.status === "available");
    const ifNeeded = statuses.filter((item) => item.status === "ifNeeded");
    const score = available.length + ifNeeded.length * 0.5;
    const possible = selectedResponses.length;

    return {
      available,
      ifNeeded,
      possible,
      score,
      heat: possible ? Math.min(1, score / possible) : 0,
      names: statuses
        .slice(0, 4)
        .map((item) => item.response.user?.name || "Member")
        .join(", "),
    };
  }

  const bestSlots = useMemo(
    () =>
      pollSlots
        .map((slot) => ({ slot, availability: getSlotAvailability(slot) }))
        .filter((item) => item.availability.score > 0)
        .sort((a, b) => b.availability.score - a.availability.score || Date.parse(a.slot.startAt) - Date.parse(b.slot.startAt))
        .slice(0, 8),
    [pollSlots, responses, selectedMemberIds],
  );
  const bestSlotKeys = useMemo(() => new Set(bestSlots.slice(0, 4).map((item) => item.slot.startAt)), [bestSlots]);
  const hoveredSlot = pollSlots.find((slot) => slot.startAt === hoveredSlotKey);
  const hoveredAvailability = hoveredSlot ? getSlotAvailability(hoveredSlot) : null;

  function moveCursor(direction) {
    if (view === "availability") {
      setCursorDate((current) => clampDateToPoll(addDays(current, direction * 7), selectedPoll));
    } else if (view === "month") {
      setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
    } else if (view === "day") {
      setCursorDate((current) => addDays(current, direction));
    } else {
      setCursorDate((current) => addDays(current, direction * 7));
    }
  }

  function goToToday() {
    setCursorDate(view === "availability" && selectedPoll ? clampDateToPoll(new Date(), selectedPoll) : new Date());
  }

  function pickDate(date) {
    setCursorDate(view === "availability" && selectedPoll ? clampDateToPoll(date, selectedPoll) : startOfDay(date));
    setDatePickerOpen(false);
  }

  function openEventDialog(slot = null, overrides = {}) {
    const firstArea = meetingAreas[0]?.label || "";
    const isSlot = Boolean(slot && typeof slot === "object" && "startAt" in slot);
    const draft = isSlot
      ? createEventDraft(new Date(slot.startAt), {
          endsAt: toDateTimeLocalInputValue(slot.endAt),
          location: firstArea,
          title: selectedPoll?.title || "Study Meetup",
          coordinatePollId: overrides.coordinatePollId || "",
          ...overrides,
        })
      : createEventDraft(slot || cursorDate, { location: firstArea, ...overrides });
    setEventDraft(draft);
    setEventDialogOpen(true);
  }

  async function saveEvent(event) {
    event.preventDefault();
    setEventSaving(true);

    try {
      const startsAt = dateTimeLocalInputValueToIso(eventDraft.startsAt);
      const endsAt = eventDraft.kind === "deadline" ? "" : dateTimeLocalInputValueToIso(eventDraft.endsAt);

      await api.addSession(room.id, {
        ...eventDraft,
        startsAt,
        allDay: eventDraft.kind === "deadline" ? false : Boolean(eventDraft.allDay),
        endsAt,
        color: eventDraft.color,
      });
      setEventDialogOpen(false);
      onChanged();
      const coordinatePayload = await api.getCoordinate(room.id);
      onCoordinateChanged(coordinatePayload);
    } catch (err) {
      onError(err.message);
    } finally {
      setEventSaving(false);
    }
  }

  async function deleteEvent(event, sessionId) {
    event?.stopPropagation?.();
    setDeletingEventId(sessionId);

    try {
      await api.deleteSession(sessionId);
      setSelectedSession((current) => (current?.id === sessionId ? null : current));
      onChanged();
      const coordinatePayload = await api.getCoordinate(room.id);
      onCoordinateChanged(coordinatePayload);
    } catch (err) {
      onError(err.message);
    } finally {
      setDeletingEventId("");
    }
  }

  function canDeleteSession(session) {
    return room?.isOwner || session.createdBy === user?.id;
  }

  function selectView(nextView) {
    setView(nextView);
    if (nextView === "availability") {
      setEditingAvailability(false);
      setAvailabilityInspectorMode("windows");
      if (selectedPoll) setCursorDate((current) => clampDateToPoll(current, selectedPoll));
    }
  }

  return (
    <section className="coordinate-shell coordinate-calendar-product" aria-label="Coordidate">
      <header className="coordinate-product-toolbar">
        <div className="coordinate-date-controls">
          <button aria-label="Previous" onClick={() => moveCursor(-1)} type="button">
            <ChevronLeft size={18} />
          </button>
          <button onClick={goToToday} type="button">Today</button>
          <button aria-label="Next" onClick={() => moveCursor(1)} type="button">
            <ChevronRight size={18} />
          </button>
          <DatePickerButton
            date={cursorDate}
            maxDate={view === "availability" ? selectedPoll?.rangeEnd : ""}
            minDate={view === "availability" ? selectedPoll?.rangeStart : ""}
            onSelect={pickDate}
            open={datePickerOpen}
            setOpen={setDatePickerOpen}
          />
        </div>

        <strong className="coordinate-toolbar-title">{toolbarTitle}</strong>

        <div className="coordinate-toolbar-actions">
          <div className="coordinate-view-switch" role="tablist" aria-label="Calendar view">
            {CALENDAR_VIEWS.map((item) => (
              <button
                className={view === item.id ? "active" : ""}
                key={item.id}
                onClick={() => selectView(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
            <span className="coordinate-view-divider" aria-hidden="true" />
            <button
              className={view === "availability" ? "active availability" : "availability"}
              onClick={() => selectView("availability")}
              type="button"
            >
              Availability
            </button>
          </div>
          <button className="primary-button compact" onClick={() => openEventDialog()} type="button">
            <CalendarPlus size={16} />
            New Item
          </button>
        </div>
      </header>

      {view === "availability" ? (
        <div className="coordinate-scheduler-layout">
          <main className="coordinate-scheduler-main availability-mode">
            {poll ? (
              <>
                <div className="coordinate-availability-header">
                  <div>
                    <strong>{poll.title || "Group Meeting"}</strong>
                    <small>
                      {formatWindowSchedule(poll)}
                    </small>
                  </div>
                  <div className="coordinate-availability-actions">
                    {editingAvailability ? (
                      <>
                        <FieldTooltipTrigger
                          ariaLabel="Availability colour help"
                          className="coordinate-availability-help"
                          maxWidth={260}
                          message={(
                            <span className="coordinate-availability-help-content">
                              <span className="availability-legend-row available">
                                <b className="available" />
                                <span>
                                  <strong>Available</strong>
                                  <small>Works well for you.</small>
                                </span>
                              </span>
                              <span className="availability-legend-row if-needed">
                                <b className="if-needed" />
                                <span>
                                  <strong>If Needed</strong>
                                  <small>Possible, but not ideal.</small>
                                </span>
                              </span>
                              <em>
                                <span>Click or drag to cycle states.</span>
                                <span>Right-click erases.</span>
                              </em>
                            </span>
                          )}
                          tooltipClassName="coordinate-availability-tooltip"
                        />
                        <span className="coordinate-action-divider" aria-hidden="true" />
                        <button
                          className="secondary-button compact danger"
                          disabled={savingAvailability}
                          onClick={deleteAvailability}
                          type="button"
                        >
                          Delete
                        </button>
                        <button className="secondary-button compact" onClick={cancelAvailabilityEdit} type="button">
                          Cancel
                        </button>
                        <button
                          className="primary-button compact"
                          disabled={!availabilityDirty || savingAvailability}
                          onClick={saveAvailability}
                          type="button"
                        >
                          {savingAvailability ? "Saving" : "Save"}
                        </button>
                      </>
                    ) : (
                      <button className="primary-button compact" onClick={beginAvailabilityEdit} type="button">
                        Edit Availability
                      </button>
                    )}
                  </div>
                </div>

                <AvailabilityHeatmap
                  bestSlotKeys={bestSlotKeys}
                  days={visiblePollDays}
                  editing={editingAvailability}
                  getSlotAvailability={getSlotAvailability}
                  overlayEnabled={!editingAvailability}
                  onPointerDown={handleAvailabilityPointerDown}
                  onPointerEnter={handleAvailabilityPointerEnter}
                  onPointerMove={handleAvailabilityPointerMove}
                  onSchedule={openEventDialog}
                  onSlotHover={handleAvailabilitySlotHover}
                  ownStatuses={slotStatusDraft}
                  poll={poll}
                  showBestTimes={showBestTimes}
                  user={user}
                  userIsOwner={room?.isOwner}
                />
              </>
            ) : (
              <div className="coordinate-empty-state refined">
                <CalendarDays size={28} />
                <strong>No Availability Window Yet.</strong>
                {room.isOwner ? (
                  <button className="primary-button compact" onClick={openNewWindowForm} type="button">
                    Create Window
                  </button>
                ) : (
                  <p>The owner can create a date range for members to mark availability.</p>
                )}
              </div>
            )}
          </main>

          <aside
            className={`coordinate-inspector ${
              availabilityInspectorMode === "details" && poll ? "detail-mode" : "windows-mode"
            }`}
          >
            {availabilityInspectorMode === "details" && poll ? (
              <>
                <section className="coordinate-inspector-section coordinate-window-detail-summary">
                  <button className="coordinate-window-back-button" onClick={returnToAvailabilityWindows} type="button">
                    <ChevronLeft size={15} />
                    Back
                  </button>
                  <div className="coordinate-window-detail-title">
                    <div>
                      <strong>{poll.title || "Group Meeting"}</strong>
                      <small>{formatWindowCardSchedule(poll)}</small>
                    </div>
                    {room.isOwner ? (
                      <button
                        aria-label={`Edit ${poll.title || "Meetup Window"}`}
                        className="coordinate-window-edit-button"
                        onClick={() => openEditWindowForm(poll)}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="coordinate-inspector-section">
                  <div className="coordinate-inspector-heading static">
                    <label className="coordinate-heading-checkbox">
                      <input
                        aria-label={selectedMemberIds.length === members.length ? "Deselect All Responses" : "Select All Responses"}
                        checked={selectedMemberIds.length === members.length}
                        className="coordinate-control-checkbox"
                        onChange={toggleEveryoneSelected}
                        type="checkbox"
                      />
                      <span>Responses</span>
                    </label>
                    <small>{pollResponses.length}/{members.length}</small>
                  </div>
                  <div className="coordinate-respondent-list">
                    {members.map((member) => {
                      const response = responseByUser.get(member.id);
                      const selected = selectedMemberIds.includes(member.id);
                      return (
                        <button
                          aria-pressed={selected}
                          className={`${selected ? "active" : ""} ${response ? "responded" : "not-responded"}`.trim()}
                          key={member.id}
                          onClick={() => toggleMember(member.id)}
                          type="button"
                        >
                          <MemberAvatar member={member} />
                          <span>
                            <strong>{member.name}</strong>
                            <small>{response ? "Responded" : "No Response"}</small>
                          </span>
                          {response ? <CheckCircle2 aria-label="Responded" size={15} /> : <span aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="coordinate-inspector-section">
                  <div className="coordinate-inspector-heading static">
                    <label className="coordinate-heading-checkbox">
                      <input
                        aria-label="Show Best Times"
                        checked={showBestTimes}
                        className="coordinate-control-checkbox"
                        onChange={(event) => setShowBestTimes(event.target.checked)}
                        type="checkbox"
                      />
                      <span>Best Times</span>
                    </label>
                    <small>{bestSlots.length}</small>
                  </div>
                  {bestSlots.length ? (
                    <div className="coordinate-best-times">
                      {bestSlots.slice(0, 5).map(({ slot, availability }) => (
                        <button
                          key={slot.startAt}
                          onClick={() => room.isOwner && openEventDialog(slot, { coordinatePollId: poll?.id || "" })}
                          type="button"
                        >
                          <span>{formatDateTimeCompact(slot.startAt)}</span>
                          <strong>
                            {availability.available.length}
                            {availability.ifNeeded.length ? ` + ${availability.ifNeeded.length}` : ""}/{availability.possible}
                          </strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="coordinate-muted-copy">No matching times yet.</p>
                  )}
                </section>
              </>
            ) : (
              <section className="coordinate-inspector-section coordinate-window-list-panel">
                <div className="coordinate-inspector-heading static">
                  <span>Meetup Windows</span>
                  <small>{activePolls.length}</small>
                </div>
                {room.isOwner ? (
                  <button className="secondary-button compact coordinate-new-window-button" onClick={openNewWindowForm} type="button">
                    <Plus size={14} />
                    New Window
                  </button>
                ) : (
                  null
                )}
                {activePolls.length ? (
                  <div className="coordinate-window-list">
                    {activePolls.map((windowPoll) => {
                      const selected = windowPoll.id === poll?.id;
                      const responseCount = getPollResponseCount(windowPoll, responses);
                      return (
                        <article
                          className={`${selected ? "active" : ""} ${room.isOwner ? "owner-actions" : ""}`.trim()}
                          key={windowPoll.id}
                        >
                          <button
                            className="coordinate-window-select"
                            onClick={() => openAvailabilityWindowDetails(windowPoll)}
                            type="button"
                          >
                            <span>
                              <strong>{windowPoll.title || "Group Meeting"}</strong>
                              <small>{formatWindowCardSchedule(windowPoll)}</small>
                            </span>
                            <em>{responseCount}/{members.length} Responses</em>
                          </button>
                          {room.isOwner ? (
                            <button
                              aria-label={`Edit ${windowPoll.title || "Meetup Window"}`}
                              className="coordinate-window-edit-button"
                              onClick={() => openEditWindowForm(windowPoll)}
                              type="button"
                            >
                              <Pencil size={14} />
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="coordinate-muted-copy">No Active Windows.</p>
                )}
              </section>
            )}
          </aside>
        </div>
      ) : view === "month" ? (
        <MonthCalendar
          cursorDate={cursorDate}
          monthDays={monthDays}
          onDateSelect={setCursorDate}
          onOpenEvent={setSelectedSession}
          onNewEvent={(date) => openEventDialog(date)}
          sessions={visibleSessions}
        />
      ) : (
        <TimeGridCalendar
          days={calendarDays}
          onOpenEvent={setSelectedSession}
          onNewEvent={openEventDialog}
          rows={calendarRows}
          sessions={visibleSessions}
          view={view}
        />
      )}

      {showPollOptions ? (
        <MeetupWindowDialog
          editing={Boolean(editingPollId)}
          form={pollForm}
          onCancel={() => setShowPollOptions(false)}
          onChange={setPollForm}
          onDelete={deletePoll}
          onSubmit={savePoll}
          saving={savingPoll}
        />
      ) : null}
      {eventDialogOpen ? (
        <EventDialog
          draft={eventDraft}
          meetingAreas={meetingAreas}
          onCancel={() => setEventDialogOpen(false)}
          onChange={setEventDraft}
          onSubmit={saveEvent}
          saving={eventSaving}
        />
      ) : null}
      {selectedSession ? (
        <EventDetailsDialog
          canDelete={canDeleteSession(selectedSession)}
          deleting={deletingEventId === selectedSession.id}
          onClose={() => setSelectedSession(null)}
          onDelete={(event) => deleteEvent(event, selectedSession.id)}
          session={selectedSession}
        />
      ) : null}
      {hoveredAvailability && hoveredSlot ? (
        <AvailabilityHoverTooltip
          availability={hoveredAvailability}
          point={hoveredSlotPoint}
          slot={hoveredSlot}
        />
      ) : null}
    </section>
  );
}

function MeetupWindowDialog({ editing, form, onCancel, onChange, onDelete, onSubmit, saving }) {
  const [visibleMonth, setVisibleMonth] = useState(() => dateInputValueToDate(form.rangeStart));
  const draggingDateModeRef = useRef("");
  const timeOptions = useMemo(() => buildTimeOptions(30), []);
  const selectedDates = asArray(form.selectedDates);

  useEffect(() => {
    const firstSelectedDate = selectedDates[0] || form.rangeStart;
    setVisibleMonth(dateInputValueToDate(firstSelectedDate));
  }, [form.rangeStart, selectedDates.join("|")]);

  useEffect(() => {
    function stopDraggingDates() {
      draggingDateModeRef.current = "";
    }

    window.addEventListener("mouseup", stopDraggingDates);
    return () => window.removeEventListener("mouseup", stopDraggingDates);
  }, []);

  function updateField(name, value) {
    onChange((current) => ({ ...current, [name]: value }));
  }

  function updateSelectedDates(updater) {
    onChange((current) => ({
      ...current,
      selectedDates: updater(asArray(current.selectedDates)),
    }));
  }

  function setDateSelection(dateKey, mode = "") {
    if (!dateKey) return;
    updateSelectedDates((current) => {
      const hasDate = current.includes(dateKey);
      const shouldAdd = mode ? mode === "add" : !hasDate;
      if (shouldAdd && !hasDate) return [...current, dateKey].sort();
      if (!shouldAdd && hasDate) return current.filter((date) => date !== dateKey);
      return current;
    });
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form className="room-form-modal coordinate-window-dialog" onSubmit={onSubmit}>
        <header>
          <h2>{editing ? "Edit Meetup Window" : "New Meetup Window"}</h2>
          <button aria-label="Close Meetup Window" onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            name="title"
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="Project Meeting"
            required
            value={form.title}
          />
        </label>

        <section className="coordinate-window-dialog-section">
          <h3>What Times Might Work?</h3>
          <div className="coordinate-time-range-fields">
            <label className="field">
              <span>Starts</span>
              <AppSelectMenu
                ariaLabel="Starts"
                onChange={(value) => updateField("dayStartMinutes", Number(value))}
                options={timeOptions.slice(0, -1).map((option) => ({
                  label: option.label,
                  value: String(option.value),
                }))}
                value={String(Number(form.dayStartMinutes))}
              />
            </label>
            <label className="field">
              <span>Ends</span>
              <AppSelectMenu
                ariaLabel="Ends"
                onChange={(value) => updateField("dayEndMinutes", Number(value))}
                options={timeOptions.slice(1).map((option) => ({
                  label: option.label,
                  value: String(option.value),
                }))}
                value={String(Number(form.dayEndMinutes))}
              />
            </label>
          </div>
        </section>

        <section className="coordinate-window-dialog-section">
          <h3>What Dates Might Work?</h3>
          <div className="coordinate-date-select-copy">
            <span>{selectedDates.length ? `${selectedDates.length} Dates Selected` : "Select One Or More Dates"}</span>
            {selectedDates.length ? (
              <button onClick={() => updateField("selectedDates", [])} type="button">
                Clear Dates
              </button>
            ) : null}
          </div>
          <DateSelectionCalendar
            draggingModeRef={draggingDateModeRef}
            onDatePaint={setDateSelection}
            selectedDates={selectedDates}
            setVisibleMonth={setVisibleMonth}
            visibleMonth={visibleMonth}
          />
        </section>

        <section className="coordinate-window-dialog-section compact">
          <h3>Time Increment</h3>
          <div className="coordinate-segmented-options" role="group" aria-label="Time Increment">
            {POLL_SLOT_OPTIONS.map((minutes) => (
              <button
                className={Number(form.slotMinutes) === minutes ? "active" : ""}
                key={minutes}
                onClick={() => updateField("slotMinutes", minutes)}
                type="button"
              >
                {minutes < 60 ? `${minutes} Min` : `${minutes / 60} Hr`}
              </button>
            ))}
          </div>
        </section>

        <div className={`modal-actions coordinate-window-modal-actions ${editing ? "editing" : "creating"}`}>
          {editing ? (
            <button className="secondary-button compact danger" disabled={saving} onClick={onDelete} type="button">
              <Trash2 size={15} />
              Delete Window
            </button>
          ) : null}
          {editing ? <span /> : null}
          <button
            className="primary-button compact"
            disabled={saving || !form.title.trim() || Number(form.dayEndMinutes) <= Number(form.dayStartMinutes) || !selectedDates.length}
            type="submit"
          >
            {saving ? "Saving" : editing ? "Save Window" : "Create Window"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DateSelectionCalendar({ draggingModeRef, maxDate = "", minDate = "", onDatePaint, selectedDates, setVisibleMonth, visibleMonth }) {
  const days = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const min = minDate ? constraintDate(minDate) : null;
  const max = maxDate ? constraintDate(maxDate) : null;
  const selectedSet = new Set(selectedDates);

  function disabled(day) {
    if (min && day.date < min) return true;
    if (max && day.date > max) return true;
    return false;
  }

  function startPaint(day) {
    if (disabled(day)) return;
    const key = localDateKey(day.date);
    const mode = selectedSet.has(key) ? "remove" : "add";
    draggingModeRef.current = mode;
    onDatePaint(key, mode);
  }

  return (
    <div className="coordinate-date-selection-calendar">
      <header>
        <button
          aria-label="Previous Month"
          onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <strong>{formatMonthTitle(visibleMonth)}</strong>
        <button
          aria-label="Next Month"
          onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          type="button"
        >
          <ChevronRight size={16} />
        </button>
      </header>
      <div className="coordinate-date-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="coordinate-date-grid selectable">
        {days.map((day) => {
          const key = localDateKey(day.date);
          return (
            <button
              className={`${day.inMonth ? "" : "muted"} ${selectedSet.has(key) ? "selected" : ""}`.trim()}
              disabled={disabled(day)}
              key={day.key}
              onMouseDown={(event) => {
                event.preventDefault();
                startPaint(day);
              }}
              onMouseEnter={() => draggingModeRef.current && !disabled(day) && onDatePaint(key, draggingModeRef.current)}
              type="button"
            >
              {day.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AvailabilityHeatmap({
  bestSlotKeys,
  days,
  editing,
  getSlotAvailability,
  overlayEnabled,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onSchedule,
  onSlotHover,
  ownStatuses,
  poll,
  showBestTimes,
  user,
  userIsOwner,
}) {
  const rows = useMemo(() => buildAvailabilityRows(days, Number(poll?.slotMinutes) || 30), [days, poll?.slotMinutes]);

  return (
    <div
      className={`coordinate-heatmap-grid polished ${editing ? "editing" : ""}`.trim()}
      style={{
        "--coordinate-day-count": days.length || 1,
      }}
    >
      <div className="coordinate-grid-corner" />
      {days.map((day) => {
        const header = formatDayHeader(day.date);
        return (
          <div className="coordinate-grid-day" key={day.key}>
            <span>{header.date}</span>
            <strong>{header.weekday}</strong>
          </div>
        );
      })}

      {rows.map((row) => (
        <div className="coordinate-grid-row" key={row.key}>
          <span className="coordinate-grid-time">{row.label}</span>
          {row.slots.map((slot, index) => {
            if (!slot) return <span className="coordinate-grid-gap" key={`${row.key}-${index}`} />;

            const availability = getSlotAvailability(slot);
            const ownStatus = ownStatuses[slot.startAt] || "";
            const isBest = bestSlotKeys.has(slot.startAt);
            const heatPercent = overlayEnabled ? (showBestTimes && !isBest ? 4 : Math.round(availability.heat * 72)) : 0;

            return (
              <button
                className={`coordinate-heat-slot ${ownStatus ? `own-${ownStatus}` : ""}`.trim()}
                data-slot-start={slot.startAt}
                key={slot.startAt}
                onContextMenu={(event) => editing && event.preventDefault()}
                onClick={() => {
                  if (!editing && userIsOwner) onSchedule(slot, { coordinatePollId: poll?.id || "" });
                }}
                onPointerDown={(event) => onPointerDown(event, slot)}
                onPointerEnter={() => onPointerEnter(slot)}
                onPointerLeave={() => onSlotHover("", null)}
                onPointerMove={(event) => {
                  onSlotHover(slot.startAt, event);
                  onPointerMove(event, slot);
                }}
                style={{
                  "--heat": `${heatPercent}%`,
                }}
                type="button"
              >
                {!editing && ownStatus ? <OwnAvailabilityMarker status={ownStatus} user={user} /> : null}
                {overlayEnabled ? <span className="coordinate-heat-count">{availability.available.length}</span> : <span />}
                {overlayEnabled && availability.ifNeeded.length ? <small>+{availability.ifNeeded.length}</small> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function OwnAvailabilityMarker({ status, user }) {
  const label = status === "ifNeeded" ? "Your If Needed Slot" : "Your Available Slot";
  const initial = getInitial(user?.name || user?.email || "You");

  return (
    <span className={`coordinate-own-slot-marker ${status}`} aria-label={label}>
      {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : <span>{initial}</span>}
    </span>
  );
}

function AvailabilityHoverTooltip({ availability, point, slot }) {
  if (!slot || !point) return null;

  const tooltipWidth = 248;
  const tooltipHeight = 112;
  const left =
    typeof window === "undefined"
      ? point.x
      : Math.min(Math.max(12, point.x + 14), window.innerWidth - tooltipWidth - 12);
  const top =
    typeof window === "undefined"
      ? point.y
      : Math.min(Math.max(12, point.y + 14), window.innerHeight - tooltipHeight - 12);

  return createPortal(
    <div
      className="coordinate-slot-tooltip"
      role="tooltip"
      style={{
        left,
        top,
      }}
    >
      <strong>{formatSlotRange(slot)}</strong>
      <span>
        {availability.available.length}
        {availability.ifNeeded.length ? ` + ${availability.ifNeeded.length}` : ""}/{availability.possible} selected
      </span>
      <small>{availability.names || "No Selected Members Available"}</small>
    </div>,
    document.body,
  );
}

function TimeGridCalendar({ days, onOpenEvent, onNewEvent, rows, sessions, view }) {
  const scrollRef = useRef(null);
  const dayKey = days.map((day) => localDateKey(day)).join("|");
  const gridHeight = (CALENDAR_DAY_END_HOUR - CALENDAR_DAY_START_HOUR) * CALENDAR_HOUR_ROW_HEIGHT;
  const now = new Date();

  useEffect(() => {
    const surface = scrollRef.current;
    if (!surface) return undefined;

    const hasToday = days.some((day) => isSameDate(day, now));
    const targetMinutes = hasToday ? Math.max(0, minutesOfDay(now) - 120) : 7 * 60;
    const frame = window.requestAnimationFrame(() => {
      surface.scrollTop = Math.max(0, (targetMinutes / 60) * CALENDAR_HOUR_ROW_HEIGHT);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dayKey, view]);

  return (
    <main
      className={`coordinate-calendar-grid-surface ${view}`}
      ref={scrollRef}
      style={{
        "--coordinate-day-count": days.length || 1,
        "--coordinate-hour-row-height": `${CALENDAR_HOUR_ROW_HEIGHT}px`,
        "--coordinate-time-grid-height": `${gridHeight}px`,
      }}
    >
      <div className="coordinate-heatmap-grid calendar-mode">
        <div className="coordinate-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
        {days.map((day, dayIndex) => {
          const header = formatDayHeader(day);
          return (
            <div
              className="coordinate-grid-day"
              key={day.toISOString()}
              style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
            >
              <span>{header.date}</span>
              <strong>{header.weekday}</strong>
            </div>
          );
        })}
        <div className="coordinate-grid-row all-day">
          <span className="coordinate-grid-time" style={{ gridColumn: 1, gridRow: 2 }}>All Day</span>
          {days.map((day, dayIndex) => {
            const shelfSessions = sessionsForDate(sessions, day).filter(sessionIsAllDay);
            return (
              <div
                className="coordinate-calendar-slot all-day"
                key={`all-day-${day.toISOString()}`}
                style={{ gridColumn: dayIndex + 2, gridRow: 2 }}
              >
                {shelfSessions.map((session) => (
                  <CalendarEventBlock
                    key={session.id}
                    onOpen={() => onOpenEvent(session)}
                    session={session}
                  />
                ))}
              </div>
            );
          })}
        </div>
        {rows.map((row, rowIndex) => (
          <div className="coordinate-grid-row" key={row.key}>
            <span
              className="coordinate-grid-time"
              style={{ gridColumn: 1, gridRow: rowIndex + 3 }}
            >
              {row.label}
            </span>
            {row.slots.map((slotGroup, dayIndex) => (
              <div
                className="coordinate-calendar-slot hour"
                key={`${row.key}-${dayIndex}`}
                style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 3 }}
              >
                {slotGroup.map((slot) => (
                  <button
                    aria-label={`Create Item At ${formatDateTimeCompact(slot.startAt)}`}
                    className="coordinate-calendar-slot-zone"
                    key={slot.startAt}
                    onClick={() => onNewEvent(slot)}
                    type="button"
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
        {days.map((day, dayIndex) => (
          <div
            className="coordinate-timed-event-layer"
            key={`events-${day.toISOString()}`}
            style={{
              gridColumn: dayIndex + 2,
              gridRow: `3 / span ${rows.length}`,
            }}
          >
            {isSameDate(day, now) ? (
              <span
                aria-hidden="true"
                className="coordinate-current-time-line"
                style={{ top: `${(minutesOfDay(now) / (24 * 60)) * 100}%` }}
              />
            ) : null}
            {layoutTimedSessions(sessions, day).map((item) => {
              const durationMinutes = item.endMinute - item.startMinute;
              const heightPercent = (durationMinutes / (24 * 60)) * 100;
              const compact = item.session.kind !== "deadline" && durationMinutes <= 30;
              const minimumHeight = item.session.kind === "deadline" ? 30 : compact ? 30 : 46;
              const width = 100 / item.columnCount;
              return (
                <CalendarEventBlock
                  compact={compact}
                  key={item.session.id}
                  onOpen={() => onOpenEvent(item.session)}
                  session={item.session}
                  style={{
                    top: `${(item.startMinute / (24 * 60)) * 100}%`,
                    height: `max(${minimumHeight}px, ${heightPercent}%)`,
                    left: `calc(${item.column * width}% + 3px)`,
                    width: `calc(${width}% - 6px)`,
                  }}
                  timed
                />
              );
            })}
          </div>
        ))}
      </div>
    </main>
  );
}

function MonthCalendar({
  cursorDate,
  monthDays,
  onDateSelect,
  onOpenEvent,
  onNewEvent,
  sessions,
}) {
  const surfaceRef = useRef(null);
  const [overflowDay, setOverflowDay] = useState(null);

  useEffect(() => {
    setOverflowDay(null);
  }, [cursorDate]);

  useEffect(() => {
    if (!overflowDay) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") setOverflowDay(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [overflowDay]);

  function selectDate(date) {
    setOverflowDay(null);
    onDateSelect(date);
  }

  function openOverflow(event, day, daySessions) {
    event.stopPropagation();

    const surface = surfaceRef.current;
    const surfaceRect = surface?.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 280;
    const popoverHeight = 320;
    const left = surfaceRect
      ? Math.min(
          Math.max(10, buttonRect.left - surfaceRect.left - 18),
          Math.max(10, surfaceRect.width - popoverWidth - 10),
        )
      : 10;
    const top = surfaceRect
      ? Math.min(
          Math.max(46, buttonRect.bottom - surfaceRect.top + 6),
          Math.max(46, surfaceRect.height - popoverHeight - 10),
        )
      : 46;

    setOverflowDay({
      date: day.date.toISOString(),
      key: day.key,
      left,
      sessions: daySessions,
      top,
    });
  }

  const overflowDate = overflowDay ? new Date(overflowDay.date) : null;
  const overflowHeader = overflowDate ? formatDayHeader(overflowDate) : null;

  return (
    <main className="coordinate-month-surface" ref={surfaceRef}>
      <div className="coordinate-month-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="coordinate-month-grid">
        {monthDays.map((day) => {
          const daySessions = sessionsForDate(sessions, day.date);
          return (
            <div
              className={`${day.inMonth ? "" : "muted"} ${isSameDate(day.date, new Date()) ? "today" : ""}`.trim()}
              key={day.key}
              onClick={() => selectDate(day.date)}
              onDoubleClick={() => onNewEvent(day.date)}
              onKeyDown={(event) => {
                if (event.key === "Enter") selectDate(day.date);
                if (event.key === " ") onNewEvent(day.date);
              }}
              role="button"
              tabIndex={0}
            >
              <span>{day.date.getDate()}</span>
              <div>
                {daySessions.slice(0, MONTH_VISIBLE_EVENT_LIMIT).map((session) => (
                  <MonthEventChip
                    key={session.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenEvent(session);
                    }}
                    session={session}
                  />
                ))}
                {daySessions.length > MONTH_VISIBLE_EVENT_LIMIT ? (
                  <button
                    className="coordinate-month-more-button"
                    onClick={(event) => openOverflow(event, day, daySessions)}
                    type="button"
                  >
                    +{daySessions.length - MONTH_VISIBLE_EVENT_LIMIT} More
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {overflowDay && overflowHeader ? (
        <div
          className="coordinate-month-more-popover"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          style={{
            left: `${overflowDay.left}px`,
            top: `${overflowDay.top}px`,
          }}
        >
          <header>
            <span>{overflowHeader.weekday}</span>
            <strong>{overflowDate.getDate()}</strong>
            <button aria-label="Close Month Items" onClick={() => setOverflowDay(null)} type="button">
              <X size={16} />
            </button>
          </header>
          <div className="coordinate-month-more-list">
            {overflowDay.sessions.map((session) => (
              <MonthEventChip
                key={session.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setOverflowDay(null);
                  onOpenEvent(session);
                }}
                session={session}
              />
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function MonthEventChip({ onClick, session }) {
  const allDay = sessionIsAllDay(session);
  return (
    <article
      className={`${session.kind || "meeting"} ${allDay ? "all-day" : "timed"}`}
      onClick={onClick}
      role="button"
      style={{ "--event-color": sessionColorValue(session) }}
      tabIndex={0}
    >
      {allDay ? null : <span aria-hidden="true" />}
      <strong>
        {allDay
          ? session.title
          : session.kind === "deadline"
            ? `${formatTimeLabel(session.startsAt)} ${session.title}`
            : `${formatTimeLabel(session.startsAt)} ${session.title}`}
      </strong>
    </article>
  );
}

function CalendarEventBlock({
  canDelete = false,
  compact = false,
  deleting = false,
  onDelete = null,
  onOpen,
  session,
  style,
  timed = false,
}) {
  const allDay = sessionIsAllDay(session);
  const deadline = session.kind === "deadline";
  const startLabel = formatTimeLabel(session.startsAt);
  const endLabel = session.endsAt ? formatTimeLabel(sessionEndDate(session)) : "";
  const timeLabel = deadline ? startLabel : `${startLabel}${endLabel ? ` – ${endLabel}` : ""}`;
  const locationLabel = !deadline && session.location ? ` – ${session.location}` : "";
  const displayStyle = {
    ...(style || {}),
    "--event-color": sessionColorValue(session),
  };

  return (
    <article
      className={`coordinate-event-block ${session.kind || "meeting"} ${allDay ? "all-day" : ""} ${timed ? "timed" : ""} ${compact ? "compact" : ""}`.trim()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
      role="button"
      style={displayStyle}
      tabIndex={0}
    >
      {deadline ? <span className="coordinate-deadline-check" aria-hidden="true" /> : null}
      <strong>
        {session.title}
        {compact ? <span>{`, ${timeLabel}${locationLabel}`}</span> : null}
      </strong>
      {allDay ? null : compact ? null : <small>{timeLabel}{locationLabel}</small>}
      {canDelete ? (
        <button aria-label="Delete event" disabled={deleting} onClick={onDelete} type="button">
          <X size={12} />
        </button>
      ) : null}
    </article>
  );
}

function DatePickerButton({ date, maxDate = "", minDate = "", onSelect, open, setOpen }) {
  const rootRef = useRef(null);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(date || new Date()));

  useEffect(() => {
    if (open) setVisibleMonth(new Date(date || new Date()));
  }, [date, open]);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open, setOpen]);

  return (
    <span className="coordinate-date-picker-root" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Go To Date"
        className="coordinate-date-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{formatCompactDate(date)}</span>
        <CalendarDays size={15} />
      </button>
      {open ? (
        <ThemedDatePicker
          maxDate={maxDate}
          minDate={minDate}
          onSelect={onSelect}
          setVisibleMonth={setVisibleMonth}
          value={date}
          visibleMonth={visibleMonth}
        />
      ) : null}
    </span>
  );
}

function ThemedDatePicker({ maxDate, minDate, onSelect, setVisibleMonth, value, visibleMonth }) {
  const days = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const min = minDate ? constraintDate(minDate) : null;
  const max = maxDate ? constraintDate(maxDate) : null;
  const selectedDate = startOfDay(value);

  function disabled(day) {
    if (min && day.date < min) return true;
    if (max && day.date > max) return true;
    return false;
  }

  return (
    <div className="coordinate-date-popover" role="dialog" aria-label="Choose Date">
      <header>
        <strong>{formatMonthTitle(visibleMonth)}</strong>
        <span>
          <button
            aria-label="Previous Month"
            onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="Next Month"
            onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            type="button"
          >
            <ChevronRight size={15} />
          </button>
        </span>
      </header>
      <div className="coordinate-date-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="coordinate-date-grid">
        {days.map((day) => {
          const isSelected = isSameDate(day.date, selectedDate);
          const isToday = isSameDate(day.date, new Date());
          return (
            <button
              className={`${day.inMonth ? "" : "muted"} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`.trim()}
              disabled={disabled(day)}
              key={day.key}
              onClick={() => onSelect(day.date)}
              type="button"
            >
              {day.date.getDate()}
            </button>
          );
        })}
      </div>
      <footer>
        <button onClick={() => onSelect(new Date())} type="button">Today</button>
      </footer>
    </div>
  );
}

function MemberAvatar({ member }) {
  if (member.avatarUrl) {
    return <img alt="" className="coordinate-member-avatar" src={member.avatarUrl} />;
  }

  return <span className="coordinate-member-avatar">{member.initial || getInitial(member.name)}</span>;
}

function EventDetailsDialog({ canDelete, deleting, onClose, onDelete, session }) {
  const allDay = sessionIsAllDay(session);
  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <article className="room-form-modal coordinate-event-dialog coordinate-event-details">
        <header>
          <div>
            <span className={`coordinate-event-kind ${session.kind || "meeting"}`}>
              {sessionKindLabel(session.kind)}
            </span>
            <h2>{session.title}</h2>
          </div>
          <button aria-label="Close Event Details" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="coordinate-event-detail-grid">
          <span>
            <Clock size={15} />
            {allDay ? "Date" : "Starts"}
          </span>
          <strong>{allDay ? formatDayMonth(session.startsAt, true) : formatDateTimeFull(session.startsAt)}</strong>
          {!allDay && session.endsAt ? (
            <>
              <span>
                <Clock size={15} />
                Ends
              </span>
              <strong>{formatDateTimeFull(session.endsAt)}</strong>
            </>
          ) : null}
          <span>
            <Lock size={15} />
            Visibility
          </span>
          <strong>{session.visibility === "private" ? "Private To Me" : "Everyone In Room"}</strong>
          {session.location ? (
            <>
              <span>
                <MapPin size={15} />
                Location
              </span>
              <strong>{session.location}</strong>
            </>
          ) : null}
        </div>
        {session.agenda ? (
          <section className="coordinate-event-notes">
            <strong>Notes</strong>
            <p>{session.agenda}</p>
          </section>
        ) : null}
        {canDelete ? (
          <div className="modal-actions">
            <button className="secondary-button compact danger" disabled={deleting} onClick={onDelete} type="button">
              {deleting ? "Deleting" : "Delete Event"}
            </button>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function EventDialog({ draft, meetingAreas, onCancel, onChange, onSubmit, saving }) {
  function updateField(event) {
    onChange((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function setKind(kindId) {
    onChange((current) => {
      const nextKind = EVENT_KINDS.some((kind) => kind.id === kindId) ? kindId : "meeting";
      const defaultColor =
        nextKind === "deadline"
          ? "gold"
          : nextKind === "event"
            ? "iris"
            : "rose";
      const start = dateTimeLocalInputValueToDate(current.startsAt || toDateTimeLocalInputValue(new Date()));
      const fallbackEnd = toDateTimeLocalInputValue(addMinutes(Number.isNaN(start.getTime()) ? new Date() : start, 60));

      return {
        ...current,
        kind: nextKind,
        color: current.kind === nextKind && current.color ? current.color : defaultColor,
        allDay: nextKind === "deadline" ? false : current.allDay,
        endsAt: nextKind === "deadline" ? "" : current.endsAt || fallbackEnd,
      };
    });
  }

  function setAllDay(enabled) {
    onChange((current) => {
      const date = String(current.startsAt || toDateTimeLocalInputValue(new Date())).slice(0, 10);
      return {
        ...current,
        allDay: enabled,
        startsAt: enabled ? `${date}T00:00` : current.startsAt,
        endsAt: enabled ? `${date}T23:59` : current.endsAt,
      };
    });
  }

  function updateAllDayDate(value) {
    onChange((current) => ({
      ...current,
      startsAt: `${value}T00:00`,
      endsAt: `${value}T23:59`,
    }));
  }

  return (
    <div
      className="modal-backdrop room-form-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form className="room-form-modal coordinate-event-dialog" onSubmit={onSubmit}>
        <header>
          <h2>New Calendar Item</h2>
          <button aria-label="Close Calendar Item" onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            name="title"
            onChange={updateField}
            placeholder="Study Meetup"
            required
            value={draft.title}
          />
        </label>

        <div className="form-grid">
          <div className="field">
            <span>Type</span>
            <div className="coordinate-segmented-options" role="group" aria-label="Type">
              {EVENT_KINDS.map((kind) => (
                <button
                  className={draft.kind === kind.id ? "active" : ""}
                  key={kind.id}
                  onClick={() => setKind(kind.id)}
                  type="button"
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Visibility</span>
            <div className="coordinate-segmented-options" role="group" aria-label="Visibility">
              <button
                className={draft.visibility === "room" ? "active" : ""}
                onClick={() => onChange((current) => ({ ...current, visibility: "room" }))}
                type="button"
              >
                Everyone
              </button>
              <button
                className={draft.visibility === "private" ? "active" : ""}
                onClick={() => onChange((current) => ({ ...current, visibility: "private" }))}
                type="button"
              >
                Private
              </button>
            </div>
          </div>
        </div>

        {draft.kind !== "deadline" ? (
          <label className="coordinate-control-pill coordinate-toggle-row compact">
            <input
              checked={Boolean(draft.allDay)}
              className="coordinate-control-checkbox"
              onChange={(event) => setAllDay(event.target.checked)}
              type="checkbox"
            />
            <span>All Day</span>
          </label>
        ) : null}

        {draft.allDay ? (
          <label className="field">
            <span>Date</span>
            <input
              onChange={(event) => updateAllDayDate(event.target.value)}
              required
              type="date"
              value={String(draft.startsAt || "").slice(0, 10)}
            />
          </label>
        ) : draft.kind === "deadline" ? (
          <label className="field">
            <span>Time</span>
            <input name="startsAt" onChange={updateField} required type="datetime-local" value={draft.startsAt} />
          </label>
        ) : (
          <div className="form-grid">
            <label className="field">
              <span>Starts</span>
              <input name="startsAt" onChange={updateField} required type="datetime-local" value={draft.startsAt} />
            </label>
            <label className="field">
              <span>Ends</span>
              <input
                disabled={draft.kind === "deadline"}
                name="endsAt"
                onChange={updateField}
                type="datetime-local"
                value={draft.endsAt}
              />
            </label>
          </div>
        )}

        <div className="field">
          <span>Colour</span>
          <div className="coordinate-color-options" role="group" aria-label="Colour">
            {EVENT_COLOR_OPTIONS.map((option) => (
              <button
                aria-pressed={draft.color === option.id}
                className={draft.color === option.id ? "active" : ""}
                key={option.id}
                onClick={() => onChange((current) => ({ ...current, color: option.id }))}
                style={{ "--swatch-color": option.value }}
                type="button"
              >
                <span aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Location</span>
          <div className="coordinate-location-input">
            <MapPin size={17} />
            <input
              name="location"
              onChange={updateField}
              placeholder={meetingAreas.length ? "Meeting Area or custom location" : "Meeting room, Zoom, library, anything"}
              value={draft.location}
            />
          </div>
        </label>

        {meetingAreas.length ? (
          <div className="coordinate-meeting-area-picks" aria-label="Meeting areas">
            {meetingAreas.map((area) => (
              <button
                key={area.id}
                onClick={() => onChange((current) => ({ ...current, location: area.label }))}
                type="button"
              >
                <MapPin size={14} />
                {area.label}
              </button>
            ))}
          </div>
        ) : null}

        <label className="field">
          <span>Notes</span>
          <textarea
            name="agenda"
            onChange={updateField}
            placeholder="Agenda, deadline context, or prep notes"
            rows={3}
            value={draft.agenda}
          />
        </label>

        <div className="modal-actions">
          <button className="primary-button compact" disabled={saving || !draft.title.trim()} type="submit">
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
