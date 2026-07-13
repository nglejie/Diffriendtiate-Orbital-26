import { describe, expect, it } from "vitest";
import {
  getPreviewCitationHighlight,
  getPreviewCitationHighlights,
  getPreviewFocusLabel,
  getPreviewHighlightPosition,
  getPreviewPageNumber,
  resourcePreviewUrl,
} from "../../apps/client/src/features/room/resources/ResourceFileManager.tsx";

describe("resource preview focus helpers", () => {
  const pdfResource = {
    fileUrl: "/api/resources/res_pdf/file",
    resourceType: "pdf",
  };

  it("keeps PDF source pills focused on cited pages", () => {
    expect(getPreviewPageNumber({ pageNumber: 49 })).toBe(49);
    expect(getPreviewFocusLabel({ pageNumber: 49 })).toBe("page 49");
    expect(resourcePreviewUrl(pdfResource, { pageNumber: 49 })).toBe("/api/resources/res_pdf/file#page=49");
  });

  it("uses slide numbers for converted presentation previews", () => {
    expect(getPreviewPageNumber({ slideNumber: 7 })).toBe(7);
    expect(getPreviewFocusLabel({ slideNumber: 7 })).toBe("slide 7");
    expect(resourcePreviewUrl(pdfResource, { slideNumber: 7 })).toBe("/api/resources/res_pdf/file#page=7");
  });

  it("does not append PDF fragments to non-PDF previews", () => {
    expect(resourcePreviewUrl({ fileUrl: "/api/resources/res_txt/file", resourceType: "txt" }, { pageNumber: 3 }))
      .toBe("/api/resources/res_txt/file");
  });

  it("uses backend PDF geometry when source refs include exact highlight positions", () => {
    const focus = {
      textQuote: "A cited sentence from the PDF.",
      highlightPosition: {
        boundingRect: { x1: 20, y1: 40, x2: 180, y2: 70, width: 600, height: 800, pageNumber: 12 },
        rects: [
          { x1: 20, y1: 40, x2: 180, y2: 70, width: 600, height: 800, pageNumber: 12 },
        ],
      },
    };

    expect(getPreviewPageNumber(focus)).toBe(12);
    expect(getPreviewHighlightPosition(focus)).toEqual(focus.highlightPosition);
    expect(getPreviewCitationHighlight(focus)).toMatchObject({
      content: { text: "A cited sentence from the PDF." },
      position: focus.highlightPosition,
      type: "text",
    });
    expect(getPreviewCitationHighlights(focus)).toEqual([
      expect.objectContaining({
        content: {},
        position: {
          boundingRect: focus.highlightPosition.rects[0],
          rects: [],
        },
        type: "area",
      }),
    ]);
  });

  it("rejects malformed PDF geometry instead of rendering arbitrary source payloads", () => {
    const focus = {
      pageNumber: 3,
      highlightPosition: {
        boundingRect: { x1: 20, y1: 40, x2: 10, y2: 70, width: 600, height: 800, pageNumber: 3 },
        rects: [{ x1: 20, y1: 40, x2: 10, y2: 70, width: 600, height: 800, pageNumber: 3 }],
      },
    };

    expect(getPreviewPageNumber(focus)).toBe(3);
    expect(getPreviewHighlightPosition(focus)).toBeNull();
    expect(getPreviewCitationHighlight(focus)).toBeNull();
    expect(getPreviewCitationHighlights(focus)).toEqual([]);
  });
});
