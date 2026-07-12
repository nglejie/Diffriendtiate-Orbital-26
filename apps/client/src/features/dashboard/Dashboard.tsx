import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api.ts";
import TopBar from "./TopBar.tsx";
import { CreateRoomModal, ExploreRoomModal, RoomTile } from "./DashboardComponents.tsx";
import { MAX_ROOM_TAGS } from "./dashboardConstants.ts";
import AlertDialog from "../../shared/ui/AlertDialog.tsx";
import {
  createAcademicTermOptions,
  extractInviteCode,
  isCourseCodeFormatValid,
  limitWorldDescription,
  limitWorldFieldValue,
  limitWorldName,
  normaliseCourseCodeInput,
  normaliseTags,
} from "./dashboardUtils.ts";
import { emptyRoomForm } from "../../constants.ts";

/** Main world browser for joined worlds and public worlds the user can explore. */
function Dashboard({ onLogout, onOpenRoom, onThemeChange, onUserUpdated, themeMode, user }) {
  const academicTermOptions = useMemo(() => createAcademicTermOptions(), []);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState(emptyRoomForm);
  const [search, setSearch] = useState("");
  const [activeScope, setActiveScope] = useState("my");
  const [alertMessage, setAlertMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);

  const myRooms = useMemo(() => rooms.filter((room) => room.isMember), [rooms]);
  // Explore deliberately excludes private worlds; private discovery should happen by invite only.
  const exploreRooms = useMemo(
    () => rooms.filter((room) => !room.isMember && room.visibility === "public"),
    [rooms],
  );
  const visibleRooms = activeScope === "my" ? myRooms : exploreRooms;

  // Debounce room search so typing does not fire an API request for every keystroke.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadRooms(search);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [search]);

  /**
   * Loads both joined and discoverable worlds. The client decides which tab shows
   * each world so search stays consistent between My Worlds and Explore Worlds.
   */
  async function loadRooms(nextSearch = search) {
    setLoading(true);

    try {
      const payload = await api.listRooms(nextSearch);
      setRooms(payload.rooms);
    } catch (err) {
      setAlertMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setForm({ ...emptyRoomForm, academicTerm: academicTermOptions[0] || "" });
    setCreateOpen(true);
  }

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: limitWorldFieldValue(name, value),
    }));
  }

  /**
   * Centralizes room-creation rules before sending data to the API.
   * This keeps the modal responsive and avoids avoidable server round trips.
   */
  function validateRoomForm() {
    const tags = normaliseTags(form.tags);

    if (!form.name.trim()) {
      setAlertMessage("Domain name is required.");
      return false;
    }

    if (!form.moduleCode.trim()) {
      setAlertMessage("Course code is required.");
      return false;
    }

    if (!isCourseCodeFormatValid(form.moduleCode)) {
      setAlertMessage("Enter a valid NUS course code, e.g. CS2040S.");
      return false;
    }

    if (!form.academicTerm.trim()) {
      setAlertMessage("Academic year is required.");
      return false;
    }

    if (form.visibility === "private" && !form.password.trim()) {
      setAlertMessage("Password is required for private domain.");
      return false;
    }

    if (tags.length > MAX_ROOM_TAGS) {
      setAlertMessage("Each room can only have up to 3 tags.");
      return false;
    }

    return true;
  }

  /**
   * Creates a room, refreshes the dashboard list, then opens the new room.
   */
  async function createRoom(event) {
    event.preventDefault();
    if (!validateRoomForm()) return;

    setCreating(true);

    try {
      const payload = await api.createRoom({
        ...form,
        name: limitWorldName(form.name).trim(),
        description: limitWorldDescription(form.description).trim(),
        moduleCode: normaliseCourseCodeInput(form.moduleCode),
        // The API accepts either arrays or comma-separated tags; arrays keep the cap explicit here.
        tags: normaliseTags(form.tags),
      });
      setCreateOpen(false);
      setForm(emptyRoomForm);
      await loadRooms("");
      onOpenRoom(payload.room.id);
    } catch (err) {
      setAlertMessage(err.message);
    } finally {
      setCreating(false);
    }
  }

  /**
   * Joins a public room from the explore modal and immediately enters it.
   */
  async function joinRoom(roomId) {
    try {
      const payload = await api.joinRoom(roomId);
      setSelectedRoom(null);
      await loadRooms(search);
      onOpenRoom(payload.room.id);
    } catch (err) {
      setAlertMessage(err.message);
    }
  }

  /** Joins a world from an invite URL/code entered inside the create-world flow. */
  async function joinInvite(inviteValue, password = "") {
    const inviteCode = extractInviteCode(inviteValue);

    if (!inviteCode) {
      setAlertMessage("Invite link is required.");
      return;
    }

    try {
      const payload = await api.joinInvite(inviteCode, {
        password: String(password || "").trim(),
      });
      setCreateOpen(false);
      await loadRooms(search);
      onOpenRoom(payload.room.id);
    } catch (err) {
      setAlertMessage(err.message);
    }
  }

  return (
    <>
      <TopBar
        onCreateRoom={openCreateModal}
        onLogout={onLogout}
        onThemeChange={onThemeChange}
        onUserUpdated={onUserUpdated}
        themeMode={themeMode}
        user={user}
      />
      <div className="home-page">
      <section className="home-controls" aria-label="Domain browser">
        <div className="scope-tabs" role="tablist" aria-label="Room lists">
          <button
            aria-selected={activeScope === "my"}
            className={activeScope === "my" ? "active" : ""}
            onClick={() => setActiveScope("my")}
            role="tab"
            type="button"
          >
            My Domains
          </button>
          <button
            aria-selected={activeScope === "explore"}
            className={activeScope === "explore" ? "active" : ""}
            onClick={() => setActiveScope("explore")}
            role="tab"
            type="button"
          >
            Explore Domains
          </button>
        </div>

        <div className="home-toolbar">
          <label className="home-search">
            <Search size={18} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search domains..."
              value={search}
            />
          </label>
        </div>
      </section>

      <section className="room-gallery" aria-label="Domain gallery">
        {visibleRooms.map((room) => (
          <RoomTile
            key={room.id}
            mode={activeScope}
            onPreviewRoom={setSelectedRoom}
            onOpenRoom={onOpenRoom}
            room={room}
          />
        ))}
        {loading ? <p className="room-gallery-status">Loading rooms...</p> : null}
      </section>

      {createOpen ? (
        <CreateRoomModal
          creating={creating}
          form={form}
          academicTermOptions={academicTermOptions}
          onClose={() => setCreateOpen(false)}
          onCreate={createRoom}
          onJoinInvite={joinInvite}
          onUpdateField={updateForm}
          setAlertMessage={setAlertMessage}
          setForm={setForm}
        />
      ) : null}

      {selectedRoom ? (
        <ExploreRoomModal
          onClose={() => setSelectedRoom(null)}
          onJoinRoom={joinRoom}
          room={selectedRoom}
        />
      ) : null}

      {alertMessage ? (
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage("")} />
      ) : null}
      </div>
    </>
  );
}

export default Dashboard;
