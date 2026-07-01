import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "../../apps/client/src/features/room/chat/ChatSidebar.tsx";
import { DEFAULT_CATEGORY_ID } from "../../apps/client/src/features/room/chat/chatLayout.ts";

const layout = [
  { id: DEFAULT_CATEGORY_ID, name: "Text Channels", channels: ["general", "lectures"] },
  { id: "cat-new", name: "New Cat", channels: ["labs"] },
];

function renderSidebar(overrides = {}) {
  return render(
    <ChatSidebar
      activeChannel="general"
      channelLayout={layout}
      drafts={{ lectures: "Remember to ask about MST." }}
      isOwner={false}
      onCreateCategory={vi.fn()}
      onCreateChannel={vi.fn()}
      onDeleteCategory={vi.fn()}
      onMoveChannel={vi.fn()}
      onRequestDeleteChannel={vi.fn()}
      onSelectChannel={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ChatSidebar", () => {
  // Non-owners should be able to read and enter channels, but they must not see
  // buttons that mutate room structure. This mirrors the product rule that only
  // the room owner manages categories and channels.
  it("hides channel and category mutation controls from non-owners", () => {
    renderSidebar({ isOwner: false });

    expect(screen.queryByRole("button", { name: /create channel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /text channels options/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /general options/i })).not.toBeInTheDocument();
  });

  // Owner-specific category controls should expose the same tooltip/menu
  // patterns as the rest of the app. This test hovers the create button,
  // verifies the New Channel tooltip, then opens the category menu and triggers
  // Delete Category for a non-default category.
  it("shows owner controls, tooltips, and category delete menu", async () => {
    const user = userEvent.setup();
    const onCreateChannel = vi.fn();
    const onDeleteCategory = vi.fn();

    renderSidebar({
      isOwner: true,
      onCreateChannel,
      onDeleteCategory,
    });

    const createButton = screen.getByRole("button", { name: /create channel in text channels/i });
    await user.hover(createButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("New Channel");

    await user.unhover(createButton);
    await user.click(createButton);
    expect(onCreateChannel).toHaveBeenCalledWith(DEFAULT_CATEGORY_ID);

    await user.click(screen.getByRole("button", { name: /new cat options/i }));
    await user.click(screen.getByRole("button", { name: /delete category/i }));
    expect(onDeleteCategory).toHaveBeenCalledWith("cat-new", "New Cat");
  });

  // Channel options should allow deleting regular channels while protecting the
  // required #general channel. The test opens both menus so a regression in
  // disabled state or callback wiring is caught.
  it("opens channel delete actions and protects the general channel", async () => {
    const user = userEvent.setup();
    const onRequestDeleteChannel = vi.fn();

    renderSidebar({
      isOwner: true,
      onRequestDeleteChannel,
    });

    await user.click(screen.getByRole("button", { name: /general options/i }));
    expect(screen.getByRole("button", { name: /delete channel/i })).toBeDisabled();

    await user.click(document.body);
    const lectureRow = screen.getByRole("button", { name: /^lectures$/i }).closest(".chat-channel-row");
    await user.click(within(lectureRow).getByRole("button", { name: /lectures options/i }));
    await user.click(screen.getByRole("button", { name: /delete channel/i }));

    expect(onRequestDeleteChannel).toHaveBeenCalledWith("lectures");
  });
});
