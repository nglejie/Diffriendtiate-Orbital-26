import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "../../apps/client/src/shared/ui/ConfirmDialog.tsx";
import TextInputDialog from "../../apps/client/src/shared/ui/TextInputDialog.tsx";

describe("shared room dialogs", () => {
  it("portals confirm dialogs to the document body", () => {
    const { container } = render(
      <div data-testid="sidebar-host">
        <ConfirmDialog
          confirmLabel="Delete"
          message="Delete this channel?"
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete Channel"
        />
      </div>,
    );

    expect(screen.getByRole("alertdialog", { name: "Delete Channel" })).toBeInTheDocument();
    expect(container.querySelector(".modal-backdrop")).toBeNull();
    expect(document.body.querySelector(".room-form-modal-backdrop")).toBeInTheDocument();
  });

  it("portals text input dialogs to the document body", () => {
    const { container } = render(
      <div data-testid="sidebar-host">
        <TextInputDialog
          confirmLabel="Rename"
          initialValue="general"
          label="Channel name"
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          placeholder="tutorials"
          title="Rename Channel"
        />
      </div>,
    );

    expect(screen.getByRole("textbox", { name: "Channel name" })).toBeInTheDocument();
    expect(container.querySelector(".modal-backdrop")).toBeNull();
    expect(document.body.querySelector(".room-form-modal-backdrop")).toBeInTheDocument();
  });
});
