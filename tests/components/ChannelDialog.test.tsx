import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelDialog } from "../../apps/client/src/features/room/chat/ChannelDialog.tsx";

const resources = [
  { id: "res-pdf", title: "Lecture 01.pdf", mimeType: "application/pdf" },
  {
    id: "res-docx",
    title: "Tutorial worksheet",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { id: "res-txt", title: "Plain notes.txt", mimeType: "text/plain" },
  { id: "res-image", title: "Diagram.png", mimeType: "image/png" },
  {
    id: "res-pptx",
    title: "Lecture slides.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { id: "res-jpeg", title: "Whiteboard.jpg", mimeType: "image/jpeg" },
  { id: "res-webp", title: "Concept map.webp", mimeType: "image/webp" },
  { id: "res-deleted", title: "Deleted.pdf", mimeType: "application/pdf", deletedAt: "2026-07-04T00:00:00.000Z" },
];

function renderDialog(overrides = {}) {
  return render(
    <ChannelDialog
      mode="channel"
      onCancel={vi.fn()}
      onCreateCategory={vi.fn()}
      onCreateChannel={vi.fn()}
      resources={resources}
      {...overrides}
    />,
  );
}

describe("ChannelDialog", () => {
  // Document channels must be selectable now, but they should only submit once
  // the owner has chosen a supported room document to anchor the channel.
  it("creates a document channel only after a supported resource is selected", async () => {
    const user = userEvent.setup();
    const onCreateChannel = vi.fn();
    renderDialog({ onCreateChannel });

    await user.type(screen.getByPlaceholderText("new-channel"), "Lecture Docs");
    await user.click(screen.getByRole("radio", { name: /document/i }));

    expect(screen.getByText("Link a Document")).toBeInTheDocument();
    expect(screen.getByText("Lecture 01.pdf")).toBeInTheDocument();
    expect(screen.getByText("Tutorial worksheet")).toBeInTheDocument();
    expect(screen.getByText("Lecture slides.pptx")).toBeInTheDocument();
    expect(screen.getByText("Diagram.png")).toBeInTheDocument();
    expect(screen.getByText("Whiteboard.jpg")).toBeInTheDocument();
    expect(screen.getByText("Concept map.webp")).toBeInTheDocument();
    expect(screen.queryByText("Plain notes.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("Deleted.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create channel$/i })).toBeDisabled();

    await user.click(screen.getByLabelText(/lecture 01\.pdf/i));
    expect(screen.getByRole("button", { name: /^create channel$/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /^create channel$/i }));

    expect(onCreateChannel).toHaveBeenCalledWith({
      name: "lecture-docs",
      type: "document",
      resourceId: "res-pdf",
    });
  });

  // The upload affordance keeps the owner from getting stuck when the room has
  // no compatible documents yet. The dialog itself delegates to RoomView's
  // existing upload path, so this test only verifies the callback wiring.
  it("offers document upload when no compatible resources are listed", async () => {
    const user = userEvent.setup();
    const onRequestUpload = vi.fn();
    renderDialog({ onRequestUpload, resources: [{ id: "res-txt", title: "Only text.txt", mimeType: "text/plain" }] });

    await user.click(screen.getByRole("radio", { name: /document/i }));
    expect(screen.getByText(/no pdf, docx, pptx, png, jpg, or webp resources/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /upload new document/i }));
    expect(onRequestUpload).toHaveBeenCalledTimes(1);
  });
});
