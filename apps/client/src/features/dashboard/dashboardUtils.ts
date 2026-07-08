import {
  MAX_WORLD_DESCRIPTION_WORDS,
  MAX_WORLD_NAME_CHARS,
} from "./dashboardConstants.ts";

/**
 * Normalizes comma-separated or array-based tag input into trimmed tag values.
 * The dashboard keeps this as a helper because room creation and filtering both
 * need exactly the same tag interpretation.
 */
export function normaliseTags(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Accepts raw invite codes or full invite URLs and returns the final code segment. */
export function extractInviteCode(value) {
  const input = String(value || "").trim();
  const inviteMatch = input.match(/(?:#\/?|\/)invite\/([^/?#]+)/i);

  if (inviteMatch?.[1]) return inviteMatch[1];

  return input.split(/[/?#]/).filter(Boolean).at(-1) || "";
}

export const COURSE_CODE_PATTERN = /^[A-Z]{2,3}\d{4}[A-Z]?$/;

/**
 * Keeps NUS course-code inputs compact and comparable while the UI still lets
 * users paste codes with lowercase letters or accidental spaces.
 */
export function normaliseCourseCodeInput(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

/**
 * Validates the common NUS course-code shape: a two- or three-letter discipline
 * prefix, four digits, and an optional trailing suffix used by courses such as
 * CS2040S or CS2103T.
 */
export function isCourseCodeFormatValid(value) {
  return COURSE_CODE_PATTERN.test(normaliseCourseCodeInput(value));
}

export function getCourseCodeValidationMessage(value) {
  const normalisedValue = normaliseCourseCodeInput(value);

  if (!normalisedValue) return "";
  if (isCourseCodeFormatValid(normalisedValue)) return "";

  return "Course code should use 2-3 letters, 4 digits, and an optional suffix, e.g. CS2040S.";
}

/**
 * Converts the app's display term, such as "2026/2027 S1", to the NUSMods API
 * academic-year segment, such as "2026-2027".
 */
export function getNusmodsAcademicYear(term) {
  const match = String(term || "").match(/(\d{4})\/(\d{4})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

export function limitWorldName(value) {
  return String(value || "").slice(0, MAX_WORLD_NAME_CHARS);
}

export function countWords(value) {
  return String(value || "").trim().match(/\S+/g)?.length || 0;
}

export function limitWords(value, maxWords = MAX_WORLD_DESCRIPTION_WORDS) {
  const text = String(value || "");
  const words = text.match(/\S+/g) || [];

  if (words.length <= maxWords) return text;

  return words.slice(0, maxWords).join(" ");
}

export function limitWorldDescription(value) {
  return limitWords(value, MAX_WORLD_DESCRIPTION_WORDS);
}

export function limitWorldFieldValue(name, value) {
  if (name === "name") return limitWorldName(value);
  if (name === "description") return limitWorldDescription(value);
  return value;
}

/**
 * Builds a filter dropdown option list from background metadata.
 */
export function createFilterOptions(items, key) {
  return ["All", ...new Set(items.map((item) => item[key]).filter(Boolean))];
}

/**
 * Applies the dashboard theme-library filters without mutating the preset data.
 */
export function matchesBackgroundFilters(item, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (value === "All") return true;
    return item[key] === value;
  });
}

/**
 * Produces the current NUS-style semester plus the next few regular semesters.
 * The picker intentionally avoids a free-form academic-year text field so room
 * cards stay consistent and easy to scan.
 */
export function createAcademicTermOptions(date = new Date(), count = 4) {
  const month = date.getMonth();
  let startYear = date.getFullYear();
  let semester = "S1";

  if (month <= 4) {
    startYear -= 1;
    semester = "S2";
  }

  const terms = [];
  let currentYear = startYear;
  let currentSemester = semester;

  for (let index = 0; index < count; index += 1) {
    terms.push(`${currentYear}/${currentYear + 1} ${currentSemester}`);

    if (currentSemester === "S1") {
      currentSemester = "S2";
    } else {
      currentYear += 1;
      currentSemester = "S1";
    }
  }

  return terms;
}
