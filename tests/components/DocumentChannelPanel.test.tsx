import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImageAnnotatorPanel } from "../../apps/client/src/features/room/chat/ImageAnnotatorPanel.tsx";
import { AnnotationSidebar } from "../../apps/client/src/features/room/chat/AnnotationSidebar.tsx";
import { DocumentAuthorAvatar } from "../../apps/client/src/features/room/chat/DocumentAuthorAvatar.tsx";
import { DocumentChannelPanel } from "../../apps/client/src/features/room/chat/DocumentChannelPanel.tsx";

const basePanelProps = {
  activeChannel: "lecture-slides",
  annotations: [],
  documentPresence: [],
  isOwner: false,
  onAddReply: async () => {},
  onCreateAnnotation: async () => {},
  onDeleteAnnotation: async () => {},
  onDeleteReply: async () => {},
  onError: () => {},
  onPageChange: () => {},
  onUpdateAnnotation: async () => {},
  resourceFileUrl: "/api/resources/res_slides/file",
  resourceId: "res_slides",
  resourceMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  resourcePdfUrl: "",
  resourceTitle: "Lecture Slides.pptx",
  resourceType: "pptx",
  resourceUrl: "/api/resources/res_slides/file",
  user: { email: "student@example.test", id: "user_1", name: "Student One" },
};

function dispatchPointerDragEvent(
  element: HTMLElement,
  type: "mousedown" | "mousemove" | "mouseup",
  clientX: number,
  clientY: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "clientX", { configurable: true, value: clientX });
  Object.defineProperty(event, "clientY", { configurable: true, value: clientY });
  Object.defineProperty(event, "offsetX", { configurable: true, value: clientX });
  Object.defineProperty(event, "offsetY", { configurable: true, value: clientY });
  fireEvent(element, event);
}

describe("DocumentAuthorAvatar", () => {
  it("renders uploaded profile pictures for annotation authors", () => {
    render(
      <DocumentAuthorAvatar
        author={{
          avatarUrl: "data:image/png;base64,ZmFrZQ==",
          id: "author-photo",
          name: "Photo Author",
        }}
      />,
    );

    expect(screen.getByAltText("Photo Author profile picture")).toBeInTheDocument();
  });

  it("uses the current user's latest profile picture for own annotations", () => {
    render(
      <DocumentAuthorAvatar
        author={{ avatarUrl: "", id: "me", name: "Old Name" }}
        currentUser={{
          avatarUrl: "data:image/png;base64,bWVfcGhvdG8=",
          email: "me@example.test",
          id: "me",
          name: "Current User",
        }}
      />,
    );

    expect(screen.getByAltText("Current User profile picture")).toBeInTheDocument();
  });

  it("falls back to the default initial avatar instead of the Limeets sprite", () => {
    render(
      <DocumentAuthorAvatar
        author={{
          avatarPreset: { selections: {} },
          id: "avatar-author",
          name: "Avatar Author",
        }}
      />,
    );

    expect(screen.getByText("A")).toHaveClass("document-annotation-avatar");
    expect(screen.queryByRole("img", { name: "Avatar Author avatar" })).not.toBeInTheDocument();
  });
});

describe("DocumentChannelPanel conversion states", () => {
  it("shows a PPTX conversion progress state while the server is still processing", () => {
    render(
      <DocumentChannelPanel
        {...basePanelProps}
        resourceConversionStatus="pending"
      />,
    );

    expect(screen.getAllByText("Lecture Slides.pptx").length).toBeGreaterThan(0);
    expect(screen.getByText(/converting this pptx into a pdf preview/i)).toBeInTheDocument();
  });

  it("shows a download fallback when PPTX conversion fails", () => {
    render(
      <DocumentChannelPanel
        {...basePanelProps}
        resourceConversionStatus="failed"
      />,
    );

    expect(screen.getByText(/could not convert this pptx into a pdf preview/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download original/i })).toHaveAttribute(
      "href",
      "/api/resources/res_slides/file",
    );
  });
});

describe("DocumentChannelPanel annotation sidebar", () => {
  it("filters annotation threads from the dropdown without emoji pills", async () => {
    const user = userEvent.setup();
    render(
      <DocumentChannelPanel
        {...basePanelProps}
        annotations={[
          {
            annotationType: "question",
            author: { id: "author-1", name: "Question Author" },
            channel: "lecture-slides",
            comment: "Why does this step work?",
            content: { text: "confusing step" },
            createdAt: "2026-07-04T10:00:00.000Z",
            id: "ann-question",
            position: { boundingRect: { y1: 20 }, pageNumber: 1 },
            replies: [],
            resolved: false,
            resourceId: "res_slides",
          },
          {
            annotationType: "key-point",
            author: { id: "author-2", name: "Key Author" },
            channel: "lecture-slides",
            comment: "This is the main formula.",
            content: { text: "main formula" },
            createdAt: "2026-07-04T11:00:00.000Z",
            id: "ann-key",
            position: { boundingRect: { y1: 10 }, pageNumber: 2 },
            replies: [],
            resolved: false,
            resourceId: "res_slides",
          },
        ]}
      />,
    );

    expect(screen.getByText("Why does this step work?")).toBeInTheDocument();
    expect(screen.getByText("This is the main formula.")).toBeInTheDocument();
    expect(screen.queryByText("Filter")).not.toBeInTheDocument();
    expect(screen.queryByText(/showing all/i)).not.toBeInTheDocument();
    expect(screen.queryByText("❓ Questions")).not.toBeInTheDocument();

    const filterSelect = screen.getByLabelText(/annotation filter/i);
    expect(filterSelect).toHaveClass("app-select-menu-button");

    await user.click(filterSelect);
    await user.click(screen.getByRole("option", { name: "Questions" }));

    expect(screen.getByText("Why does this step work?")).toBeInTheDocument();
    expect(screen.queryByText("This is the main formula.")).not.toBeInTheDocument();
  });

  it("opens an annotation thread and sends replies through the shared composer", async () => {
    const user = userEvent.setup();
    const onAddReply = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentChannelPanel
        {...basePanelProps}
        annotations={[
          {
            annotationType: "question",
            author: { id: "author-1", name: "Question Author" },
            channel: "lecture-slides",
            comment: "Why does this step work?",
            content: { text: "confusing step" },
            createdAt: "2026-07-04T10:00:00.000Z",
            id: "ann-question",
            position: { boundingRect: { y1: 20 }, pageNumber: 1 },
            replies: [],
            resolved: false,
            resourceId: "res_slides",
          },
        ]}
        onAddReply={onAddReply}
      />,
    );

    await user.click(screen.getByRole("button", { name: /why does this step work/i }));
    expect(screen.queryByRole("button", { name: /^reply$/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/reply to question/i), "It follows from the theorem.");
    await user.click(screen.getByRole("button", { name: /send reply/i }));

    expect(onAddReply).toHaveBeenCalledWith(
      "ann-question",
      expect.stringContaining("It follows from the theorem."),
    );
  });

  it("jumps to an annotation anchor from the preview card while showing neutral reply counts", async () => {
    const user = userEvent.setup();
    const onJumpToAnnotation = vi.fn();

    render(
      <AnnotationSidebar
        activeChannel="lecture-slides"
        annotations={[
          {
            annotationType: "insight",
            author: { id: "author-1", name: "Question Author" },
            channel: "lecture-slides",
            comment: "This is a TOC!",
            content: {},
            createdAt: "2026-07-04T10:00:00.000Z",
            id: "ann-insight",
            position: {},
            replies: [
              {
                author: { id: "user_1", name: "Student One" },
                comment: "First reply",
                createdAt: "2026-07-04T10:02:00.000Z",
                id: "reply-1",
              },
              {
                author: { id: "user_2", name: "Student Two" },
                comment: "Second reply",
                createdAt: "2026-07-04T10:03:00.000Z",
                id: "reply-2",
              },
            ],
            resourceId: "res_slides",
            resolved: false,
          },
        ]}
        currentUser={{ email: "student@example.test", id: "user_1", name: "Student One" }}
        onAddReply={async () => {}}
        onDeleteAnnotation={async () => {}}
        onDeleteReply={async () => {}}
        onError={() => {}}
        onJumpToAnnotation={onJumpToAnnotation}
        onUpdateAnnotation={async () => {}}
        resourceId="res_slides"
      />,
    );

    expect(screen.getByText("2 Replies")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reply$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /this is a toc/i }));

    expect(onJumpToAnnotation).toHaveBeenCalledWith("ann-insight");
    expect(screen.getByRole("button", { name: "Back To Annotations" })).toBeInTheDocument();
  });

  it("uses custom tooltip labels for annotation thread icon buttons and timestamps", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DocumentChannelPanel
        {...basePanelProps}
        annotations={[
          {
            annotationType: "question",
            author: { id: "author-1", name: "Question Author" },
            channel: "lecture-slides",
            comment: "Why does this step work?",
            content: { text: "confusing step" },
            createdAt: "2026-07-04T10:00:00.000Z",
            id: "ann-question",
            position: { boundingRect: { y1: 20 }, pageNumber: 1 },
            replies: [],
            resolved: false,
            resourceId: "res_slides",
          },
        ]}
        isOwner
        onJumpToAnnotation={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /why does this step work/i }));

    expect(screen.getByRole("button", { name: "Back To Annotations" })).toHaveAttribute(
      "data-tooltip",
      "Back To Annotations",
    );
    expect(screen.getByRole("button", { name: "Mark Resolved" })).toHaveAttribute(
      "data-tooltip",
      "Mark Resolved",
    );
    expect(screen.getByRole("button", { name: "Delete Annotation" })).toHaveAttribute(
      "data-tooltip",
      "Delete Annotation",
    );
    expect(screen.getByRole("button", { name: "Jump To Annotation" })).toHaveAttribute(
      "data-tooltip",
      "Jump To Annotation",
    );

    const threadTimestamp = container.querySelector(".document-annotation-thread .document-message-time");
    expect(threadTimestamp).not.toHaveAttribute("title");
    expect(threadTimestamp).toHaveAttribute("data-tooltip", expect.stringContaining("2026"));
  });

  it("opens an annotation thread and deletes a reply when the user owns it", async () => {
    const user = userEvent.setup();
    const onDeleteReply = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentChannelPanel
        {...basePanelProps}
        annotations={[
          {
            annotationType: "question",
            author: { id: "author-1", name: "Question Author" },
            channel: "lecture-slides",
            comment: "Why does this step work?",
            content: { text: "confusing step" },
            createdAt: "2026-07-04T10:00:00.000Z",
            id: "ann-question",
            position: { boundingRect: { y1: 20 }, pageNumber: 1 },
            replies: [
              {
                author: { id: "user_1", name: "Student One" },
                comment: "This is my reply.",
                createdAt: "2026-07-04T10:02:00.000Z",
                id: "reply-owned",
              },
            ],
            resolved: false,
            resourceId: "res_slides",
          },
        ]}
        onDeleteReply={onDeleteReply}
      />,
    );

    await user.click(screen.getByRole("button", { name: /why does this step work/i }));
    await user.click(screen.getByRole("button", { name: /delete reply/i }));

    expect(onDeleteReply).toHaveBeenCalledWith("ann-question", "reply-owned");
  });
});

describe("DocumentChannelPanel annotation composer", () => {
  it("saves a typed annotation from the PDF selection tip", async () => {
    const user = userEvent.setup();
    const onCreateAnnotation = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentChannelPanel
        {...basePanelProps}
        onCreateAnnotation={onCreateAnnotation}
        resourceConversionStatus="not-needed"
        resourceMimeType="application/pdf"
        resourcePdfUrl="/uploads/document-smoke.pdf"
        resourceTitle="document-smoke.pdf"
        resourceType="pdf"
        resourceUrl="/uploads/document-smoke.pdf"
      />,
    );

    const tip = within(screen.getByTestId("selection-tip"));
    await user.click(tip.getByLabelText(/annotation type/i));
    await user.click(screen.getByRole("option", { name: "Question" }));
    await user.type(tip.getByLabelText(/add context for this annotation/i), "Can someone explain this paragraph?");
    await user.click(tip.getByRole("button", { name: /save annotation/i }));

    expect(onCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationType: "question",
        channel: "lecture-slides",
        comment: expect.stringContaining("Can someone explain this paragraph?"),
        content: { text: "Document channel smoke test" },
        resourceId: "res_slides",
      }),
    );
  });
});

describe("ImageAnnotatorPanel", () => {
  it("creates a percentage-based image annotation from a drawn rectangle", async () => {
    const user = userEvent.setup();
    const onCreateAnnotation = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ImageAnnotatorPanel
        {...basePanelProps}
        onCreateAnnotation={onCreateAnnotation}
        resourceMimeType={undefined}
        resourceTitle="Diagram.webp"
        resourceType={undefined}
        resourceUrl="/uploads/diagram.webp"
      />,
    );

    const image = screen.getByAltText("Diagram.webp") as HTMLImageElement;
    Object.defineProperty(image, "offsetWidth", { configurable: true, value: 400 });
    Object.defineProperty(image, "offsetHeight", { configurable: true, value: 300 });
    image.getBoundingClientRect = () =>
      ({
        bottom: 300,
        height: 300,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    const overlay = container.querySelector(".image-annotation-overlay") as HTMLElement;
    dispatchPointerDragEvent(overlay, "mousedown", 40, 30);
    dispatchPointerDragEvent(overlay, "mousemove", 200, 150);
    dispatchPointerDragEvent(overlay, "mouseup", 200, 150);

    await user.click(screen.getByLabelText(/annotation type/i));
    await user.click(screen.getByRole("option", { name: "Insight" }));
    await user.type(screen.getByLabelText(/add context for this region/i), "This diagram needs a note.");
    await user.click(screen.getByRole("button", { name: /save annotation/i }));

    expect(onCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationType: "insight",
        channel: "lecture-slides",
        comment: expect.stringContaining("This diagram needs a note."),
        content: {},
        position: expect.objectContaining({
          height: 0.4,
          pageNumber: 1,
          width: 0.4,
          x: 0.1,
          y: 0.1,
        }),
        resourceId: "res_slides",
      }),
    );
  });

  it("keeps the image annotation composer inside the overlay near edges", () => {
    const { container } = render(
      <ImageAnnotatorPanel
        {...basePanelProps}
        resourceMimeType={undefined}
        resourceTitle="Diagram.webp"
        resourceType={undefined}
        resourceUrl="/uploads/diagram.webp"
      />,
    );

    const image = screen.getByAltText("Diagram.webp") as HTMLImageElement;
    Object.defineProperty(image, "offsetWidth", { configurable: true, value: 400 });
    Object.defineProperty(image, "offsetHeight", { configurable: true, value: 300 });
    image.getBoundingClientRect = () =>
      ({
        bottom: 300,
        height: 300,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    const overlay = container.querySelector(".image-annotation-overlay") as HTMLElement;
    Object.defineProperty(overlay, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(overlay, "clientHeight", { configurable: true, value: 300 });

    dispatchPointerDragEvent(overlay, "mousedown", 350, 240);
    dispatchPointerDragEvent(overlay, "mousemove", 390, 280);
    dispatchPointerDragEvent(overlay, "mouseup", 390, 280);

    const popover = container.querySelector(".image-annotation-create-popover") as HTMLElement;
    expect(popover).toBeInTheDocument();
    expect(popover.style.left).toBe("58px");
    expect(popover.style.top).toBe("60px");
    expect(Number.parseFloat(popover.style.left) + 280).toBeLessThanOrEqual(388);
    expect(Number.parseFloat(popover.style.top) + 220).toBeLessThanOrEqual(288);
  });

  it("lets the image annotation composer handle wheel scrolling without zooming the image", () => {
    const { container } = render(
      <ImageAnnotatorPanel
        {...basePanelProps}
        resourceMimeType={undefined}
        resourceTitle="Diagram.webp"
        resourceType={undefined}
        resourceUrl="/uploads/diagram.webp"
      />,
    );

    const image = screen.getByAltText("Diagram.webp") as HTMLImageElement;
    Object.defineProperty(image, "offsetWidth", { configurable: true, value: 400 });
    Object.defineProperty(image, "offsetHeight", { configurable: true, value: 300 });
    image.getBoundingClientRect = () =>
      ({
        bottom: 300,
        height: 300,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    const overlay = container.querySelector(".image-annotation-overlay") as HTMLElement;
    dispatchPointerDragEvent(overlay, "mousedown", 40, 30);
    dispatchPointerDragEvent(overlay, "mousemove", 200, 150);
    dispatchPointerDragEvent(overlay, "mouseup", 200, 150);

    const popover = container.querySelector(".image-annotation-create-popover") as HTMLElement;
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.wheel(popover, { deltaY: 120 });

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText("90%")).not.toBeInTheDocument();
  });

  it("labels image toolbar controls and exposes a resizable annotations panel", () => {
    render(
      <ImageAnnotatorPanel
        {...basePanelProps}
        resourceMimeType={undefined}
        resourceTitle="Diagram.webp"
        resourceType={undefined}
        resourceUrl="/uploads/diagram.webp"
      />,
    );

    expect(screen.getByRole("button", { name: "Fit To View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Original" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize Annotations Panel" })).toBeInTheDocument();
  });
});
