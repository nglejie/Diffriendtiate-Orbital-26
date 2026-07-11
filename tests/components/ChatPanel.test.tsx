import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../apps/client/src/features/room/chat/ChatPanel.tsx";
import { DRAFTS_VIEW_ID } from "../../apps/client/src/features/room/chat/chatLayout.ts";

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

  it("renders rich text formatting in text channel messages", () => {
    renderChatPanel({
      messages: [
        {
          body: "<p><strong>Bold note</strong> and <s>done</s></p><ul><li>First item</li></ul>",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-rich",
          sender: { id: "rich-user", name: "Rich User" },
        },
      ],
    });

    expect(screen.getByText("Bold note").tagName.toLowerCase()).toBe("strong");
    expect(["s", "del"]).toContain(screen.getByText("done").tagName.toLowerCase());
    expect(screen.getByText("First item").tagName.toLowerCase()).toBe("li");
  });

  it("renders date dividers, timestamp tooltips, and edited markers", () => {
    const { container } = renderChatPanel({
      messages: [
        {
          body: "Older message.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-old",
          sender: { id: "date-user", name: "Date User" },
        },
        {
          body: "Updated message.",
          channel: "general",
          createdAt: "2026-07-05T10:00:00.000Z",
          id: "msg-edited",
          sender: { id: "date-user", name: "Date User" },
          updatedAt: "2026-07-05T10:04:00.000Z",
        },
      ],
    });

    expect(container.querySelectorAll(".discord-date-divider span")).toHaveLength(2);
    expect(screen.getByText("Updated message.")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toHaveClass("discord-edited-indicator");
    const messageTimestamps = container.querySelectorAll(".discord-message-meta .document-message-time");
    expect(messageTimestamps.length).toBeGreaterThan(0);
    expect(messageTimestamps[0]).not.toHaveAttribute("title");
    expect(messageTimestamps[0]).toHaveAttribute("data-tooltip", expect.stringContaining("2026"));
    expect(messageTimestamps[0]?.querySelector(".document-message-time-tooltip")).not.toBeInTheDocument();
  });

  it("renders consecutive messages with compact timestamp rails", () => {
    const { container } = renderChatPanel({
      messages: [
        {
          body: "First message.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-first",
          sender: { id: "compact-user", name: "Compact User" },
        },
        {
          body: "Follow-up message.",
          channel: "general",
          createdAt: "2026-07-04T10:01:00.000Z",
          id: "msg-follow-up",
          sender: { id: "compact-user", name: "Compact User" },
        },
      ],
    });

    const groupedMessage = screen.getByText("Follow-up message.").closest(".discord-message");
    expect(groupedMessage).toHaveClass("grouped");
    expect(groupedMessage?.querySelector(".discord-message-compact-time")).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("2026"),
    );
    expect(container.querySelectorAll(".discord-avatar")).toHaveLength(1);
  });

  it("renders document and image attachments as clean attachment cards", () => {
    const { container } = renderChatPanel({
      messages: [
        {
          body: "Sharing files.",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-files",
          sender: { id: "file-user", name: "File User" },
          attachments: [
            {
              id: "doc-1",
              size: 15920,
              title: "Programme Overview 26.pdf",
              type: "application/pdf",
              url: "https://example.test/programme.pdf",
            },
            {
              id: "img-1",
              size: 2048,
              title: "Mascot.png",
              type: "image/png",
              url: "https://example.test/mascot.png",
            },
          ],
        },
      ],
    });

    expect(screen.getByRole("link", { name: /Programme Overview 26\.pdf/i })).toHaveClass(
      "discord-attachment-card",
    );
    expect(screen.getByRole("link", { name: /Mascot\.png/i })).toHaveClass(
      "discord-attachment-card",
      "image",
    );
    expect(container.querySelector(".discord-attachment-thumb.image img")).toBeInTheDocument();
  });

  it("preserves legacy Markdown message rendering", () => {
    renderChatPanel({
      messages: [
        {
          body: "**Bold note** and ~~done~~\n\n- First item",
          channel: "general",
          createdAt: "2026-07-04T10:00:00.000Z",
          id: "msg-markdown",
          sender: { id: "markdown-user", name: "Markdown User" },
        },
      ],
    });

    expect(screen.getByText("Bold note").tagName.toLowerCase()).toBe("strong");
    expect(screen.getByText("done").tagName.toLowerCase()).toBe("del");
    expect(screen.getByText("First item").tagName.toLowerCase()).toBe("li");
  });

  it("uses a live rich text editor for continuous formatting", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("Message #general"), "Live bold");

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe("general");
      expect(lastCall?.[1]).toContain("<strong>Live bold</strong>");
    });
  });

  it("sends rich formatted messages with Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onUploadFiles = vi.fn().mockResolvedValue([]);

    renderChatPanel({ onSend, onUploadFiles });

    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.type(screen.getByLabelText("Message #general"), "Bold enter");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        expect.stringContaining("<strong>Bold enter</strong>"),
        expect.objectContaining({ channel: "general" }),
      );
    });
  });

  it("continues ordered list items inside the editor", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByLabelText("Message #general"));
    await user.click(screen.getByRole("button", { name: "Ordered List" }));
    await user.keyboard("First");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("Second");

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toContain("<ol>");
      expect(lastCall?.[1]).toContain("<li><p>First</p></li>");
      expect(lastCall?.[1]).toContain("<li><p>Second</p></li>");
    });
  });

  it("applies ordered lists only to the current soft line", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByLabelText("Message #general"));
    await user.keyboard("Plain intro");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("List item");
    await user.click(screen.getByRole("button", { name: "Ordered List" }));

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toContain("<p>Plain intro</p>");
      expect(lastCall?.[1]).toContain("<ol>");
      expect(lastCall?.[1]).toContain("<li><p>List item</p></li>");
      expect(lastCall?.[1]).not.toContain("<li><p>Plain intro");
    });
  });

  it("applies bulleted lists only to the current soft line", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByLabelText("Message #general"));
    await user.keyboard("Plain intro");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("Bullet item");
    await user.click(screen.getByRole("button", { name: "Bulleted List" }));

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toContain("<p>Plain intro</p>");
      expect(lastCall?.[1]).toContain("<ul>");
      expect(lastCall?.[1]).toContain("<li><p>Bullet item</p></li>");
      expect(lastCall?.[1]).not.toContain("<li><p>Plain intro");
    });
  });

  it("applies code blocks only to the current soft line", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByLabelText("Message #general"));
    await user.keyboard("Plain intro");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("const value = 1;");
    await user.click(screen.getByRole("button", { name: "Code Block" }));

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toContain("<p>Plain intro</p>");
      expect(lastCall?.[1]).toContain("<pre><code>const value = 1;</code></pre>");
      expect(lastCall?.[1]).not.toContain("<pre><code>Plain intro");
    });
  });

  it("opens a real link dialog and inserts the saved link", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();

    renderChatPanel({ onDraftChange });

    await user.click(screen.getByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Link" });
    expect(dialog).toHaveClass("room-profile-editor");
    expect(dialog).toHaveClass("small-settings-dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Course Site");
    await user.type(within(dialog).getByLabelText("Link"), "example.edu");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const lastCall = onDraftChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toContain('href="https://example.edu"');
      expect(lastCall?.[1]).toContain("Course Site");
    });
  });

  it("opens a searchable emoji picker and closes it on outside click", async () => {
    const user = userEvent.setup();

    renderChatPanel();

    await user.click(screen.getByRole("button", { name: "Emoji" }));
    expect(document.body.querySelector(".discord-emoji-picker.portal")).toBeInTheDocument();
    expect(document.body.querySelector(".EmojiPickerReact")).toBeInTheDocument();

    await user.click(screen.getByText("Welcome to #general!"));
    expect(document.body.querySelector(".EmojiPickerReact")).not.toBeInTheDocument();
  });

  it("opens member suggestions from the mention button", async () => {
    const user = userEvent.setup();

    renderChatPanel({
      members: [
        { email: "current@example.test", id: "me", name: "Current User" },
        {
          avatarUrl: "data:image/png;base64,bGVqaWU=",
          email: "lejie@example.test",
          id: "member-2",
          name: "Le Jie",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Mention" }));

    expect(await screen.findByText("Le Jie")).toBeInTheDocument();
    expect(screen.getByText("lejie@example.test")).toBeInTheDocument();
    expect(screen.getByAltText("Le Jie profile picture")).toBeInTheDocument();
  });

  it("adds custom tooltip labels to composer controls", () => {
    renderChatPanel();

    expect(screen.getByRole("button", { name: "Attach Files" })).toHaveAttribute(
      "data-tooltip",
      "Attach Files",
    );
    expect(screen.getByRole("button", { name: "Send message" })).toHaveAttribute(
      "data-tooltip",
      "Send Message",
    );
  });

  it("renders the Drafts view without touching the rich text editor schema", () => {
    renderChatPanel({
      activeChannel: DRAFTS_VIEW_ID,
      drafts: {
        general: "<p>Saved <strong>draft</strong> text</p>",
      },
    });

    expect(screen.getByRole("button", { name: /#general/i })).toBeInTheDocument();
    expect(screen.getByText("Saved draft text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message #__drafts__")).not.toBeInTheDocument();
  });
});
