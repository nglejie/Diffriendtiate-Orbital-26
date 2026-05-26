import {
  DoorOpen,
  Globe2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { emptyRoomForm, getTheme, themePresets } from "../constants.js";

function Dashboard({ onOpenRoom }) {
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState(emptyRoomForm);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const myRooms = useMemo(() => rooms.filter((room) => room.isMember), [rooms]);
  const discoverRooms = useMemo(
    () => rooms.filter((room) => !room.isMember && room.visibility === "public"),
    [rooms],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadRooms(search);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [search]);

  async function loadRooms(nextSearch = search) {
    setLoading(true);
    setError("");

    try {
      const payload = await api.listRooms(nextSearch);
      setRooms(payload.rooms);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateForm(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function createRoom(event) {
    event.preventDefault();
    setCreating(true);
    setError("");

    try {
      const payload = await api.createRoom(form);
      setForm(emptyRoomForm);
      await loadRooms("");
      onOpenRoom(payload.room.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(roomId) {
    setError("");

    try {
      const payload = await api.joinRoom(roomId);
      await loadRooms(search);
      onOpenRoom(payload.room.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="dashboard-layout">
      <section className="dashboard-main">
        <div className="section-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Your Study Rooms</h1>
          </div>
          <button className="icon-button" onClick={() => loadRooms(search)} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>

        <label className="search-box">
          <Search size={18} />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by module, room, or tag"
            value={search}
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <RoomGrid
          emptyText={loading ? "Loading rooms..." : "No joined rooms yet."}
          onJoinRoom={joinRoom}
          onOpenRoom={onOpenRoom}
          rooms={myRooms}
          title="Joined"
        />

        <RoomGrid
          emptyText={loading ? "Loading rooms..." : "No public rooms found."}
          onJoinRoom={joinRoom}
          onOpenRoom={onOpenRoom}
          rooms={discoverRooms}
          title="Discover"
        />
      </section>

      <aside className="create-panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">New Room</p>
            <h2>Create</h2>
          </div>
          <Plus size={20} />
        </div>

        <form className="stacked-form" onSubmit={createRoom}>
          <label className="field">
            <span>Room Name</span>
            <input
              name="name"
              onChange={updateForm}
              placeholder="CS2040S Final Push"
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Module Code</span>
            <input
              name="moduleCode"
              onChange={updateForm}
              placeholder="CS2040S"
              value={form.moduleCode}
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              onChange={updateForm}
              placeholder="Revision plan, focus areas, and group notes."
              rows={4}
              value={form.description}
            />
          </label>

          <label className="field">
            <span>Tags</span>
            <input
              name="tags"
              onChange={updateForm}
              placeholder="algorithms, finals"
              value={form.tags}
            />
          </label>

          <div className="segmented-control" role="group">
            <button
              className={form.visibility === "public" ? "active" : ""}
              onClick={() => setForm((current) => ({ ...current, visibility: "public" }))}
              type="button"
            >
              <Globe2 size={16} />
              Public
            </button>
            <button
              className={form.visibility === "private" ? "active" : ""}
              onClick={() => setForm((current) => ({ ...current, visibility: "private" }))}
              type="button"
            >
              <Lock size={16} />
              Private
            </button>
          </div>

          <label className="field">
            <span>Theme</span>
            <select name="theme" onChange={updateForm} value={form.theme}>
              {themePresets.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-button" disabled={creating} type="submit">
            <Plus size={18} />
            {creating ? "Creating" : "Create Room"}
          </button>
        </form>
      </aside>
    </div>
  );
}

function RoomGrid({ emptyText, onJoinRoom, onOpenRoom, rooms, title }) {
  return (
    <section className="room-section">
      <div className="section-title-row">
        <h2>{title}</h2>
        <span>{rooms.length}</span>
      </div>

      {rooms.length ? (
        <div className="room-grid">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              onJoinRoom={onJoinRoom}
              onOpenRoom={onOpenRoom}
              room={room}
            />
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyText}</p>
      )}
    </section>
  );
}

function RoomCard({ onJoinRoom, onOpenRoom, room }) {
  const theme = getTheme(room.theme);

  return (
    <article className="room-card">
      <div className="room-accent" style={{ background: theme.colors[1] }} />
      <div className="room-card-top">
        <div>
          <p className="module-code">{room.moduleCode}</p>
          <h3>{room.name}</h3>
        </div>
        <span className="visibility-chip">
          {room.visibility === "public" ? <Globe2 size={14} /> : <Lock size={14} />}
          {room.visibility}
        </span>
      </div>

      <p className="room-description">
        {room.description || "No description added yet."}
      </p>

      {room.tags?.length ? (
        <div className="tag-row">
          {room.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="room-meta">
        <span>
          <Users size={15} />
          {room.memberCount}
        </span>
        <span>{room.messageCount} messages</span>
      </div>

      {room.isMember ? (
        <button className="secondary-button" onClick={() => onOpenRoom(room.id)} type="button">
          <DoorOpen size={17} />
          Open
        </button>
      ) : (
        <button className="secondary-button" onClick={() => onJoinRoom(room.id)} type="button">
          <Plus size={17} />
          Join
        </button>
      )}
    </article>
  );
}

export default Dashboard;
