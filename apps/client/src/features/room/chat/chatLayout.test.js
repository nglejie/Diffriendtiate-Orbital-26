import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CATEGORY_ID,
  addChannelToCategory,
  createCategoryId,
  getCategoryNameForChannel,
  moveChannelToCategory,
  normalizeChannelLayout,
  normalizeChannelName,
  removeChannelFromLayout,
  renameChannelInLayout,
} from "./chatLayout.js";

describe("chatLayout", () => {
  it("normalizes a flat server channel list into a safe sidebar layout", () => {
    const layout = normalizeChannelLayout(null, ["general", "lectures"]);

    expect(layout).toEqual([
      {
        id: DEFAULT_CATEGORY_ID,
        name: "Text Channels",
        channels: ["general", "lectures"],
      },
    ]);
  });

  it("preserves empty custom categories while removing stale channels", () => {
    const layout = normalizeChannelLayout(
      [
        { id: "cat-empty", name: "Empty", channels: [] },
        { id: "cat-old", name: "Old", channels: ["ghost", "general"] },
      ],
      ["general", "lectures"],
    );

    expect(layout).toEqual([
      { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["lectures"] },
      { id: "cat-empty", name: "Empty", channels: [] },
      { id: "cat-old", name: "Old", channels: ["general"] },
    ]);
  });

  it("moves, renames, and removes channels without duplicating them", () => {
    const layout = [
      { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general", "lectures"] },
      { id: "cat-revision", name: "Revision", channels: [] },
    ];

    const moved = moveChannelToCategory(layout, "lectures", "cat-revision");
    expect(getCategoryNameForChannel(moved, "lectures")).toBe("Revision");

    const renamed = renameChannelInLayout(moved, "lectures", "lecture-notes");
    expect(renamed[1].channels).toEqual(["lecture-notes"]);

    const removed = removeChannelFromLayout(renamed, "lecture-notes");
    expect(removed[1].channels).toEqual([]);
  });

  it("adds a new channel to the requested category", () => {
    const layout = addChannelToCategory(
      [
        { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general"] },
        { id: "cat-revision", name: "Revision", channels: [] },
      ],
      "tutorials",
      "cat-revision",
    );

    expect(layout[1].channels).toEqual(["tutorials"]);
  });

  it("normalizes user-entered channel names", () => {
    expect(normalizeChannelName("  Lecture Notes!! Week 01  ")).toBe("lecture-notes-week-01");
  });

  it("creates readable unique category ids", () => {
    vi.spyOn(Date.prototype, "valueOf");
    expect(createCategoryId("Exam Prep")).toMatch(/^category-exam-prep-/);
  });
});
