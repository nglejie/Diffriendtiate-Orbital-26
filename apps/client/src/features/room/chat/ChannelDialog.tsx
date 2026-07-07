import { FileText, Hash, MessageSquareText, MessagesSquare, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeChannelName } from "./chatLayout.ts";

type Resource = {
  id: string;
  title?: string;
  originalName?: string;
  mimeType?: string;
  deletedAt?: string;
};

type ChannelDialogProps = {
  categoryName?: string;
  mode: "category" | "channel";
  onCancel: () => void;
  onCreateCategory: (name: string) => void;
  onCreateChannel: (payload: { name: string; type: string; resourceId: string }) => void;
  onRequestUpload?: () => void;
  resources?: Resource[];
};

const DOCUMENT_RESOURCE_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|webp)$/i;

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
    description: "Read, annotate, and discuss on documents.",
    icon: FileText,
    enabled: true,
  },
];

function isDocumentResource(resource: Resource) {
  const mimeType = String(resource?.mimeType || "").toLowerCase();
  const title = String(resource?.title || resource?.originalName || "").toLowerCase();

  return (
    !resource?.deletedAt &&
    (mimeType.includes("pdf") ||
      mimeType.includes("docx") ||
      mimeType.includes("pptx") ||
      mimeType.includes("wordprocessingml") ||
      mimeType.includes("presentationml") ||
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/webp" ||
      DOCUMENT_RESOURCE_EXTENSIONS.test(title))
  );
}

function getResourceTitle(resource: Resource) {
  return String(resource?.title || resource?.originalName || "Untitled document").trim();
}

/**
 * Discord-inspired channel/category creation dialog.
 *
 * Forum channels are still visible for product direction; document channels can
 * link a room resource so the next Convolution surface has a stable source.
 */
export function ChannelDialog({
  categoryName = "Text Channels",
  mode,
  onCancel,
  onCreateCategory,
  onCreateChannel,
  onRequestUpload,
  resources = [],
}: ChannelDialogProps) {
  const [channelType, setChannelType] = useState("text");
  const [linkedResourceId, setLinkedResourceId] = useState("");
  const [name, setName] = useState("");
  const documentResources = useMemo(
    () => resources.filter(isDocumentResource),
    [resources],
  );
  const normalizedName = mode === "channel" ? normalizeChannelName(name) : name.trim();
  const needsLinkedResource = mode === "channel" && channelType === "document";
  const canSubmit =
    normalizedName.length > 0 &&
    (mode === "category" || channelType === "text" || (channelType === "document" && Boolean(linkedResourceId)));

  const title = mode === "category" ? "Create Category" : "Create Channel";
  const subtitle =
    mode === "category" ? null : `in ${categoryName || "Text Channels"}`;

  const namePlaceholder = useMemo(
    () => (mode === "category" ? "New Category" : "new-channel"),
    [mode],
  );

  useEffect(() => {
    if (!linkedResourceId) return;
    if (!documentResources.some((resource) => resource.id === linkedResourceId)) {
      setLinkedResourceId("");
    }
  }, [documentResources, linkedResourceId]);

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
      resourceId: channelType === "document" ? linkedResourceId : "",
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

        {needsLinkedResource ? (
          <fieldset className="chat-document-picker">
            <legend>Link a Document</legend>
            <div className="chat-document-resource-list">
              {documentResources.length ? (
                documentResources.map((resource) => (
                  <label className="chat-document-resource-card" key={resource.id}>
                    <input
                      checked={linkedResourceId === resource.id}
                      name="linked-document"
                      onChange={() => setLinkedResourceId(resource.id)}
                      type="radio"
                      value={resource.id}
                    />
                    <span aria-hidden="true" className="channel-radio" />
                    <span className="chat-document-resource-copy">
                      <strong>{getResourceTitle(resource)}</strong>
                      <small>{resource.mimeType || "Document"}</small>
                    </span>
                  </label>
                ))
              ) : (
                <p className="chat-document-empty">
                  No PDF, DOCX, PPTX, PNG, JPG, or WEBP resources are available in this room yet.
                </p>
              )}
            </div>
            {onRequestUpload ? (
              <button
                className="secondary-button compact chat-document-upload-button"
                onClick={onRequestUpload}
                type="button"
              >
                <Upload size={16} />
                Upload new document
              </button>
            ) : null}
          </fieldset>
        ) : null}

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
