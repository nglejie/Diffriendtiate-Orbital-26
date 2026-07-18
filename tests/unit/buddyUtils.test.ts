import { describe, expect, it } from "vitest";
import {
  buildSourceResourceMap,
  cleanBuddyThinkingArtifacts,
  createBuddyThoughtItem,
  extractBuddyToolCallsFromText,
  formatBuddyToolEvent,
  getBuddyChainFinalVisibleResponse,
  getBuddySourceLabel,
  inferMentionedBuddySources,
  mergeBuddySources,
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
      text: "Searching Domain context for \"minimum spanning tree\"",
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

    expect(
      formatBuddyToolEvent({
        event: "tool_start",
        tool: "search_domain_context",
        input: { query: "meetings", source_type: "coordidate", timeframe: "upcoming" },
      }),
    ).toMatchObject({
      sourceType: "coordidate_session",
      status: "running",
      text: 'Searching upcoming Coordidate for "meetings"',
      type: "tool",
    });

    expect(
      formatBuddyToolEvent({
        event: "tool_start",
        tool: "search_corpus",
        input: { query: "meetings coming up" },
      }),
    ).toMatchObject({
      sourceType: "coordidate_session",
      status: "running",
      text: 'Searching upcoming Coordidate for "meetings coming up"',
      type: "tool",
    });

    expect(
      formatBuddyToolEvent({
        event: "tool_start",
        tool: "search_corpus",
        input: { query: "files and messages about Orbital" },
      }),
    ).toMatchObject({
      sourceType: "",
      status: "running",
      text: 'Searching Domain context for "files and messages about Orbital"',
      type: "tool",
    });

    expect(
      formatBuddyToolEvent({
        event: "tool_end",
        tool: "search_corpus",
        input: { query: "unknown term" },
        result: "No relevant domain context was found.",
      }),
    ).toMatchObject({
      status: "done",
      text: 'No relevant Domain context was found for "unknown term"',
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
    expect(normalizeBuddyMarkdown("First paragraph.\n\n.\n\nSecond paragraph.")).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
    expect(normalizeBuddyMarkdown("Meeting details.\n\n(Source: Coordidate)")).toBe("Meeting details.");
    expect(normalizeBuddyMarkdown("- Group availability at 10 AM. (Source: Coordidate)")).toBe(
      "- Group availability at 10 AM.",
    );
    expect(normalizeBuddyMarkdown("```txt\n.\n```\n\nDone.")).toBe("```txt\n.\n```\n\nDone.");
  });

  it("infers source pills only from known resources cited in the answer text", () => {
    const resources = [
      {
        id: "res_static",
        originalName: "Static1Hazard.pdf",
        storageName: "upload-static.pdf",
        title: "Static Hazard Notes",
        url: "/uploads/Static1Hazard.pdf",
      },
      {
        id: "res_other",
        originalName: "Other.pdf",
        title: "Other",
      },
    ];

    expect(
      inferMentionedBuddySources("From Static1Hazard.pdf: hazards can be eliminated.", resources),
    ).toEqual(["Static1Hazard.pdf"]);
    expect(mergeBuddySources(["ManualSource.pdf"], "From Static1Hazard.pdf", resources)).toEqual([
      "ManualSource.pdf",
      "Static1Hazard.pdf",
    ]);
  });

  it("does not infer resource source pills from negative no-evidence answers", () => {
    const resources = [
      {
        id: "res_amortization",
        originalName: "Amortization Proof Notes.pdf",
        title: "Amortization Proof Notes.pdf",
      },
      {
        id: "res_orbital",
        originalName: "Orbital Bridge Notes.pdf",
        title: "Orbital Bridge Notes.pdf",
      },
    ];

    expect(
      inferMentionedBuddySources(
        "I searched Amortization Proof Notes.pdf and Orbital Bridge Notes.pdf. There is no mention of a ZebraNebula chipset in the provided documents.",
        resources,
      ),
    ).toEqual([]);
    expect(
      mergeBuddySources(
        [],
        "I checked Amortization Proof Notes.pdf. There is no specific information about a ZebraNebula chipset.",
        resources,
      ),
    ).toEqual([]);
  });

  it("adds page focus to source pills when a known resource citation names a page", () => {
    const resources = [
      {
        id: "res_session",
        originalName: "Session 7_8.pdf",
        title: "Session 7_8.pdf",
        url: "/api/resources/res_session/file",
      },
      {
        id: "res_random",
        originalName: "Random Notes.pdf",
        title: "Random Notes.pdf",
        url: "/api/resources/res_random/file",
      },
    ];
    const answer =
      "I checked Session 7_8.pdf and Random Notes.pdf, and the topic appears on page 49 of those documents.";

    expect(mergeBuddySources(["Session 7_8.pdf", "Random Notes.pdf"], answer, resources)).toEqual([
      {
        type: "resource",
        label: "Session 7_8.pdf",
        resourceId: "res_session",
        pageNumber: 49,
      },
      {
        type: "resource",
        label: "Random Notes.pdf",
        resourceId: "res_random",
        pageNumber: 49,
      },
    ]);
  });

  it("keeps structured Domain source refs while deduplicating fallback text sources", () => {
    const sourceRef = {
      type: "resource",
      label: "Static1Hazard.pdf",
      resourceId: "res_static",
      pageNumber: 2,
      highlightPosition: {
        boundingRect: { x1: 12, y1: 20, x2: 160, y2: 42, width: 600, height: 800, pageNumber: 2 },
        rects: [{ x1: 12, y1: 20, x2: 160, y2: 42, width: 600, height: 800, pageNumber: 2 }],
      },
      textQuote: "Hazards can be eliminated with redundant terms.",
    };
    const merged = mergeBuddySources([sourceRef, "Static1Hazard.pdf"], "From Static1Hazard.pdf", [
      {
        id: "res_static",
        originalName: "Static1Hazard.pdf",
        title: "Static Hazard Notes",
      },
    ]);

    expect(merged).toEqual([sourceRef]);
    expect(getBuddySourceLabel(merged[0])).toBe("Static1Hazard.pdf");
  });

  it("prefers exact PDF highlight geometry over a generic inferred page pill", () => {
    const resources = [
      {
        id: "res_session",
        originalName: "Session 7_8.pdf",
        title: "Session 7_8.pdf",
        url: "/api/resources/res_session/file",
      },
    ];
    const page51Highlight = {
      boundingRect: { x1: 31, y1: 46, x2: 704, y2: 388, width: 720, height: 405, pageNumber: 51 },
      rects: [{ x1: 67, y1: 101, x2: 299, y2: 119, width: 720, height: 405, pageNumber: 51 }],
    };
    const merged = mergeBuddySources(
      [
        "Session 7_8.pdf",
        {
          type: "resource",
          label: "Session 7_8.pdf",
          resourceId: "res_session",
        },
        {
          type: "resource",
          label: "Session 7_8.pdf",
          resourceId: "res_session",
          pageNumber: 52,
          highlightPosition: {
            boundingRect: { x1: 31, y1: 46, x2: 704, y2: 388, width: 720, height: 405, pageNumber: 52 },
            rects: [{ x1: 31, y1: 101, x2: 647, y2: 119, width: 720, height: 405, pageNumber: 52 }],
          },
          score: 0.67,
        },
        {
          type: "resource",
          label: "Session 7_8.pdf",
          resourceId: "res_session",
          pageNumber: 51,
          highlightPosition: page51Highlight,
          textQuote: "Effective Annual Interest Rate uses compound interest.",
          score: 0.61,
        },
      ],
      "Based on Session 7_8.pdf (page 51), the Effective Annual Interest Rate is annualized using compound interest.",
      resources,
    );

    expect(merged).toEqual([
      expect.objectContaining({
        label: "Session 7_8.pdf",
        pageNumber: 51,
        highlightPosition: page51Highlight,
      }),
    ]);
  });

  it("keeps distinct channel-style source labels instead of treating them as URL fragments", () => {
    const messageSource = {
      type: "convolution_message",
      label: "#general source note",
      messageId: "msg_1",
    };
    const annotationSource = {
      type: "annotation",
      label: "#general annotation",
      annotationId: "ann_1",
    };

    expect(normalizeSourceKey("#general source note")).toBe("#general source note");
    expect(mergeBuddySources([messageSource, annotationSource], "", [])).toEqual([
      messageSource,
      annotationSource,
    ]);
  });

  it("separates provider-leaked tool-call JSON from visible answer text", () => {
    const result = extractBuddyToolCallsFromText(
      [
        "I need to inspect the Domain resources first.",
        "",
        '{ "action": "search_corpus", "action_input": { "query": "Orbital" } }',
        "",
        "Orbital is the project context mentioned in the notes.",
      ].join("\n"),
    );

    expect(result.preToolText).toBe("I need to inspect the Domain resources first.");
    expect(result.postToolText).toBe("Orbital is the project context mentioned in the notes.");
    expect(result.text).not.toContain("search_corpus");
    expect(result.toolCalls).toEqual([
      {
        event: "tool_start",
        tool: "search_corpus",
        input: { query: "Orbital" },
        status: "running",
      },
    ]);
  });
});
