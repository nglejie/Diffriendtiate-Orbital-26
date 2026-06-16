import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Info,
  ListChecks,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import "katex/dist/katex.min.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { resourceToAttachment } from "../../shared/utils/room.js";
import { UPLOADS_FOLDER } from "./roomConstants.js";
import {
  buildSourceResourceMap,
  compactBuddyText,
  createBuddyThoughtItem,
  formatBuddyResponseText,
  formatBuddyToolEvent,
  getBuddyChainFinalAnswer,
  getBuddyChainFinalVisibleResponse,
  getBuddyThoughtSummary,
  mergeBuddyThoughtSteps,
  normalizeBuddyMarkdown,
  normalizeMathGlyphs,
  normalizeSourceKey,
  splitBuddyVisibleThinking,
  uniqueBuddySteps,
} from "./buddyUtils.js";

/** Chooses the progress icon based on the streamed Intelligrate event type. */
function getBuddyThoughtIcon(step) {
  if (step.type === "done") return CheckCircle2;
  if (step.type === "tool") {
    if (step.tool === "search_corpus") {
      return step.status === "done" ? ListChecks : Search;
    }
    if (step.tool === "read_file") return FileText;
    return Terminal;
  }
  return Clock;
}

/** Renders Intelligrate answers with markdown, math, and formatting cleanup applied. */
function renderBuddyMarkdown(text) {
  const markdown = normalizeBuddyMarkdown(text);
  if (!markdown) return null;

  return (
    <ReactMarkdown
      className="buddy-markdown"
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {markdown}
    </ReactMarkdown>
  );
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
function AttachmentPreview({ file, onRemove }) {
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
function MessageActions({ message, onCopy, onEdit }) {
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
  resources = [],
  syncingResources,
  threadId,
  threadTitle,
  user,
}) {
  const fileInputId = useId();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [liveAssistantId, setLiveAssistantId] = useState("");
  const [collapsedThoughts, setCollapsedThoughts] = useState({});
  const fileInputRef = useRef(null);
  const draftInputRef = useRef(null);
  const editInputRef = useRef(null);
  const listRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sourceResourceMap = useMemo(() => buildSourceResourceMap(resources), [resources]);

  // Keep the latest streamed response visible without forcing the user to scroll manually.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  // Abort an in-flight Intelligrate request if the user leaves the panel.
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

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

  // Close the attachment menu after the next outside click.
  useEffect(() => {
    if (!composerMenuOpen) return undefined;

    function closeMenu() {
      setComposerMenuOpen(false);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [composerMenuOpen]);

  /** Adds selected or dropped files to the pending message attachments. */
  function addAttachments(fileList) {
    setAttachments((current) => [...current, ...Array.from(fileList || [])]);
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
      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        preface: "",
        body: "",
        sources: [],
        thinkingSteps: [],
        isThinking: true,
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

      onMessagesChange([...nextMessages, assistantMessage], targetThreadId);
      setLiveAssistantId(assistantId);

      await onAskBuddy(nextMessages, uploadedResources, {
        signal: controller.signal,
        onToken: (token) => {
          if (!token) return;

          streamedRawBody += token;
          const visibleStream = splitBuddyVisibleThinking(streamedRawBody);
          streamedBody = visibleStream.answer;

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
          streamedBody = stripPreToolText(visibleAnswer.answer);
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
          if (chainResponse.answer && chainResponse.answer.length >= streamedBody.length) {
            streamedBody = stripPreToolText(chainResponse.answer);
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
    setComposerMenuOpen(false);
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
          disabled={thinking || syncingResources}
          onClick={handleSyncResources}
          title="Sync room resources with Intelligrate"
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
              file attached, or any relevant resources already uploaded into the study room.
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
                  <span>Intelligrate</span>
                  {showProcessingText ? <BuddyProcessingText /> : null}
                  {message.preface ? (
                    <div className="buddy-preface">
                      {renderBuddyMarkdown(message.preface)}
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
                              className={`buddy-thinking-step ${step.type} ${step.status ? `status-${step.status}` : ""
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
                      : renderBuddyMarkdown(message.body)
                    : null}
                  {message.sources?.length ? (
                    <div className="buddy-source-row">
                      {message.sources.map((source) => {
                        const resource = sourceResourceMap.get(normalizeSourceKey(source));
                        const chipContent = (
                          <>
                            <FileText size={13} />
                            {source}
                          </>
                        );

                        return resource?.url ? (
                          <a
                            href={resource.url}
                            key={source}
                            rel="noreferrer"
                            target="_blank"
                            title="Open source in a new tab"
                          >
                            {chipContent}
                          </a>
                        ) : (
                          <span key={source}>{chipContent}</span>
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
        <textarea
          ref={draftInputRef}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything"
          rows={1}
          value={draft}
        />
        <div className="buddy-composer-footer">
          <div className="buddy-attach-menu-wrap">
            <button
              className="buddy-attach-button"
              disabled={thinking}
              onClick={(event) => {
                event.stopPropagation();
                setComposerMenuOpen((current) => !current);
              }}
              title="Add content"
              type="button"
            >
              <Plus size={20} />
            </button>
            {composerMenuOpen ? (
              <div
                className="buddy-attach-menu"
                onClick={(event) => event.stopPropagation()}
                role="menu"
              >
                <label
                  className="buddy-attach-menu-item"
                  htmlFor={fileInputId}
                  onClick={(event) => {
                    event.stopPropagation();
                    window.setTimeout(() => setComposerMenuOpen(false), 0);
                  }}
                  role="menuitem"
                >
                  <Paperclip size={18} />
                  Attach file
                </label>
              </div>
            ) : null}
          </div>
          <button
            className={`buddy-send-button ${thinking ? "is-stopping" : ""}`}
            disabled={!thinking && !draft.trim() && !attachments.length}
            onClick={thinking ? handleStopResponse : undefined}
            title={thinking ? "Stop response" : "Send"}
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
