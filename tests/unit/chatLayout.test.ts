import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CATEGORY_ID,
  addChannelToCategory,
  createCategoryId,
  getCategoryNameForChannel,
  moveCategoryInLayout,
  moveChannelToCategory,
  normalizeChannelLayout,
  normalizeChannelName,
  removeChannelFromLayout,
  renameCategoryInLayout,
  renameChannelInLayout,
} from "../../apps/client/src/features/room/chat/chatLayout.ts";

describe("chat layout helpers", () => {
  // Protects the saved chat sidebar layout from stale local/server data. The
  // app must always expose #general, remove channels that no longer exist, and
  // place any newly discovered channels into the default text category.
  it("always exposes general and prunes stale saved channels", () => {
    const layout = normalizeChannelLayout(
      [
        { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general", "missing"] },
        { id: "cat-study", name: "Study", channels: ["lectures"] },
      ],
      ["general", "lectures", "labs"],
    );

    expect(layout).toEqual([
      { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general", "labs"] },
      { id: "cat-study", name: "Study", channels: ["lectures"] },
    ]);
  });

  // Typed channel payloads are the server shape for document-aware Convolution.
  // The current text sidebar still works with names, so this locks the migration
  // shim that extracts names from both old strings and new channel objects.
  it("extracts channel names from typed channel objects", () => {
    const layout = normalizeChannelLayout(
      [{ id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general"] }],
      [
        { name: "general", type: "text", resourceId: "" },
        { name: "lecture-doc", type: "document", resourceId: "res_123" },
        "tutorials",
      ],
    );

    expect(layout[0].channels).toEqual(["general", "lecture-doc", "tutorials"]);
  });

  // Exercises the core category operations used by owner controls in the Chat
  // tab. Each helper should update only the requested channel placement/name
  // while preserving the category objects around it.
  it("moves, renames, and removes channels while preserving categories", () => {
    const layout = [
      { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general", "lectures"] },
      { id: "cat-lab", name: "Labs", channels: ["labs"] },
    ];

    expect(addChannelToCategory(layout, "announcements", "cat-lab")[1].channels).toEqual([
      "labs",
      "announcements",
    ]);

    expect(moveChannelToCategory(layout, "lectures", "cat-lab", "labs")[1].channels).toEqual([
      "lectures",
      "labs",
    ]);

    expect(renameChannelInLayout(layout, "lectures", "lecture-notes")[0].channels).toContain("lecture-notes");
    expect(removeChannelFromLayout(layout, "labs")[1].channels).toEqual([]);
  });

  it("renames and reorders whole categories", () => {
    const layout = [
      { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general"] },
      { id: "cat-lab", name: "Labs", channels: ["labs"] },
      { id: "cat-revision", name: "Revision", channels: ["papers"] },
    ];

    expect(renameCategoryInLayout(layout, "cat-lab", "Lab Work")[1]).toEqual({
      id: "cat-lab",
      name: "Lab Work",
      channels: ["labs"],
    });
    expect(moveCategoryInLayout(layout, "cat-revision", "cat-lab").map((category) => category.id)).toEqual([
      DEFAULT_CATEGORY_ID,
      "cat-revision",
      "cat-lab",
    ]);
    expect(moveCategoryInLayout(layout, DEFAULT_CATEGORY_ID, "").map((category) => category.id)).toEqual([
      "cat-lab",
      "cat-revision",
      DEFAULT_CATEGORY_ID,
    ]);
  });

  // Confirms user-entered channel names are transformed into URL/storage-safe
  // slugs without losing meaningful separators such as underscores.
  it("normalizes channel names into safe slugs", () => {
    expect(normalizeChannelName(" Lecture Notes!! ")).toBe("lecture-notes");
    expect(normalizeChannelName("Week_1 / Q&A")).toBe("week_1-qa");
  });

  // Freezes time so category id generation can be tested deterministically.
  // The exact timestamp suffix can vary by implementation, but the readable
  // slug prefix should be preserved for debugging and persisted layouts.
  it("creates readable category ids", () => {
    vi.spyOn(Date.prototype, "getTime").mockReturnValue(1_721_234_567_890);
    expect(createCategoryId("Past Year Papers")).toMatch(/^category-past-year-papers-/);
    vi.restoreAllMocks();
  });

  // Verifies draft labels and other UI references can resolve the category that
  // owns a channel. Missing layouts should still fall back to Text Channels so
  // the sidebar never renders an empty or confusing label.
  it("finds the containing category for draft labels", () => {
    expect(getCategoryNameForChannel([{ id: "x", name: "Labs", channels: ["lab-1"] }], "lab-1")).toBe("Labs");
    expect(getCategoryNameForChannel([], "general")).toBe("Text Channels");
  });
});
