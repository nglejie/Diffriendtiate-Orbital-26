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
