import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  MonitorUp,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function getInitial(value) {
  return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function getDisplayName(user) {
  return user?.name || user?.displayName || user?.email || "Member";
}

function avatarUrl(user) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

function hasLiveVideo(stream) {
  return Boolean(
    stream
      ?.getVideoTracks?.()
      .some((track) => track.readyState !== "ended"),
  );
}

function pickPrimaryTile(tiles, focusedTileId) {
  if (!tiles.length) return null;

  return (
    tiles.find((tile) => tile.id === focusedTileId) ||
    tiles.find((tile) => tile.kind === "screen" && hasLiveVideo(tile.stream)) ||
    tiles.find((tile) => tile.kind === "screen") ||
    tiles.find((tile) => hasLiveVideo(tile.stream)) ||
    tiles[0]
  );
}

export function buildMeetingTiles(meeting, user) {
  if (!meeting?.isActive) return [];

  const participants = meeting.participants || [];
  const selfId = user?.id || "local-user";
  const tiles = participants.map((participant) => {
    const isLocal = participant.userId === selfId;
    return {
      id: `camera:${participant.userId}`,
      isLocal,
      kind: "camera",
      participant,
      stream: isLocal ? meeting.localStream : meeting.remoteStreams?.[participant.userId] || null,
    };
  });

  participants.forEach((participant) => {
    const isLocal = participant.userId === selfId;
    if (!participant?.media?.screenSharing && !(isLocal && meeting.screenSharing)) return;

    tiles.push({
      id: `screen:${participant.userId}`,
      isLocal,
      kind: "screen",
      participant,
      stream: isLocal
        ? meeting.screenStream
        : meeting.remoteScreenStreams?.[participant.userId] || null,
    });
  });

  return tiles;
}

export function MeetingMediaTile({ deafened, onSelect, selected = false, tile }) {
  const videoRef = useRef(null);
  const participant = tile.participant;
  const displayName = getDisplayName(participant?.user);
  const isScreen = tile.kind === "screen";
  const hasVideo = hasLiveVideo(tile.stream) && (isScreen || !participant?.media?.cameraOff);
  const className = `limeets-meeting-tile ${hasVideo ? "live" : ""} ${isScreen ? "screen" : ""} ${selected ? "selected" : ""}`.trim();

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = tile.stream || null;
    if (tile.stream) {
      void videoRef.current.play?.().catch(() => {});
    }
  }, [tile.stream]);

  const content = (
    <>
      {tile.stream ? (
        <video
          autoPlay
          className={hasVideo ? "" : "audio-only"}
          muted={tile.isLocal || deafened}
          playsInline
          ref={videoRef}
        />
      ) : null}
      {!hasVideo ? (
        <div className="limeets-meeting-placeholder" aria-hidden="true">
          {isScreen ? (
            <MonitorUp size={24} />
          ) : avatarUrl(participant?.user) ? (
            <img src={avatarUrl(participant.user)} alt="" />
          ) : (
            <span>{getInitial(displayName)}</span>
          )}
        </div>
      ) : null}
      <div className="limeets-meeting-tile-label">
        <span>{isScreen ? `${displayName} screen` : displayName}</span>
        {isScreen ? (
          <MonitorUp size={13} />
        ) : participant?.media?.muted ? (
          <MicOff size={13} />
        ) : (
          <Mic size={13} />
        )}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        aria-pressed={selected}
        className={className}
        onClick={() => onSelect(tile.id)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <article className={className}>
      {content}
    </article>
  );
}

export function MeetingDockPreview({ meeting, meetingAreaName = "Meeting Area", onOpen, user }) {
  const [collapsed, setCollapsed] = useState(false);
  const tiles = useMemo(() => buildMeetingTiles(meeting, user), [meeting, user]);
  if (!meeting?.isActive || !tiles.length) return null;

  return (
    <section className={`meeting-dock-preview ${collapsed ? "collapsed" : ""}`.trim()}>
      <div className="meeting-dock-preview-header">
        <button onClick={() => onOpen?.()} title="Open Limeets" type="button">
          <span>{meetingAreaName}</span>
        </button>
        <button
          aria-label={collapsed ? "Expand meeting preview" : "Collapse meeting preview"}
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {!collapsed ? (
        <div className="meeting-dock-preview-grid">
          {tiles.slice(0, 4).map((tile) => (
            <MeetingMediaTile
              deafened={meeting.deafened}
              key={tile.id}
              onSelect={() => onOpen?.()}
              tile={tile}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MeetingMediaStrip({ meeting, onOpen, user, variant = "overlay" }) {
  const tiles = useMemo(() => buildMeetingTiles(meeting, user), [meeting, user]);
  const trackRef = useRef(null);
  if (!meeting?.isActive || !tiles.length) return null;

  function scrollStrip(direction) {
    trackRef.current?.scrollBy({
      behavior: "smooth",
      left: direction * 340,
    });
  }

  function handleTrackKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen?.();
  }

  return (
    <section
      className={`meeting-media-strip ${variant} ${tiles.length > 2 ? "has-nav" : ""}`.trim()}
      aria-label="Meeting video tiles"
    >
      {tiles.length > 2 ? (
        <button
          aria-label="Show previous meeting tile"
          className="meeting-media-strip-nav previous"
          onClick={() => scrollStrip(-1)}
          type="button"
        >
          <ChevronLeft size={18} />
        </button>
      ) : null}
      <div
        className="meeting-media-strip-track"
        onClick={() => onOpen?.()}
        onKeyDown={handleTrackKeyDown}
        ref={trackRef}
        role="button"
        tabIndex={0}
        title="Open Limeets"
      >
        {tiles.map((tile) => (
          <MeetingMediaTile deafened={meeting.deafened} key={tile.id} tile={tile} />
        ))}
      </div>
      {tiles.length > 2 ? (
        <button
          aria-label="Show next meeting tile"
          className="meeting-media-strip-nav next"
          onClick={() => scrollStrip(1)}
          type="button"
        >
          <ChevronRight size={18} />
        </button>
      ) : null}
    </section>
  );
}

export function MeetingDisplayStage({ meeting, meetingAreaName = "Meeting Area", user }) {
  const [focusedTileId, setFocusedTileId] = useState("");
  const [primaryFullscreen, setPrimaryFullscreen] = useState(false);
  const primaryRef = useRef(null);
  const tiles = useMemo(() => buildMeetingTiles(meeting, user), [meeting, user]);
  const primaryTile = useMemo(
    () => pickPrimaryTile(tiles, focusedTileId),
    [focusedTileId, tiles],
  );
  const secondaryTiles = useMemo(
    () => tiles.filter((tile) => tile.id !== primaryTile?.id),
    [primaryTile?.id, tiles],
  );

  useEffect(() => {
    if (focusedTileId && !tiles.some((tile) => tile.id === focusedTileId)) {
      setFocusedTileId("");
    }
  }, [focusedTileId, tiles]);

  useEffect(() => {
    function handleFullscreenChange() {
      setPrimaryFullscreen(document.fullscreenElement === primaryRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function maximizePrimaryTile() {
    const node = primaryRef.current;
    if (!node) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    void node.requestFullscreen?.();
  }

  return (
    <section className="meeting-display-stage" aria-label={meetingAreaName}>
      <div className="meeting-display-room-name">{meeting?.isActive ? meetingAreaName : "Meeting Area"}</div>

      {meeting?.isActive && primaryTile ? (
        <div className={`meeting-display-layout ${secondaryTiles.length ? "" : "single"}`.trim()}>
          <div className="meeting-display-primary" ref={primaryRef}>
            <MeetingMediaTile
              deafened={meeting.deafened}
              key={primaryTile.id}
              selected
              tile={primaryTile}
            />
            <div className="meeting-display-primary-actions">
              <button
                onClick={maximizePrimaryTile}
                title={primaryFullscreen ? "Minimise display" : "Maximise display"}
                type="button"
              >
                {primaryFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                <span>{primaryFullscreen ? "Minimise" : "Maximise"}</span>
              </button>
            </div>
          </div>

          {secondaryTiles.length ? (
            <div className="meeting-display-filmstrip" aria-label="Other meeting displays">
              {secondaryTiles.map((tile) => (
                <MeetingMediaTile
                  deafened={meeting.deafened}
                  key={tile.id}
                  onSelect={setFocusedTileId}
                  selected={tile.id === focusedTileId}
                  tile={tile}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="meeting-display-empty">
          <Video size={28} />
          <span>Enter a Meeting Area in Domain to connect.</span>
        </div>
      )}
    </section>
  );
}
