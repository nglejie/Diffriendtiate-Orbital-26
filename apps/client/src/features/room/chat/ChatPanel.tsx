import {
  ArrowUp,
  AtSign,
  Bold,
  Braces,
  Check,
  Code2,
  Copy,
  Download,
  Edit3,
  FileText,
  Hash,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  MessageSquareQuote,
  Paperclip,
  Send,
  SmilePlus,
  Star,
  Strikethrough,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapLink from "@tiptap/extension-link";
import TiptapMention from "@tiptap/extension-mention";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SmallSettingsDialog from "../../../shared/ui/SmallSettingsDialog.tsx";
import { UPLOADS_FOLDER } from "../roomConstants.ts";
import { formatTimeOnly, getInitial, resourceToAttachment } from "../../../shared/utils/room.ts";
import { DRAFTS_VIEW_ID, getCategoryNameForChannel } from "./chatLayout.ts";
import { EmojiPickerPopover } from "./EmojiPickerPopover.tsx";
import { runCurrentLineBlockCommand } from "./richTextEditorCommands.ts";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const EMPTY_ARRAY = [];
const EMPTY_RECORD = {};
const MESSAGE_SANITIZE_OPTIONS = {
  ALLOWED_ATTR: ["class", "data-id", "data-label", "data-type", "href", "rel", "target"],
  ALLOWED_TAGS: [
    "a", "blockquote", "br", "code", "del", "em", "li", "ol", "p", "pre",
    "s", "span", "strong", "ul",
  ],
};
const EMPTY_TOOLBAR_STATE = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  empty: true,
  italic: false,
  link: false,
  orderedList: false,
  strike: false,
};

function isHtmlMessage(value = "") {
  return /<\/?[a-z][\s\S]*>/i.test(String(value));
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function draftToEditorContent(value = "") {
  if (!value) return "";
  return isHtmlMessage(value) ? value : `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
}

function editorHtmlIsEmpty(html = "") {
  const text = String(html)
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return !text;
}

function getEditorHtml(editor) {
  if (!editor || editor.isDestroyed || !editor.schema) return "";
  try {
    return editor.getHTML();
  } catch {
    return "";
  }
}

function messagePreviewText(value = "") {
  if (!isHtmlMessage(value)) return value;
  const container = document.createElement("div");
  container.innerHTML = DOMPurify.sanitize(value);
  return container.textContent || "";
}

function getSenderKey(message) {
  return message.sender?.id || message.sender?.email || message.sender?.name || "unknown";
}

function isGroupedWithPrevious(message, previousMessage) {
  if (!previousMessage) return false;
  if (getSenderKey(message) !== getSenderKey(previousMessage)) return false;
  if (!isSameCalendarDay(message.createdAt, previousMessage.createdAt)) return false;

  const currentTime = new Date(message.createdAt || 0).getTime();
  const previousTime = new Date(previousMessage.createdAt || 0).getTime();
  return Number.isFinite(currentTime) && currentTime - previousTime <= GROUP_WINDOW_MS;
}

function safeDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function calendarKey(value) {
  const date = safeDate(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameCalendarDay(first, second) {
  return calendarKey(first) === calendarKey(second);
}

function isToday(value) {
  return isSameCalendarDay(value, new Date());
}

function isYesterday(value) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameCalendarDay(value, yesterday);
}

function formatDateDivider(value) {
  if (isToday(value)) return "Today";
  if (isYesterday(value)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(safeDate(value));
}

function formatFullTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    year: "numeric",
  }).format(safeDate(value));
}

function ChatTimestamp({ compact = false, value }) {
  return (
    <time
      className={["document-message-time", "discord-message-time", compact ? "discord-message-compact-time" : ""]
        .filter(Boolean)
        .join(" ")}
      data-tooltip={formatFullTimestamp(value)}
      dateTime={value}
    >
      {formatTimeOnly(value)}
    </time>
  );
}

function isEditedMessage(message) {
  const updatedAt = message?.updatedAt || message?.editedAt;
  if (!updatedAt || !message?.createdAt) return false;
  return safeDate(updatedAt).getTime() - safeDate(message.createdAt).getTime() > 1000;
}

function attachmentTitle(attachment) {
  return attachment?.title || attachment?.name || "Attachment";
}

function attachmentUrl(attachment) {
  return attachment?.url || attachment?.href || "#";
}

function attachmentMime(attachment) {
  return String(attachment?.mimeType || attachment?.type || "");
}

function attachmentExtension(attachment) {
  const title = attachmentTitle(attachment);
  return title.includes(".") ? title.split(".").pop().toLowerCase() : "";
}

function isImageAttachment(attachment) {
  const mime = attachmentMime(attachment);
  const extension = attachmentExtension(attachment);
  return mime.startsWith("image/") || ["apng", "avif", "gif", "jpg", "jpeg", "png", "webp"].includes(extension);
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentKindLabel(attachment) {
  const mime = attachmentMime(attachment);
  const extension = attachmentExtension(attachment);
  if (isImageAttachment(attachment)) return "Image";
  if (mime.includes("pdf") || extension === "pdf") return "PDF";
  if (["doc", "docx"].includes(extension)) return "Document";
  if (["ppt", "pptx"].includes(extension)) return "Presentation";
  if (["xls", "xlsx", "csv"].includes(extension)) return "Spreadsheet";
  return extension ? extension.toUpperCase() : "File";
}

function MessageAttachmentCard({ attachment }) {
  const title = attachmentTitle(attachment);
  const url = attachmentUrl(attachment);
  const image = isImageAttachment(attachment);
  const size = formatBytes(attachment?.size);
  const label = [attachmentKindLabel(attachment), size].filter(Boolean).join(" · ");

  return (
    <a
      className={`discord-attachment-card ${image ? "image" : "file"}`}
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      {image ? (
        <span className="discord-attachment-thumb image">
          <img alt="" loading="lazy" src={url} />
        </span>
      ) : (
        <span className="discord-attachment-thumb file">
          <FileText size={22} />
        </span>
      )}
      <span className="discord-attachment-copy">
        <strong>{title}</strong>
        <small>{label}</small>
      </span>
      <span className="discord-attachment-action" aria-hidden="true">
        {image ? <ImageIcon size={16} /> : <Download size={16} />}
      </span>
    </a>
  );
}

function avatarUrl(user) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

function getMessageSender(message, currentUser) {
  const sender = message.sender || {};
  if (sender.id !== currentUser?.id) return sender;

  return {
    ...sender,
    ...currentUser,
    avatarUrl: avatarUrl(currentUser) || avatarUrl(sender),
  };
}

function MessageAvatar({ sender }) {
  const displayName = sender?.name || sender?.email || "Unknown";
  const photo = avatarUrl(sender);

  if (photo) {
    return (
      <div className="discord-avatar image">
        <img alt={`${displayName} profile picture`} src={photo} />
      </div>
    );
  }

  return <div className="discord-avatar">{getInitial(displayName)}</div>;
}

function MessageBody({ body }) {
  if (!body) return null;

  if (isHtmlMessage(body)) {
    return (
      <div
        className="discord-message-markdown"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(body, MESSAGE_SANITIZE_OPTIONS),
        }}
      />
    );
  }

  return (
    <div className="discord-message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

function createMentionSuggestion(members) {
  return {
    items: ({ query }) => {
      const normalized = String(query || "").toLowerCase();
      return members
        .filter((member) => {
          const label = member.name || member.email || "Member";
          return label.toLowerCase().includes(normalized);
        })
        .slice(0, 6)
        .map((member) => ({
          avatarUrl: avatarUrl(member),
          id: member.id || member.email || member.name,
          initial: getInitial(member.name || member.email || "Member"),
          label: member.name || member.email || "Member",
          subtitle: member.email || "",
        }));
    },
    render: () => {
      let popup = null;
      let selectedIndex = 0;
      let latestProps = null;

      const updatePopup = (props) => {
        latestProps = props;
        const items = props.items || [];
        if (!popup) {
          popup = document.createElement("div");
          popup.className = "discord-mention-popover";
          document.body.appendChild(popup);
        }

        if (!items.length) {
          popup.innerHTML = "<p>No Matching Members.</p>";
        } else {
          selectedIndex = Math.min(selectedIndex, items.length - 1);
          popup.innerHTML = items
            .map(
              (item, index) => `
                <button class="${index === selectedIndex ? "active" : ""}" type="button" data-index="${index}">
                  <span>
                    ${item.avatarUrl
                      ? `<img alt="${escapeHtml(item.label)} profile picture" src="${escapeHtml(item.avatarUrl)}" />`
                      : escapeHtml(item.initial)}
                  </span>
                  <strong>${escapeHtml(item.label)}</strong>
                  ${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ""}
                </button>
              `,
            )
            .join("");
          popup.querySelectorAll("button").forEach((button) => {
            button.addEventListener("mousedown", (event) => {
              event.preventDefault();
              const index = Number(button.getAttribute("data-index"));
              props.command(items[index]);
            });
          });
        }

        const rect = props.clientRect?.();
        const composerRect = document.querySelector(".discord-composer")?.getBoundingClientRect();
        const invalidRect = !rect || (Math.abs(rect.left) < 1 && Math.abs(rect.top) < 1);
        const popoverHeight = Math.min(popup.offsetHeight || 260, 280);
        const popoverWidth = Math.min(popup.offsetWidth || 260, 320);
        const fallbackLeft = (composerRect?.left || 16) + 12;
        const fallbackTop = Math.max(12, (composerRect?.top || window.innerHeight) - popoverHeight - 10);
        const left = invalidRect ? fallbackLeft : rect.left;
        const belowCaretTop = invalidRect ? fallbackTop : rect.bottom + 8;
        const shouldUseComposerFallback =
          invalidRect ||
          belowCaretTop + popoverHeight > window.innerHeight - 12 ||
          (composerRect && belowCaretTop > composerRect.top);
        const top = shouldUseComposerFallback ? fallbackTop : belowCaretTop;

        popup.style.left = `${Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12))}px`;
        popup.style.top = `${Math.max(12, Math.min(top, window.innerHeight - popoverHeight - 12))}px`;
      };

      return {
        onStart: updatePopup,
        onUpdate: updatePopup,
        onKeyDown: ({ event }) => {
          const items = latestProps?.items || [];
          if (!items.length) return false;
          if (event.key === "ArrowDown") {
            selectedIndex = (selectedIndex + 1) % items.length;
            updatePopup(latestProps);
            return true;
          }
          if (event.key === "ArrowUp") {
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updatePopup(latestProps);
            return true;
          }
          if (event.key === "Enter") {
            latestProps.command(items[selectedIndex]);
            return true;
          }
          return false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
        },
      };
    },
  };
}

function AttachmentPreviewCard({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const isImage = file.type?.startsWith("image/");

  useEffect(() => {
    if (!isImage) return undefined;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <article className={`discord-attachment-preview ${isImage ? "image" : ""}`}>
      {isImage ? (
        <img alt="" src={previewUrl} />
      ) : (
        <span>
          <Paperclip size={18} />
        </span>
      )}
      <div>
        <strong>{file.name}</strong>
        <small>{file.type || "File"}</small>
      </div>
      <button aria-label={`Remove ${file.name}`} data-tooltip="Remove Attachment" onClick={onRemove} type="button">
        <X size={15} />
      </button>
    </article>
  );
}

function LinkDialog({ initialText, initialUrl, onClose, onSave }) {
  const [text, setText] = useState(initialText || "");
  const [url, setUrl] = useState(initialUrl || "");

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    onSave({
      text: text.trim() || trimmedUrl,
      url: /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`,
    });
  }

  return (
    <SmallSettingsDialog
      ariaLabel="Edit Link"
      className="discord-link-dialog compact-dialog"
      footer={
        <>
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={!url.trim()} type="submit">
            Save
          </button>
        </>
      }
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Edit Link"
    >
      <label className="field">
        <span>Text</span>
        <input autoFocus onChange={(event) => setText(event.target.value)} value={text} />
      </label>
      <label className="field">
        <span>Link</span>
        <input onChange={(event) => setUrl(event.target.value)} value={url} />
      </label>
    </SmallSettingsDialog>
  );
}

function ComposerButton({ active = false, children, label, onClick }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active || undefined}
      className={active ? "active" : ""}
      data-tooltip={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
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
  members = EMPTY_ARRAY,
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState(null);
  const [sending, setSending] = useState(false);
  const emojiAnchorRef = useRef(null);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const messageListRef = useRef(null);
  const lastDraftRef = useRef("");
  const submitComposerRef = useRef(() => {});

  const safeDraft = typeof draft === "string" ? draft : "";
  const safeDrafts =
    drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : EMPTY_RECORD;
  const safeChannelLayout = Array.isArray(channelLayout) ? channelLayout : EMPTY_ARRAY;
  const safeMembers = Array.isArray(members) ? members : EMPTY_ARRAY;
  const safeMessages = Array.isArray(messages) ? messages : EMPTY_ARRAY;
  const safeStarredMessageIds = Array.isArray(starredMessageIds) ? starredMessageIds : EMPTY_ARRAY;
  const mentionMembersKey = safeMembers
    .map((member) => `${member?.id || ""}:${member?.name || ""}:${member?.email || ""}:${avatarUrl(member)}`)
    .join("|");
  const mentionSuggestion = useMemo(
    () => createMentionSuggestion(safeMembers),
    [mentionMembersKey],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      TiptapLink.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
        protocols: ["http", "https"],
      }),
      TiptapMention.configure({
        HTMLAttributes: { class: "discord-mention" },
        suggestion: mentionSuggestion,
      }),
      Placeholder.configure({
        placeholder: `Message #${activeChannel}`,
      }),
    ],
    content: draftToEditorContent(safeDraft),
    editorProps: {
      attributes: {
        "aria-label": `Message #${activeChannel}`,
        class: "discord-rich-editor",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter") return false;
        const activeEditor = editorRef.current;
        const inList = activeEditor?.isActive("bulletList") || activeEditor?.isActive("orderedList");

        if (event.shiftKey && inList && activeEditor?.commands.splitListItem("listItem")) {
          event.preventDefault();
          return true;
        }

        if (!event.shiftKey && !inList) {
          event.preventDefault();
          submitComposerRef.current();
          return true;
        }

        return false;
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      if (activeChannel === DRAFTS_VIEW_ID || activeEditor.isDestroyed) return;
      const html = activeEditor.isEmpty ? "" : getEditorHtml(activeEditor);
      lastDraftRef.current = html;
      onDraftChange(activeChannel, html);
    },
  }, [activeChannel, mentionSuggestion]);
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: stateEditor }) =>
      stateEditor && !stateEditor.isDestroyed
        ? {
            blockquote: stateEditor.isActive("blockquote"),
            bold: stateEditor.isActive("bold"),
            bulletList: stateEditor.isActive("bulletList"),
            code: stateEditor.isActive("code"),
            codeBlock: stateEditor.isActive("codeBlock"),
            empty: stateEditor.isEmpty,
            italic: stateEditor.isActive("italic"),
            link: stateEditor.isActive("link"),
            orderedList: stateEditor.isActive("orderedList"),
            strike: stateEditor.isActive("strike"),
          }
        : EMPTY_TOOLBAR_STATE,
  }) || EMPTY_TOOLBAR_STATE;

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const visibleDrafts = useMemo(
    () =>
      Object.entries(safeDrafts)
        .filter(([, body]) => typeof body === "string" && !editorHtmlIsEmpty(body))
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
    if (!editor) return;
    if (activeChannel === DRAFTS_VIEW_ID || editor.isDestroyed) return;
    if (lastDraftRef.current === safeDraft) return;
    const nextContent = draftToEditorContent(safeDraft);
    if (getEditorHtml(editor) !== nextContent) {
      editor.commands.setContent(nextContent, false);
      lastDraftRef.current = safeDraft;
    }
  }, [activeChannel, editor, safeDraft]);

  useEffect(() => {
    if (typeof messageListRef.current?.scrollTo !== "function") return;
    messageListRef.current.scrollTo({ top: messageListRef.current.scrollHeight });
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

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    const existingHref = editor.getAttributes("link").href || "";
    setLinkDialog({ text: selectedText, url: existingHref });
  }

  function insertMentionTrigger() {
    if (!editor) return;
    const { from } = editor.state.selection;
    const previousCharacter = from > 1 ? editor.state.doc.textBetween(from - 1, from, "") : "";
    const prefix = previousCharacter && !/\s/.test(previousCharacter) ? " @" : "@";
    editor.chain().focus().insertContent(prefix).run();
  }

  function saveLink({ text, url }) {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty) {
      editor.chain().focus().insertContent(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkDialog(null);
  }

  function toggleInlineMark(markName, runToggle) {
    if (!editor) return;
    const shouldEnable = !editor.isActive(markName);
    runToggle();

    if (!editor.state.selection.empty) return;

    const markType = editor.schema.marks[markName];
    if (!markType) return;

    const transaction = shouldEnable
      ? editor.state.tr.addStoredMark(markType.create())
      : editor.state.tr.removeStoredMark(markType);
    editor.view.dispatch(transaction);
    editor.view.focus();
  }

  async function submitComposer() {
    const activeEditor = editorRef.current || editor;
    const body = activeEditor && !activeEditor.isDestroyed && !activeEditor.isEmpty
      ? DOMPurify.sanitize(getEditorHtml(activeEditor), MESSAGE_SANITIZE_OPTIONS)
      : "";
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

      activeEditor?.commands.clearContent();
      onDraftChange(activeChannel, "");
      setAttachments([]);
      setEmojiOpen(false);
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    submitComposer();
  }

  useEffect(() => {
    submitComposerRef.current = submitComposer;
  });

  async function copyMessage(message) {
    try {
      await navigator.clipboard?.writeText(messagePreviewText(message.body || ""));
    } catch {
      onError("Unable to copy message.");
    }
  }

  function beginEditing(message) {
    setEditingMessageId(message.id);
    setEditingBody(messagePreviewText(message.body || ""));
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
                  <em>{messagePreviewText(item.body)}</em>
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
          const startsNewDay = !previous || !isSameCalendarDay(message.createdAt, previous.createdAt);
          const grouped = isGroupedWithPrevious(message, previous);
          const previousWasGrouped = isGroupedWithPrevious(previous, channelMessages[index - 2]);
          const firstGroupedMessage = grouped && !previousWasGrouped;
          const isOwnMessage = message.sender?.id === user?.id;
          const sender = getMessageSender(message, user);
          const senderName = isOwnMessage
            ? sender.name || sender.email || "You"
            : sender.name || "Unknown";
          const starred = safeStarredMessageIds.includes(message.id);
          const editing = editingMessageId === message.id;
          const edited = isEditedMessage(message);
          const editedAt = message.updatedAt || message.editedAt;

          return (
            <Fragment key={message.id}>
              {startsNewDay ? (
                <div className="discord-date-divider" role="separator">
                  <span>{formatDateDivider(message.createdAt)}</span>
                </div>
              ) : null}
              <article
                className={[
                  "discord-message",
                  grouped ? "grouped" : "",
                  firstGroupedMessage ? "first-grouped" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {grouped ? (
                  <ChatTimestamp compact value={message.createdAt} />
                ) : (
                  <MessageAvatar sender={sender} />
                )}

                <div className="discord-message-content">
                  {!grouped ? (
                    <div className="discord-message-meta">
                      <strong className={isOwnMessage ? "own-author" : ""}>{senderName}</strong>
                      <ChatTimestamp value={message.createdAt} />
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
                  ) : (
                    <>
                      <MessageBody body={message.body} />
                      {edited ? (
                        <span className="discord-edited-indicator" title={`Edited ${formatFullTimestamp(editedAt)}`}>
                          Edited
                        </span>
                      ) : null}
                    </>
                  )}

                  {message.attachments?.length ? (
                    <div className="discord-attachments">
                      {message.attachments.map((attachment) => (
                        <MessageAttachmentCard
                          attachment={attachment}
                          key={attachment.id || attachment.url || attachment.title}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="discord-message-actions">
                  <button
                    aria-label={starred ? "Unstar message" : "Star message"}
                    data-tooltip={starred ? "Unstar Message" : "Star Message"}
                    onClick={() => onToggleStarredMessage(message)}
                    type="button"
                  >
                    <Star fill={starred ? "currentColor" : "none"} size={16} />
                  </button>
                  <button
                    aria-label="Copy message"
                    data-tooltip="Copy Message"
                    onClick={() => copyMessage(message)}
                    type="button"
                  >
                    <Copy size={16} />
                  </button>
                  {isOwnMessage ? (
                    <>
                      <button
                        aria-label="Edit message"
                        data-tooltip="Edit Message"
                        onClick={() => beginEditing(message)}
                        type="button"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        aria-label="Delete message"
                        data-tooltip="Delete Message"
                        onClick={() => deleteMessage(message)}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>

      <form className="discord-composer" onSubmit={handleSubmit}>
        <input
          multiple
          onChange={(event) => addAttachments(event.target.files)}
          ref={fileInputRef}
          type="file"
        />
        <EditorContent editor={editor} />
        {attachments.length ? (
          <div className="discord-composer-attachments">
            {attachments.map((file, index) => (
              <AttachmentPreviewCard
                file={file}
                key={`${file.name}-${file.size}-${index}`}
                onRemove={() => removeAttachment(index)}
              />
            ))}
          </div>
        ) : null}
        <div className="discord-format-toolbar" aria-label="Message Formatting Tools">
          <ComposerButton label="Attach Files" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={17} />
          </ComposerButton>
          <ComposerButton label="Mention" onClick={insertMentionTrigger}>
            <AtSign size={17} />
          </ComposerButton>
          <div className="discord-emoji-anchor" ref={emojiAnchorRef}>
            <ComposerButton label="Emoji" onClick={() => setEmojiOpen((current) => !current)}>
              <SmilePlus size={17} />
            </ComposerButton>
            {emojiOpen ? (
              <EmojiPickerPopover
                anchorRef={emojiAnchorRef}
                onClose={() => setEmojiOpen(false)}
                onPick={(emoji) => {
                  editor?.chain().focus().insertContent(emoji).run();
                  setEmojiOpen(false);
                }}
              />
            ) : null}
          </div>
          <span aria-hidden="true" />
          <ComposerButton
            active={toolbarState.bold}
            label="Bold"
            onClick={() => toggleInlineMark("bold", () => editor?.chain().focus().toggleBold().run())}
          >
            <Bold size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.italic}
            label="Italic"
            onClick={() =>
              toggleInlineMark("italic", () => editor?.chain().focus().toggleItalic().run())
            }
          >
            <Italic size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.strike}
            label="Strikethrough"
            onClick={() => toggleInlineMark("strike", () => editor?.chain().focus().toggleStrike().run())}
          >
            <Strikethrough size={16} />
          </ComposerButton>
          <ComposerButton active={toolbarState.link} label="Link" onClick={openLinkDialog}>
            <Link size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.orderedList}
            label="Ordered List"
            onClick={() =>
              runCurrentLineBlockCommand(editor, () => editor?.chain().focus().toggleOrderedList().run())
            }
          >
            <ListOrdered size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.bulletList}
            label="Bulleted List"
            onClick={() =>
              runCurrentLineBlockCommand(editor, () => editor?.chain().focus().toggleBulletList().run())
            }
          >
            <List size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.blockquote}
            label="Quote"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <MessageSquareQuote size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.code}
            label="Code"
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Code2 size={16} />
          </ComposerButton>
          <ComposerButton
            active={toolbarState.codeBlock}
            label="Code Block"
            onClick={() =>
              runCurrentLineBlockCommand(editor, () => editor?.chain().focus().toggleCodeBlock().run())
            }
          >
            <Braces size={16} />
          </ComposerButton>
        </div>
        <button
          aria-label="Send message"
          data-tooltip="Send Message"
          disabled={sending || (toolbarState.empty && !attachments.length)}
          type="submit"
        >
          <ArrowUp size={19} strokeWidth={2.4} />
        </button>
      </form>
      {linkDialog ? (
        <LinkDialog
          initialText={linkDialog.text}
          initialUrl={linkDialog.url}
          onClose={() => setLinkDialog(null)}
          onSave={saveLink}
        />
      ) : null}
    </section>
  );
}
