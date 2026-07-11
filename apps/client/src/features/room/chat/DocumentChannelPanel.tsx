import {
  AreaHighlight,
  MonitoredHighlightContainer,
  PdfHighlighter,
  PdfLoader,
  TextHighlight,
  useHighlightContainerContext,
  usePdfHighlighterContext,
} from "react-pdf-highlighter-extended";
import type {
  Highlight,
  PdfHighlighterUtils,
  PdfSelection,
  ScaledPosition,
  Tip,
} from "react-pdf-highlighter-extended";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getAuthToken } from "../../../api.ts";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import { AnnotationSidebar, RichAnnotationComposer } from "./AnnotationSidebar.tsx";
import type { AnnotationSidebarHandle } from "./AnnotationSidebar.tsx";
import { DocumentAuthorAvatar } from "./DocumentAuthorAvatar.tsx";

export const ANNOTATION_TYPES = [
  { id: "question", label: "Question", color: "#f59e0b" },
  { id: "key-point", label: "Key Point", color: "#3b82f6" },
  { id: "definition", label: "Definition", color: "#8b5cf6" },
  { id: "mistake", label: "Common Mistake", color: "#ef4444" },
  { id: "insight", label: "Insight", color: "#10b981" },
  { id: "general", label: "Note", color: "#6b7280" },
] as const;

type AnnotationType = (typeof ANNOTATION_TYPES)[number]["id"];

export interface Annotation {
  id: string;
  channel: string;
  resourceId: string;
  position: ScaledPosition | any;
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

type DocumentPresenceMember = {
  avatarPreset?: any;
  avatarUrl?: string;
  email?: string;
  userId: string;
  name: string;
  page: number;
  initial: string;
};

export interface DocumentChannelPanelProps {
  activeChannel: string;
  resourceId: string;
  resourceConversionStatus?: string;
  resourceFileUrl?: string;
  resourceMimeType?: string;
  resourcePdfUrl?: string;
  resourceType?: string;
  resourceUrl: string;
  resourceTitle: string;
  annotations: Annotation[];
  documentPresence: DocumentPresenceMember[];
  user: { id: string; name: string; email: string; avatarPreset?: any; avatarUrl?: string };
  onCreateAnnotation: (
    annotation: Omit<Annotation, "id" | "author" | "createdAt" | "replies" | "resolved">,
  ) => Promise<void>;
  onUpdateAnnotation: (
    id: string,
    patch: { comment?: string; annotationType?: string; resolved?: boolean },
  ) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onAddReply: (annotationId: string, comment: string) => Promise<void>;
  onDeleteReply: (annotationId: string, replyId: string) => Promise<void>;
  onError: (message: string) => void;
  onPageChange: (page: number) => void;
  isOwner?: boolean;
}

type AnnotationHighlight = Highlight & {
  annotation: Annotation;
  content: { text?: string; image?: string };
  annotationType: AnnotationType;
};

type AnnotationFilter = AnnotationType | "all" | "unresolved";
type AnnotationSort = "page" | "date";
type DocumentResourceKind = "pdf" | "docx" | "pptx" | "image" | "unsupported";

const FILTER_LABEL_BY_TYPE: Record<AnnotationType, string> = {
  question: "\u2753 Questions",
  "key-point": "\u2b50 Key Points",
  definition: "\ud83d\udcd6 Definitions",
  mistake: "\u26a0\ufe0f Mistakes",
  insight: "\ud83d\udca1 Insights",
  general: "\ud83d\udcdd Notes",
};

const FILTERS: Array<{ id: AnnotationFilter; label: string; color: string }> = [
  { id: "all", label: "All", color: "var(--accent-primary)" },
  ...ANNOTATION_TYPES.map((type) => ({
    id: type.id,
    label: FILTER_LABEL_BY_TYPE[type.id],
    color: type.color,
  })),
  { id: "unresolved", label: "Unresolved", color: "#ef4444" },
];

function isApiDocumentUrl(resourceUrl: string) {
  try {
    return new URL(resourceUrl, window.location.origin).pathname.startsWith("/api/");
  } catch {
    return resourceUrl.startsWith("/api/");
  }
}

function getDocumentResourceKind(mimeType = "", title = "", resourceUrl = ""): DocumentResourceKind {
  const mime = String(mimeType || "").toLowerCase();
  const source = `${title} ${resourceUrl}`.toLowerCase();

  if (mime.includes("pdf") || /\.pdf(?:$|[?#])/.test(source)) return "pdf";
  if (mime.includes("wordprocessingml") || mime.includes("docx") || /\.docx(?:$|[?#])/.test(source)) return "docx";
  if (mime.includes("presentationml") || mime.includes("pptx") || /\.pptx(?:$|[?#])/.test(source)) return "pptx";
  if (
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/webp" ||
    /\.(png|jpe?g|webp)(?:$|[?#])/.test(source)
  ) {
    return "image";
  }

  return "unsupported";
}

function getAnnotationType(typeId: string = "general") {
  return ANNOTATION_TYPES.find((type) => type.id === typeId) || ANNOTATION_TYPES.at(-1)!;
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function truncate(value: string, length = 60) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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

function getPageNumber(annotation: Annotation) {
  return Number(annotation.position?.pageNumber || annotation.position?.boundingRect?.pageNumber || 0);
}

function getPositionSortValue(annotation: Annotation) {
  const rect = annotation.position?.boundingRect || {};
  return [getPageNumber(annotation), Number(rect.y1 ?? rect.top ?? 0), Number(rect.x1 ?? rect.left ?? 0)];
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

function inferHighlightType(annotation: Annotation) {
  return annotation.content?.image || !annotation.position?.rects?.length ? "area" : "text";
}

function toHighlight(annotation: Annotation): AnnotationHighlight {
  return {
    id: annotation.id,
    type: inferHighlightType(annotation),
    position: annotation.position,
    content: annotation.content || {},
    annotation,
    annotationType: annotation.annotationType || "general",
  };
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
  if (filter === "unresolved") return "All questions are resolved. Nice work! 🎉";
  const type = getAnnotationType(filter);
  return `No ${type.label.toLowerCase()} annotations yet.`;
}

function getAnnotationCountLabel(filteredCount: number, totalCount: number, filter: AnnotationFilter) {
  if (filter === "all") return String(totalCount);
  return `${filteredCount} of ${totalCount}`;
}

function getDateSortValue(annotation: Annotation) {
  const timestamp = Date.parse(annotation.createdAt || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function presenceColour(userId: string) {
  const colours = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899"];
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) & 0xffffffff;
  return colours[Math.abs(hash) % colours.length];
}

function getVisiblePdfPage(container: HTMLElement) {
  const pages = Array.from(container.querySelectorAll<HTMLElement>(".page[data-page-number]"));
  if (!pages.length) return 0;

  const containerRect = container.getBoundingClientRect();
  const targetY = containerRect.top + Math.min(containerRect.height * 0.38, 240);
  let bestPage = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const page of pages) {
    const pageNumber = Number(page.dataset.pageNumber);
    if (!Number.isFinite(pageNumber)) continue;

    const rect = page.getBoundingClientRect();
    if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue;

    const distance = Math.abs(rect.top - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = pageNumber;
    }
  }

  return bestPage;
}

function SelectionTip({
  activeChannel,
  onCreateAnnotation,
  onError,
  resourceId,
}: {
  activeChannel: string;
  onCreateAnnotation: DocumentChannelPanelProps["onCreateAnnotation"];
  onError: (message: string) => void;
  resourceId: string;
}) {
  const [annotationType, setAnnotationType] = useState<AnnotationType>("general");
  const [saving, setSaving] = useState(false);
  const highlighter = usePdfHighlighterContext();

  useEffect(() => {
    highlighter.getCurrentSelection()?.makeGhostHighlight();
  }, [highlighter]);

  useEffect(() => {
    highlighter.updateTipPosition();
  }, [annotationType, highlighter]);

  async function saveAnnotation(commentHtml: string) {
    const selection: PdfSelection | null = highlighter.getCurrentSelection() || highlighter.getGhostHighlight();
    const note = commentHtml.trim();
    if (!selection || !note) return;

    setSaving(true);
    try {
      await onCreateAnnotation({
        annotationType,
        channel: activeChannel,
        comment: note,
        content: selection.content || {},
        position: selection.position,
        resourceId,
      });
      highlighter.removeGhostHighlight();
      highlighter.setTip(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to save annotation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="document-annotation-tip">
      <AppSelectMenu
        ariaLabel="Annotation type"
        className="document-annotation-type-select"
        label="Type"
        onChange={(value) => setAnnotationType(value as AnnotationType)}
        options={ANNOTATION_TYPES.map((type) => ({
          label: type.label,
          value: type.id,
        }))}
        value={annotationType}
      />
      <RichAnnotationComposer
        autoFocus
        buttonLabel="Save Annotation"
        className="selection-tip-composer"
        disabled={saving}
        onSubmit={saveAnnotation}
        placeholder="Add context for this annotation"
      />
    </div>
  );
}

function HighlightPopup({
  annotation,
}: {
  annotation: Annotation;
}) {
  return (
    <div className="document-highlight-popup">
      <strong>{annotation.author?.name || "Unknown"}</strong>
      <p>{truncate(annotation.comment || annotation.content?.text || "Annotation")}</p>
    </div>
  );
}

function HighlightContainer({ onOpenThread }: { onOpenThread: (id: string) => void }) {
  const { highlight, isScrolledTo } = useHighlightContainerContext<AnnotationHighlight>();
  const annotation = highlight.annotation;
  const type = getAnnotationType(highlight.annotationType);
  const color = type.color;
  const highlightTip: Tip = {
    position: highlight.position,
    content: <HighlightPopup annotation={annotation} />,
  };

  const renderedHighlight =
    highlight.type === "area" ? (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        style={{
          background: hexToRgba(color, 0.2),
          border: `2px solid ${hexToRgba(color, 0.88)}`,
        }}
      />
    ) : (
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        style={{
          background: hexToRgba(color, 0.32),
          borderBottom: `2px solid ${hexToRgba(color, 0.82)}`,
        }}
      />
    );

  return <MonitoredHighlightContainer highlightTip={highlightTip}>{renderedHighlight}</MonitoredHighlightContainer>;
}

function ImageDocumentPreview({ resourceTitle, resourceUrl }: { resourceTitle: string; resourceUrl: string }) {
  return (
    <div className="document-image-preview">
      <img alt={resourceTitle || "Document image"} src={resourceUrl} />
    </div>
  );
}

function OfficeConversionState({
  resourceFileUrl,
  resourceKind,
  resourceTitle,
  status,
}: {
  resourceFileUrl: string;
  resourceKind: "docx" | "pptx";
  resourceTitle: string;
  status: string;
}) {
  const label = resourceKind === "docx" ? "DOCX" : "PPTX";
  const message =
    status === "failed"
      ? `We could not convert this ${label} into a PDF preview.`
      : `Converting this ${label} into a PDF preview...`;

  return (
    <div className="document-conversion-state">
      <FileText size={34} />
      <strong>{resourceTitle}</strong>
      <p>{message}</p>
      {status === "failed" && resourceFileUrl ? (
        <a className="secondary-button compact" href={resourceFileUrl} rel="noreferrer" target="_blank">
          Download original
        </a>
      ) : null}
    </div>
  );
}

function DocumentPresenceBar({ members }: { members: DocumentPresenceMember[] }) {
  if (!members.length) return null;

  const visibleMembers = members.slice(0, 4);
  const extraCount = members.length - visibleMembers.length;

  return (
    <div className="document-reading-presence-bar" aria-label="Other readers in this document channel">
      <span className="document-reading-presence-label">Also reading:</span>
      {visibleMembers.map((member, index) => (
        <span
          className="document-reading-presence-member"
          key={member.userId}
          style={
            {
              "--annotation-color": presenceColour(member.userId),
              "--presence-color": presenceColour(member.userId),
            } as CSSProperties
          }
        >
          {index > 0 ? <span className="document-reading-presence-divider" aria-hidden="true" /> : null}
          <DocumentAuthorAvatar
            author={{
              avatarPreset: member.avatarPreset,
              avatarUrl: member.avatarUrl,
              email: member.email,
              id: member.userId,
              name: member.name,
            }}
            small
          />
          <span className="document-reading-presence-name">
            {member.name} - p.{member.page}
          </span>
        </span>
      ))}
      {extraCount > 0 ? <span className="document-reading-presence-extra">and {extraCount} others</span> : null}
    </div>
  );
}

export function DocumentChannelPanel({
  activeChannel,
  annotations,
  documentPresence,
  isOwner = false,
  onAddReply,
  onCreateAnnotation,
  onDeleteAnnotation,
  onDeleteReply,
  onError,
  onPageChange,
  onUpdateAnnotation,
  resourceId,
  resourceConversionStatus = "not-needed",
  resourceFileUrl = "",
  resourceMimeType = "",
  resourcePdfUrl = "",
  resourceTitle,
  resourceType = "",
  resourceUrl,
  user,
}: DocumentChannelPanelProps) {
  const [activeFilter, setActiveFilter] = useState<AnnotationFilter>("all");
  const [sortOrder, setSortOrder] = useState<AnnotationSort>("page");
  const [activeAnnotationId, setActiveAnnotationId] = useState("");
  const [pdfScrollContainer, setPdfScrollContainer] = useState<HTMLElement | null>(null);
  const [filterScrollState, setFilterScrollState] = useState({ left: false, right: false });
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const annotationSidebarRef = useRef<AnnotationSidebarHandle | null>(null);
  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const lastReportedPageRef = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);
  const pageChangeTimeoutRef = useRef<number | null>(null);
  const resourceKind = useMemo(() => {
    if (["pdf", "docx", "pptx", "image"].includes(resourceType)) {
      return resourceType as DocumentResourceKind;
    }
    return getDocumentResourceKind(resourceMimeType, resourceTitle, resourceUrl);
  }, [resourceMimeType, resourceTitle, resourceType, resourceUrl]);
  const pdfViewerUrl =
    resourceKind === "pdf" ? resourcePdfUrl || resourceUrl : resourcePdfUrl || "";
  const pdfDocumentSource = useMemo(() => {
    const token = getAuthToken();
    if (!token || !isApiDocumentUrl(pdfViewerUrl)) return pdfViewerUrl;
    return {
      url: pdfViewerUrl,
      httpHeaders: { Authorization: `Bearer ${token}` },
    };
  }, [pdfViewerUrl]);

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
  const documentPresenceByPage = useMemo(() => {
    const grouped = new Map<number, DocumentPresenceMember[]>();

    for (const member of Array.isArray(documentPresence) ? documentPresence : []) {
      const page = Number(member.page);
      if (!Number.isFinite(page)) continue;
      grouped.set(page, [...(grouped.get(page) || []), member]);
    }

    return grouped;
  }, [documentPresence]);

  const annotationCountLabel = getAnnotationCountLabel(
    visibleAnnotations.length,
    channelAnnotations.length,
    activeFilter,
  );
  const emptyAnnotationMessage = getEmptyAnnotationMessage(activeFilter);

  const highlights = useMemo(() => channelAnnotations.map(toHighlight), [channelAnnotations]);
  const hasPdfPreview = Boolean(pdfViewerUrl) && (resourceKind === "pdf" || resourceConversionStatus === "done");

  function updateFilterScrollState() {
    const row = filterRowRef.current;
    if (!row) {
      setFilterScrollState({ left: false, right: false });
      return;
    }

    const maxScrollLeft = row.scrollWidth - row.clientWidth;
    setFilterScrollState({
      left: row.scrollLeft > 2,
      right: row.scrollLeft < maxScrollLeft - 2,
    });
  }

  function scrollFilters(direction: -1 | 1) {
    const row = filterRowRef.current;
    if (!row) return;

    row.scrollBy({ behavior: "smooth", left: direction * Math.max(140, row.clientWidth * 0.7) });
    window.setTimeout(updateFilterScrollState, 240);
  }

  useEffect(() => {
    const row = filterRowRef.current;
    updateFilterScrollState();
    if (!row) return undefined;

    row.addEventListener("scroll", updateFilterScrollState, { passive: true });
    window.addEventListener("resize", updateFilterScrollState);

    return () => {
      row.removeEventListener("scroll", updateFilterScrollState);
      window.removeEventListener("resize", updateFilterScrollState);
    };
  }, []);

  useEffect(() => {
    lastReportedPageRef.current = 0;
  }, [activeChannel, resourceId]);

  useEffect(() => {
    if (!pdfViewerUrl) {
      highlighterUtilsRef.current = null;
      setPdfScrollContainer(null);
      return undefined;
    }

    let intervalId = 0;
    let cancelled = false;
    let attempts = 0;

    function syncViewerContainer() {
      const nextContainer = highlighterUtilsRef.current?.getViewer()?.container || null;
      setPdfScrollContainer((current) => (current === nextContainer ? current : nextContainer));
      attempts += 1;
      if ((nextContainer || attempts >= 120) && intervalId) {
        window.clearInterval(intervalId);
      }
    }

    syncViewerContainer();
    if (!cancelled && !highlighterUtilsRef.current?.getViewer()?.container) {
      intervalId = window.setInterval(syncViewerContainer, 250);
    }

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [pdfViewerUrl]);

  useEffect(() => {
    if (!pdfScrollContainer) return undefined;

    let pageRetryTimeoutId = 0;
    let pageRetryAttempts = 0;

    function reportVisiblePage() {
      const page = getVisiblePdfPage(pdfScrollContainer);
      if (!page) return false;
      if (page === lastReportedPageRef.current) return true;

      if (pageChangeTimeoutRef.current !== null) {
        window.clearTimeout(pageChangeTimeoutRef.current);
      }

      pageChangeTimeoutRef.current = window.setTimeout(() => {
        lastReportedPageRef.current = page;
        onPageChange(page);
      }, 500);

      return true;
    }

    function reportWhenPagesAreReady() {
      const hasVisiblePage = reportVisiblePage();
      pageRetryAttempts += 1;
      if (!hasVisiblePage && pageRetryAttempts < 40) {
        pageRetryTimeoutId = window.setTimeout(reportWhenPagesAreReady, 250);
      }
    }

    reportWhenPagesAreReady();
    pdfScrollContainer.addEventListener("scroll", reportVisiblePage, { passive: true });
    window.addEventListener("resize", reportVisiblePage);

    return () => {
      pdfScrollContainer.removeEventListener("scroll", reportVisiblePage);
      window.removeEventListener("resize", reportVisiblePage);
      if (pageRetryTimeoutId) window.clearTimeout(pageRetryTimeoutId);
      if (pageChangeTimeoutRef.current !== null) {
        window.clearTimeout(pageChangeTimeoutRef.current);
        pageChangeTimeoutRef.current = null;
      }
    };
  }, [activeChannel, onPageChange, pdfScrollContainer, resourceId]);

  function openThread(annotationId: string) {
    setActiveAnnotationId(annotationId);
    const highlight = highlights.find((candidate) => candidate.id === annotationId);
    if (highlight) highlighterUtilsRef.current?.scrollToHighlight?.(highlight);
    annotationSidebarRef.current?.openThread(annotationId);
  }

  function jumpToAnnotation(annotationId: string) {
    setActiveAnnotationId(annotationId);
    const highlight = highlights.find((candidate) => candidate.id === annotationId);
    if (highlight) highlighterUtilsRef.current?.scrollToHighlight?.(highlight);
  }

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();

    const panelRect = panel.getBoundingClientRect();
    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = Math.min(Math.max(panelRect.right - moveEvent.clientX, 300), Math.min(560, panelRect.width * 0.48));
      setSidebarWidth(nextWidth);
    }
    function stopResize() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

  if (!resourceUrl) {
    return (
      <section className="document-channel-panel empty">
        <FileText size={34} />
        <h2>No document linked</h2>
        <p>This document channel needs a linked PDF, DOCX, PPTX, PNG, JPG, or WEBP resource before it can be opened.</p>
      </section>
    );
  }

  return (
    <section
      className="document-channel-panel"
      aria-label={`${resourceTitle} document channel`}
      ref={panelRef}
      style={{ "--document-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="document-viewer-pane">
        <header className="document-channel-header">
          <div>
            <FileText size={22} />
            <span>
              <strong>{resourceTitle || activeChannel}</strong>
              <small>#{activeChannel}</small>
            </span>
          </div>
        </header>

        <div className="document-pdf-area">
          <DocumentPresenceBar members={Array.isArray(documentPresence) ? documentPresence : []} />
          <div className="document-pdf-shell">
            {hasPdfPreview ? (
              <PdfLoader
                beforeLoad={() => <div className="document-pdf-state">Loading document...</div>}
                document={pdfDocumentSource}
                errorMessage={() => <div className="document-pdf-state">Unable to load this PDF.</div>}
                onError={(error) => onError(error.message || "Unable to load this PDF.")}
                workerSrc={pdfWorkerUrl}
              >
                {(pdfDocument) => (
                  <PdfHighlighter
                    enableAreaSelection={(event) => event.altKey}
                    highlights={highlights}
                    pdfDocument={pdfDocument}
                    pdfScaleValue="page-width"
                    selectionTip={
                      <SelectionTip
                        activeChannel={activeChannel}
                        onCreateAnnotation={onCreateAnnotation}
                        onError={onError}
                        resourceId={resourceId}
                      />
                    }
                    textSelectionColor="rgba(245, 158, 11, 0.18)"
                    utilsRef={(utils) => {
                      highlighterUtilsRef.current = utils;
                    }}
                  >
                    <HighlightContainer onOpenThread={openThread} />
                  </PdfHighlighter>
                )}
              </PdfLoader>
            ) : null}
            {(resourceKind === "docx" || resourceKind === "pptx") && !hasPdfPreview ? (
              <OfficeConversionState
                resourceFileUrl={resourceFileUrl || resourceUrl}
                resourceKind={resourceKind}
                resourceTitle={resourceTitle || activeChannel}
                status={resourceConversionStatus}
              />
            ) : null}
            {resourceKind === "image" ? (
              <ImageDocumentPreview resourceTitle={resourceTitle || activeChannel} resourceUrl={resourceUrl} />
            ) : null}
            {resourceKind === "unsupported" ? (
              <div className="document-pdf-state">
                Document channels support PDF, DOCX, PPTX, PNG, JPG, JPEG, or WEBP files only.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        aria-label="Resize Annotations Panel"
        aria-orientation="vertical"
        className="document-sidebar-resizer"
        onPointerDown={beginSidebarResize}
        role="separator"
      />

      <AnnotationSidebar
        activeChannel={activeChannel}
        annotations={annotations}
        currentUser={user}
        isOwner={isOwner}
        onAddReply={onAddReply}
        onDeleteAnnotation={onDeleteAnnotation}
        onDeleteReply={onDeleteReply}
        onError={onError}
        onJumpToAnnotation={jumpToAnnotation}
        onUpdateAnnotation={onUpdateAnnotation}
        ref={annotationSidebarRef}
        resourceId={resourceId}
      />
    </section>
  );
}
