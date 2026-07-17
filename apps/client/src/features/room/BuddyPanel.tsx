import {
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Edit3,
  File as FileIcon,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Info,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  SearchCheck,
  Square,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import "katex/dist/katex.min.css";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatModelLabel, ProviderIcon } from "../../shared/ui/LlmProviderIcon.tsx";
import { resourceToAttachment } from "../../shared/utils/room.ts";
import IntelligrateIcon from "./IntelligrateIcon.tsx";
import { UPLOADS_FOLDER } from "./roomConstants.ts";
import {
  buildSourceResourceMap,
  compactBuddyText,
  createBuddyThoughtItem,
  extractBuddyToolCallsFromText,
  formatBuddyResponseText,
  formatBuddyToolEvent,
  getBuddyChainFinalAnswer,
  getBuddyChainFinalVisibleResponse,
  getBuddySourceLabel,
  getBuddyThoughtSummary,
  mergeBuddyThoughtSteps,
  mergeBuddySources,
  normalizeBuddyMarkdown,
  normalizeMathGlyphs,
  normalizeSourceKey,
  splitBuddyVisibleThinking,
  uniqueBuddySteps,
} from "./buddyUtils.ts";

const BUILT_IN_PROVIDER_ID = "intelligrate";
const DEFAULT_BUILT_IN_MODEL_LABEL = "Default Intelligrate model";
const BUDDY_ATTACHMENT_ACCEPT =
  ".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation";
const BUDDY_ATTACHMENT_EXTENSIONS = new Set(["pdf", "docx", "pptx"]);
const BUDDY_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const BuddyMarkdownRenderer = lazy(() => import("./BuddyMarkdownRenderer.tsx"));
const BUILT_IN_PROVIDER_OPTION = {
  id: BUILT_IN_PROVIDER_ID,
  providerId: BUILT_IN_PROVIDER_ID,
  providerName: "Intelligrate",
  label: "Intelligrate",
  model: DEFAULT_BUILT_IN_MODEL_LABEL,
  builtIn: true,
  available: true,
  unavailableReason: "",
};

/** Chooses the progress icon based on the streamed Intelligrate event type. */
function getBuddyThoughtIcon(step) {
  if (step.type === "done") return CheckCircle2;
  if (step.type === "tool") {
    if (["search_domain_context", "search_corpus"].includes(step.tool)) {
      if (step.sourceType === "resource") return FileText;
      if (step.sourceType === "convolution_message") return MessageCircle;
      if (step.sourceType === "coordidate_session" || step.sourceType === "coordidate_poll") return CalendarDays;
      return step.status === "done" ? SearchCheck : Search;
    }
    if (step.tool === "read_file") {
      return step.status === "done" ? FileCheck2 : FileText;
    }
    if (["embed_room_documents", "sync_resources"].includes(step.tool)) {
      return step.status === "done" ? Database : RefreshCw;
    }
    return Terminal;
  }
  return Clock;
}

function getBuddySourceType(source) {
  const type = String(source?.type || "").trim();
  if (type === "uploaded_file") return "uploaded-file";
  if (type === "resource" || !type || typeof source === "string") return "resource";
  if (type === "convolution_message") return "convolution";
  if (type === "coordidate_session" || type === "coordidate_poll") return "coordidate";
  if (type === "annotation") return "annotation";
  return "domain";
}

function BuddySourceIcon({ source }) {
  const type = getBuddySourceType(source);
  if (type === "convolution") return <MessageCircle size={13} />;
  if (type === "coordidate") return <CalendarDays size={13} />;
  return <FileText size={13} />;
}

/** Renders Intelligrate answers through a streaming-aware markdown renderer. */
function BuddyMarkdown({ streaming = false, text }) {
  const markdown = normalizeBuddyMarkdown(text);
  if (!markdown) return null;

  return (
    <Suspense fallback={<div className="buddy-markdown"><p>{markdown}</p></div>}>
      <BuddyMarkdownRenderer markdown={markdown} streaming={streaming} />
    </Suspense>
  );
}

/** Wraps Streamdown so callers can opt into streaming repair while a response is still arriving. */
function renderBuddyMarkdown(text, options = {}) {
  return <BuddyMarkdown streaming={Boolean(options.streaming)} text={text} />;
}

/** Returns the compact timestamp shown beneath a message on hover. */
function formatMessageHoverTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return now - date.getTime() > oneDayMs
    ? date.toLocaleDateString([], { day: "numeric", month: "short" })
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Maps MIME/name information into the short label shown on attachment previews. */
function getAttachmentExtension(file) {
  const name = file?.name || file?.title || file?.originalName || "";
  const extension = name.includes(".") ? name.split(".").pop() : "file";
  return extension.slice(0, 5).toUpperCase();
}

/** Detects images that can be previewed directly in the browser. */
function isPreviewableImage(file) {
  const mime = String(file?.mimeType || file?.type || "");
  const name = String(file?.name || file?.title || file?.originalName || "");
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name);
}

/** Safely checks for browser File objects without breaking test/build environments. */
function isBrowserFile(value) {
  return typeof File !== "undefined" && value instanceof File;
}

/** Allows only the document formats Intelligrate can actually read today. */
function isAllowedBuddyAttachment(file) {
  const name = String(file?.name || "");
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  const mimeType = String(file?.type || "").toLowerCase();
  return BUDDY_ATTACHMENT_EXTENSIONS.has(extension || "") || BUDDY_ATTACHMENT_MIME_TYPES.has(mimeType);
}

/** Converts API provider records into the compact option shape used by the composer. */
function normalizeProviderOption(option) {
  if (!option || typeof option !== "object") return null;

  return {
    id: String(option.id || "").trim(),
    providerId: String(option.providerId || option.id || "").trim(),
    providerName: String(option.providerName || option.label || "Provider").trim(),
    label: String(option.label || option.providerName || "Provider").trim(),
    model: String(option.model || "").trim(),
    builtIn: Boolean(option.builtIn),
    available: option.available !== false,
    unavailableReason: String(option.unavailableReason || "").trim(),
  };
}

/** Captures the selected provider on each assistant message for attribution and retries. */
function providerMetaForMessage(providerOption) {
  const provider = normalizeProviderOption(providerOption) || BUILT_IN_PROVIDER_OPTION;

  return {
    providerKeyId: provider.id || BUILT_IN_PROVIDER_ID,
    providerId: provider.providerId || BUILT_IN_PROVIDER_ID,
    providerName: provider.providerName || "Intelligrate",
    providerLabel: provider.label || "Intelligrate",
    model: provider.model || DEFAULT_BUILT_IN_MODEL_LABEL,
  };
}

/** Falls back legacy assistant messages to the built-in Intelligrate provider name. */
function getAssistantProviderName(message) {
  return String(message?.providerName || "Intelligrate").trim() || "Intelligrate";
}

/** Chooses the visible model name that appears before each assistant response. */
function getAssistantProviderLabel(message) {
  return String(message?.providerLabel || message?.providerName || "Intelligrate").trim() || "Intelligrate";
}

/** Builds a provider-like object so saved message metadata can reuse provider icons. */
function providerRecordFromMessage(message) {
  return {
    id: String(message?.providerId || BUILT_IN_PROVIDER_ID).trim() || BUILT_IN_PROVIDER_ID,
    providerId: String(message?.providerId || BUILT_IN_PROVIDER_ID).trim() || BUILT_IN_PROVIDER_ID,
    providerName: getAssistantProviderName(message),
    label: getAssistantProviderLabel(message),
    defaultLabel: getAssistantProviderLabel(message),
  };
}

/** Formats the secondary text under response and picker provider names. */
function providerSubtitle(provider) {
  if (!provider) return "";
  if (provider.providerId === BUILT_IN_PROVIDER_ID || provider.id === BUILT_IN_PROVIDER_ID) {
    return provider.model || DEFAULT_BUILT_IN_MODEL_LABEL;
  }

  return formatModelLabel(provider.model) || String(provider.model || "").trim();
}

/** Keeps picker rows compact because the provider name is already the row title. */
function providerPickerSubtitle(provider) {
  if (!provider) return "";
  if (provider.providerId === BUILT_IN_PROVIDER_ID || provider.id === BUILT_IN_PROVIDER_ID) {
    return provider.model || DEFAULT_BUILT_IN_MODEL_LABEL;
  }
  return formatModelLabel(provider.model) || String(provider.model || "").trim();
}

/** Searches across the label, official provider, and model variant in the @ picker. */
function providerMatchesSearch(provider, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [provider?.label, provider?.providerName, provider?.model]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

/** Renders the custom built-in icon while BYOK providers use the shared brand icon fallback. */
function BuddyProviderIcon({ className = "", provider }) {
  const providerId = String(provider?.providerId || provider?.id || "").trim().toLowerCase();
  if (providerId === BUILT_IN_PROVIDER_ID) {
    return (
      <span
        aria-hidden="true"
        className={["llm-provider-icon intelligrate-provider-icon", className].filter(Boolean).join(" ")}
      >
        <IntelligrateIcon size={20} />
      </span>
    );
  }

  return <ProviderIcon className={className} provider={provider} />;
}

/** Keeps pending uploads previewable until the server returns canonical resources. */
function fileToPendingAttachment(file, index) {
  const safeName = file.name || `Attachment ${index + 1}`;
  const stableStamp = file.lastModified || file.size || index;

  return {
    id: `pending-${safeName}-${stableStamp}-${index}`,
    title: safeName,
    originalName: safeName,
    mimeType: file.type || "",
    size: file.size || 0,
    type: "file",
    file,
  };
}

/** ChatGPT/Claude-style attachment chip with a square preview and filename. */
function AttachmentPreview({ file, onRemove = undefined }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const sourceFile = isBrowserFile(file) ? file : file?.file;
  const isImage = isPreviewableImage(file);
  const canPreview = isImage;
  const Tag = onRemove ? "button" : "span";

  useEffect(() => {
    if (!canPreview) return undefined;
    const url = isBrowserFile(sourceFile) ? URL.createObjectURL(sourceFile) : file?.url || "";
    if (!url) return undefined;
    setPreviewUrl(url);
    return () => {
      if (isBrowserFile(sourceFile)) URL.revokeObjectURL(url);
    };
  }, [sourceFile, file?.url, canPreview]);

  return (
    <Tag
      className={`attachment-preview-card ${previewUrl ? "has-preview" : ""}`}
      onClick={onRemove}
      title={onRemove ? "Remove attachment" : file.title || file.name}
      type={onRemove ? "button" : undefined}
    >
      <span className="attachment-preview-icon">
        {isImage && previewUrl ? (
          <img alt="" src={previewUrl} />
        ) : isImage ? (
          <ImageIcon size={18} />
        ) : (
          <>
            <FileIcon size={18} />
            <small>{getAttachmentExtension(file)}</small>
          </>
        )}
      </span>
      <span>{file.title || file.name}</span>
      {onRemove ? <X size={13} /> : null}
    </Tag>
  );
}

/** Subtle message affordances shown below user messages on hover. */
function MessageActions({ message, onCopy, onEdit = undefined }) {
  const [copied, setCopied] = useState(false);
  const timestamp = formatMessageHoverTime(message.createdAt);
  const isUserMessage = message.role === "user";
  const senderName = message.authorName || message.senderName || "You";

  /** Gives immediate feedback without adding another toast to the chat surface. */
  async function handleCopy() {
    const didCopy = await onCopy();
    if (didCopy === false) return;

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="buddy-message-actions">
      {isUserMessage ? (
        <span>
          {senderName}
          {timestamp ? ` | ${timestamp}` : ""}
        </span>
      ) : null}
      {isUserMessage ? (
        <button aria-label="Edit message" onClick={onEdit} type="button">
          <Edit3 size={15} />
        </button>
      ) : null}
      <button aria-label="Copy message" onClick={handleCopy} type="button">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

/** Inline edit composer used when a sent message is revised and resent. */
function InlineMessageEditor({
  attachments = [],
  editDraft,
  inputRef,
  onCancel,
  onChange,
  onSubmit,
}) {
  return (
    <form className="buddy-inline-editor" onSubmit={onSubmit}>
      {attachments.length ? (
        <div className="attachment-preview-row sent-attachments">
          {attachments.map((file) => (
            <AttachmentPreview file={file} key={file.id || file.title || file.name} />
          ))}
        </div>
      ) : null}
      <textarea
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        ref={inputRef}
        rows={2}
        value={editDraft}
      />
      <div className="buddy-inline-editor-actions">
        <button onClick={onCancel} type="button">
          Cancel
        </button>
        <button disabled={!editDraft.trim()} type="submit">
          Send
        </button>
      </div>
    </form>
  );
}

/** Lightweight loading row used before the first stream event arrives. */
function BuddyProcessingMessage() {
  return (
    <article className="buddy-message processing-placeholder">
      <BuddyProcessingText />
    </article>
  );
}

/** Initial non-collapsible state shown before Intelligrate emits progress events. */
function BuddyProcessingText() {
  return (
    <div className="buddy-processing-text" aria-live="polite">
      Intelligrate is processing your request
    </div>
  );
}

/** Collapses long progress text so tool output does not dominate the chat. */
function BuddyThinkingText({ text }) {
  const [expanded, setExpanded] = useState(false);
  const cleanedText = normalizeMathGlyphs(text).trim();
  const isLong = cleanedText.length > 420 || cleanedText.split(/\r?\n/).length > 5;
  const preview = `${cleanedText.slice(0, 420).trim()}...`;

  return (
    <span className={`buddy-thinking-copy ${isLong && !expanded ? "truncated" : ""}`}>
      {isLong && !expanded ? preview : cleanedText}
      {isLong ? (
        <button
          className="buddy-thinking-more"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </span>
  );
}

/** ChatGPT-style Intelligrate panel for messages, file attachments, and streaming output. */
function BuddyPanel({
  isDraftThread = false,
  messages,
  onAskBuddy,
  onEnsureThread,
  onMessagesChange,
  onError,
  onPersistMessages,
  onSyncResources,
  onUploadFiles,
  onNotify,
  onOpenSource,
  providerOptions = [],
  resources = [],
  selectedProviderId: selectedProviderIdProp = "",
  syncingResources,
  threadId,
  threadTitle,
  onSelectedProviderIdChange,
  user,
}) {
  const fileInputId = useId();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [liveAssistantId, setLiveAssistantId] = useState("");
  const [collapsedThoughts, setCollapsedThoughts] = useState({});
  const [localSelectedProviderId, setLocalSelectedProviderId] = useState(
    () => String(selectedProviderIdProp || BUILT_IN_PROVIDER_ID).trim() || BUILT_IN_PROVIDER_ID,
  );
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [providerPickerSearch, setProviderPickerSearch] = useState("");
  const [providerMentionRange, setProviderMentionRange] = useState(null);
  const fileInputRef = useRef(null);
  const draftInputRef = useRef(null);
  const editInputRef = useRef(null);
  const listRef = useRef(null);
  const providerPickerRef = useRef(null);
  const providerPickerSearchRef = useRef(null);
  const abortControllerRef = useRef(null);
  const selectedProviderIdRef = useRef(localSelectedProviderId);
  const sourceResourceMap = useMemo(() => buildSourceResourceMap(resources), [resources]);
  const selectedProviderId = String(localSelectedProviderId || BUILT_IN_PROVIDER_ID);
  const availableProviderOptions = useMemo(() => {
    const normalized = providerOptions.map(normalizeProviderOption).filter(Boolean);
    const hasBuiltIn = normalized.some((option) => option.id === BUILT_IN_PROVIDER_ID);
    return hasBuiltIn ? normalized : [BUILT_IN_PROVIDER_OPTION, ...normalized];
  }, [providerOptions]);
  const selectedProvider =
    availableProviderOptions.find((option) => option.id === selectedProviderId) ||
    availableProviderOptions[0] ||
    BUILT_IN_PROVIDER_OPTION;
  const selectedProviderUnavailable =
    selectedProvider && selectedProvider.available === false
      ? selectedProvider.unavailableReason || "This provider is not available yet."
      : "";
  const filteredProviderOptions = useMemo(
    () => availableProviderOptions.filter((provider) => providerMatchesSearch(provider, providerPickerSearch)),
    [availableProviderOptions, providerPickerSearch],
  );

  // Keep the latest streamed response visible without forcing the user to scroll manually.
  useEffect(() => {
    if (typeof listRef.current?.scrollTo !== "function") return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  // Abort an in-flight Intelligrate request if the user leaves the panel.
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const nextProviderId = String(selectedProviderIdProp || BUILT_IN_PROVIDER_ID).trim() || BUILT_IN_PROVIDER_ID;
    selectedProviderIdRef.current = nextProviderId;
    setLocalSelectedProviderId(nextProviderId);
  }, [selectedProviderIdProp]);

  useEffect(() => {
    if (availableProviderOptions.some((option) => option.id === selectedProviderId)) return;
    if (selectedProviderIdProp && !providerOptions.length) return;
    const fallbackProviderId = availableProviderOptions[0]?.id || BUILT_IN_PROVIDER_ID;
    setLocalSelectedProviderId(fallbackProviderId);
    selectedProviderIdRef.current = fallbackProviderId;
    onSelectedProviderIdChange?.(fallbackProviderId);
  }, [availableProviderOptions, onSelectedProviderIdChange, providerOptions.length, selectedProviderId, selectedProviderIdProp]);

  // Match ChatGPT/Claude-style composers: grow with the message, then scroll.
  useEffect(() => {
    const textarea = draftInputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const padding =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const maxHeight = lineHeight * 10 + padding;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  // Inline edited messages use the same grow-until-scroll behaviour as the main composer.
  useEffect(() => {
    const textarea = editInputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const maxHeight = 220;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [editDraft, editingMessageId]);

  // The @ picker dismisses on outside clicks and Escape while keeping the composer focused.
  useEffect(() => {
    if (!providerPickerOpen) return undefined;

    function closePickerOnPointerDown(event) {
      const target = event.target;
      if (target instanceof Node && providerPickerRef.current?.contains(target)) return;
      setProviderPickerOpen(false);
    }

    function closePickerOnEscape(event) {
      if (event.key === "Escape") {
        setProviderPickerOpen(false);
      }
    }

    window.addEventListener("pointerdown", closePickerOnPointerDown, true);
    window.addEventListener("keydown", closePickerOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closePickerOnPointerDown, true);
      window.removeEventListener("keydown", closePickerOnEscape, true);
    };
  }, [providerPickerOpen]);

  // Focus the search field after the popover mounts so click and typed @ share one flow.
  useEffect(() => {
    if (!providerPickerOpen) return;
    window.requestAnimationFrame(() => providerPickerSearchRef.current?.focus());
  }, [providerPickerOpen]);

  /** Opens the model picker from either the selector button or an @ typed into the composer. */
  function openProviderPicker({ mentionRange = null, search = "" } = {}) {
    if (thinking) return;
    setProviderMentionRange(mentionRange);
    setProviderPickerSearch(search);
    setProviderPickerOpen(true);
  }

  /** Removes the typed @ trigger when it was used only to choose a provider. */
  function removeProviderMentionTrigger() {
    if (!providerMentionRange) return;
    setDraft((current) => {
      const start = Math.max(0, Math.min(providerMentionRange.start, current.length));
      const end = Math.max(start, Math.min(providerMentionRange.end, current.length));
      return `${current.slice(0, start)}${current.slice(end)}`;
    });
  }

  /** Selects the provider used for subsequent prompts until the member changes it. */
  function selectProvider(provider) {
    if (!provider || provider.available === false || thinking) return;
    const nextProviderId = provider.id || BUILT_IN_PROVIDER_ID;
    setLocalSelectedProviderId(nextProviderId);
    selectedProviderIdRef.current = nextProviderId;
    onSelectedProviderIdChange?.(nextProviderId);
    removeProviderMentionTrigger();
    setProviderPickerOpen(false);
    setProviderPickerSearch("");
    setProviderMentionRange(null);
    window.requestAnimationFrame(() => draftInputRef.current?.focus());
  }

  /** Watches composer text for a freshly typed @ and opens the shared model picker. */
  function handleDraftChange(event) {
    const nextDraft = event.target.value;
    const cursor = event.target.selectionStart ?? nextDraft.length;
    setDraft(nextDraft);

    if (nextDraft[cursor - 1] === "@") {
      openProviderPicker({
        mentionRange: { start: cursor - 1, end: cursor },
        search: "",
      });
    }
  }

  /** Adds selected or dropped files to the pending message attachments. */
  function addAttachments(fileList) {
    const files = Array.from(fileList || []);
    const acceptedFiles = files.filter(isAllowedBuddyAttachment);
    const rejectedCount = files.length - acceptedFiles.length;

    if (acceptedFiles.length) {
      setAttachments((current) => [...current, ...acceptedFiles]);
    }
    if (rejectedCount) {
      const message = "Intelligrate attachments currently support PDF, DOCX, and PPTX files.";
      if (onNotify) onNotify(message);
      else onError?.(message);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Reads the native file input and resets it so the same file can be reselected. */
  function handleFileSelection(event) {
    addAttachments(event.currentTarget.files);
  }

  /** Removes a pending attachment before it is uploaded to the room library. */
  function removeAttachment(indexToRemove) {
    setAttachments((current) =>
      current.filter((_file, index) => index !== indexToRemove),
    );
  }

  /** Shows the drop target only when the browser is dragging files over Intelligrate. */
  function handleDragOver(event) {
    if (thinking) return;
    event.preventDefault();
    if (event.dataTransfer?.types?.includes("Files")) {
      setDraggingFiles(true);
    }
  }

  /** Hides the drop target once the drag leaves the panel. */
  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDraggingFiles(false);
  }

  /** Adds dropped files to the current Intelligrate message. */
  function handleDrop(event) {
    event.preventDefault();
    setDraggingFiles(false);
    if (thinking) return;
    addAttachments(event.dataTransfer.files);
  }

  /** Manually asks the backend to refresh Intelligrate's room corpus. */
  async function handleSyncResources() {
    if (syncingResources) return;

    try {
      const payload = await onSyncResources();
      if (!payload) return;

      const successCount = payload.success?.length || 0;
      const failedCount = payload.failed?.length || 0;
      onNotify?.(
        payload.message ||
        `Synced ${successCount} file${successCount === 1 ? "" : "s"} into ${payload.totalChunks || 0} chunk${payload.totalChunks === 1 ? "" : "s"}${failedCount ? `, ${failedCount} failed` : ""}.`,
      );
    } catch (err) {
      onError(err.message);
    }
  }

  /** Lets the user stop the current streamed response. */
  function handleStopResponse() {
    abortControllerRef.current?.abort();
  }

  /** Copies message text without interrupting the chat if a browser blocks clipboard access. */
  async function copyMessageText(text) {
    const value = String(text || "");
    if (!value) return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Some browsers block Clipboard API access on localhost; fall through.
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand("copy");
    } catch {
      // Clipboard failures should not surface as modal errors for a tiny utility action.
    } finally {
      textarea.remove();
    }

    return true;
  }

  /** Opens an inline edit surface under the selected user message. */
  function editMessage(message) {
    setEditingMessageId(message.id);
    setEditDraft(message.body || "");
    window.setTimeout(() => editInputRef.current?.focus(), 0);
  }

  /**
   * Streams an Intelligrate answer for a prepared message history. Normal sends
   * and edited-message resends both flow through this path so progress rendering,
   * interruption handling, and persistence stay consistent.
   */
  async function streamPreparedMessages({
    nextMessages,
    providerOption = BUILT_IN_PROVIDER_OPTION,
    sharedAttachments = [],
    targetThreadId,
    uploadedResources = [],
  }) {
    let pendingAssistantId = "";
    let interruptedAssistantMessage = null;
    let latestSources = [];
    let latestThinkingSteps = [];
    let preToolBody = "";
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const assistantId = `assistant-${Date.now()}`;
      const providerMeta = providerMetaForMessage(providerOption);
      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        preface: "",
        body: "",
        sources: [],
        thinkingSteps: [],
        isThinking: true,
        ...providerMeta,
        createdAt: new Date().toISOString(),
      };
      let streamedBody = "";
      let streamedRawBody = "";
      let streamedSources = [];
      let streamedChain = [];
      let visibleThinkingSteps = [];
      let hasToolTimelineStarted = false;
      pendingAssistantId = assistantId;
      interruptedAssistantMessage = assistantMessage;
      latestThinkingSteps = visibleThinkingSteps;

      /**
       * The chatbot may stream a normal assistant sentence before the first
       * TOOL_START, such as "I will first search...". Once a tool event arrives,
       * keep that sentence above the timeline and render later model text below it.
       */
      function capturePreToolText() {
        if (hasToolTimelineStarted) return;
        hasToolTimelineStarted = true;

        const leadingText = streamedBody.trim();
        if (!leadingText) return;

        preToolBody = leadingText;
        streamedBody = "";
        streamedRawBody = "";
      }

      /** Avoids repeating the pre-tool sentence when final chain payloads include it. */
      function stripPreToolText(answer) {
        const text = String(answer || "").trimStart();
        if (!preToolBody) return text;

        return text.startsWith(preToolBody)
          ? text.slice(preToolBody.length).trimStart()
          : text;
      }

      /**
       * Some BYOK providers can leak tool-call JSON as ordinary assistant text
       * when the provider/service contract is misconfigured. Treat those objects
       * as attempted progress events and keep them out of the persisted answer.
       */
      function separateLeakedToolCalls(answer) {
        const extracted = extractBuddyToolCallsFromText(answer);
        if (!extracted.toolCalls.length) {
          return hasToolTimelineStarted ? stripPreToolText(extracted.text) : extracted.text;
        }

        if (!hasToolTimelineStarted) {
          hasToolTimelineStarted = true;
          preToolBody = extracted.preToolText;
        }

        extracted.toolCalls.forEach((toolCall, index) => {
          const cleanedStep = formatBuddyToolEvent(toolCall, {
            attachments: sharedAttachments,
          });
          if (!cleanedStep.text) return;
          visibleThinkingSteps = mergeBuddyThoughtSteps(visibleThinkingSteps, {
            ...cleanedStep,
            id: `leaked-model-tool:${index}:${cleanedStep.id}`,
          });
        });

        return extracted.postToolText || stripPreToolText(extracted.text);
      }

      onMessagesChange([...nextMessages, assistantMessage], targetThreadId);
      setLiveAssistantId(assistantId);

      await onAskBuddy(nextMessages, uploadedResources, {
        provider: providerMeta,
        signal: controller.signal,
        onToken: (token) => {
          if (!token) return;

          streamedRawBody += token;
          const visibleStream = splitBuddyVisibleThinking(streamedRawBody);
          streamedBody = separateLeakedToolCalls(visibleStream.answer);

          if (visibleStream.thoughts.length) {
            visibleThinkingSteps = mergeBuddyThoughtSteps(
              visibleThinkingSteps,
              visibleStream.thoughts.map((thought, index) =>
                createBuddyThoughtItem("thought", thought, {
                  id: `model-thinking:${index}`,
                  summary: compactBuddyText(thought).slice(0, 120),
                }),
              ),
            );
          }

          onMessagesChange(
            (current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                    ...message,
                    preface: preToolBody,
                    body: streamedBody,
                    isThinking: true,
                    thinkingSteps: visibleThinkingSteps,
                  }
                  : message,
              ),
            targetThreadId,
          );
          latestThinkingSteps = visibleThinkingSteps;
        },
        onThinking: (step) => {
          capturePreToolText();
          const cleanedStep = formatBuddyToolEvent(step, {
            attachments: sharedAttachments,
          });
          if (!cleanedStep.text) return;
          visibleThinkingSteps = mergeBuddyThoughtSteps(visibleThinkingSteps, cleanedStep);
          latestThinkingSteps = visibleThinkingSteps;
          onMessagesChange(
            (current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                    ...message,
                    preface: preToolBody,
                    body: streamedBody,
                    isThinking: true,
                    thinkingSteps: visibleThinkingSteps,
                  }
                  : message,
              ),
            targetThreadId,
          );
        },
        onAnswer: (answer) => {
          const visibleAnswer = splitBuddyVisibleThinking(answer);
          streamedBody = separateLeakedToolCalls(visibleAnswer.answer);
          streamedRawBody = streamedBody;
          if (visibleAnswer.thoughts.length) {
            visibleThinkingSteps = mergeBuddyThoughtSteps(
              visibleThinkingSteps,
              visibleAnswer.thoughts.map((thought, index) =>
                createBuddyThoughtItem("thought", thought, {
                  id: `model-answer-thinking:${index}`,
                  summary: compactBuddyText(thought).slice(0, 120),
                }),
              ),
            );
          }
          latestThinkingSteps = visibleThinkingSteps;
        },
        onChain: (chain) => {
          streamedChain = Array.isArray(chain) ? chain : [];
          const chainResponse = getBuddyChainFinalVisibleResponse(streamedChain);
          if (chainResponse.thoughts.length) {
            visibleThinkingSteps = mergeBuddyThoughtSteps(
              visibleThinkingSteps,
              chainResponse.thoughts.map((thought, index) =>
                createBuddyThoughtItem("thought", thought, {
                  id: `model-chain-thinking:${index}`,
                  summary: compactBuddyText(thought).slice(0, 120),
                }),
              ),
            );
          }
          const hasStreamedAnswer = Boolean(streamedRawBody.trim() || streamedBody.trim());
          if (!hasStreamedAnswer && chainResponse.answer) {
            streamedBody = separateLeakedToolCalls(chainResponse.answer);
          }
          onMessagesChange(
            (current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                    ...message,
                    preface: preToolBody,
                    body: streamedBody,
                    isThinking: true,
                    thinkingSteps: visibleThinkingSteps,
                  }
                  : message,
              ),
            targetThreadId,
          );
        },
        onSources: (sources) => {
          streamedSources = Array.isArray(sources) ? sources : [];
          latestSources = streamedSources;
          onMessagesChange(
            (current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, preface: preToolBody, sources: streamedSources }
                  : message,
              ),
            targetThreadId,
          );
        },
      });

      const finalThinkingBase = uniqueBuddySteps(visibleThinkingSteps).filter(
        (step) => step.type !== "done",
      );
      const finalThinkingSteps = finalThinkingBase.length
        ? mergeBuddyThoughtSteps(
          finalThinkingBase,
          createBuddyThoughtItem(
            "done",
            "Done",
            { id: "done" },
          ),
        )
        : [];
      const finalBody = splitBuddyVisibleThinking(
        streamedBody || getBuddyChainFinalAnswer(streamedChain),
      ).answer;
      const finalAssistantMessage = {
        ...assistantMessage,
        preface: preToolBody,
        body:
          formatBuddyResponseText(stripPreToolText(finalBody)) ||
          "I could not generate a response from the current context.",
        sources: streamedSources,
        thinkingSteps: finalThinkingSteps,
        isThinking: false,
      };
      const finalMessages = [...nextMessages, finalAssistantMessage];

      onMessagesChange(finalMessages, targetThreadId);
      await onPersistMessages?.(finalMessages, targetThreadId);
    } catch (err) {
      if (err?.name === "AbortError" && pendingAssistantId && interruptedAssistantMessage) {
        const interruptedThinkingSteps = uniqueBuddySteps(latestThinkingSteps).filter(
          (step) => step.type !== "done",
        );
        const finalMessages = [
          ...nextMessages,
          {
            ...interruptedAssistantMessage,
            preface: preToolBody,
            body: "Intelligrate's response was interrupted.",
            sources: latestSources,
            thinkingSteps: interruptedThinkingSteps,
            isThinking: false,
            interrupted: true,
          },
        ];

        onMessagesChange(finalMessages, targetThreadId);
        await onPersistMessages?.(finalMessages, targetThreadId);
        return;
      }

      if (pendingAssistantId) {
        onMessagesChange(
          (current) =>
            current.filter(
              (message) => message.id !== pendingAssistantId || message.body?.trim(),
            ),
          targetThreadId,
        );
      }
      throw err;
    }
  }

  /**
   * Sends the current composer contents to Intelligrate after uploading any
   * attached files into the room resource library.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = draft.trim();
    if ((!trimmed && !attachments.length) || thinking) return;
    if (selectedProviderUnavailable) {
      onError(selectedProviderUnavailable);
      return;
    }

    const providerForMessage =
      availableProviderOptions.find((provider) => provider.id === selectedProviderIdRef.current) ||
      selectedProvider;
    const queuedFiles = [...attachments];
    const localAttachments = queuedFiles.map(fileToPendingAttachment);
    const optimisticUserMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      body: trimmed || "Please review the attached files.",
      attachments: localAttachments,
      authorId: user?.id || "",
      authorName: user?.name || "You",
      createdAt: new Date().toISOString(),
    };
    const optimisticMessages = [...messages, optimisticUserMessage];
    const optimisticThreadId = threadId;
    let streamStarted = false;

    setThinking(true);
    setDraft("");
    setAttachments([]);
    setProviderPickerOpen(false);
    setProviderPickerSearch("");
    setProviderMentionRange(null);
    onMessagesChange(optimisticMessages, optimisticThreadId);

    try {
      const uploadedResources = queuedFiles.length
        ? await onUploadFiles(queuedFiles, UPLOADS_FOLDER)
        : [];
      const sharedAttachments = (uploadedResources || []).map(resourceToAttachment);
      const userMessage = {
        ...optimisticUserMessage,
        attachments: sharedAttachments.length ? sharedAttachments : localAttachments,
      };

      // Replace local File-backed chips with saved resource records as soon as upload completes.
      onMessagesChange(
        (current) =>
          current.map((message) =>
            message.id === optimisticUserMessage.id ? userMessage : message,
          ),
        optimisticThreadId,
      );

      const ensuredThread = await onEnsureThread?.(userMessage);
      const targetThreadId = ensuredThread?.id || threadId;
      const baseMessages = ensuredThread?.messages?.some(
        (message) => message.id === userMessage.id,
      )
        ? ensuredThread.messages.filter((message) => message.id !== userMessage.id)
        : messages;
      const nextMessages = [...baseMessages, userMessage];

      streamStarted = true;
      await streamPreparedMessages({
        nextMessages,
        providerOption: providerForMessage,
        sharedAttachments,
        targetThreadId,
        uploadedResources,
      });
    } catch (err) {
      if (!streamStarted) {
        setAttachments(queuedFiles);
        onMessagesChange(
          (current) => current.filter((message) => message.id !== optimisticUserMessage.id),
          optimisticThreadId,
        );
      }
      onError(err.message);
    } finally {
      abortControllerRef.current = null;
      setLiveAssistantId("");
      setThinking(false);
    }
  }

  /** Resends a revised user message and discards later replies from the old branch. */
  async function handleEditSubmit(event, originalMessage) {
    event.preventDefault();
    const trimmed = editDraft.trim();
    if (!trimmed || thinking) return;
    if (selectedProviderUnavailable) {
      onError(selectedProviderUnavailable);
      return;
    }

    const providerForMessage = selectedProvider;
    const messageIndex = messages.findIndex((message) => message.id === originalMessage.id);
    if (messageIndex < 0) {
      setEditingMessageId("");
      setEditDraft("");
      return;
    }

    const editedMessage = {
      ...originalMessage,
      body: trimmed,
      editedAt: new Date().toISOString(),
    };
    const nextMessages = [...messages.slice(0, messageIndex), editedMessage];

    setEditingMessageId("");
    setEditDraft("");
    setThinking(true);

    try {
      await onPersistMessages?.(nextMessages, threadId);
      await streamPreparedMessages({
        nextMessages,
        providerOption: providerForMessage,
        sharedAttachments: editedMessage.attachments || [],
        targetThreadId: threadId,
        uploadedResources: editedMessage.attachments || [],
      });
    } catch (err) {
      onError(err.message);
    } finally {
      abortControllerRef.current = null;
      setLiveAssistantId("");
      setThinking(false);
    }
  }

  return (
    <section
      className={`buddy-panel ${isDraftThread && !messages.length ? "empty-thread" : ""} ${draggingFiles ? "dragging-files" : ""}`}
      aria-label="Intelligrate chat"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <header className="chat-channel-bar buddy-channel-bar">
        <div>
          <span>{threadTitle}</span>
        </div>
        <button
          aria-label={syncingResources ? "Syncing room resources" : "Sync room resources"}
          className="buddy-sync-button icon-only"
          data-tooltip="Sync Domain resources with Intelligrate"
          disabled={thinking || syncingResources}
          onClick={handleSyncResources}
          type="button"
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="buddy-message-list" ref={listRef}>
        {isDraftThread && !messages.length && !thinking ? (
          <div className="buddy-draft-welcome">
            <h2>Ready to learn{user?.name ? `, ${user.name.split(" ")[0]}` : ""}?</h2>
            <p>
              Start your chatting session by optionally adding a file that you wish to
              learn more about. Then ask Intelligrate for any enquiries you have on the
              file attached, or any relevant resources already uploaded into the Domain.
            </p>
            <p>
              Intelligrate is powered by AI, so mistakes are possible. Please review
              output carefully before use.
            </p>
          </div>
        ) : null}
        {messages.map((message) => {
          const normalizedThinkingSteps = uniqueBuddySteps(message.thinkingSteps || []);
          const hasThinkingSteps = Boolean(normalizedThinkingSteps.length);
          const isEditing = editingMessageId === message.id;
          const showProcessingText =
            message.role === "assistant" &&
            message.isThinking &&
            !hasThinkingSteps &&
            !message.body;
          const thoughtCollapsed =
            collapsedThoughts[message.id] ?? (message.isThinking ? false : true);
          const thoughtSummary = getBuddyThoughtSummary({
            ...message,
            thinkingSteps: normalizedThinkingSteps,
          });
          const messageSources = mergeBuddySources(
            message.sources,
            `${message.preface || ""}\n${message.body || ""}`,
            resources,
          );

          return (
            <article
              className={`${message.role === "user" ? "buddy-message user" : "buddy-message"} ${message.interrupted ? "interrupted" : ""} ${isEditing ? "editing" : ""}`}
              key={message.id}
            >
              {isEditing ? (
                <InlineMessageEditor
                  attachments={message.attachments}
                  editDraft={editDraft}
                  inputRef={editInputRef}
                  onCancel={() => {
                    setEditingMessageId("");
                    setEditDraft("");
                  }}
                  onChange={setEditDraft}
                  onSubmit={(event) => handleEditSubmit(event, message)}
                />
              ) : (
                message.role === "user" ? (
                  <div className="buddy-user-message-stack">
                    {message.attachments?.length ? (
                      <div className="attachment-preview-row sent-attachments">
                        {message.attachments.map((file) => (
                          <AttachmentPreview file={file} key={file.id} />
                        ))}
                      </div>
                    ) : null}
                    <div className="buddy-user-bubble">
                      <span>
                        {message.authorId === user?.id
                          ? "You"
                          : message.authorName || "Member"}
                      </span>
                      {message.body ? <p>{message.body}</p> : null}
                    </div>
                    {message.body ? (
                      <MessageActions
                        message={message}
                        onCopy={() => copyMessageText(message.body)}
                        onEdit={() => editMessage(message)}
                      />
                    ) : null}
                  </div>
                ) : (
                  <>
                  <div className="buddy-assistant-header">
                    <BuddyProviderIcon provider={providerRecordFromMessage(message)} />
                    <span>
                      <strong>{getAssistantProviderLabel(message)}</strong>
                      {providerSubtitle(message) ? <small>{providerSubtitle(message)}</small> : null}
                    </span>
                  </div>
                  {showProcessingText ? <BuddyProcessingText /> : null}
                  {message.preface ? (
                    <div className="buddy-preface">
                      {renderBuddyMarkdown(message.preface, { streaming: message.isThinking })}
                    </div>
                  ) : null}
                  {hasThinkingSteps ? (
                    <div
                      className={`buddy-thinking-steps ${thoughtCollapsed ? "collapsed" : ""
                        }`}
                      aria-label="Intelligrate progress"
                    >
                      <button
                        aria-expanded={!thoughtCollapsed}
                        className="buddy-thinking-summary"
                        onClick={() =>
                          setCollapsedThoughts((current) => ({
                            ...current,
                            [message.id]: !thoughtCollapsed,
                          }))
                        }
                        type="button"
                      >
                        <ChevronRight size={15} />
                        {message.isThinking
                          ? "Intelligrate is working hard on your request"
                          : thoughtSummary}
                      </button>
                      <div
                        className={`buddy-thinking-step-list ${
                          thoughtCollapsed ? "collapsed" : ""
                        }`}
                      >
                        {normalizedThinkingSteps.map((step, index) => {
                          const ThoughtIcon = getBuddyThoughtIcon(step);

                          return (
                            <div
                              className={`buddy-thinking-step ${step.type} ${step.status ? `status-${step.status}` : ""} ${step.sourceType ? `source-${step.sourceType}` : ""
                                }`}
                              key={`${step.id}-${index}`}
                            >
                              <span className="buddy-thinking-icon">
                                <ThoughtIcon size={16} />
                              </span>
                              <BuddyThinkingText text={step.text} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {message.body
                    ? message.interrupted
                      ? (
                        <div className="buddy-interrupted-card">
                          <Info size={18} />
                          <span>{message.body}</span>
                        </div>
                      )
                      : renderBuddyMarkdown(message.body, { streaming: message.isThinking })
                    : null}
                  {messageSources.length ? (
                    <div className="buddy-source-row">
                      {messageSources.map((source) => {
                        const resource = sourceResourceMap.get(normalizeSourceKey(source));
                        const label = getBuddySourceLabel(source);
                        const sourceKey = `${normalizeSourceKey(source)}:${label}`;
                        const sourceClassName = `source-${getBuddySourceType(source)}`;
                        const chipContent = (
                          <>
                            <BuddySourceIcon source={source} />
                            {label}
                          </>
                        );

                        if (onOpenSource) {
                          return (
                            <button
                              className={sourceClassName}
                              data-source-has-highlight={source?.highlightPosition ? "true" : "false"}
                              data-source-page={source?.pageNumber || source?.slideNumber || ""}
                              key={sourceKey}
                              onClick={() => onOpenSource(source)}
                              title="Open source in Diffriendtiate"
                              type="button"
                            >
                              {chipContent}
                            </button>
                          );
                        }

                        return resource?.url ? (
                          <a
                            className={sourceClassName}
                            data-source-has-highlight={source?.highlightPosition ? "true" : "false"}
                            data-source-page={source?.pageNumber || source?.slideNumber || ""}
                            href={resource.url}
                            key={sourceKey}
                            rel="noreferrer"
                            target="_blank"
                            title="Open source in a new tab"
                          >
                            {chipContent}
                          </a>
                        ) : (
                          <span className={sourceClassName} key={sourceKey}>{chipContent}</span>
                        );
                      })}
                    </div>
                  ) : null}
                  {message.body ? (
                    <MessageActions
                      message={message}
                      onCopy={() => copyMessageText(message.body)}
                    />
                  ) : null}
                  </>
                )
              )}
            </article>
          );
        })}
        {thinking && !liveAssistantId ? <BuddyProcessingMessage /> : null}
      </div>

      <form
        className={`buddy-input-row room-composer ${
          attachments.length ? "has-attachments" : ""
        }`}
        onSubmit={handleSubmit}
      >
        <input
          accept={BUDDY_ATTACHMENT_ACCEPT}
          id={fileInputId}
          multiple
          onChange={handleFileSelection}
          ref={fileInputRef}
          type="file"
        />
        {attachments.length ? (
          <div className="attachment-preview-row pending-attachments buddy-composer-attachments">
            {attachments.map((file, index) => (
              <AttachmentPreview
                file={fileToPendingAttachment(file, index)}
                key={`${file.name}-${file.size}-${index}`}
                onRemove={() => removeAttachment(index)}
              />
            ))}
          </div>
        ) : null}
        {providerPickerOpen ? (
          <div
            aria-label="Choose Intelligrate model"
            className="buddy-model-picker-popover"
            onClick={(event) => event.stopPropagation()}
            ref={providerPickerRef}
            role="dialog"
          >
            <label className="buddy-model-picker-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search models</span>
              <input
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const firstAvailableProvider = filteredProviderOptions.find(
                    (provider) => provider.available !== false,
                  );
                  if (firstAvailableProvider) selectProvider(firstAvailableProvider);
                }}
                onChange={(event) => setProviderPickerSearch(event.target.value)}
                placeholder="Search models"
                ref={providerPickerSearchRef}
                value={providerPickerSearch}
              />
            </label>
            <div className="buddy-model-picker-list" role="listbox">
              {filteredProviderOptions.length ? (
                filteredProviderOptions.map((provider) => {
                  const disabled = thinking || provider.available === false;
                  const selected = selectedProvider.id === provider.id;
                  return (
                    <button
                      aria-label={`Use ${provider.label}`}
                      aria-selected={selected}
                      className={selected ? "selected" : ""}
                      disabled={disabled}
                      key={provider.id}
                      onClick={() => selectProvider(provider)}
                      role="option"
                      type="button"
                    >
                      <BuddyProviderIcon provider={provider} />
                      <span>
                        <strong>{provider.label}</strong>
                        <small>
                          {provider.available === false
                            ? provider.unavailableReason || "Unavailable"
                            : providerPickerSubtitle(provider)}
                        </small>
                      </span>
                      {selected ? <Check size={16} aria-hidden="true" /> : null}
                    </button>
                  );
                })
              ) : (
                <p>
                  {providerPickerSearch.trim()
                    ? "No saved models match your search."
                    : "Add LLM API keys in User Settings to switch models."}
                </p>
              )}
            </div>
          </div>
        ) : null}
        <textarea
          ref={draftInputRef}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onChange={handleDraftChange}
          placeholder="Ask anything"
          rows={1}
          value={draft}
        />
        <div className="buddy-composer-footer">
          <div className="buddy-composer-tools">
            <button
              aria-label="Select Attachment"
              className="buddy-attach-button"
              data-tooltip="Select Attachment"
              disabled={thinking}
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
              type="button"
            >
              <Plus size={20} />
            </button>
            <button
              aria-expanded={providerPickerOpen}
              aria-label={`Choose Model: ${selectedProvider.label}`}
              className={`buddy-model-selector-button ${
                selectedProviderUnavailable ? "unavailable" : ""
              }`}
              data-tooltip={selectedProviderUnavailable || undefined}
              disabled={thinking}
              onClick={(event) => {
                event.stopPropagation();
                if (providerPickerOpen) {
                  setProviderPickerOpen(false);
                } else {
                  openProviderPicker();
                }
              }}
              type="button"
            >
              <BuddyProviderIcon provider={selectedProvider} />
              <span>{selectedProvider.label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <button
            aria-label={thinking ? "Stop Response" : "Send"}
            className={`buddy-send-button ${thinking ? "is-stopping" : ""}`}
            data-tooltip={thinking ? "Stop Response" : selectedProviderUnavailable || "Send"}
            disabled={!thinking && (!draft.trim() && !attachments.length || Boolean(selectedProviderUnavailable))}
            onClick={thinking ? handleStopResponse : undefined}
            type={thinking ? "button" : "submit"}
          >
            {thinking ? <Square fill="currentColor" size={13} /> : <ArrowUp size={19} />}
          </button>
        </div>
      </form>

      {draggingFiles ? (
        <div className="buddy-drop-overlay">
          <Upload size={22} />
          <span>Drop files to add them</span>
        </div>
      ) : null}
    </section>
  );
}

export { BuddyPanel };
