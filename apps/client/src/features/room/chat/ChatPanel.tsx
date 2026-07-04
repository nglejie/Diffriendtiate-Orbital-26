import { ArrowUp, Check, Copy, Edit3, Hash, Paperclip, Plus, Send, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { UPLOADS_FOLDER } from "../roomConstants.ts";
import { formatTimeOnly, getInitial, resourceToAttachment } from "../../../shared/utils/room.ts";
import { DRAFTS_VIEW_ID, getCategoryNameForChannel } from "./chatLayout.ts";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function getSenderKey(message) {
  return message.sender?.id || message.sender?.email || message.sender?.name || "unknown";
}

function isGroupedWithPrevious(message, previousMessage) {
  if (!previousMessage) return false;
  if (getSenderKey(message) !== getSenderKey(previousMessage)) return false;

  const currentTime = new Date(message.createdAt || 0).getTime();
  const previousTime = new Date(previousMessage.createdAt || 0).getTime();
  return Number.isFinite(currentTime) && currentTime - previousTime <= GROUP_WINDOW_MS;
}

/**
 * Text-channel chat surface.
 *
 * Forum and document channels are intentionally not implemented here yet; this
 * keeps the working messaging path reliable while the product direction remains
 * visible in the sidebar.
 */
export function ChatPanel({
  activeChannel,
  draft,
  drafts,
  channelLayout,
  messages,
  onDraftChange,
  onDeleteMessage,
  onEditMessage,
  onError,
  onSelectChannel,
  onSend,
  onToggleStarredMessage,
  onUploadFiles,
  starredMessageIds,
  user,
}) {
  const [attachments, setAttachments] = useState([]);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef(null);
  const messageListRef = useRef(null);

  // Keep the chat panel resilient to stale room state persisted by older UI
  // builds. These guards prevent one malformed local value from crashing Convolution.
  const safeDraft = typeof draft === "string" ? draft : "";
  const safeDrafts: Record<string, string> =
    drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
  const safeChannelLayout = Array.isArray(channelLayout) ? channelLayout : [];
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeStarredMessageIds = Array.isArray(starredMessageIds) ? starredMessageIds : [];

  const visibleDrafts = useMemo(
    () =>
      Object.entries(safeDrafts)
        .filter(([, body]) => typeof body === "string" && body.trim())
        .map(([channel, body]) => ({
          channel,
          body,
          category: getCategoryNameForChannel(safeChannelLayout, channel),
        })),
    [safeChannelLayout, safeDrafts],
  );

  const channelMessages = useMemo(
    () => safeMessages.filter((message) => (message.channel || "general") === activeChannel),
    [activeChannel, safeMessages],
  );

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight });
  }, [channelMessages.length, activeChannel, visibleDrafts.length]);

  function addAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setAttachments((current) => [...current, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(indexToRemove) {
    setAttachments((current) => current.filter((_file, index) => index !== indexToRemove));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const body = safeDraft.trim();
    if (!body && !attachments.length) return;

    setSending(true);
    try {
      const uploaded = attachments.length
        ? await onUploadFiles(attachments, UPLOADS_FOLDER)
        : [];

      await onSend(body, {
        channel: activeChannel,
        attachments: uploaded.map(resourceToAttachment),
      });

      onDraftChange(activeChannel, "");
      setAttachments([]);
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard?.writeText(message.body || "");
    } catch {
      onError("Unable to copy message.");
    }
  }

  function beginEditing(message) {
    setEditingMessageId(message.id);
    setEditingBody(message.body || "");
  }

  async function saveEditedMessage(message) {
    const body = editingBody.trim();
    if (!body) {
      onError("Message cannot be empty.");
      return;
    }

    try {
      await onEditMessage(message.id, body);
      setEditingMessageId("");
      setEditingBody("");
    } catch (err) {
      onError(err.message);
    }
  }

  /** Deletes the user's own message through RoomView so socket errors surface cleanly. */
  async function deleteMessage(message) {
    try {
      await onDeleteMessage(message.id);
    } catch (err) {
      onError(err.message);
    }
  }

  if (activeChannel === DRAFTS_VIEW_ID) {
    return (
      <section className="discord-chat-surface">
        <header className="discord-chat-header">
          <div>
            <Send size={22} />
            <span>Drafts</span>
          </div>
        </header>

        <div className="discord-message-list drafts-content" ref={messageListRef}>
          {visibleDrafts.length ? (
            visibleDrafts.map((item) => (
              <button
                className="draft-preview-row"
                key={item.channel}
                onClick={() => onSelectChannel(item.channel)}
                type="button"
              >
                <span className="draft-channel-icon">
                  <Hash size={18} />
                </span>
                <span>
                  <strong>#{item.channel}</strong>
                  <small>{item.category}</small>
                  <em>{item.body}</em>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-drafts-state">
              <h2>No drafts</h2>
              <p>Unsent messages will appear here so you can pick them back up later.</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="discord-chat-surface">
      <header className="discord-chat-header">
        <div>
          <Hash size={24} />
          <span>{activeChannel}</span>
        </div>
        <label className="discord-chat-search" title="Search will be enabled later">
          <input disabled placeholder="Search disabled for now" type="search" />
        </label>
      </header>

      <div className="discord-message-list" ref={messageListRef}>
        <div className="discord-channel-welcome">
          <div className="welcome-icon">
            <Hash size={36} />
          </div>
          <h2>Welcome to #{activeChannel}!</h2>
          <p>This is the start of the #{activeChannel} channel.</p>
        </div>

        {channelMessages.map((message, index) => {
          const previous = channelMessages[index - 1];
          const grouped = isGroupedWithPrevious(message, previous);
          const previousWasGrouped = isGroupedWithPrevious(previous, channelMessages[index - 2]);
          const firstGroupedMessage = grouped && !previousWasGrouped;
          const isOwnMessage = message.sender?.id === user?.id;
          const senderName = isOwnMessage
            ? user?.name || message.sender?.name || user?.email || "You"
            : message.sender?.name || "Unknown";
          const starred = safeStarredMessageIds.includes(message.id);
          const editing = editingMessageId === message.id;

          return (
            <article
              className={[
                "discord-message",
                grouped ? "grouped" : "",
                firstGroupedMessage ? "first-grouped" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={message.id}
            >
              {grouped ? (
                <time className="discord-message-compact-time">
                  {formatTimeOnly(message.createdAt)}
                </time>
              ) : (
                <div className="discord-avatar">
                  {getInitial(message.sender?.name || message.sender?.email || "U")}
                </div>
              )}

              <div className="discord-message-content">
                {!grouped ? (
                  <div className="discord-message-meta">
                    <strong className={isOwnMessage ? "own-author" : ""}>{senderName}</strong>
                    <time>{formatTimeOnly(message.createdAt)}</time>
                  </div>
                ) : null}

                {editing ? (
                  <div className="discord-message-editor">
                    <textarea
                      autoFocus
                      onChange={(event) => setEditingBody(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          saveEditedMessage(message);
                        }
                        if (event.key === "Escape") {
                          setEditingMessageId("");
                          setEditingBody("");
                        }
                      }}
                      rows={3}
                      value={editingBody}
                    />
                    <div>
                      <button
                        onClick={() => {
                          setEditingMessageId("");
                          setEditingBody("");
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button onClick={() => saveEditedMessage(message)} type="button">
                        <Check size={15} />
                        Save
                      </button>
                    </div>
                  </div>
                ) : message.body ? (
                  <p>{message.body}</p>
                ) : null}

                {message.attachments?.length ? (
                  <div className="discord-attachments">
                    {message.attachments.map((attachment) => (
                      <a
                        href={attachment.url}
                        key={attachment.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Paperclip size={14} />
                        {attachment.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="discord-message-actions">
                <button
                  aria-label={starred ? "Unstar message" : "Star message"}
                  onClick={() => onToggleStarredMessage(message)}
                  title={starred ? "Unstar message" : "Star message"}
                  type="button"
                >
                  <Star fill={starred ? "currentColor" : "none"} size={16} />
                </button>
                <button
                  aria-label="Copy message"
                  onClick={() => copyMessage(message)}
                  title="Copy message"
                  type="button"
                >
                  <Copy size={16} />
                </button>
                {isOwnMessage ? (
                  <>
                    <button
                      aria-label="Edit message"
                      onClick={() => beginEditing(message)}
                      title="Edit message"
                      type="button"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      aria-label="Delete message"
                      onClick={() => deleteMessage(message)}
                      title="Delete message"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {attachments.length ? (
        <div className="discord-composer-attachments">
          {attachments.map((file, index) => (
            <button
              key={`${file.name}-${file.size}-${index}`}
              onClick={() => removeAttachment(index)}
              title="Remove attachment"
              type="button"
            >
              <Paperclip size={13} />
              <span>{file.name}</span>
              <X size={13} />
            </button>
          ))}
        </div>
      ) : null}

      <form className="discord-composer" onSubmit={handleSubmit}>
        <input
          multiple
          onChange={(event) => addAttachments(event.target.files)}
          ref={fileInputRef}
          type="file"
        />
        <button
          aria-label="Attach files"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Plus size={22} />
        </button>
        <textarea
          onChange={(event) => onDraftChange(activeChannel, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={`Message #${activeChannel}`}
          rows={1}
          value={safeDraft}
        />
        <button
          aria-label="Send message"
          disabled={sending || (!safeDraft.trim() && !attachments.length)}
          type="submit"
        >
          <ArrowUp size={19} strokeWidth={2.4} />
        </button>
      </form>
    </section>
  );
}
