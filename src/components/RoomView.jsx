import {
  ArrowLeft,
  CalendarPlus,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Link as LinkIcon,
  Lock,
  MessageCircle,
  Palette,
  Send,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api } from "../api.js";
import { getTheme, themePresets } from "../constants.js";

const tabs = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "resources", label: "Resources", icon: FileText },
  { id: "sessions", label: "Sessions", icon: CalendarPlus },
  { id: "settings", label: "Settings", icon: Palette },
];

function RoomView({ inviteCode, onBack, onOpenRoom, roomId, token, user }) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [resources, setResources] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState("chat");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [socketStatus, setSocketStatus] = useState("offline");

  const theme = getTheme(room?.theme);

  useEffect(() => {
    if (inviteCode) {
      setLoading(true);
      setError("");
      api
        .joinInvite(inviteCode)
        .then(({ room: joinedRoom }) => {
          onOpenRoom(joinedRoom.id);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
      return;
    }

    if (roomId) {
      loadRoomBundle(roomId);
    }
  }, [inviteCode, roomId]);

  useEffect(() => {
    if (!room?.id || !room.isMember) return undefined;

    const socket = io("/", {
      auth: { token },
      path: "/socket.io",
    });

    socket.on("connect", () => {
      setSocketStatus("online");
      socket.emit("room:join", room.id, (ack) => {
        if (!ack?.ok) setError(ack?.message || "Unable to join chat.");
      });
    });

    socket.on("disconnect", () => setSocketStatus("offline"));

    socket.on("message:new", (message) => {
      if (message.roomId !== room.id) return;
      setMessages((current) =>
        current.some((existing) => existing.id === message.id)
          ? current
          : [...current, message],
      );
    });

    socket.on("room:deleted", (payload) => {
      if (payload.roomId === room.id) onBack();
    });

    socket.on("room:updated", (updatedRoom) => {
      if (updatedRoom.id === room.id) {
        setRoom((current) => ({ ...current, ...updatedRoom }));
      }
    });

    window.diffriendtiateSocket = socket;

    return () => {
      socket.disconnect();
      if (window.diffriendtiateSocket === socket) {
        delete window.diffriendtiateSocket;
      }
    };
  }, [room?.id, room?.isMember, token]);

  async function loadRoomBundle(nextRoomId = room?.id) {
    if (!nextRoomId) return;
    setLoading(true);
    setError("");

    try {
      const { room: loadedRoom } = await api.getRoom(nextRoomId);
      setRoom(loadedRoom);

      if (loadedRoom.isMember) {
        const [messagePayload, resourcePayload, sessionPayload] = await Promise.all([
          api.getMessages(loadedRoom.id),
          api.getResources(loadedRoom.id),
          api.getSessions(loadedRoom.id),
        ]);
        setMessages(messagePayload.messages);
        setResources(resourcePayload.resources);
        setSessions(sessionPayload.sessions);
      } else {
        setMessages([]);
        setResources([]);
        setSessions([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function joinPublicRoom() {
    if (!room) return;
    setError("");

    try {
      const payload = await api.joinRoom(room.id);
      setRoom(payload.room);
      await loadRoomBundle(payload.room.id);
      setNotice("Joined room.");
    } catch (err) {
      setError(err.message);
    }
  }

  function sendViaSocket(body) {
    return new Promise((resolve, reject) => {
      const socket = window.diffriendtiateSocket;
      if (!socket?.connected) {
        reject(new Error("Chat is reconnecting. Try again in a moment."));
        return;
      }

      socket.emit("message:send", { roomId: room.id, body }, (ack) => {
        if (ack?.ok) resolve(ack.message);
        else reject(new Error(ack?.message || "Message failed."));
      });
    });
  }

  if (loading) {
    return <p className="empty-state">Loading room...</p>;
  }

  if (error && !room) {
    return (
      <section className="surface error-surface">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft size={17} />
          Back
        </button>
        <p className="form-error">{error}</p>
      </section>
    );
  }

  if (!room) return null;

  return (
    <div className="room-workspace">
      <RoomHeader
        onBack={onBack}
        onCopyInvite={() => {
          const inviteUrl = `${window.location.origin}${window.location.pathname}#/invite/${room.inviteCode}`;
          navigator.clipboard?.writeText(inviteUrl);
          setNotice("Invite link copied.");
        }}
        room={room}
        socketStatus={socketStatus}
        theme={theme}
      />

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-notice">{notice}</p> : null}

      {!room.isMember ? (
        <section className="surface join-surface">
          <h2>{room.name}</h2>
          <p>{room.description || "This public room is open to join."}</p>
          <button className="primary-button" onClick={joinPublicRoom} type="button">
            <Users size={18} />
            Join Room
          </button>
        </section>
      ) : (
        <>
          <nav className="tab-bar" aria-label="Room sections">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <Icon size={17} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {activeTab === "chat" ? (
            <ChatPanel messages={messages} onSend={sendViaSocket} user={user} />
          ) : null}

          {activeTab === "resources" ? (
            <ResourcePanel
              onChanged={() => loadRoomBundle(room.id)}
              resources={resources}
              room={room}
            />
          ) : null}

          {activeTab === "sessions" ? (
            <SessionPanel
              onChanged={() => loadRoomBundle(room.id)}
              room={room}
              sessions={sessions}
            />
          ) : null}

          {activeTab === "settings" ? (
            <SettingsPanel
              onBack={onBack}
              onChanged={(updatedRoom) => {
                setRoom(updatedRoom);
                setNotice("Room updated.");
              }}
              room={room}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function RoomHeader({ onBack, onCopyInvite, room, socketStatus, theme }) {
  return (
    <section
      className="room-hero"
      style={{
        "--theme-a": theme.colors[0],
        "--theme-b": theme.colors[1],
        "--theme-c": theme.colors[2],
      }}
    >
      <div className="room-hero-top">
        <button className="ghost-button on-dark" onClick={onBack} type="button">
          <ArrowLeft size={17} />
          Back
        </button>

        <div className="room-hero-actions">
          <span className="status-pill">
            <span className={socketStatus === "online" ? "dot online" : "dot"} />
            {socketStatus === "online" ? "Live" : "Offline"}
          </span>
          {room.inviteCode ? (
            <button className="ghost-button on-dark" onClick={onCopyInvite} type="button">
              <Copy size={17} />
              Invite
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <p className="module-code light">{room.moduleCode}</p>
        <h1>{room.name}</h1>
        <p>{room.description || "No description added yet."}</p>
      </div>

      <div className="room-hero-meta">
        <span>
          {room.visibility === "public" ? <Globe2 size={16} /> : <Lock size={16} />}
          {room.visibility}
        </span>
        <span>
          <Users size={16} />
          {room.memberCount} members
        </span>
        <span>
          <Palette size={16} />
          {theme.name}
        </span>
      </div>
    </section>
  );
}

function ChatPanel({ messages, onSend, user }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setSending(true);
    setError("");

    try {
      await onSend(trimmed);
      setBody("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="workspace-grid chat-grid">
      <div className="surface chat-surface">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Discussion</p>
            <h2>Room Chat</h2>
          </div>
          <MessageCircle size={20} />
        </div>

        <div className="message-list" ref={listRef}>
          {messages.length ? (
            messages.map((message) => (
              <article
                className={
                  message.sender?.id === user.id ? "message own-message" : "message"
                }
                key={message.id}
              >
                <div className="message-meta">
                  <strong>{message.sender?.name || "Unknown"}</strong>
                  <span>{formatDateTime(message.createdAt)}</span>
                </div>
                <p>{message.body}</p>
              </article>
            ))
          ) : (
            <p className="empty-state">No messages yet.</p>
          )}
        </div>

        <form className="message-form" onSubmit={handleSubmit}>
          <input
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type a message"
            value={body}
          />
          <button className="icon-button filled" disabled={sending} title="Send">
            <Send size={18} />
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}

function ResourcePanel({ onChanged, resources, room }) {
  const [urlForm, setUrlForm] = useState({ title: "", url: "" });
  const [fileTitle, setFileTitle] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function addUrl(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await api.addUrlResource(room.id, urlForm);
      setUrlForm({ title: "", url: "" });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFile(event) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", fileTitle || file.name);

    try {
      await api.uploadFileResource(room.id, formData);
      setFileTitle("");
      setFile(null);
      event.target.reset();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeResource(resourceId) {
    setError("");

    try {
      await api.deleteResource(resourceId);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="workspace-grid resource-grid">
      <div className="surface">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Materials</p>
            <h2>Shared Resources</h2>
          </div>
          <FileText size={20} />
        </div>

        <div className="resource-list">
          {resources.length ? (
            resources.map((resource) => (
              <article className="resource-row" key={resource.id}>
                <div className="resource-icon">
                  {resource.type === "url" ? <LinkIcon size={18} /> : <FileText size={18} />}
                </div>
                <div>
                  <a href={resource.url} rel="noreferrer" target="_blank">
                    {resource.title}
                    <ExternalLink size={14} />
                  </a>
                  <p>
                    {resource.uploader?.name || "Unknown"} ·{" "}
                    {resource.type === "file"
                      ? formatBytes(resource.size)
                      : "External link"}{" "}
                    · {formatDateTime(resource.createdAt)}
                  </p>
                </div>
                <button
                  className="icon-button subtle"
                  onClick={() => removeResource(resource.id)}
                  title="Delete resource"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <p className="empty-state">No resources yet.</p>
          )}
        </div>
      </div>

      <aside className="side-stack">
        <form className="surface stacked-form" onSubmit={addUrl}>
          <div className="section-header compact">
            <h3>Add Link</h3>
            <LinkIcon size={18} />
          </div>
          <label className="field">
            <span>Title</span>
            <input
              onChange={(event) =>
                setUrlForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Lecture notes"
              value={urlForm.title}
            />
          </label>
          <label className="field">
            <span>URL</span>
            <input
              onChange={(event) =>
                setUrlForm((current) => ({ ...current, url: event.target.value }))
              }
              placeholder="https://..."
              value={urlForm.url}
            />
          </label>
          <button className="secondary-button" disabled={submitting} type="submit">
            <LinkIcon size={17} />
            Save Link
          </button>
        </form>

        <form className="surface stacked-form" onSubmit={uploadFile}>
          <div className="section-header compact">
            <h3>Upload File</h3>
            <Upload size={18} />
          </div>
          <label className="field">
            <span>Display Name</span>
            <input
              onChange={(event) => setFileTitle(event.target.value)}
              placeholder="Optional"
              value={fileTitle}
            />
          </label>
          <label className="field">
            <span>File</span>
            <input onChange={(event) => setFile(event.target.files?.[0])} type="file" />
          </label>
          <button className="secondary-button" disabled={submitting || !file} type="submit">
            <Upload size={17} />
            Upload
          </button>
        </form>

        {error ? <p className="form-error">{error}</p> : null}
      </aside>
    </section>
  );
}

function SessionPanel({ onChanged, room, sessions }) {
  const [form, setForm] = useState({ title: "", startsAt: "", agenda: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions.filter((session) => new Date(session.startsAt).getTime() >= now);
  }, [sessions]);

  async function addSession(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await api.addSession(room.id, form);
      setForm({ title: "", startsAt: "", agenda: "" });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeSession(sessionId) {
    setError("");

    try {
      await api.deleteSession(sessionId);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="workspace-grid session-grid">
      <div className="surface">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Planner</p>
            <h2>Study Sessions</h2>
          </div>
          <Clock size={20} />
        </div>

        {upcoming.length ? (
          <p className="form-notice">
            Next: {upcoming[0].title} · {formatDateTime(upcoming[0].startsAt)}
          </p>
        ) : null}

        <div className="session-list">
          {sessions.length ? (
            sessions.map((session) => (
              <article className="session-row" key={session.id}>
                <div>
                  <h3>{session.title}</h3>
                  <p>{formatDateTime(session.startsAt)}</p>
                  {session.agenda ? <p>{session.agenda}</p> : null}
                </div>
                <button
                  className="icon-button subtle"
                  onClick={() => removeSession(session.id)}
                  title="Delete session"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <p className="empty-state">No scheduled sessions.</p>
          )}
        </div>
      </div>

      <aside className="surface stacked-form">
        <div className="section-header compact">
          <h3>Schedule</h3>
          <CalendarPlus size={18} />
        </div>
        <form className="stacked-form plain" onSubmit={addSession}>
          <label className="field">
            <span>Title</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Midterm revision"
              value={form.title}
            />
          </label>
          <label className="field">
            <span>Date and Time</span>
            <input
              onChange={(event) =>
                setForm((current) => ({ ...current, startsAt: event.target.value }))
              }
              placeholder="2026-06-02 14:30"
              value={form.startsAt}
            />
          </label>
          <label className="field">
            <span>Agenda</span>
            <textarea
              onChange={(event) =>
                setForm((current) => ({ ...current, agenda: event.target.value }))
              }
              placeholder="Topics, questions, and goals."
              rows={4}
              value={form.agenda}
            />
          </label>
          <button className="secondary-button" disabled={submitting} type="submit">
            <CalendarPlus size={17} />
            Add Session
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </aside>
    </section>
  );
}

function SettingsPanel({ onBack, onChanged, room }) {
  const [form, setForm] = useState({
    name: room.name,
    moduleCode: room.moduleCode,
    description: room.description,
    visibility: room.visibility,
    tags: room.tags.join(", "),
    theme: room.theme,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function saveRoom(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = await api.updateRoom(room.id, form);
      onChanged(payload.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoom() {
    if (!window.confirm("Delete this room and all its local data?")) return;
    setError("");

    try {
      await api.deleteRoom(room.id);
      onBack();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!room.isOwner) {
    return (
      <section className="surface">
        <p className="empty-state">Only the room owner can change settings.</p>
      </section>
    );
  }

  return (
    <section className="workspace-grid settings-grid">
      <form className="surface stacked-form" onSubmit={saveRoom}>
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Room</p>
            <h2>Settings</h2>
          </div>
          <Edit3 size={20} />
        </div>

        <label className="field">
          <span>Room Name</span>
          <input name="name" onChange={updateField} value={form.name} />
        </label>
        <label className="field">
          <span>Module Code</span>
          <input name="moduleCode" onChange={updateField} value={form.moduleCode} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            name="description"
            onChange={updateField}
            rows={4}
            value={form.description}
          />
        </label>
        <label className="field">
          <span>Tags</span>
          <input name="tags" onChange={updateField} value={form.tags} />
        </label>
        <label className="field">
          <span>Visibility</span>
          <select name="visibility" onChange={updateField} value={form.visibility}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="field">
          <span>Theme</span>
          <select name="theme" onChange={updateField} value={form.theme}>
            {themePresets.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" disabled={saving} type="submit">
          <Edit3 size={18} />
          {saving ? "Saving" : "Save Changes"}
        </button>
      </form>

      <aside className="surface danger-zone">
        <h3>Delete Room</h3>
        <p>Messages, resources, uploaded files, and sessions will be removed locally.</p>
        <button className="danger-button" onClick={deleteRoom} type="button">
          <Trash2 size={17} />
          Delete Room
        </button>
        {error ? <p className="form-error">{error}</p> : null}
      </aside>
    </section>
  );
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default RoomView;
