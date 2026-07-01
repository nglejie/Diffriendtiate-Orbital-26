import { describe, expect, it } from "vitest";
import {
  buildSourceResourceMap,
  cleanBuddyThinkingArtifacts,
  createBuddyThoughtItem,
  formatBuddyToolEvent,
  getBuddyChainFinalVisibleResponse,
  mergeBuddyThoughtSteps,
  normalizeBuddyMarkdown,
  normalizeSourceKey,
  splitBuddyVisibleThinking,
} from "../../apps/client/src/features/room/buddyUtils.ts";

describe("Intelligrate presentation utilities", () => {
  // Confirms the frontend separates model-provided <thinking> text from the
  // visible final answer without inventing any extra reasoning. This directly
  // protects the rule that Intelligrate UI may format events but must not fake
  // model thoughts.
  it("separates received thinking from final visible answer without inventing content", () => {
    const result = splitBuddyVisibleThinking("<thinking>Search notes</thinking>The answer is Dijkstra.");

    expect(result.thoughts).toEqual(["Search notes"]);
    expect(result.answer).toBe("The answer is Dijkstra.");
  });

  // Verifies the chat renderer chooses only the assistant response after the
  // latest user message. Older assistant answers should not leak into the
  // current response block when a thread is rehydrated.
  it("keeps final visible response after the latest user message", () => {
    const visible = getBuddyChainFinalVisibleResponse([
      { role: "assistant", content: "Old answer" },
      { role: "user", content: "Explain BFS" },
      { role: "assistant", content: "<thinking>Find source</thinking>BFS uses a queue." },
    ]);

    expect(visible).toEqual({ answer: "BFS uses a queue.", thoughts: ["Find source"] });
  });

  // Checks factual timeline labels for tool start/end events. These labels come
  // from real service events and should describe what happened without
  // exaggerating or fabricating hidden model reasoning.
  it("formats tool events as factual timeline items", () => {
    expect(
      formatBuddyToolEvent({
        event: "tool_start",
        tool: "search_corpus",
        input: { query: "minimum spanning tree" },
      }),
    ).toMatchObject({
      status: "running",
      text: "Searching room resources for \"minimum spanning tree\"",
      type: "tool",
    });

    expect(
      formatBuddyToolEvent({
        event: "tool_end",
        tool: "read_file",
        input: { file_name: "Lecture 1.pdf" },
        result: "Done",
      }),
    ).toMatchObject({
      status: "done",
      text: "Finished reading the uploaded document: Lecture 1.pdf",
      type: "tool",
      });
  });

  // Simulates streaming updates where the service may resend the same thought.
  // The UI should merge duplicates by id/text so the progress timeline remains
  // readable and does not jitter with repeated entries.
  it("deduplicates streamed thinking updates by id and text", () => {
    const first = createBuddyThoughtItem("thought", "Searching resources", { id: "a" });
    const merged = mergeBuddyThoughtSteps([first], [
      createBuddyThoughtItem("thought", "Searching resources", { id: "a" }),
      createBuddyThoughtItem("thought", "Reading lecture notes", { id: "b" }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((step) => step.text)).toEqual(["Searching resources", "Reading lecture notes"]);
  });

  // Validates source normalization for file pills. The same uploaded document
  // may be referenced by title, storage name, or URL, so the map must resolve
  // those variants back to the original room resource.
  it("normalizes source keys so source pills can resolve uploads reliably", () => {
    const map = buildSourceResourceMap([
      {
        id: "r1",
        originalName: "Lecture 1.pdf",
        storageName: "123-Lecture 1.pdf",
        title: "Lecture 1",
        url: "/uploads/123-Lecture%201.pdf",
      },
    ]);

    expect(normalizeSourceKey("/uploads/123-Lecture%201.pdf?download=true")).toBe("123-lecture 1.pdf");
    expect(map.get("lecture 1.pdf")?.id).toBe("r1");
  });

  // Ensures final Intelligrate markdown remains presentable. Transport wrappers
  // such as <thinking> should be stripped while ordinary markdown line breaks
  // and list formatting are kept intact.
  it("cleans transport artifacts while preserving markdown structure", () => {
    expect(cleanBuddyThinkingArtifacts("<thinking>search</thinking>\nActual answer")).toBe("search\nActual answer");
    expect(normalizeBuddyMarkdown("Line 1\n- item")).toBe("Line 1\n- item");
  });
});
