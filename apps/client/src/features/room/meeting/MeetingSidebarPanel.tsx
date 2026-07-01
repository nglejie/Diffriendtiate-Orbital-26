import {
  Headphones,
  Mic,
  MicOff,
  Settings,
  Video,
  VideoOff,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef } from "react";

function getInitial(value) {
  return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function getDisplayName(user) {
  return user?.name || user?.displayName || user?.email || "Member";
}

function avatarUrl(user) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

function MediaTile({ deafened, isLocal, participant, stream }) {
  const videoRef = useRef(null);
  const displayName = getDisplayName(participant?.user);
  const hasVideo =
    Boolean(stream?.getVideoTracks?.().length) && !participant?.media?.cameraOff;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream || null;
  }, [stream]);

  return (
    <article className={hasVideo ? "limeets-meeting-tile live" : "limeets-meeting-tile"}>
      {stream ? (
        <video
          autoPlay
          className={hasVideo ? "" : "audio-only"}
          muted={isLocal || deafened}
          playsInline
          ref={videoRef}
        />
      ) : null}
      {!hasVideo ? (
        <div className="limeets-meeting-placeholder" aria-hidden="true">
          {avatarUrl(participant?.user) ? (
            <img src={avatarUrl(participant.user)} alt="" />
          ) : (
            <span>{getInitial(displayName)}</span>
          )}
        </div>
      ) : null}
      <div className="limeets-meeting-tile-label">
        <span>{displayName}</span>
        {participant?.media?.muted ? <MicOff size={13} /> : <Mic size={13} />}
      </div>
    </article>
  );
}

export function MeetingSidebarPanel({ meeting, user }) {
  const participants = meeting?.participants || [];
  const selfId = user?.id || "local-user";
  const active = Boolean(meeting?.isActive);

  return (
    <section className="limeets-meeting-panel" aria-label="Limeets Meeting Area">
      <div className="limeets-meeting-status">
        <p>{active ? "Meeting Area" : "Voice and Video"}</p>
        <h3>{active ? "Live session" : "Enter a Meeting Area"}</h3>
        <span>
          {active
            ? `${participants.length || 1} member${participants.length === 1 ? "" : "s"} connected`
            : "Walk into a Meeting Area in Limeets to join automatically."}
        </span>
      </div>

      {meeting?.mediaError ? (
        <p className="limeets-meeting-warning">{meeting.mediaError}</p>
      ) : null}

      <div className="limeets-meeting-grid">
        {active ? (
          participants.map((participant) => {
            const isLocal = participant.userId === selfId;
            const stream = isLocal
              ? meeting.localStream
              : meeting.remoteStreams?.[participant.userId] || null;
            return (
              <MediaTile
                deafened={meeting.deafened}
                isLocal={isLocal}
                key={participant.userId}
                participant={participant}
                stream={stream}
              />
            );
          })
        ) : (
          <div className="limeets-meeting-empty">
            <Video size={22} />
            <p>Videos will appear here when you enter a Meeting Area.</p>
          </div>
        )}
      </div>

      <div className="limeets-meeting-controls" aria-label="Limeets user settings">
        <div className="limeets-meeting-user">
          <span className="limeets-meeting-avatar">
            {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : getInitial(getDisplayName(user))}
            <i className={active ? "online" : ""} />
          </span>
          <div>
            <strong>{getDisplayName(user)}</strong>
            <span>{active ? "In Meeting Area" : "In Limeets"}</span>
          </div>
        </div>
        <div className="limeets-meeting-control-buttons">
          <button
            aria-pressed={meeting?.muted}
            className={meeting?.muted ? "active danger" : ""}
            disabled={!active}
            onClick={meeting?.toggleMuted}
            title={meeting?.muted ? "Unmute microphone" : "Mute microphone"}
            type="button"
          >
            {meeting?.muted ? <MicOff size={17} /> : <Mic size={17} />}
          </button>
          <button
            aria-pressed={meeting?.deafened}
            className={meeting?.deafened ? "active" : ""}
            disabled={!active}
            onClick={meeting?.toggleDeafened}
            title={meeting?.deafened ? "Undeafen" : "Deafen"}
            type="button"
          >
            {meeting?.deafened ? <VolumeX size={17} /> : <Headphones size={17} />}
          </button>
          <button
            aria-pressed={meeting?.cameraOff}
            className={meeting?.cameraOff ? "active" : ""}
            disabled={!active}
            onClick={meeting?.toggleCamera}
            title={meeting?.cameraOff ? "Turn camera on" : "Turn camera off"}
            type="button"
          >
            {meeting?.cameraOff ? <VideoOff size={17} /> : <Video size={17} />}
          </button>
          <button disabled title="Settings coming later" type="button">
            <Settings size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
