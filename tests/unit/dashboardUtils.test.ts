import { describe, expect, it } from "vitest";
import {
  createAcademicTermOptions,
  extractInviteCode,
  createFilterOptions,
  getCourseCodeValidationMessage,
  getNusmodsAcademicYear,
  isCourseCodeFormatValid,
  countWords,
  limitWorldDescription,
  limitWorldFieldValue,
  limitWorldName,
  matchesBackgroundFilters,
  normaliseCourseCodeInput,
  normaliseTags,
} from "../../apps/client/src/features/dashboard/dashboardUtils.ts";

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

  // Invite links can be copied as a raw code or as a full hash URL. The join
  // dialog should submit the same invite code either way.
  it("extracts invite codes from raw values and URLs", () => {
    expect(extractInviteCode("q01CPdf9")).toBe("q01CPdf9");
    expect(extractInviteCode("https://diffriendtiate.test/#/invite/q01CPdf9")).toBe("q01CPdf9");
    expect(extractInviteCode("https://diffriendtiate.test/#/invite/q01CPdf9?from=chat")).toBe("q01CPdf9");
    expect(extractInviteCode(" https://diffriendtiate.test/invite/q01CPdf9/ ")).toBe("q01CPdf9");
    expect(extractInviteCode("")).toBe("");
  });

  // Course creation should only accept NUS-like course codes while still being
  // forgiving about pasted lowercase letters, spaces, or punctuation.
  it("normalises and validates NUS course-code input", () => {
    expect(normaliseCourseCodeInput(" cs 2040s ")).toBe("CS2040S");
    expect(normaliseCourseCodeInput("cs-2103t")).toBe("CS2103T");
    expect(isCourseCodeFormatValid("CS2040S")).toBe(true);
    expect(isCourseCodeFormatValid("GER1000")).toBe(true);
    expect(isCourseCodeFormatValid("C1000")).toBe(false);
    expect(isCourseCodeFormatValid("GESS1000")).toBe(false);
    expect(isCourseCodeFormatValid("CS20")).toBe(false);
    expect(getCourseCodeValidationMessage("CS20")).toMatch(/2-3 letters, 4 digits/i);
    expect(getCourseCodeValidationMessage("CS2040S")).toBe("");
  });

  // NUSMods indexes course lists by hyphenated academic year, while the app
  // displays terms in the more readable NUS semester format.
  it("converts display academic terms to NUSMods academic years", () => {
    expect(getNusmodsAcademicYear("2026/2027 S1")).toBe("2026-2027");
    expect(getNusmodsAcademicYear("2025/2026 S2")).toBe("2025-2026");
    expect(getNusmodsAcademicYear("")).toBe("");
  });

  // Room creation caps should handle both normal typing and pasted content,
  // because native input maxLength does not protect every state update path.
  it("limits world names and descriptions consistently", () => {
    expect(limitWorldName("1234567890123456789012345")).toBe("12345678901234567890");

    const longDescription = Array.from({ length: 105 }, (_, index) => `word${index + 1}`).join(" ");
    const limitedDescription = limitWorldDescription(longDescription);
    expect(countWords(limitedDescription)).toBe(100);
    expect(limitedDescription.endsWith("word100")).toBe(true);
    expect(limitedDescription).not.toContain("word101");

    expect(limitWorldFieldValue("name", "abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmnopqrst");
    expect(countWords(limitWorldFieldValue("description", longDescription))).toBe(100);
    expect(limitWorldFieldValue("moduleCode", "CS2040S")).toBe("CS2040S");
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
