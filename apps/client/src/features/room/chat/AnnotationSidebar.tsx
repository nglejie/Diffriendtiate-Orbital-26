import {
  ArrowLeft,
  ArrowUp,
  Bold,
  CheckCircle2,
  Code2,
  Crosshair,
  Edit3,
  Italic,
  Link,
  MessageSquareQuote,
  RotateCcw,
  SmilePlus,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
} from "lucide-react";
import DOMPurify from "dompurify";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapLink from "@tiptap/extension-link";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import SmallSettingsDialog from "../../../shared/ui/SmallSettingsDialog.tsx";
import { EmojiPickerPopover } from "./EmojiPickerPopover.tsx";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import { DocumentAuthorAvatar, mergeCurrentUserProfile } from "./DocumentAuthorAvatar.tsx";

export const ANNOTATION_TYPES = [
  { id: "question", label: "Question", color: "#f59e0b" },
  { id: "key-point", label: "Key Point", color: "#3b82f6" },
  { id: "definition", label: "Definition", color: "#8b5cf6" },
  { id: "mistake", label: "Common Mistake", color: "#ef4444" },
  { id: "insight", label: "Insight", color: "#10b981" },
  { id: "general", label: "Note", color: "#6b7280" },
] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number]["id"];
export type AnnotationFilter = AnnotationType | "all" | "unresolved";
type AnnotationSort = "page" | "date";

export interface Annotation {
  id: string;
  channel: string;
  resourceId: string;
  position: any;
  content: { text?: string; image?: string };
  comment: string;
  annotationType: AnnotationType;
  resolved: boolean;
  author: { id: string; name: string; avatarPreset?: any; avatarUrl?: string };
  replies: Array<{
    id: string;
    author: { id: string; name: string; avatarPreset?: any; avatarUrl?: string };
    comment: string;
    createdAt: string;
  }>;
  createdAt: string;
}

export type DocumentPresenceMember = {
  avatarPreset?: any;
  avatarUrl?: string;
  email?: string;
  userId: string;
  name: string;
  page: number;
  initial: string;
};

export type AnnotationSidebarHandle = {
  openThread: (annotationId: string) => void;
};

type AnnotationSidebarProps = {
  activeChannel: string;
  annotations: Annotation[];
  currentUser: { id: string; name: string; email: string; avatarPreset?: any; avatarUrl?: string };
  isOwner?: boolean;
  onAddReply: (annotationId: string, comment: string) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onDeleteReply: (annotationId: string, replyId: string) => Promise<void>;
  onError: (message: string) => void;
  onJumpToAnnotation?: (annotationId: string) => void;
  onUpdateAnnotation: (
    id: string,
    patch: { comment?: string; annotationType?: string; resolved?: boolean },
  ) => Promise<void>;
  resourceId: string;
};

type RichAnnotationComposerProps = {
  autoFocus?: boolean;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  initialValue?: string;
  onSubmit: (html: string) => Promise<void> | void;
  placeholder: string;
};

function AnnotationThreadIconButton({
  children,
  className,
  label,
  onClick,
}: {
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
}) {
  const classNames = ["has-inline-tooltip", className].filter(Boolean).join(" ");

  return (
    <button aria-label={label} className={classNames} data-tooltip={label} onClick={onClick} type="button">
      {children}
    </button>
  );
}

const FILTER_OPTIONS: Array<{ id: AnnotationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "question", label: "Questions" },
  { id: "key-point", label: "Key Points" },
  { id: "definition", label: "Definitions" },
  { id: "mistake", label: "Mistakes" },
  { id: "insight", label: "Insights" },
  { id: "general", label: "Notes" },
  { id: "unresolved", label: "Unresolved Questions" },
];

const MESSAGE_SANITIZE_OPTIONS = {
  ALLOWED_ATTR: ["class", "data-id", "data-label", "data-type", "href", "rel", "target"],
  ALLOWED_TAGS: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "u",
    "ul",
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
  underline: false,
};

export function getAnnotationType(typeId: string = "general") {
  return ANNOTATION_TYPES.find((type) => type.id === typeId) || ANNOTATION_TYPES.at(-1)!;
}

export function getPageNumber(annotation: Annotation) {
  const page = Number(
    annotation.position?.pageNumber ||
      annotation.position?.boundingRect?.pageNumber ||
      annotation.position?.page ||
      0,
  );

  if (Number.isFinite(page) && page > 0) return page;
  return annotation.position?.x !== undefined || annotation.position?.y !== undefined ? 1 : 0;
}

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

function getEditorHtml(editor: any) {
  if (!editor || editor.isDestroyed || !editor.schema) return "";
  try {
    return editor.getHTML();
  } catch {
    return "";
  }
}

function messagePreviewText(value = "", fallback = "Annotation") {
  if (!value) return fallback;
  if (!isHtmlMessage(value)) return value;
  const container = document.createElement("div");
  container.innerHTML = DOMPurify.sanitize(value, MESSAGE_SANITIZE_OPTIONS);
  return container.textContent || fallback;
}

function getPositionSortValue(annotation: Annotation) {
  const rect = annotation.position?.boundingRect || {};
  return [
    getPageNumber(annotation),
    Number(rect.y1 ?? rect.top ?? annotation.position?.y ?? 0),
    Number(rect.x1 ?? rect.left ?? annotation.position?.x ?? 0),
  ];
}

function compareByPage(a: Annotation, b: Annotation) {
  const aPosition = getPositionSortValue(a);
  const bPosition = getPositionSortValue(b);
  return (
    aPosition[0] - bPosition[0] ||
    aPosition[1] - bPosition[1] ||
    aPosition[2] - bPosition[2] ||
    String(a.createdAt).localeCompare(String(b.createdAt))
  );
}

function getDateSortValue(annotation: Annotation) {
  const timestamp = Date.parse(annotation.createdAt || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isAnnotationVisible(annotation: Annotation, filter: AnnotationFilter) {
  if (filter === "all") return true;
  if (filter === "unresolved") return !annotation.resolved && annotation.annotationType === "question";
  return annotation.annotationType === filter;
}

function getEmptyAnnotationMessage(filter: AnnotationFilter) {
  if (filter === "all") return "No annotations yet. Select text in the document to add the first one.";
  if (filter === "question") return "No questions yet. Highlight confusing passages to ask the group.";
  if (filter === "key-point") return "No key points marked. Highlight important content to flag it.";
  if (filter === "unresolved") return "All questions are resolved.";
  const type = getAnnotationType(filter);
  return `No ${type.label.toLowerCase()} annotations yet.`;
}

function safeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function formatAnnotationTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(safeDate(value));
}

function formatAnnotationDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(safeDate(value));
}

function formatFullTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    year: "numeric",
  }).format(safeDate(value));
}

function AnnotationTimestamp({ value }: { value: string }) {
  return (
    <time className="document-message-time" data-tooltip={formatFullTimestamp(value)} dateTime={value}>
      {formatAnnotationTime(value)}
    </time>
  );
}

function getAnnotationDateKey(value: string) {
  const date = safeDate(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function ComposerButton({ active = false, children, label, onClick }: any) {
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

function LinkDialog({
  initialText,
  initialUrl,
  onClose,
  onSave,
}: {
  initialText: string;
  initialUrl: string;
  onClose: () => void;
  onSave: (value: { text: string; url: string }) => void;
}) {
  const [text, setText] = useState(initialText || "");
  const [url, setUrl] = useState(initialUrl || "");

  function handleSubmit(event: FormEvent) {
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
        <button className="primary-button compact" disabled={!url.trim()} type="submit">
          Save
        </button>
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

export function AnnotationMessageBody({ body }: { body: string }) {
  if (!body) return null;

  if (isHtmlMessage(body)) {
    return (
      <div
        className="discord-message-markdown document-annotation-rich-body"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(body, MESSAGE_SANITIZE_OPTIONS),
        }}
      />
    );
  }

  return <p className="document-annotation-comment">{body}</p>;
}

export function RichAnnotationComposer({
  autoFocus = false,
  buttonLabel = "Post",
  className = "",
  disabled = false,
  initialValue = "",
  onSubmit,
  placeholder,
}: RichAnnotationComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ text: string; url: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bubbleMenuKey = useId().replace(/:/g, "");
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const submitComposerRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      TiptapLink.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
        protocols: ["http", "https"],
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: draftToEditorContent(initialValue),
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        class: "discord-rich-editor",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter") return false;
        const inList = editor?.isActive("bulletList") || editor?.isActive("orderedList");

        if (event.shiftKey && inList && editor?.commands.splitListItem("listItem")) {
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
  });
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
            underline: stateEditor.isActive("underline"),
          }
        : EMPTY_TOOLBAR_STATE,
  }) || EMPTY_TOOLBAR_STATE;

  useEffect(() => {
    if (autoFocus) editor?.commands.focus("end");
  }, [autoFocus, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const nextContent = draftToEditorContent(initialValue);
    if (getEditorHtml(editor) !== nextContent) {
      editor.commands.setContent(nextContent, false);
    }
  }, [editor, initialValue]);

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    const existingHref = editor.getAttributes("link").href || "";
    setLinkDialog({ text: selectedText, url: existingHref });
  }

  function saveLink({ text, url }: { text: string; url: string }) {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty) {
      editor.chain().focus().insertContent(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkDialog(null);
  }

  function toggleInlineMark(markName: string, runToggle: () => void) {
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
    if (!editor || editor.isDestroyed) return;
    const body = editor.isEmpty ? "" : DOMPurify.sanitize(getEditorHtml(editor), MESSAGE_SANITIZE_OPTIONS);
    if (editorHtmlIsEmpty(body) || disabled || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit(body);
      editor.commands.clearContent();
      setEmojiOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitComposer();
  }

  useEffect(() => {
    submitComposerRef.current = submitComposer;
  });

  return (
    <>
      <form className={`discord-composer document-annotation-composer ${className}`} onSubmit={handleSubmit}>
        <EditorContent editor={editor} />
        {editor ? (
          <BubbleMenu
            appendTo={document.body}
            className="annotation-selection-toolbar"
            editor={editor}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            options={{ offset: 8, placement: "top", shift: true }}
            pluginKey={`annotationBubbleMenu-${bubbleMenuKey}`}
            shouldShow={({ editor: menuEditor, from, to }) =>
              menuEditor.isEditable && from !== to && !menuEditor.isDestroyed
            }
          >
            <ComposerButton
              active={toolbarState.bold}
              label="Bold"
              onClick={() => toggleInlineMark("bold", () => editor.chain().focus().toggleBold().run())}
            >
              <Bold size={16} />
            </ComposerButton>
            <ComposerButton
              active={toolbarState.italic}
              label="Italic"
              onClick={() => toggleInlineMark("italic", () => editor.chain().focus().toggleItalic().run())}
            >
              <Italic size={16} />
            </ComposerButton>
            <ComposerButton
              active={toolbarState.underline}
              label="Underline"
              onClick={() => toggleInlineMark("underline", () => editor.chain().focus().toggleUnderline().run())}
            >
              <UnderlineIcon size={16} />
            </ComposerButton>
            <ComposerButton
              active={toolbarState.strike}
              label="Strikethrough"
              onClick={() => toggleInlineMark("strike", () => editor.chain().focus().toggleStrike().run())}
            >
              <Strikethrough size={16} />
            </ComposerButton>
            <ComposerButton
              active={toolbarState.blockquote}
              label="Quote"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <MessageSquareQuote size={16} />
            </ComposerButton>
            <ComposerButton
              active={toolbarState.code}
              label="Code"
              onClick={() => toggleInlineMark("code", () => editor.chain().focus().toggleCode().run())}
            >
              <Code2 size={16} />
            </ComposerButton>
            <ComposerButton active={toolbarState.link} label="Link" onClick={openLinkDialog}>
              <Link size={16} />
            </ComposerButton>
          </BubbleMenu>
        ) : null}
        <div className="annotation-composer-actions" aria-label="Annotation Actions">
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
          <ComposerButton active={toolbarState.link} label="Link" onClick={openLinkDialog}>
            <Link size={16} />
          </ComposerButton>
        </div>
        <button
          aria-label={buttonLabel}
          data-tooltip={buttonLabel}
          disabled={disabled || submitting || toolbarState.empty}
          type="submit"
        >
          <ArrowUp size={18} strokeWidth={2.4} />
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
    </>
  );
}

function AnnotationPreviewCard({
  annotation,
  currentUser,
  onOpenThread,
}: {
  annotation: Annotation;
  currentUser: AnnotationSidebarProps["currentUser"];
  onOpenThread: (id: string) => void;
}) {
  const type = getAnnotationType(annotation.annotationType);
  const annotationAuthor = mergeCurrentUserProfile(annotation.author, currentUser);
  const replyCount = annotation.replies?.length || 0;

  return (
    <article
      className="document-annotation-preview"
      style={{ "--annotation-color": type.color } as CSSProperties}
    >
      <button
        aria-label={`Open ${type.label} annotation thread: ${messagePreviewText(annotation.comment || annotation.content?.text || "", "Annotation")}`}
        className="document-annotation-preview-main"
        onClick={() => onOpenThread(annotation.id)}
        type="button"
      >
      <span className="document-annotation-preview-topline">
        <span className="document-annotation-type-badge">{type.label}</span>
        {getPageNumber(annotation) ? <small>Page {getPageNumber(annotation)}</small> : null}
      </span>
      <span className="document-annotation-preview-body">
        <DocumentAuthorAvatar author={annotation.author} currentUser={currentUser} />
          <span>
            <span className="document-annotation-author-row compact">
              <strong>{annotationAuthor.name || "Unknown"}</strong>
              <AnnotationTimestamp value={annotation.createdAt} />
            </span>
            <strong className="document-annotation-preview-text">
              {messagePreviewText(annotation.comment || annotation.content?.text || "", "Annotation")}
          </strong>
          <small className="document-annotation-preview-replies">
            {replyCount ? `${replyCount} ${replyCount === 1 ? "Reply" : "Replies"}` : "No Replies Yet"}
            {annotation.resolved ? " · Resolved" : ""}
          </small>
        </span>
      </span>
      </button>
    </article>
  );
}

function AnnotationThreadView({
  annotation,
  currentUser,
  currentUserId,
  editing,
  editComment,
  editType,
  isOwner,
  onAddReply,
  onBeginEdit,
  onCancelEdit,
  onCloseThread,
  onDeleteAnnotation,
  onDeleteReply,
  onError,
  onJumpToAnnotation,
  onSaveEdit,
  onSetEditComment,
  onSetEditType,
  onToggleResolved,
}: {
  annotation: Annotation;
  currentUser: AnnotationSidebarProps["currentUser"];
  currentUserId: string;
  editing: boolean;
  editComment: string;
  editType: AnnotationType;
  isOwner: boolean;
  onAddReply: (annotationId: string, comment: string) => Promise<void>;
  onBeginEdit: (annotation: Annotation) => void;
  onCancelEdit: () => void;
  onCloseThread: () => void;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onDeleteReply: (annotationId: string, replyId: string) => Promise<void>;
  onError: (message: string) => void;
  onJumpToAnnotation?: (annotationId: string) => void;
  onSaveEdit: (id: string, comment?: string) => Promise<void>;
  onSetEditComment: (value: string) => void;
  onSetEditType: (value: AnnotationType) => void;
  onToggleResolved: (annotation: Annotation) => Promise<void>;
}) {
  const type = getAnnotationType(annotation.annotationType);
  const ownsAnnotation = annotation.author?.id === currentUserId;
  const canDelete = ownsAnnotation || isOwner;
  const canToggleResolved = annotation.annotationType === "question";
  const annotationAuthor = mergeCurrentUserProfile(annotation.author, currentUser);

  async function submitReply(html: string) {
    try {
      await onAddReply(annotation.id, html);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to add reply.");
    }
  }

  async function deleteReply(replyId: string) {
    try {
      await onDeleteReply(annotation.id, replyId);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to delete reply.");
    }
  }

  return (
    <div className="document-annotation-thread" style={{ "--annotation-color": type.color } as CSSProperties}>
      <header className="document-annotation-thread-header">
        <AnnotationThreadIconButton align="start" label="Back To Annotations" onClick={onCloseThread}>
          <ArrowLeft size={18} />
        </AnnotationThreadIconButton>
        <span>
          <strong>{type.label}</strong>
          {getPageNumber(annotation) ? <small>Page {getPageNumber(annotation)}</small> : null}
        </span>
        <div>
          {canToggleResolved ? (
            <AnnotationThreadIconButton
              label={annotation.resolved ? "Mark Unresolved" : "Mark Resolved"}
              onClick={() => onToggleResolved(annotation)}
            >
              {annotation.resolved ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
            </AnnotationThreadIconButton>
          ) : null}
          {onJumpToAnnotation ? (
            <AnnotationThreadIconButton label="Jump To Annotation" onClick={() => onJumpToAnnotation(annotation.id)}>
              <Crosshair size={15} />
            </AnnotationThreadIconButton>
          ) : null}
        </div>
      </header>

      <div className="document-annotation-thread-scroll">
        {annotation.content?.text ? (
          <blockquote className="document-annotation-excerpt">{annotation.content.text}</blockquote>
        ) : null}

        <article className="document-thread-message root">
          <DocumentAuthorAvatar author={annotation.author} currentUser={currentUser} />
          <div>
            <div className="discord-message-meta">
              <strong>{annotationAuthor.name || "Unknown"}</strong>
              <AnnotationTimestamp value={annotation.createdAt} />
              {annotation.resolved ? <em>Resolved</em> : null}
            </div>
            {editing ? (
              <div className="document-annotation-edit-form">
                <AppSelectMenu
                  ariaLabel="Edit Annotation Type"
                  className="document-annotation-type-select compact"
                  label="Type"
                  onChange={(value) => onSetEditType(value as AnnotationType)}
                  options={ANNOTATION_TYPES.map((nextType) => ({
                    label: nextType.label,
                    value: nextType.id,
                  }))}
                  value={editType}
                />
                <RichAnnotationComposer
                  autoFocus
                  buttonLabel="Save"
                  initialValue={editComment}
                  onSubmit={(html) => onSaveEdit(annotation.id, html)}
                  placeholder="Edit annotation"
                />
                <button className="document-annotation-text-button" onClick={onCancelEdit} type="button">
                  Stop Editing
                </button>
              </div>
            ) : (
              <AnnotationMessageBody body={annotation.comment} />
            )}
          </div>
          {ownsAnnotation || canDelete ? (
            <div className="discord-message-actions document-thread-message-actions">
              {ownsAnnotation ? (
                <button
                  aria-label="Edit Annotation"
                  data-tooltip="Edit Annotation"
                  onClick={() => onBeginEdit(annotation)}
                  type="button"
                >
                  <Edit3 size={15} />
                </button>
              ) : null}
              {canDelete ? (
                <button
                  aria-label="Delete Annotation"
                  className="danger"
                  data-tooltip="Delete Annotation"
                  onClick={() => onDeleteAnnotation(annotation.id)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ) : null}
        </article>

        {annotation.replies?.length ? (
          <div className="document-thread-replies">
            {annotation.replies.map((reply) => {
              const replyAuthor = mergeCurrentUserProfile(reply.author, currentUser);
              const canDeleteReply =
                reply.author?.id === currentUserId || annotation.author?.id === currentUserId || isOwner;
              return (
                <article className="document-thread-message" key={reply.id}>
                  <DocumentAuthorAvatar author={reply.author} currentUser={currentUser} />
                  <div>
                    <div className="discord-message-meta">
                      <strong>{replyAuthor.name || "Unknown"}</strong>
                      <AnnotationTimestamp value={reply.createdAt} />
                    </div>
                    <AnnotationMessageBody body={reply.comment} />
                  </div>
                  {canDeleteReply ? (
                    <div className="discord-message-actions document-thread-message-actions">
                      <button
                        aria-label="Delete Reply"
                        className="danger"
                        data-tooltip="Delete Reply"
                        onClick={() => deleteReply(reply.id)}
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      <RichAnnotationComposer
        buttonLabel="Send Reply"
        className="thread-reply"
        onSubmit={submitReply}
        placeholder={`Reply to ${type.label}`}
      />
    </div>
  );
}

export const AnnotationSidebar = forwardRef<AnnotationSidebarHandle, AnnotationSidebarProps>(
  function AnnotationSidebar(
    {
      activeChannel,
      annotations,
      currentUser,
      isOwner = false,
      onAddReply,
      onDeleteAnnotation,
      onDeleteReply,
      onError,
      onJumpToAnnotation,
      onUpdateAnnotation,
      resourceId,
    },
    ref,
  ) {
    const [activeFilter, setActiveFilter] = useState<AnnotationFilter>("all");
    const [sortOrder, setSortOrder] = useState<AnnotationSort>("page");
    const [threadAnnotationId, setThreadAnnotationId] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editComment, setEditComment] = useState("");
    const [editType, setEditType] = useState<AnnotationType>("general");
    const threadRefs = useRef<Record<string, HTMLElement | null>>({});

    const channelAnnotations = useMemo(
      () =>
        (Array.isArray(annotations) ? annotations : [])
          .filter((annotation) => annotation.channel === activeChannel && annotation.resourceId === resourceId)
          .map((annotation) => ({
            ...annotation,
            annotationType: getAnnotationType(annotation.annotationType).id,
            replies: Array.isArray(annotation.replies) ? annotation.replies : [],
          })),
      [activeChannel, annotations, resourceId],
    );

    const visibleAnnotations = useMemo(() => {
      const filtered = channelAnnotations.filter((annotation) => isAnnotationVisible(annotation, activeFilter));
      return [...filtered].sort((a, b) =>
        sortOrder === "date"
          ? getDateSortValue(b) - getDateSortValue(a)
          : compareByPage(a, b),
      );
    }, [activeFilter, channelAnnotations, sortOrder]);

    const activeThread = channelAnnotations.find((annotation) => annotation.id === threadAnnotationId) || null;

    useImperativeHandle(ref, () => ({
      openThread(annotationId: string) {
        setThreadAnnotationId(annotationId);
        window.setTimeout(() => {
          threadRefs.current[annotationId]?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      },
    }));

    function openThread(annotationId: string) {
      onJumpToAnnotation?.(annotationId);
      setThreadAnnotationId(annotationId);
    }

    function beginEdit(annotation: Annotation) {
      setEditingId(annotation.id);
      setEditComment(annotation.comment || "");
      setEditType(getAnnotationType(annotation.annotationType).id);
    }

    function cancelEdit() {
      setEditingId("");
      setEditComment("");
      setEditType("general");
    }

    async function saveEdit(annotationId: string, nextComment = editComment) {
      try {
        await onUpdateAnnotation(annotationId, {
          annotationType: editType,
          comment: nextComment.trim(),
        });
        cancelEdit();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Unable to update annotation.");
      }
    }

    async function toggleResolved(annotation: Annotation) {
      try {
        await onUpdateAnnotation(annotation.id, { resolved: !annotation.resolved });
      } catch (error) {
        onError(error instanceof Error ? error.message : "Unable to update annotation.");
      }
    }

    async function deleteAnnotation(annotationId: string) {
      try {
        await onDeleteAnnotation(annotationId);
        if (threadAnnotationId === annotationId) setThreadAnnotationId("");
      } catch (error) {
        onError(error instanceof Error ? error.message : "Unable to delete annotation.");
      }
    }

    const countLabel =
      activeFilter === "all"
        ? String(channelAnnotations.length)
        : `${visibleAnnotations.length} of ${channelAnnotations.length}`;

    let previousDateKey = "";

    return (
      <aside className="document-annotation-sidebar" aria-label="Annotation threads">
        {activeThread ? (
          <AnnotationThreadView
            annotation={activeThread}
            currentUser={currentUser}
            currentUserId={currentUser.id}
            editComment={editComment}
            editing={editingId === activeThread.id}
            editType={editType}
            isOwner={isOwner}
            onAddReply={onAddReply}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onCloseThread={() => {
              setThreadAnnotationId("");
              cancelEdit();
            }}
            onDeleteAnnotation={deleteAnnotation}
            onDeleteReply={onDeleteReply}
            onError={onError}
            onJumpToAnnotation={onJumpToAnnotation}
            onSaveEdit={saveEdit}
            onSetEditComment={setEditComment}
            onSetEditType={setEditType}
            onToggleResolved={toggleResolved}
          />
        ) : (
          <>
            <header>
              <div className="document-annotation-title-row">
                <h2>Annotations</h2>
                <div className="document-annotation-count" aria-label={`${countLabel} annotations`}>
                  <span>{activeFilter === "all" ? channelAnnotations.length : visibleAnnotations.length}</span>
                  {activeFilter !== "all" ? <small>of {channelAnnotations.length}</small> : null}
                </div>
              </div>
              <div className="document-annotation-controls">
                <AppSelectMenu
                  ariaLabel="Annotation Filter"
                  className="document-annotation-filter-select"
                  onChange={(value) => setActiveFilter(value as AnnotationFilter)}
                  options={FILTER_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  value={activeFilter}
                />
                <div className="document-annotation-sort-toggle" aria-label="Annotation Sort">
                  <button
                    aria-pressed={sortOrder === "page"}
                    className={sortOrder === "page" ? "active" : ""}
                    onClick={() => setSortOrder("page")}
                    type="button"
                  >
                    By Page
                  </button>
                  <button
                    aria-pressed={sortOrder === "date"}
                    className={sortOrder === "date" ? "active" : ""}
                    onClick={() => setSortOrder("date")}
                    type="button"
                  >
                    By Date
                  </button>
                </div>
              </div>
            </header>

            <div className="document-annotation-list">
              {visibleAnnotations.length ? (
                visibleAnnotations.map((annotation) => {
                  const dateKey = getAnnotationDateKey(annotation.createdAt);
                  const showDateDivider = sortOrder === "date" && dateKey !== previousDateKey;
                  previousDateKey = dateKey;

                  return (
                    <div
                      key={annotation.id}
                      ref={(node) => {
                        threadRefs.current[annotation.id] = node;
                      }}
                    >
                      {showDateDivider ? (
                        <div className="document-annotation-date-divider">
                          <span>{formatAnnotationDateLabel(annotation.createdAt) || "Unknown Date"}</span>
                        </div>
                      ) : null}
                      <AnnotationPreviewCard
                        annotation={annotation}
                        currentUser={currentUser}
                        onOpenThread={openThread}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="document-annotation-empty">
                  {getEmptyAnnotationMessage(activeFilter)}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    );
  },
);
