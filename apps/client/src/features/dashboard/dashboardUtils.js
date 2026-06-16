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
