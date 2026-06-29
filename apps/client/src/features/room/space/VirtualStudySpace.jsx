import {
  Bot,
  CalendarDays,
  FolderOpen,
  House,
  MessageCircle,
  MonitorUp,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getActivityTileForTab,
  getAreaForTile,
  spaceMapConfig,
  worldTabs,
} from "./spaceMapConfig.js";

const MOVE_EMIT_DELAY_MS = 120;
const MIN_TILE_SIZE = 18;

const areaIcons = {
  buddy: Bot,
  calendar: CalendarDays,
  chat: MessageCircle,
  coordidate: CalendarDays,
  focus: House,
  meeting: MonitorUp,
  private: Users,
  resources: FolderOpen,
  space: House,
};

function clampTile(tile, fallback = spaceMapConfig.startTile) {
  const col = Number(tile?.col);
  const row = Number(tile?.row);

  if (!Number.isFinite(col) || !Number.isFinite(row)) return fallback;

  return {
    col: Math.min(spaceMapConfig.columns - 1, Math.max(0, Math.round(col))),
    row: Math.min(spaceMapConfig.rows - 1, Math.max(0, Math.round(row))),
  };
}

function getUserInitial(user) {
  const name = user?.name || user?.email || "You";
  return String(name).trim().charAt(0).toUpperCase() || "Y";
}

function isTypingTarget(target) {
  const tagName = target?.tagName;
  return (
    target?.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getAreaStyle(bounds, layout) {
  return {
    "--area-cols": bounds.w,
    "--area-rows": bounds.h,
    gridColumn: `${bounds.col + layout.columnOffset + 1} / span ${bounds.w}`,
    gridRow: `${bounds.row + 1} / span ${bounds.h}`,
  };
}

function getTileStyle(tile, layout) {
  const worldCol = Number.isFinite(tile?.worldCol)
    ? tile.worldCol
    : tile.col + layout.columnOffset;

  return {
    gridColumn: `${worldCol + 1} / span 1`,
    gridRow: `${tile.row + 1} / span 1`,
  };
}

function getAvatarStyle(tile, layout) {
  const worldCol = tile.col + layout.columnOffset;

  return {
    left: `${((worldCol + 0.5) / layout.columns) * 100}%`,
    top: `${((tile.row + 0.5) / spaceMapConfig.rows) * 100}%`,
  };
}

function getTileFromPointer(event, layout) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const worldCol = Math.min(
    layout.columns - 1,
    Math.max(0, Math.floor((event.clientX - bounds.left) / layout.tileSize)),
  );
  const row = Math.min(
    spaceMapConfig.rows - 1,
    Math.max(0, Math.floor((event.clientY - bounds.top) / layout.tileSize)),
  );
  const col = worldCol - layout.columnOffset;
  const insideMap =
    col >= 0 &&
    col < spaceMapConfig.columns &&
    row >= 0 &&
    row < spaceMapConfig.rows;

  return {
    col,
    insideMap,
    row,
    worldCol,
  };
}

function normalizeSpaceMembers(users, currentUserId) {
  return Array.isArray(users)
    ? users
        .filter((member) => member?.userId && member.userId !== currentUserId)
        .map((member) => ({
          ...member,
          position: clampTile(member.position || spaceMapConfig.startTile),
        }))
    : [];
}

function formatCount(value, singular, plural = `${singular}s`) {
  const count = Number(value);
  if (!Number.isFinite(count)) return "";
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildAreaDetails(area, room, context) {
  if (area.id === "home") {
    return {
      status: "Room home",
      title: room?.name || "Home",
      lines: [room?.moduleCode, room?.academicTerm].filter(Boolean),
      action: "Open Home",
    };
  }

  if (area.id === "convolution") {
    const activeChannel = context?.activeChatChannel || "general";
    return {
      status: "Live chat",
      title: "Convolution",
      lines: [`#${activeChannel}`],
      action: "Open Convolution",
    };
  }

  if (area.id === "infilenite") {
    return {
      status: "Shared resources",
      title: "Infilenite",
      lines: [
        area.sublabel,
        formatCount(context?.resourceCount, "file"),
        "Latest uploads will surface here.",
      ].filter(Boolean),
      action: "Open Infilenite",
    };
  }

  if (area.id === "intelligrate") {
    return {
      status: context?.intelligrateAvailable ? "Ready" : "Setup needed",
      title: "Intelligrate",
      lines: [
        context?.activeBuddyThreadTitle || "",
        context?.intelligrateProviderLabel || "",
        "Recent assistant threads will surface here.",
      ].filter(Boolean),
      action: "Open Intelligrate",
    };
  }

  if (area.id === "coordidate") {
    return {
      status: "Limited",
      title: "Coordidate",
      lines: [area.sublabel, area.disabledLabel].filter(Boolean),
      action: "Coordidate unavailable",
    };
  }

  if (area.kind === "meeting") {
    return {
      status: "Coming later",
      title: area.label,
      lines: [area.disabledLabel],
      action: "Voice/video not available yet",
    };
  }

  return {
    status: area.tabId ? worldTabs[area.tabId] : "World area",
    title: area.label,
    lines: [area.sublabel, area.description || area.disabledLabel].filter(Boolean),
    action: area.tabId ? `Open ${worldTabs[area.tabId]}` : "",
  };
}

function WorldArea({
  active,
  area,
  details,
  focused,
  hovered,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
  worldLayout,
}) {
  const Icon = areaIcons[area.tabId || area.kind] || House;
  const interactive = Boolean(area.tabId || area.disabledLabel);

  function handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!area.tabId) return;

    event.preventDefault();
    onNavigate(area.tabId);
  }

  const className = [
    "world-area",
    `world-area-${area.kind}`,
    active ? "active" : "",
    focused ? "focused" : "",
    hovered ? "hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="world-area-icon">
        <Icon size={15} />
      </span>
      <span className="world-area-copy">
        <strong>{area.label}</strong>
        {area.sublabel ? <small>{area.sublabel}</small> : null}
        {details.lines.slice(0, area.id === "infilenite" || area.id === "intelligrate" ? 3 : 2).map((line) => (
          <em key={line}>{line}</em>
        ))}
      </span>
    </>
  );

  if (!interactive) {
    return (
      <div className={className} style={getAreaStyle(area.bounds, worldLayout)}>
        {content}
      </div>
    );
  }

  return (
    <button
      aria-describedby={active ? `world-area-panel-${area.id}` : undefined}
      aria-label={`${area.label}: ${details.action}`}
      className={className}
      data-world-area={area.id}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={getAreaStyle(area.bounds, worldLayout)}
      title={details.action}
      type="button"
    >
      {content}
    </button>
  );
}

function AreaPanel({ area, details }) {
  const Icon = areaIcons[area.tabId || area.kind] || House;

  return (
    <aside
      className={`world-area-panel ${area.id === "coordidate" ? "limited" : ""}`}
      id={`world-area-panel-${area.id}`}
    >
      <p>
        <Icon size={14} />
        {details.status}
      </p>
      <h3>{details.title}</h3>
      {details.lines.length ? (
        <div>
          {details.lines.slice(0, 3).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      ) : null}
      {details.action ? <strong>{details.action}</strong> : null}
    </aside>
  );
}

function WorldAvatar({ member, tile, variant = "peer", worldLayout }) {
  const name = member?.user?.name || member?.user?.email || member?.name || member?.email || "Classmate";
  const initial = getUserInitial(member?.user || member);

  return (
    <div
      aria-label={`${name} avatar`}
      className={`virtual-space-avatar ${variant}`}
      style={getAvatarStyle(tile, worldLayout)}
    >
      <span>{initial}</span>
      <strong>{name}</strong>
      {member?.status ? <small>{member.status}</small> : null}
    </div>
  );
}

export function VirtualStudySpace({
  onNavigate,
  room,
  roomActivityMembers = [],
  socket,
  spaceContext = {},
  user,
}) {
  const viewportRef = useRef(null);
  const [avatarTile, setAvatarTile] = useState(spaceMapConfig.startTile);
  const [spaceMembers, setSpaceMembers] = useState([]);
  const [focusedAreaId, setFocusedAreaId] = useState("");
  const [hoveredAreaId, setHoveredAreaId] = useState("");
  const [hoveredTile, setHoveredTile] = useState(null);
  const [worldLayout, setWorldLayout] = useState({
    columnOffset: 0,
    columns: spaceMapConfig.columns,
    tileSize: 24,
  });
  const joinedSpaceRef = useRef(false);
  const moveTimerRef = useRef(null);
  const pendingMoveRef = useRef(null);
  const avatarTileRef = useRef(avatarTile);
  const currentArea = useMemo(() => getAreaForTile(avatarTile), [avatarTile]);
  const activeAreaId = focusedAreaId || hoveredAreaId || currentArea?.id || "";
  const activeArea = spaceMapConfig.areas.find((area) => area.id === activeAreaId);
  const activeAreaDetails = activeArea
    ? buildAreaDetails(activeArea, room, spaceContext)
    : null;
  const hoveredTileArea = useMemo(
    () => (hoveredTile?.insideMap ? getAreaForTile(hoveredTile) : null),
    [hoveredTile],
  );
  const hoveredTileLabel = hoveredTileArea
    ? worldTabs[hoveredTileArea.tabId] || hoveredTileArea.label
    : "";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    function updateWorldLayout() {
      const viewportStyle = window.getComputedStyle(viewport);
      const horizontalPadding =
        Number.parseFloat(viewportStyle.paddingLeft || "0") +
        Number.parseFloat(viewportStyle.paddingRight || "0");
      const verticalPadding =
        Number.parseFloat(viewportStyle.paddingTop || "0") +
        Number.parseFloat(viewportStyle.paddingBottom || "0");
      const usableHeight = Math.max(1, viewport.clientHeight - verticalPadding);
      const usableWidth = Math.max(1, viewport.clientWidth - horizontalPadding);
      const tileSize = Math.max(
        MIN_TILE_SIZE,
        Math.floor(usableHeight / spaceMapConfig.rows),
      );
      const columns = Math.max(
        spaceMapConfig.columns,
        Math.floor(usableWidth / tileSize),
      );
      const columnOffset = Math.floor((columns - spaceMapConfig.columns) / 2);

      setWorldLayout((current) =>
        current.tileSize === tileSize &&
        current.columns === columns &&
        current.columnOffset === columnOffset
          ? current
          : { columnOffset, columns, tileSize },
      );
    }

    updateWorldLayout();

    const resizeObserver = new ResizeObserver(updateWorldLayout);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  const displayedMembers = useMemo(() => {
    const liveSpaceMembers = new Map(spaceMembers.map((member) => [member.userId, member]));
    const seenUserIds = new Set();
    const members = [];

    roomActivityMembers.forEach((activity) => {
      if (!activity?.userId || activity.userId === user?.id) return;
      seenUserIds.add(activity.userId);

      const liveSpaceMember = liveSpaceMembers.get(activity.userId);
      const tabId = activity.tabId || "focus";
      const tile = tabId === "space" && liveSpaceMember
        ? liveSpaceMember.position
        : getActivityTileForTab(tabId);

      members.push({
        ...activity,
        position: tile,
        status: worldTabs[tabId] || "In room",
      });
    });

    spaceMembers.forEach((member) => {
      if (seenUserIds.has(member.userId)) return;
      members.push({
        ...member,
        status: "Limeets",
      });
    });

    return members;
  }, [roomActivityMembers, spaceMembers, user?.id]);

  useEffect(() => {
    const startTile = clampTile(spaceMapConfig.startTile);
    setAvatarTile(startTile);
    avatarTileRef.current = startTile;
    setSpaceMembers([]);
    joinedSpaceRef.current = false;
  }, [room?.id]);

  useEffect(() => {
    avatarTileRef.current = avatarTile;
  }, [avatarTile]);

  function navigateForTile(tile) {
    const area = getAreaForTile(tile);
    if (!area?.tabId || area.tabId === "space") return;

    if (typeof onNavigate === "function") {
      onNavigate(area.tabId);
    }
  }

  function moveAvatar(nextTile, { navigate = true } = {}) {
    const tile = clampTile(nextTile);
    setAvatarTile(tile);

    if (navigate) {
      navigateForTile(tile);
    }
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;

      const movement = {
        ArrowDown: { col: 0, row: 1 },
        ArrowLeft: { col: -1, row: 0 },
        ArrowRight: { col: 1, row: 0 },
        ArrowUp: { col: 0, row: -1 },
        a: { col: -1, row: 0 },
        d: { col: 1, row: 0 },
        s: { col: 0, row: 1 },
        w: { col: 0, row: -1 },
      }[event.key.length === 1 ? event.key.toLowerCase() : event.key];

      if (!movement) return;

      event.preventDefault();
      moveAvatar({
        col: avatarTileRef.current.col + movement.col,
        row: avatarTileRef.current.row + movement.row,
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNavigate]);

  useEffect(() => {
    if (!socket || !room?.id || !user?.id) {
      if (moveTimerRef.current) {
        window.clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
        pendingMoveRef.current = null;
      }
      setSpaceMembers([]);
      joinedSpaceRef.current = false;
      return undefined;
    }

    let active = true;

    function joinSpace() {
      socket.emit(
        "space:join",
        {
          roomId: room.id,
          position: avatarTileRef.current,
        },
        (ack) => {
          if (!active) return;
          joinedSpaceRef.current = Boolean(ack?.ok);
          if (ack?.ok) {
            setSpaceMembers(normalizeSpaceMembers(ack.users, user.id));
            socket.emit("space:move", {
              roomId: room.id,
              position: avatarTileRef.current,
            });
          }
        },
      );
    }

    function leaveSpace() {
      if (!joinedSpaceRef.current) return;
      joinedSpaceRef.current = false;
      if (socket.connected) {
        socket.emit("space:leave", { roomId: room.id });
      }
    }

    function handleSpaceState(payload) {
      if (payload?.roomId !== room.id) return;
      setSpaceMembers(normalizeSpaceMembers(payload.users, user.id));
    }

    function handleUserMoved(payload) {
      if (payload?.roomId !== room.id || payload.userId === user.id) return;

      setSpaceMembers((current) => {
        const nextMember = {
          userId: payload.userId,
          user: payload.user,
          position: clampTile(payload.position || spaceMapConfig.startTile),
        };
        const exists = current.some((member) => member.userId === payload.userId);

        return exists
          ? current.map((member) =>
              member.userId === payload.userId ? { ...member, ...nextMember } : member,
            )
          : [...current, nextMember];
      });
    }

    function handleUserLeft(payload) {
      if (payload?.roomId !== room.id) return;
      setSpaceMembers((current) =>
        current.filter((member) => member.userId !== payload.userId),
      );
    }

    function handleDisconnect() {
      joinedSpaceRef.current = false;
      setSpaceMembers([]);
    }

    socket.on("space:state", handleSpaceState);
    socket.on("space:user-moved", handleUserMoved);
    socket.on("space:user-left", handleUserLeft);
    socket.on("connect", joinSpace);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      joinSpace();
    }

    return () => {
      active = false;
      socket.off("space:state", handleSpaceState);
      socket.off("space:user-moved", handleUserMoved);
      socket.off("space:user-left", handleUserLeft);
      socket.off("connect", joinSpace);
      socket.off("disconnect", handleDisconnect);
      leaveSpace();
      if (moveTimerRef.current) {
        window.clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
        pendingMoveRef.current = null;
      }
      setSpaceMembers([]);
    };
  }, [room?.id, socket, user?.id]);

  useEffect(() => {
    if (!socket || !room?.id || !joinedSpaceRef.current) return undefined;

    pendingMoveRef.current = avatarTile;
    if (moveTimerRef.current) return undefined;

    moveTimerRef.current = window.setTimeout(() => {
      moveTimerRef.current = null;
      const nextTile = pendingMoveRef.current;
      pendingMoveRef.current = null;

      if (!nextTile || !joinedSpaceRef.current) return;
      socket.emit("space:move", {
        roomId: room.id,
        position: nextTile,
      });
    }, MOVE_EMIT_DELAY_MS);

    return undefined;
  }, [avatarTile, room?.id, socket]);

  useEffect(() => {
    return () => {
      if (moveTimerRef.current) {
        window.clearTimeout(moveTimerRef.current);
      }
    };
  }, []);

  function handleWorldDoubleClick(event) {
    const nextTile = getTileFromPointer(event, worldLayout);
    if (!nextTile.insideMap) return;
    moveAvatar(nextTile);
  }

  function handleWorldMouseMove(event) {
    const nextTile = getTileFromPointer(event, worldLayout);
    setHoveredTile((current) =>
      current?.worldCol === nextTile.worldCol && current?.row === nextTile.row
        ? current
        : nextTile,
    );
  }

  function handleWorldMouseLeave() {
    setHoveredTile(null);
    setHoveredAreaId("");
  }

  function navigateToArea(tabId) {
    if (typeof onNavigate === "function") {
      onNavigate(tabId);
    }
  }

  return (
    <div className="virtual-study-space" ref={viewportRef}>
      <div
        aria-label="Limeets world"
        className="virtual-space-floor"
        onDoubleClick={handleWorldDoubleClick}
        onMouseLeave={handleWorldMouseLeave}
        onMouseMove={handleWorldMouseMove}
        role="application"
        style={{
          "--world-cols": worldLayout.columns,
          "--world-rows": spaceMapConfig.rows,
          "--world-tile-size": `${worldLayout.tileSize}px`,
        }}
        tabIndex={0}
      >
        <div className="virtual-space-backdrop" aria-hidden="true" />

        {spaceMapConfig.areas.map((area) => {
          const details = buildAreaDetails(area, room, spaceContext);
          const active = activeAreaId === area.id;

          return (
            <WorldArea
              active={active}
              area={area}
              details={details}
              focused={focusedAreaId === area.id}
              hovered={hoveredAreaId === area.id}
              key={area.id}
              onBlur={() => setFocusedAreaId("")}
              onFocus={() => setFocusedAreaId(area.id)}
              onMouseEnter={() => setHoveredAreaId(area.id)}
              onMouseLeave={() => setHoveredAreaId("")}
              onNavigate={navigateToArea}
              worldLayout={worldLayout}
            />
          );
        })}

        {hoveredTile ? (
          <div
            aria-hidden="true"
            className={`world-tile-hover ${hoveredTileArea ? "inside-area" : ""}`}
            style={getTileStyle(hoveredTile, worldLayout)}
          />
        ) : null}

        {hoveredTile && hoveredTileLabel ? (
          <div
            aria-hidden="true"
            className="world-tile-tooltip"
            style={getAvatarStyle(hoveredTile, worldLayout)}
          >
            <strong>{hoveredTileLabel}</strong>
            <span>
              Tile {hoveredTile.col + 1}, {hoveredTile.row + 1}
            </span>
          </div>
        ) : null}

        {activeArea && activeAreaDetails ? (
          <AreaPanel area={activeArea} details={activeAreaDetails} />
        ) : null}

        {displayedMembers.map((member) => (
          <WorldAvatar
            key={member.userId}
            member={member}
            tile={member.position}
            worldLayout={worldLayout}
          />
        ))}

        <WorldAvatar
          member={{
            ...user,
            status: worldTabs.space,
          }}
          tile={avatarTile}
          variant="current"
          worldLayout={worldLayout}
        />
      </div>
    </div>
  );
}
