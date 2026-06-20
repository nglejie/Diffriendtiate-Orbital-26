import {
  ChevronDown,
  FileText,
  FolderPlus,
  Hash,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DRAFTS_VIEW_ID } from "./chatLayout.js";

/**
 * Chat-specific sidebar inspired by Discord/Gather.
 *
 * It manages only presentation state: drafts, category grouping, and local
 * drag/drop order. Server-owned channel creation remains in RoomView.
 */
export function ChatSidebar({
  activeChannel,
  channelLayout,
  drafts,
  onCreateCategory,
  onCreateChannel,
  onDeleteCategory,
  onMoveChannel,
  onRequestDeleteChannel,
  onSelectChannel,
  isOwner = false,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [dragTarget, setDragTarget] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  // Browser localStorage can keep older room UI state across refactors. Keep
  // the sidebar tolerant of bad saved values so Chat cannot blank the room.
  const safeDrafts = drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
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

  const menuPosition = useMemo(() => {
    if (!contextMenu) return null;

    // Keep the fixed menu inside the viewport even when users right-click near
    // the bottom edge of the sidebar.
    const width = 210;
    const height = 98;
    return {
      left: Math.min(contextMenu.x, window.innerWidth - width - 12),
      top: Math.min(contextMenu.y, window.innerHeight - height - 12),
    };
  }, [contextMenu]);

  const actionMenuPosition = useMemo(() => {
    if (!actionMenu) return null;

    const width = 210;
    const height = 54;
    return {
      left: Math.max(8, Math.min(actionMenu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(actionMenu.y, window.innerHeight - height - 8)),
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!contextMenu && !actionMenu) return undefined;

    function closeMenu() {
      setContextMenu(null);
      setActionMenu(null);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [contextMenu, actionMenu]);

  function openContextMenu(event, categoryId = null) {
    if (!isOwner) return;
    event.preventDefault();
    event.stopPropagation();
    setActionMenu(null);
    setTooltip(null);
    setContextMenu({
      categoryId,
      x: event.clientX,
      y: event.clientY,
    });
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
    setContextMenu(null);
    setTooltip(null);
    setActionMenu({
      ...menu,
      x: rect.right - width,
      y: rect.bottom + 8,
    });
  }

  /**
   * Moves a channel into a category. When dropping on a channel row, the cursor
   * position decides whether the dragged channel goes above or below that row.
   */
  function handleChannelDrop(event, categoryId, beforeChannel = "") {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);
    if (!isOwner) return;
    const channel = event.dataTransfer.getData("text/plain");
    if (channel && channel !== beforeChannel) onMoveChannel(channel, categoryId, beforeChannel);
  }

  function getDropTargetChannel(event, categoryChannels, channel) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const droppingAfter = event.clientY > bounds.top + bounds.height / 2;

    if (!droppingAfter) return channel;

    const nextChannel = categoryChannels[categoryChannels.indexOf(channel) + 1];
    return nextChannel || "";
  }

  return (
    <div className="chat-sidebar" onContextMenu={(event) => openContextMenu(event)}>
      <label className="chat-search disabled" title="Search will be enabled later">
        <Search size={16} />
        <input disabled placeholder="Search in chat" type="search" />
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

      {safeChannelLayout.map((category) => {
        const collapsed = collapsedCategories[category.id];
        const categoryChannels = Array.isArray(category.channels) ? category.channels : [];

        return (
          <section
            className="chat-sidebar-section"
            key={category.id}
            onContextMenu={(event) => openContextMenu(event, category.id)}
            onDragOver={(event) => {
              if (!isOwner) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setDragTarget(`${category.id}:__end__`);
            }}
            onDragLeave={() => setDragTarget(null)}
            onDrop={(event) => handleChannelDrop(event, category.id)}
          >
            <div className="chat-category-header">
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
              >
                {categoryChannels.map((channel) => (
                  <div
                    className={[
                      "chat-channel-row",
                      channel === activeChannel ? "active" : "",
                      dragTarget === `${category.id}:${channel}` ? "drag-over" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={isOwner}
                    key={channel}
                    onDragEnter={() => {
                      if (isOwner) setDragTarget(`${category.id}:${channel}`);
                    }}
                    onDragOver={(event) => {
                      if (!isOwner) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                      setDragTarget(`${category.id}:${channel}`);
                    }}
                    onDragStart={(event) => {
                      if (!isOwner) return;
                      event.dataTransfer.setData("text/plain", channel);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDrop={(event) =>
                      handleChannelDrop(
                        event,
                        category.id,
                        getDropTargetChannel(event, categoryChannels, channel),
                      )
                    }
                  >
                    <button className="chat-channel-button" onClick={() => onSelectChannel(channel)} type="button">
                      <Hash size={18} />
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
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="chat-sidebar-section muted">
        <div className="chat-category-header">
          <button aria-expanded="false" disabled type="button">
            <ChevronDown size={14} />
            Future Channels
          </button>
        </div>
        <div className="chat-channel-list">
          <button disabled type="button">
            <MessageCircle size={18} />
            <span>forum</span>
          </button>
          <button disabled type="button">
            <FileText size={18} />
            <span>document</span>
          </button>
        </div>
      </section>

      {isOwner && contextMenu && menuPosition
        ? createPortal(
        <div
          className="chat-sidebar-menu"
          onClick={(event) => event.stopPropagation()}
          style={menuPosition}
        >
          <button
            onClick={() => {
              onCreateChannel(contextMenu.categoryId);
              setContextMenu(null);
            }}
            type="button"
          >
            <Plus size={16} />
            Create Channel
          </button>
          <button
            onClick={() => {
              onCreateCategory();
              setContextMenu(null);
            }}
            type="button"
          >
            <FolderPlus size={16} />
            Create Category
          </button>
        </div>,
          document.body,
        )
        : null}
      {isOwner && actionMenu && actionMenuPosition
        ? createPortal(
        <div
          className="chat-sidebar-menu chat-sidebar-action-menu"
          onClick={(event) => event.stopPropagation()}
          style={actionMenuPosition}
        >
          {actionMenu.type === "category" ? (
            <button
              className="danger"
              onClick={() => {
                onDeleteCategory(actionMenu.categoryId, actionMenu.categoryName);
                setActionMenu(null);
              }}
              type="button"
            >
              <Trash2 size={16} />
              Delete Category
            </button>
          ) : (
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
