import {
  ChevronDown,
  Edit3,
  FileText,
  Hash,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DRAFTS_VIEW_ID } from "./chatLayout.ts";

const CHANNEL_DRAG_TYPE = "application/x-diffriendtiate-channel";
const CATEGORY_DRAG_TYPE = "application/x-diffriendtiate-category";

/**
 * Convolution-specific sidebar inspired by Discord/Gather.
 *
 * It manages only presentation state: drafts, category grouping, and local
 * drag/drop order. Server-owned channel creation remains in RoomView.
 */
export function ChatSidebar({
  activeChannel,
  channelObjects = [],
  channelLayout,
  drafts,
  onCreateCategory,
  onCreateChannel,
  onDeleteCategory,
  onMoveCategory,
  onMoveChannel,
  onRequestDeleteChannel,
  onRequestRenameCategory,
  onRequestRenameChannel,
  onSelectChannel,
  isOwner = false,
}) {
  const [actionMenu, setActionMenu] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [dragTarget, setDragTarget] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const activeDragPayloadRef = useRef<any>(null);

  // Browser localStorage can keep older room UI state across refactors. Keep
  // the sidebar tolerant of bad saved values so Convolution cannot blank the room.
  const safeDrafts = drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
  const safeChannelObjects = Array.isArray(channelObjects) ? channelObjects : [];
  const safeChannelLayout = Array.isArray(channelLayout) ? channelLayout : [];

  const visibleDrafts = useMemo(
    () =>
      Object.entries(safeDrafts)
        .filter(
          ([channel, value]) =>
            channel !== activeChannel && typeof value === "string" && value.trim(),
        )
        .map(([channel, body]) => ({ channel, body })),
    [activeChannel, safeDrafts],
  );

  const actionMenuPosition = useMemo(() => {
    if (!actionMenu) return null;

    const width = 210;
    const height = 96;
    return {
      left: Math.max(8, Math.min(actionMenu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(actionMenu.y, window.innerHeight - height - 8)),
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!actionMenu) return undefined;

    function closeMenu() {
      setActionMenu(null);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [actionMenu]);

  function getDragPayload(event) {
    if (activeDragPayloadRef.current) return activeDragPayloadRef.current;

    const categoryId = event.dataTransfer.getData(CATEGORY_DRAG_TYPE);
    if (categoryId) return { type: "category", categoryId };

    const channel = event.dataTransfer.getData(CHANNEL_DRAG_TYPE);
    if (channel) return { type: "channel", channel };

    const fallback = event.dataTransfer.getData("text/plain");
    return fallback ? { type: "channel", channel: fallback } : null;
  }

  function clearDragState() {
    activeDragPayloadRef.current = null;
    setDragTarget(null);
  }

  function showTooltip(event, label) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      label,
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  }

  function openActionMenu(event, menu) {
    if (!isOwner) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 210;
    setTooltip(null);
    setActionMenu({
      ...menu,
      x: rect.right - width,
      y: rect.bottom + 8,
    });
  }

  function getCategoryDropTarget(event, categoryId) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const droppingAfter = event.clientY > bounds.top + bounds.height / 2;
    const currentIndex = safeChannelLayout.findIndex((category) => category.id === categoryId);
    const nextCategory = droppingAfter ? safeChannelLayout[currentIndex + 1] : null;

    return {
      beforeCategoryId: droppingAfter ? nextCategory?.id || "" : categoryId,
      position: droppingAfter ? "after" : "before",
    };
  }

  function handleCategoryDragOver(event, categoryId) {
    if (!isOwner) return;
    const payload = getDragPayload(event);
    if (!payload) return;
    if (payload.type === "category" && payload.categoryId === categoryId) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (payload.type === "channel") {
      setDragTarget(`${categoryId}:__end__`);
      return;
    }

    const target = getCategoryDropTarget(event, categoryId);
    setDragTarget(`category:${categoryId}:${target.position}`);
  }

  function handleCategoryDrop(event, categoryId) {
    if (!isOwner) return;
    const payload = getDragPayload(event);
    if (!payload) return;

    event.preventDefault();
    event.stopPropagation();
    clearDragState();

    if (payload.type === "channel") {
      onMoveChannel(payload.channel, categoryId, "");
      return;
    }

    const target = getCategoryDropTarget(event, categoryId);
    if (payload.categoryId !== target.beforeCategoryId) {
      onMoveCategory?.(payload.categoryId, target.beforeCategoryId);
    }
  }

  /**
   * Moves a channel into a category. When dropping on a channel row, the cursor
   * position decides whether the dragged channel goes above or below that row.
   */
  function handleChannelDrop(event, categoryId, beforeChannel = "") {
    if (!isOwner) return;
    const payload = getDragPayload(event);
    if (payload?.type !== "channel") return;

    event.preventDefault();
    event.stopPropagation();
    clearDragState();
    if (payload.channel && payload.channel !== beforeChannel) {
      onMoveChannel(payload.channel, categoryId, beforeChannel);
    }
  }

  function getChannelDropTarget(event, categoryChannels, channel) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const droppingAfter = event.clientY > bounds.top + bounds.height / 2;

    if (!droppingAfter) {
      return { beforeChannel: channel, position: "before" };
    }

    const nextChannel = categoryChannels[categoryChannels.indexOf(channel) + 1];
    return { beforeChannel: nextChannel || "", position: "after" };
  }

  return (
    <div className="chat-sidebar">
      <label className="chat-search disabled" title="Search will be enabled later">
        <Search size={16} />
        <input disabled placeholder="Search in Convolution" type="search" />
      </label>

      <section className="chat-sidebar-section">
        <button
          className={[
            "chat-drafts-link",
            visibleDrafts.length ? "has-drafts" : "",
            activeChannel === DRAFTS_VIEW_ID ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSelectChannel(DRAFTS_VIEW_ID)}
          type="button"
        >
          <Send size={16} />
          Drafts
          {visibleDrafts.length ? (
            <span className="draft-count" aria-label={`${visibleDrafts.length} draft messages`}>
              {visibleDrafts.length}
            </span>
          ) : null}
        </button>
      </section>

      {isOwner ? (
        <section className="chat-sidebar-section chat-sidebar-owner-actions">
          <button
            className="chat-add-section-button"
            onClick={onCreateCategory}
            type="button"
          >
            <Plus size={16} />
            Add Section
          </button>
        </section>
      ) : null}

      {safeChannelLayout.map((category) => {
        const collapsed = collapsedCategories[category.id];
        const categoryChannels = Array.isArray(category.channels) ? category.channels : [];
        const categoryDragTarget = dragTarget?.startsWith(`category:${category.id}:`)
          ? dragTarget.split(":").at(-1)
          : "";

        return (
          <section
            className={[
              "chat-sidebar-section",
              "chat-category-section",
              categoryDragTarget === "before" ? "category-drag-before" : "",
              categoryDragTarget === "after" ? "category-drag-after" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={category.id}
            onDragLeave={() => setDragTarget(null)}
            onDragOver={(event) => handleCategoryDragOver(event, category.id)}
            onDragEnd={clearDragState}
            onDrop={(event) => handleCategoryDrop(event, category.id)}
          >
            <div
              className="chat-category-header"
              draggable={isOwner}
              onDragStart={(event) => {
                if (!isOwner) return;
                activeDragPayloadRef.current = { type: "category", categoryId: category.id };
                event.dataTransfer.setData(CATEGORY_DRAG_TYPE, category.id);
                event.dataTransfer.setData("text/plain", category.id);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              <button
                aria-expanded={!collapsed}
                className="chat-category-toggle"
                onClick={() =>
                  setCollapsedCategories((current) => ({
                    ...current,
                    [category.id]: !current[category.id],
                  }))
                }
                type="button"
              >
                <ChevronDown size={14} />
                <span>{category.name}</span>
              </button>
              {isOwner ? (
                <div className="chat-category-actions">
                  <button
                    aria-label={`Create channel in ${category.name}`}
                    className="chat-category-action-button"
                    onBlur={() => setTooltip(null)}
                    onClick={() => onCreateChannel(category.id)}
                    onFocus={(event) => showTooltip(event, "New Channel")}
                    onMouseEnter={(event) => showTooltip(event, "New Channel")}
                    onMouseLeave={() => setTooltip(null)}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    aria-label={`${category.name} options`}
                    className="chat-category-action-button"
                    onBlur={() => setTooltip(null)}
                    onClick={(event) =>
                      openActionMenu(event, {
                        type: "category",
                        categoryId: category.id,
                        categoryName: category.name,
                      })
                    }
                    onFocus={(event) => showTooltip(event, "More Options")}
                    onMouseEnter={(event) => showTooltip(event, "More Options")}
                    onMouseLeave={() => setTooltip(null)}
                    type="button"
                  >
                    <MoreVertical size={15} />
                  </button>
                </div>
              ) : null}
            </div>

            {!collapsed ? (
              <div
                className={[
                  "chat-channel-list",
                  dragTarget === `${category.id}:__end__` ? "category-drag-over" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  if (!isOwner) return;
                  const payload = getDragPayload(event);
                  if (payload?.type !== "channel") return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDragTarget(`${category.id}:__end__`);
                }}
                onDrop={(event) => handleChannelDrop(event, category.id)}
              >
                {categoryChannels.map((channel) => {
                  const channelMeta = safeChannelObjects.find((candidate) => candidate?.name === channel);
                  const isDocumentChannel = channelMeta?.type === "document";
                  const ChannelIcon = isDocumentChannel ? FileText : Hash;
                  const channelDragPrefix = `${category.id}:${channel}:`;
                  const channelDragTarget = dragTarget?.startsWith(channelDragPrefix)
                    ? dragTarget.slice(channelDragPrefix.length)
                    : "";

                  return (
                    <div
                      className={[
                        "chat-channel-row",
                        channel === activeChannel ? "active" : "",
                        channelDragTarget === "before" ? "drag-before" : "",
                        channelDragTarget === "after" ? "drag-after" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-channel-type={isDocumentChannel ? "document" : "text"}
                      draggable={isOwner}
                      key={channel}
                      onDragEnter={(event) => {
                        if (!isOwner) return;
                        const payload = getDragPayload(event);
                        if (payload?.type !== "channel") return;
                        const target = getChannelDropTarget(event, categoryChannels, channel);
                        setDragTarget(`${category.id}:${channel}:${target.position}`);
                      }}
                      onDragOver={(event) => {
                        if (!isOwner) return;
                        const payload = getDragPayload(event);
                        if (payload?.type !== "channel") return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        const target = getChannelDropTarget(event, categoryChannels, channel);
                        setDragTarget(`${category.id}:${channel}:${target.position}`);
                      }}
                      onDragStart={(event) => {
                        if (!isOwner) return;
                        activeDragPayloadRef.current = { type: "channel", channel };
                        event.dataTransfer.setData(CHANNEL_DRAG_TYPE, channel);
                        event.dataTransfer.setData("text/plain", channel);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={clearDragState}
                      onDrop={(event) => {
                        const target = getChannelDropTarget(event, categoryChannels, channel);
                        handleChannelDrop(event, category.id, target.beforeChannel);
                      }}
                    >
                      <button className="chat-channel-button" onClick={() => onSelectChannel(channel)} type="button">
                        <ChannelIcon size={18} />
                        <span>{channel}</span>
                      </button>
                      {isOwner ? (
                        <button
                          aria-label={`${channel} options`}
                          className="chat-channel-menu-button"
                          onBlur={() => setTooltip(null)}
                          onClick={(event) =>
                            openActionMenu(event, {
                              type: "channel",
                              channel,
                            })
                          }
                          onFocus={(event) => showTooltip(event, "More Options")}
                          onMouseEnter={(event) => showTooltip(event, "More Options")}
                          onMouseLeave={() => setTooltip(null)}
                          type="button"
                        >
                          <MoreVertical size={15} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}

      {isOwner && actionMenu && actionMenuPosition
        ? createPortal(
            <div
              className="chat-sidebar-menu chat-sidebar-action-menu"
              onClick={(event) => event.stopPropagation()}
              style={actionMenuPosition}
            >
              {actionMenu.type === "category" ? (
                <>
                  <button
                    onClick={() => {
                      onRequestRenameCategory?.({
                        id: actionMenu.categoryId,
                        name: actionMenu.categoryName,
                      });
                      setActionMenu(null);
                    }}
                    type="button"
                  >
                    <Edit3 size={16} />
                    Rename Section
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      onDeleteCategory(actionMenu.categoryId, actionMenu.categoryName);
                      setActionMenu(null);
                    }}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Delete Section
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={actionMenu.channel === "general"}
                    onClick={() => {
                      onRequestRenameChannel?.(actionMenu.channel);
                      setActionMenu(null);
                    }}
                    title={actionMenu.channel === "general" ? "The general channel cannot be renamed." : undefined}
                    type="button"
                  >
                    <Edit3 size={16} />
                    Rename Channel
                  </button>
                  <button
                    className="danger"
                    disabled={actionMenu.channel === "general"}
                    onClick={() => {
                      onRequestDeleteChannel(actionMenu.channel);
                      setActionMenu(null);
                    }}
                    title={actionMenu.channel === "general" ? "The general channel cannot be deleted." : undefined}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Delete Channel
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
      <ChatTooltip tooltip={tooltip} />
    </div>
  );
}

function ChatTooltip({ tooltip }) {
  if (!tooltip) return null;

  return createPortal(
    <div
      className="resource-floating-tooltip chat-floating-tooltip"
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}
