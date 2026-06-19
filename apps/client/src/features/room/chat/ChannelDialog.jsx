import { FileText, Hash, MessageSquareText, MessagesSquare, X } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizeChannelName } from "./chatLayout.js";

const CHANNEL_TYPES = [
  {
    id: "text",
    label: "Text",
    description: "Send messages, files, and study updates.",
    icon: Hash,
    enabled: true,
  },
  {
    id: "forum",
    label: "Forum",
    description: "Post questions, get answers, learn from others. [NYI]",
    icon: MessagesSquare,
    enabled: false,
  },
  {
    id: "document",
    label: "Document",
    description: "Read, annotate, and discuss on documents. [NYI]",
    icon: FileText,
    enabled: false,
  },
];

/**
 * Discord-inspired channel/category creation dialog.
 *
 * Forum and document channels are visible to communicate the product direction,
 * but disabled so users cannot enter unfinished workflows.
 */
export function ChannelDialog({
  categoryName = "Text Channels",
  mode,
  onCancel,
  onCreateCategory,
  onCreateChannel,
}) {
  const [channelType, setChannelType] = useState("text");
  const [name, setName] = useState("");
  const normalizedName = mode === "channel" ? normalizeChannelName(name) : name.trim();
  const canSubmit = normalizedName.length > 0 && (mode === "category" || channelType === "text");

  const title = mode === "category" ? "Create Category" : "Create Channel";
  const subtitle =
    mode === "category" ? null : `in ${categoryName || "Text Channels"}`;

  const namePlaceholder = useMemo(
    () => (mode === "category" ? "New Category" : "new-channel"),
    [mode],
  );

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    if (mode === "category") {
      onCreateCategory(normalizedName);
      return;
    }

    onCreateChannel({
      name: normalizedName,
      type: channelType,
    });
  }

  return (
    <div className="modal-backdrop room-form-modal-backdrop" role="presentation">
      <form
        aria-labelledby="chat-channel-dialog-title"
        className="chat-create-dialog"
        onSubmit={handleSubmit}
        role="dialog"
      >
        <button
          aria-label="Close"
          className="chat-dialog-close"
          onClick={onCancel}
          type="button"
        >
          <X size={24} />
        </button>

        <header>
          <h2 id="chat-channel-dialog-title">{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>

        {mode === "channel" ? (
          <fieldset className="chat-channel-types">
            <legend>Channel Type</legend>
            {CHANNEL_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <label
                  aria-disabled={!type.enabled}
                  className={
                    type.enabled
                      ? "channel-type-option"
                      : "channel-type-option disabled is-disabled"
                  }
                  key={type.id}
                >
                  <input
                    checked={channelType === type.id}
                    disabled={!type.enabled}
                    name="channel-type"
                    onChange={() => setChannelType(type.id)}
                    type="radio"
                    value={type.id}
                  />
                  <span aria-hidden="true" className="channel-radio" />
                  <span className="channel-type-copy">
                    <span className="channel-type-title">
                      <Icon size={22} />
                      <strong>{type.label}</strong>
                    </span>
                    <small>{type.description}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        <label className="chat-dialog-field">
          <span>{mode === "category" ? "Category Name" : "Channel Name"}</span>
          <span className="chat-dialog-input">
            {mode === "channel" ? <Hash size={20} /> : <MessageSquareText size={19} />}
            <input
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              value={name}
            />
          </span>
        </label>

        <footer>
          <button className="secondary-button compact" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={!canSubmit} type="submit">
            {mode === "category" ? "Create Category" : "Create Channel"}
          </button>
        </footer>
      </form>
    </div>
  );
}
