import {
  Download,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import { getAuthToken } from "../../../api.ts";
import { AppSelectMenu } from "../../../shared/ui/AppSelectMenu.tsx";
import {
  ANNOTATION_TYPES,
  AnnotationSidebar,
  getAnnotationType,
} from "./AnnotationSidebar.tsx";
import type {
  Annotation,
  AnnotationSidebarHandle,
  AnnotationType,
  DocumentPresenceMember,
} from "./AnnotationSidebar.tsx";
import { DocumentAuthorAvatar } from "./DocumentAuthorAvatar.tsx";

type ImageRect = { x: number; y: number; width: number; height: number };

export interface ImageAnnotatorPanelProps {
  activeChannel: string;
  resourceId: string;
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
  onError: (message: string) => void;
  onPageChange: (page: number) => void;
  isOwner?: boolean;
}

function isApiDocumentUrl(resourceUrl: string) {
  try {
    return new URL(resourceUrl, window.location.origin).pathname.startsWith("/api/");
  } catch {
    return resourceUrl.startsWith("/api/");
  }
}

function presenceColour(userId: string) {
  const colours = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899"];
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) & 0xffffffff;
  return colours[Math.abs(hash) % colours.length];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normaliseRect(start: { x: number; y: number }, end: { x: number; y: number }): ImageRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function truncate(value: string, length = 60) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function readEventNumber(event: PointerEvent<HTMLElement>, key: "clientX" | "clientY" | "offsetX" | "offsetY") {
  const nativeEvent = event.nativeEvent as any;
  const nativeValue = nativeEvent?.[key];
  if (typeof nativeValue === "number" && Number.isFinite(nativeValue)) return nativeValue;
  const eventValue = (event as any)[key];
  return typeof eventValue === "number" && Number.isFinite(eventValue) ? eventValue : 0;
}

function getPointerPosition(event: PointerEvent<HTMLElement>, imageElement: HTMLImageElement | null) {
  if (!imageElement) return null;
  const rect = imageElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const layoutWidth = imageElement.offsetWidth || rect.width;
  const layoutHeight = imageElement.offsetHeight || rect.height;
  const offsetX = readEventNumber(event, "offsetX");
  const offsetY = readEventNumber(event, "offsetY");
  const clientX = readEventNumber(event, "clientX");
  const clientY = readEventNumber(event, "clientY");

  return {
    x: clamp(
      offsetX || (clientX - rect.left) * (layoutWidth / rect.width),
      0,
      layoutWidth,
    ),
    y: clamp(
      offsetY || (clientY - rect.top) * (layoutHeight / rect.height),
      0,
      layoutHeight,
    ),
    width: layoutWidth,
    height: layoutHeight,
  };
}

function isOverlayControl(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(
        target.closest(
          "[data-annotation-id], .image-annotation-create-popover, button, input, label, select, textarea",
        ),
      )
    : false;
}

function safePointerId(event: PointerEvent<HTMLElement>) {
  const pointerId = Number((event as any).pointerId);
  return Number.isFinite(pointerId) ? pointerId : null;
}

function safelyCapturePointer(event: PointerEvent<HTMLElement>) {
  const pointerId = safePointerId(event);
  if (pointerId === null) return;
  try {
    event.currentTarget.setPointerCapture?.(pointerId);
  } catch {
    // Mouse-event fallbacks and synthetic tests may not have an active pointer.
  }
}

function safelyReleasePointer(event: PointerEvent<HTMLElement>) {
  const pointerId = safePointerId(event);
  if (pointerId === null) return;
  try {
    event.currentTarget.releasePointerCapture?.(pointerId);
  } catch {
    // The drag may have been completed by the mouse fallback path.
  }
}

function rectFromAnnotation(annotation: Annotation) {
  const position = annotation.position || {};
  const x = Number(position.x);
  const y = Number(position.y);
  const width = Number(position.width);
  const height = Number(position.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, 1),
    height: clamp(height, 0, 1),
  };
}

function ImagePresenceBar({ members }: { members: DocumentPresenceMember[] }) {
  if (!members.length) return null;

  const visibleMembers = members.slice(0, 4);
  const extraCount = members.length - visibleMembers.length;

  return (
    <div className="document-reading-presence-bar" aria-label="Other readers in this image channel">
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

export function ImageAnnotatorPanel({
  activeChannel,
  annotations,
  documentPresence,
  isOwner = false,
  onAddReply,
  onCreateAnnotation,
  onDeleteAnnotation,
  onError,
  onPageChange,
  onUpdateAnnotation,
  resourceId,
  resourceTitle,
  resourceUrl,
  user,
}: ImageAnnotatorPanelProps) {
  const [imageSrc, setImageSrc] = useState(resourceUrl);
  const [imageError, setImageError] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<ImageRect | null>(null);
  const [draftRect, setDraftRect] = useState<ImageRect | null>(null);
  const [draftType, setDraftType] = useState<AnnotationType>("general");
  const [draftComment, setDraftComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState("");
  const [popoverSize, setPopoverSize] = useState({ width: 280, height: 220 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<AnnotationSidebarHandle | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawRectRef = useRef<ImageRect | null>(null);

  const imageAnnotations = useMemo(
    () =>
      (Array.isArray(annotations) ? annotations : []).filter(
        (annotation) =>
          annotation.channel === activeChannel &&
          annotation.resourceId === resourceId &&
          rectFromAnnotation(annotation),
      ),
    [activeChannel, annotations, resourceId],
  );

  useEffect(() => {
    onPageChange(1);
  }, [activeChannel, onPageChange, resourceId]);

  useEffect(() => {
    if (!draftRect || !popoverRef.current) return;

    const rect = popoverRef.current.getBoundingClientRect();
    const nextSize = {
      height: rect.height || popoverSize.height,
      width: rect.width || popoverSize.width,
    };

    setPopoverSize((current) =>
      Math.abs(current.width - nextSize.width) < 1 && Math.abs(current.height - nextSize.height) < 1
        ? current
        : nextSize,
    );
  }, [draftComment, draftRect, draftType, popoverSize.height, popoverSize.width]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadImage() {
      setImageError("");
      setImageSrc(resourceUrl);
      if (!resourceUrl || !isApiDocumentUrl(resourceUrl)) return;

      const token = getAuthToken();
      if (!token) return;

      try {
        const response = await fetch(resourceUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Unable to load this image.");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setImageSrc(objectUrl);
      } catch (error) {
        if (!cancelled) setImageError(error instanceof Error ? error.message : "Unable to load this image.");
      }
    }

    loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resourceUrl]);

  function beginDraw(event: PointerEvent<HTMLDivElement>) {
    if (isOverlayControl(event.target)) return;
    const pointer = getPointerPosition(event, imageRef.current);
    if (!pointer) return;

    safelyCapturePointer(event);
    const point = { x: pointer.x, y: pointer.y };
    const nextRect = { ...point, width: 0, height: 0 };
    setDraftRect(null);
    drawStartRef.current = point;
    setDrawStart(point);
    drawRectRef.current = nextRect;
    setDrawRect(nextRect);
  }

  function updateDraw(event: PointerEvent<HTMLDivElement>) {
    const start = drawStartRef.current || drawStart;
    if (!start) return;
    const pointer = getPointerPosition(event, imageRef.current);
    if (!pointer) return;
    const nextRect = normaliseRect(start, { x: pointer.x, y: pointer.y });
    drawRectRef.current = nextRect;
    setDrawRect(nextRect);
  }

  function endDraw(event: PointerEvent<HTMLDivElement>) {
    const start = drawStartRef.current || drawStart;
    if (!start) return;
    safelyReleasePointer(event);
    const pointer = getPointerPosition(event, imageRef.current);
    const latestRect = pointer
      ? normaliseRect(start, { x: pointer.x, y: pointer.y })
      : drawRectRef.current || drawRect;

    if (!latestRect) return;

    if (latestRect.width >= 20 && latestRect.height >= 20) {
      setDraftRect(latestRect);
    }

    drawStartRef.current = null;
    drawRectRef.current = null;
    setDrawStart(null);
    setDrawRect(null);
  }

  async function saveAnnotation() {
    if (!draftRect || !imageRef.current) return;
    const imageWidth = imageRef.current.offsetWidth;
    const imageHeight = imageRef.current.offsetHeight;
    const comment = draftComment.trim();
    if (!comment || !imageWidth || !imageHeight) return;

    setSaving(true);
    try {
      await onCreateAnnotation({
        annotationType: draftType,
        channel: activeChannel,
        comment,
        content: {},
        position: {
          x: clamp(draftRect.x / imageWidth, 0, 1),
          y: clamp(draftRect.y / imageHeight, 0, 1),
          width: clamp(draftRect.width / imageWidth, 0, 1),
          height: clamp(draftRect.height / imageHeight, 0, 1),
          pageNumber: 1,
        },
        resourceId,
      });
      setDraftRect(null);
      setDraftComment("");
      setDraftType("general");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to save annotation.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadOriginal() {
    if (!resourceUrl) return;
    if (!isApiDocumentUrl(resourceUrl)) {
      window.open(resourceUrl, "_blank", "noopener,noreferrer");
      return;
    }

    try {
      const token = getAuthToken();
      const response = await fetch(resourceUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Unable to download the original image.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = resourceTitle || "image";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to download the original image.");
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (isOverlayControl(event.target)) return;
    if (!event.ctrlKey && Math.abs(event.deltaY) < 20) return;
    event.preventDefault();
    setZoom((current) => clamp(current + (event.deltaY < 0 ? 0.1 : -0.1), 0.4, 3));
  }

  function openThread(annotationId: string) {
    sidebarRef.current?.openThread(annotationId);
  }

  function getCreatePopoverStyle(rect: ImageRect): CSSProperties {
    const overlayWidth = overlayRef.current?.clientWidth || imageRef.current?.offsetWidth || 0;
    const overlayHeight = overlayRef.current?.clientHeight || imageRef.current?.offsetHeight || 0;
    const gap = 12;
    const availableWidth = overlayWidth ? Math.max(80, overlayWidth - gap * 2) : popoverSize.width;
    const availableHeight = overlayHeight ? Math.max(80, overlayHeight - gap * 2) : popoverSize.height;
    const popoverWidth = Math.min(popoverSize.width, availableWidth);
    const popoverHeight = Math.min(popoverSize.height, availableHeight);
    let left = rect.x + rect.width + gap;
    let top = rect.y;

    if (overlayWidth && left + popoverWidth > overlayWidth - gap) {
      left = rect.x - popoverWidth - gap;
    }

    if (overlayHeight && top + popoverHeight > overlayHeight - gap) {
      top = rect.y + rect.height - popoverHeight;
    }

    if (overlayWidth) {
      const maxLeft = Math.max(gap, overlayWidth - popoverWidth - gap);
      left = Math.min(Math.max(left, gap), maxLeft);
    }

    if (overlayHeight) {
      const maxTop = Math.max(gap, overlayHeight - popoverHeight - gap);
      top = Math.min(Math.max(top, gap), maxTop);
    }

    return {
      left,
      maxHeight: availableHeight,
      maxWidth: availableWidth,
      top,
    };
  }

  const activeDraftRect = draftRect || drawRect;
  const draftColor = getAnnotationType(draftType).color;
  const overlayHandlers = {
    onMouseDown: beginDraw as any,
    onMouseMove: updateDraw as any,
    onMouseUp: endDraw as any,
    onPointerDown: beginDraw,
    onPointerMove: updateDraw,
    onPointerUp: endDraw,
  };

  return (
    <section className="document-channel-panel image-channel-panel" aria-label={`${resourceTitle} image channel`}>
      <div className="document-viewer-pane">
        <header className="document-channel-header">
          <div>
            <ImageIcon size={22} />
            <span>
              <strong>{resourceTitle || activeChannel}</strong>
              <small>#{activeChannel}</small>
            </span>
          </div>
        </header>

        <div className="document-pdf-area image-annotation-area">
          <ImagePresenceBar members={Array.isArray(documentPresence) ? documentPresence : []} />
          <div className="image-annotation-toolbar">
            <span title={resourceTitle}>{resourceTitle || "Image"}</span>
            <div>
              <button aria-label="Zoom out" onClick={() => setZoom((current) => clamp(current - 0.1, 0.4, 3))} type="button">
                <Minus size={15} />
              </button>
              <output>{Math.round(zoom * 100)}%</output>
              <button aria-label="Zoom in" onClick={() => setZoom((current) => clamp(current + 0.1, 0.4, 3))} type="button">
                <Plus size={15} />
              </button>
              <button aria-label="Fit to screen" onClick={() => setZoom(1)} type="button">
                <Maximize2 size={15} />
              </button>
              <button aria-label="Download original" onClick={downloadOriginal} type="button">
                <Download size={15} />
              </button>
            </div>
          </div>

          <div className="image-annotation-stage" onWheel={handleWheel}>
            {imageError ? (
              <div className="document-pdf-state">{imageError}</div>
            ) : (
              <div
                className="image-annotation-frame"
                style={{ "--image-zoom": zoom } as CSSProperties}
              >
                <img
                  alt={resourceTitle || "Document image"}
                  onLoad={(event) =>
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  ref={imageRef}
                  src={imageSrc}
                />
                <div
                  className="image-annotation-overlay"
                  ref={overlayRef}
                  {...overlayHandlers}
                >
                  {imageAnnotations.map((annotation) => {
                    const rect = rectFromAnnotation(annotation);
                    if (!rect) return null;
                    const type = getAnnotationType(annotation.annotationType);

                    return (
                      <button
                        aria-label={`Open ${type.label} annotation`}
                        className="image-annotation-rect"
                        data-annotation-id={annotation.id}
                        key={annotation.id}
                        onClick={() => openThread(annotation.id)}
                        onMouseEnter={() => setHoveredAnnotationId(annotation.id)}
                        onMouseLeave={() => setHoveredAnnotationId("")}
                        style={
                          {
                            "--annotation-color": type.color,
                            height: `${rect.height * 100}%`,
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.width * 100}%`,
                          } as CSSProperties
                        }
                        type="button"
                      />
                    );
                  })}

                  {activeDraftRect ? (
                    <span
                      className="image-annotation-draft-rect"
                      style={
                        {
                          "--annotation-color": draftColor,
                          height: activeDraftRect.height,
                          left: activeDraftRect.x,
                          top: activeDraftRect.y,
                          width: activeDraftRect.width,
                        } as CSSProperties
                      }
                    />
                  ) : null}

                  {hoveredAnnotationId ? (
                    imageAnnotations
                      .filter((annotation) => annotation.id === hoveredAnnotationId)
                      .map((annotation) => {
                        const rect = rectFromAnnotation(annotation);
                        if (!rect) return null;
                        return (
                          <div
                            className="image-annotation-hover-card"
                            key={annotation.id}
                            style={{
                              left: `${Math.min(86, (rect.x + rect.width) * 100)}%`,
                              top: `${Math.max(4, rect.y * 100)}%`,
                            }}
                          >
                            <strong>{annotation.author?.name || "Unknown"}</strong>
                            <p>{truncate(annotation.comment || "Image annotation")}</p>
                            <button onClick={() => openThread(annotation.id)} type="button">
                              Open thread
                            </button>
                          </div>
                        );
                      })
                  ) : null}

                  {draftRect ? (
                    <div
                      className="image-annotation-create-popover"
                      onWheel={(event) => event.stopPropagation()}
                      ref={popoverRef}
                      style={getCreatePopoverStyle(draftRect)}
                    >
                      <AppSelectMenu
                        ariaLabel="Annotation type"
                        className="document-annotation-type-select compact"
                        label="Type"
                        onChange={(value) => setDraftType(value as AnnotationType)}
                        options={ANNOTATION_TYPES.map((type) => ({
                          label: type.label,
                          value: type.id,
                        }))}
                        value={draftType}
                      />
                      <textarea
                        autoFocus
                        onChange={(event) => setDraftComment(event.target.value)}
                        placeholder="Add context for this region..."
                        rows={3}
                        value={draftComment}
                      />
                      <div>
                        <button className="secondary-button compact" onClick={() => setDraftRect(null)} type="button">
                          Cancel
                        </button>
                        <button
                          className="primary-button compact"
                          disabled={!draftComment.trim() || saving}
                          onClick={saveAnnotation}
                          type="button"
                        >
                          Save Annotation
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {naturalSize.width && naturalSize.height ? (
            <small className="image-annotation-size-label">
              {naturalSize.width} x {naturalSize.height}
            </small>
          ) : null}
        </div>
      </div>

      <AnnotationSidebar
        activeChannel={activeChannel}
        annotations={annotations}
        currentUser={user}
        isOwner={isOwner}
        onAddReply={onAddReply}
        onDeleteAnnotation={onDeleteAnnotation}
        onError={onError}
        onUpdateAnnotation={onUpdateAnnotation}
        ref={sidebarRef}
        resourceId={resourceId}
      />
    </section>
  );
}
