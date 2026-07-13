import { describe, expect, it } from "vitest";
import {
  buildSourceResourceMap,
  formatBuddyToolEvent,
  normalizeBuddyMarkdown,
  splitBuddyVisibleThinking,
  uniqueBuddySteps,
} from "./buddyUtils.ts";

describe("buddyUtils", () => {
  it("splits model thinking blocks from the visible answer", () => {
    const result = splitBuddyVisibleThinking(
      "<thinking>Search room docs</thinking>The answer is in Lecture 7.",
    );

    expect(result).toEqual({
      answer: "The answer is in Lecture 7.",
      thoughts: ["Search room docs"],
    });
  });

  it("turns search tool events into user-readable progress rows", () => {
    const event = formatBuddyToolEvent({
      event: "tool_end",
      tool: "search_corpus",
      input: { query: "datapath" },
      result: "[Source: Lecture 7 CPU datapath.pdf]",
      status: "done",
    });

    expect(event).toMatchObject({
      type: "tool",
      tool: "search_corpus",
      status: "done",
      summary: "Found 1 Domain context source",
    });
    expect(event.text).toContain("Lecture 7 CPU datapath.pdf");
  });

  it("deduplicates repeated thinking rows", () => {
    expect(uniqueBuddySteps(["Searching resources", "Searching resources"]))
      .toHaveLength(1);
  });

  it("normalizes markdown and loose math glyphs", () => {
    expect(normalizeBuddyMarkdown("\\alpha appears here. ## Heading"))
      .toContain("α appears here.\n\n## Heading");
  });

  it("indexes source citations by stable filenames", () => {
    const map = buildSourceResourceMap([
      {
        id: "res_1",
        title: "Lecture 7.pdf",
        originalName: "Lecture 7 CPU.pdf",
        storageName: "upload-123.pdf",
      },
    ]);

    expect(map.get("lecture 7 cpu.pdf")?.id).toBe("res_1");
    expect(map.get("upload-123.pdf")?.id).toBe("res_1");
  });
});
