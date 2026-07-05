import {
  CheckCircle2,
  Edit3,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent } from "react";
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
  onError: (message: string) => void;
  onUpdateAnnotation: (
    id: string,
    patch: { comment?: string; annotationType?: string; resolved?: boolean },
  ) => Promise<void>;
  resourceId: string;
};

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
  if (filter === "unresolved") return "All questions are resolved. Nice work!";
  const type = getAnnotationType(filter);
  return `No ${type.label.toLowerCase()} annotations yet.`;
}

function formatAnnotationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function AnnotationThreadCard({
  annotation,
  currentUser,
  currentUserId,
  editing,
  editComment,
  editType,
  isActive,
  isOwner,
  onAddReply,
  onBeginEdit,
  onCancelEdit,
  onDeleteAnnotation,
  onError,
  onSaveEdit,
  onSetEditComment,
  onSetEditType,
  onToggleResolved,
  replyDraft,
  replyOpen,
  setReplyDraft,
  setReplyOpen,
}: {
  annotation: Annotation;
  currentUser: AnnotationSidebarProps["currentUser"];
  currentUserId: string;
  editing: boolean;
  editComment: string;
  editType: AnnotationType;
  isActive: boolean;
  isOwner: boolean;
  onAddReply: (annotationId: string, comment: string) => Promise<void>;
  onBeginEdit: (annotation: Annotation) => void;
  onCancelEdit: () => void;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onError: (message: string) => void;
  onSaveEdit: (id: string) => Promise<void>;
  onSetEditComment: (value: string) => void;
  onSetEditType: (value: AnnotationType) => void;
  onToggleResolved: (annotation: Annotation) => Promise<void>;
  replyDraft: string;
  replyOpen: boolean;
  setReplyDraft: (value: string) => void;
  setReplyOpen: (open: boolean) => void;
}) {
  const [submittingReply, setSubmittingReply] = useState(false);
  const type = getAnnotationType(annotation.annotationType);
  const ownsAnnotation = annotation.author?.id === currentUserId;
  const canDelete = ownsAnnotation || isOwner;
  const canToggleResolved = annotation.annotationType === "question";
  const annotationAuthor = mergeCurrentUserProfile(annotation.author, currentUser);

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    const comment = replyDraft.trim();
    if (!comment) return;

    setSubmittingReply(true);
    try {
      await onAddReply(annotation.id, comment);
      setReplyDraft("");
      setReplyOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to add reply.");
    } finally {
      setSubmittingReply(false);
    }
  }

  return (
    <article
      className={`document-annotation-card ${isActive ? "active" : ""}`}
      style={{ "--annotation-color": type.color } as CSSProperties}
    >
      <div className="document-annotation-card-actions">
        {ownsAnnotation ? (
          <button aria-label="Edit annotation" onClick={() => onBeginEdit(annotation)} type="button">
            <Edit3 size={15} />
          </button>
        ) : null}
        {canDelete ? (
          <button aria-label="Delete annotation" onClick={() => onDeleteAnnotation(annotation.id)} type="button">
            <Trash2 size={15} />
          </button>
        ) : null}
        {canToggleResolved ? (
          <button
            aria-label={annotation.resolved ? "Mark unresolved" : "Mark resolved"}
            onClick={() => onToggleResolved(annotation)}
            type="button"
          >
            {annotation.resolved ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
          </button>
        ) : null}
      </div>

      <div className="document-annotation-card-topline">
        <span className="document-annotation-type-badge">{type.label}</span>
        {getPageNumber(annotation) ? <small>Page {getPageNumber(annotation)}</small> : null}
      </div>

      {annotation.content?.text ? (
        <blockquote className="document-annotation-excerpt">{annotation.content.text}</blockquote>
      ) : null}

      <div className="document-annotation-author-row">
        <DocumentAuthorAvatar author={annotation.author} currentUser={currentUser} />
        <strong>{annotationAuthor.name || "Unknown"}</strong>
        <time>{formatAnnotationTime(annotation.createdAt)}</time>
        {annotation.resolved ? <em>Resolved</em> : null}
      </div>

      {editing ? (
        <div className="document-annotation-edit-form">
          <AppSelectMenu
            ariaLabel="Edit annotation type"
            className="document-annotation-type-select compact"
            label="Type"
            onChange={(value) => onSetEditType(value as AnnotationType)}
            options={ANNOTATION_TYPES.map((nextType) => ({
              label: nextType.label,
              value: nextType.id,
            }))}
            value={editType}
          />
          <textarea
            onChange={(event) => onSetEditComment(event.target.value)}
            rows={3}
            value={editComment}
          />
          <div>
            <button className="secondary-button compact" onClick={onCancelEdit} type="button">
              Cancel
            </button>
            <button className="primary-button compact" onClick={() => onSaveEdit(annotation.id)} type="button">
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="document-annotation-comment">{annotation.comment}</p>
      )}

      {annotation.replies?.length ? (
        <div className="document-annotation-replies">
          {annotation.replies.map((reply) => (
            <div className="document-annotation-reply" key={reply.id}>
              <DocumentAuthorAvatar author={reply.author} currentUser={currentUser} small />
              <div>
                <p>
                  <strong>{mergeCurrentUserProfile(reply.author, currentUser).name || "Unknown"}</strong>
                  <time>{formatAnnotationTime(reply.createdAt)}</time>
                </p>
                <span>{reply.comment}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {replyOpen ? (
        <form className="document-annotation-reply-form" onSubmit={submitReply}>
          <input
            autoFocus
            onChange={(event) => setReplyDraft(event.target.value)}
            placeholder="Reply to this thread"
            value={replyDraft}
          />
          <button aria-label="Send reply" disabled={!replyDraft.trim() || submittingReply} type="submit">
            <Send size={15} />
          </button>
        </form>
      ) : (
        <button className="document-annotation-reply-trigger" onClick={() => setReplyOpen(true)} type="button">
          <MessageSquarePlus size={15} />
          Reply
        </button>
      )}
    </article>
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
      onError,
      onUpdateAnnotation,
      resourceId,
    },
    ref,
  ) {
    const [activeFilter, setActiveFilter] = useState<AnnotationFilter>("all");
    const [sortOrder, setSortOrder] = useState<AnnotationSort>("page");
    const [activeAnnotationId, setActiveAnnotationId] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editComment, setEditComment] = useState("");
    const [editType, setEditType] = useState<AnnotationType>("general");
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [openReplyId, setOpenReplyId] = useState("");
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

    useImperativeHandle(ref, () => ({
      openThread(annotationId: string) {
        setActiveAnnotationId(annotationId);
        threadRefs.current[annotationId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    }));

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

    async function saveEdit(annotationId: string) {
      try {
        await onUpdateAnnotation(annotationId, {
          annotationType: editType,
          comment: editComment.trim(),
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
      } catch (error) {
        onError(error instanceof Error ? error.message : "Unable to delete annotation.");
      }
    }

    function setReplyDraft(annotationId: string, value: string) {
      setReplyDrafts((current) => ({ ...current, [annotationId]: value }));
    }

    const countLabel =
      activeFilter === "all"
        ? String(channelAnnotations.length)
        : `${visibleAnnotations.length} of ${channelAnnotations.length}`;

    return (
      <aside className="document-annotation-sidebar" aria-label="Annotation threads">
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
              ariaLabel="Annotation filter"
              className="document-annotation-filter-select"
              onChange={(value) => setActiveFilter(value as AnnotationFilter)}
              options={FILTER_OPTIONS.map((option) => ({
                label: option.label,
                value: option.id,
              }))}
              value={activeFilter}
            />
            <div className="document-annotation-sort-toggle" aria-label="Annotation sort">
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
            visibleAnnotations.map((annotation) => (
              <div
                key={annotation.id}
                ref={(node) => {
                  threadRefs.current[annotation.id] = node;
                }}
              >
                <AnnotationThreadCard
                  annotation={annotation}
                  currentUser={currentUser}
                  currentUserId={currentUser.id}
                  editComment={editComment}
                  editing={editingId === annotation.id}
                  editType={editType}
                  isActive={activeAnnotationId === annotation.id}
                  isOwner={isOwner}
                  onAddReply={onAddReply}
                  onBeginEdit={beginEdit}
                  onCancelEdit={cancelEdit}
                  onDeleteAnnotation={deleteAnnotation}
                  onError={onError}
                  onSaveEdit={saveEdit}
                  onSetEditComment={setEditComment}
                  onSetEditType={setEditType}
                  onToggleResolved={toggleResolved}
                  replyDraft={replyDrafts[annotation.id] || ""}
                  replyOpen={openReplyId === annotation.id}
                  setReplyDraft={(value) => setReplyDraft(annotation.id, value)}
                  setReplyOpen={(open) => setOpenReplyId(open ? annotation.id : "")}
                />
              </div>
            ))
          ) : (
            <div className="document-annotation-empty">
              {getEmptyAnnotationMessage(activeFilter)}
            </div>
          )}
        </div>
      </aside>
    );
  },
);
