import { describe, expect, it } from "vitest";
import {
  createAcademicTermOptions,
  createFilterOptions,
  matchesBackgroundFilters,
  normaliseTags,
} from "../../apps/client/src/features/dashboard/dashboardUtils.js";

describe("dashboard helpers", () => {
  // Ensures the dashboard accepts tags from both UI paths: an existing array
  // and a comma-separated text field. Empty entries and whitespace should not
  // create blank filter pills.
  it("normalises tag input from arrays and comma-separated text", () => {
    expect(normaliseTags([" algos ", "", "study"])).toEqual(["algos", "study"]);
    expect(normaliseTags("algos, code, , revision")).toEqual(["algos", "code", "revision"]);
  });

  // Locks the academic-term generator to NUS semester boundaries. The fixed
  // reference dates make the test reproducible instead of depending on today's
  // date when CI or another developer runs it.
  it("creates stable NUS academic terms from a reference date", () => {
    expect(createAcademicTermOptions(new Date("2026-03-15T00:00:00Z"), 3)).toEqual([
      "2025/2026 S2",
      "2026/2027 S1",
      "2026/2027 S2",
    ]);

    expect(createAcademicTermOptions(new Date("2026-08-15T00:00:00Z"), 2)).toEqual([
      "2026/2027 S1",
      "2026/2027 S2",
    ]);
  });

  // Validates the theme-library filter helpers used in the Create Room flow.
  // The test confirms available filter options are derived in display order and
  // that filtering does not mutate the original metadata array.
  it("filters theme-library metadata without mutating options", () => {
    const items = [
      { id: "a", type: "Gradient", color: "Pink" },
      { id: "b", type: "Ambient", color: "Green" },
      { id: "c", type: "Ambient", color: "Pink" },
    ];

    expect(createFilterOptions(items, "type")).toEqual(["All", "Gradient", "Ambient"]);
    expect(items.filter((item) => matchesBackgroundFilters(item, { type: "Ambient", color: "Pink" }))).toEqual([
      { id: "c", type: "Ambient", color: "Pink" },
    ]);
  });
});
