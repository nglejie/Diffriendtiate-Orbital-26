import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResourceDriveSidebar } from "../../apps/client/src/features/room/resources/ResourceFileManager.tsx";

function renderSidebar(overrides = {}) {
  const drive = {
    activeView: "all",
    collapsedSectionIds: [],
    getQuickSectionEntries: () => [
      {
        id: "res-notes",
        kind: "file",
        name: "Notes.txt",
        resource: { id: "res-notes", title: "Notes.txt" },
      },
    ],
    openQuickItemMenu: vi.fn(),
    openQuickSectionMenu: vi.fn(),
    openSectionItemMenu: null,
    openSectionMenuId: "",
    quickItemMenuAnchor: null,
    quickMenuAnchor: null,
    quickSections: [{ id: "starred", name: "Starred", itemIds: ["res-notes"] }],
    removeItemFromSection: vi.fn(),
    removeQuickSection: vi.fn(),
    setActiveView: vi.fn(),
    setAddItemsSectionId: vi.fn(),
    setCurrentPath: vi.fn(),
    setFileFilter: vi.fn(),
    setOpenSectionItemMenu: vi.fn(),
    setOpenSectionMenuId: vi.fn(),
    setQuery: vi.fn(),
    setRenameSectionId: vi.fn(),
    setSectionDialogOpen: vi.fn(),
    toggleQuickSection: vi.fn(),
    openResource: vi.fn(),
    ...overrides,
  };

  return { drive, ...render(<ResourceDriveSidebar drive={drive} />) };
}

describe("ResourceDriveSidebar", () => {
  // Keeps Infilenite aligned with the Convolution sidebar pattern: route-like
  // actions use Title Case, while section controls use Quick Access.
  it("uses the shared quick access section layout", async () => {
    const user = userEvent.setup();
    const { drive } = renderSidebar();

    expect(screen.getByRole("button", { name: /^all files$/i })).toHaveTextContent("All Files");
    expect(screen.getByRole("button", { name: /^deleted files$/i })).toHaveTextContent("Deleted Files");
    const quickAccessToggle = screen.getByRole("button", { name: /^quick access$/i });
    expect(quickAccessToggle).toHaveAttribute("aria-expanded", "true");
    expect(Array.from(quickAccessToggle.children).map((child) => child.tagName.toLowerCase())).toEqual([
      "svg",
      "span",
    ]);
    expect(screen.getByRole("button", { name: /^starred$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add items to starred$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^starred options$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^notes\.txt$/i })).toBeInTheDocument();

    const starredToggle = screen.getByRole("button", { name: /^starred$/i });
    expect(Array.from(starredToggle.children).map((child) => child.tagName.toLowerCase())).toEqual([
      "svg",
      "span",
    ]);

    await user.click(quickAccessToggle);
    expect(quickAccessToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^starred$/i })).not.toBeInTheDocument();
    await user.click(quickAccessToggle);
    expect(quickAccessToggle).toHaveAttribute("aria-expanded", "true");

    const addSectionButton = screen.getByRole("button", { name: /^add section$/i });
    await user.hover(addSectionButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add Section");

    await user.unhover(addSectionButton);
    await user.click(addSectionButton);
    expect(drive.setSectionDialogOpen).toHaveBeenCalledWith(true);

    const addItemsButton = screen.getByRole("button", { name: /^add items to starred$/i });
    await user.hover(addItemsButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add Items");

    await user.click(addItemsButton);
    expect(drive.setAddItemsSectionId).toHaveBeenCalledWith("starred");
  });
});
