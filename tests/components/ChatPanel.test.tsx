import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../apps/client/src/features/room/chat/ChatPanel.tsx";

const defaultProps = {
  activeChannel: "general",
  channelLayout: [{ id: "text", name: "Text Channels", channels: ["general"] }],
  draft: "",
  drafts: {},
  onDeleteMessage: vi.fn(),
  onDraftChange: vi.fn(),
  onEditMessage: vi.fn(),
  onError: vi.fn(),
  onSelectChannel: vi.fn(),
  onSend: vi.fn(),
  onToggleStarredMessage: vi.fn(),
  onUploadFiles: vi.fn(),
  starredMessageIds: [],
  user: { email: "me@example.test", id: "me", name: "Current User" },
};

function renderChatPanel(overrides = {}) {
  return render(<ChatPanel {...defaultProps} {...overrides} />);
}

describe("ChatPanel", () => {
  it("renders image profile pictures from message sender metadata", () => {
    renderChatPanel({
      messages: [
        {
          body: "I have a profile photo.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-photo",
          sender: {
            avatarUrl: "data:image/png;base64,ZmFrZQ==",
            id: "photo-user",
            name: "Photo User",
          },
        },
      ],
    });

    expect(screen.getByAltText("Photo User profile picture")).toBeInTheDocument();
  });

  it("uses the current user's latest profile picture for own messages", () => {
    renderChatPanel({
      messages: [
        {
          body: "My sender payload is stale.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-own",
          sender: { avatarUrl: "", id: "me", name: "Old Name" },
        },
      ],
      user: {
        avatarUrl: "data:image/png;base64,bWVfcGhvdG8=",
        email: "me@example.test",
        id: "me",
        name: "Current User",
      },
    });

    expect(screen.getByAltText("Current User profile picture")).toBeInTheDocument();
  });

  it("falls back to initials instead of Limeets avatar presets in Convolution", () => {
    renderChatPanel({
      messages: [
        {
          body: "I use the avatar creator.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-avatar",
          sender: {
            avatarPreset: { selections: {} },
            id: "avatar-user",
            name: "Avatar User",
          },
        },
      ],
    });

    expect(screen.getByText("A")).toHaveClass("discord-avatar");
    expect(screen.queryByRole("img", { name: "Avatar User avatar" })).not.toBeInTheDocument();
  });
});
