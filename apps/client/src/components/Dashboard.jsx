import {
  CheckCircle2,
  ChevronDown,
  DoorOpen,
  Eye,
  EyeOff,
  Globe2,
  Lock,
  Plus,
  Search,
  Tag,
  Upload,
  UserRound,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import TopBar from "./TopBar.jsx";
import {
  backgroundPresets,
  createCustomBackgroundValue,
  createCustomImageBackgroundValue,
  emptyRoomForm,
  getBackground,
  getTheme,
  moduleCodeOptions,
} from "../constants.js";

const MAX_TAGS = 3;

function Dashboard({ onLogout, onOpenRoom, user }) {
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
  // Explore deliberately excludes private rooms; private discovery should happen by invite only.
  const exploreRooms = useMemo(
    () => rooms.filter((room) => !room.isMember && room.visibility === "public"),
    [rooms],
  );
  const visibleRooms = activeScope === "my" ? myRooms : exploreRooms;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadRooms(search);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [search]);

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
    setForm(emptyRoomForm);
    setCreateOpen(true);
  }

  function updateForm(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  function validateRoomForm() {
    const tags = normaliseTags(form.tags);

    if (!form.name.trim()) {
      setAlertMessage("Room name is required.");
      return false;
    }

    if (!form.moduleCode.trim()) {
      setAlertMessage("Module code is required.");
      return false;
    }

    if (form.visibility === "private" && !form.password.trim()) {
      setAlertMessage("Password is required for private room.");
      return false;
    }

    if (tags.length > MAX_TAGS) {
      setAlertMessage("Each room can only have up to 3 tags.");
      return false;
    }

    return true;
  }

  async function createRoom(event) {
    event.preventDefault();
    if (!validateRoomForm()) return;

    setCreating(true);

    try {
      const payload = await api.createRoom({
        ...form,
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

  return (
    <>
      <TopBar onCreateRoom={openCreateModal} onLogout={onLogout} user={user} />
      <div className="home-page">
      <section className="home-controls" aria-label="Room browser">
        <div className="scope-tabs" role="tablist" aria-label="Room lists">
          <button
            aria-selected={activeScope === "my"}
            className={activeScope === "my" ? "active" : ""}
            onClick={() => setActiveScope("my")}
            role="tab"
            type="button"
          >
            My Rooms
          </button>
          <button
            aria-selected={activeScope === "explore"}
            className={activeScope === "explore" ? "active" : ""}
            onClick={() => setActiveScope("explore")}
            role="tab"
            type="button"
          >
            Explore Rooms
          </button>
        </div>

        <div className="home-toolbar">
          <label className="home-search">
            <Search size={18} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search rooms, modules, or tags"
              value={search}
            />
          </label>
        </div>
      </section>

      <section className="room-gallery" aria-label="Room gallery">
        {visibleRooms.length ? (
          visibleRooms.map((room) => (
            <RoomTile
              key={room.id}
              mode={activeScope}
              onPreviewRoom={setSelectedRoom}
              onOpenRoom={onOpenRoom}
              room={room}
            />
          ))
        ) : (
          <div className="empty-room-tile">
            <p>
              {loading
                ? "Loading rooms..."
                : activeScope === "my"
                  ? "Create or join a room to see it here."
                  : "Nothing to see here for now"}
            </p>
          </div>
        )}
      </section>

      {createOpen ? (
        <CreateRoomModal
          creating={creating}
          form={form}
          onClose={() => setCreateOpen(false)}
          onCreate={createRoom}
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

function RoomTile({ mode, onOpenRoom, onPreviewRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const ownerName = room.owner?.name || "Room owner";
  const roomTags = (room.tags || []).slice(0, MAX_TAGS);
  const isExploreCard = mode === "explore";
  const VisibilityIcon = room.visibility === "private" ? Lock : Globe2;

  return (
    <article
      className="gallery-room-card"
      style={{
        "--theme-a": theme.colors[0],
        "--theme-b": theme.colors[1],
        "--theme-c": theme.colors[2],
        "--room-bg": background.css,
      }}
    >
      <button
        className="gallery-cover"
        onClick={() => (isExploreCard ? onPreviewRoom(room) : onOpenRoom(room.id))}
        type="button"
      >
        <span className="participant-count">
          <Users size={16} />
          {room.memberCount}
        </span>

        <span className="room-card-tags">
          {roomTags.length ? (
            roomTags.map((tag) => <span key={tag}>{tag}</span>)
          ) : (
            <span>study</span>
          )}
        </span>

        <span className="room-card-visibility" title={room.visibility}>
          <VisibilityIcon size={15} />
        </span>

        <span className="room-card-module">{room.moduleCode}</span>

        <span className="room-enter-action">
          {isExploreCard ? <Plus size={18} /> : <DoorOpen size={18} />}
          {isExploreCard ? "View Details" : "Open Room"}
        </span>
      </button>

      <div className="gallery-card-meta">
        <span className="room-avatar">
          <UserRound size={20} />
        </span>
        <div>
          <h2>{room.name}</h2>
          <p>{ownerName}</p>
        </div>
      </div>
    </article>
  );
}

function ExploreRoomModal({ onClose, onJoinRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const roomTags = (room.tags || []).slice(0, MAX_TAGS);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="room-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-room-title"
        style={{
          "--theme-a": theme.colors[0],
          "--theme-b": theme.colors[1],
          "--theme-c": theme.colors[2],
          "--room-bg": background.css,
        }}
      >
        <div className="modal-header">
          <div>
            <h2 id="explore-room-title">{room.name}</h2>
          </div>
          <button className="icon-button subtle on-dark" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </div>

        <div className="room-details-hero">
          <span>{room.moduleCode}</span>
        </div>

        <p className="room-details-description">
          {room.description || "This room has not added a description yet."}
        </p>

        <div className="room-details-meta">
          <span>
            <Globe2 size={16} />
            Public
          </span>
          <span>
            <Users size={16} />
            {room.memberCount} members
          </span>
          {roomTags.map((tag) => (
            <span key={tag}>
              <Tag size={15} />
              {tag}
            </span>
          ))}
        </div>

        <div className="modal-actions">
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" onClick={() => onJoinRoom(room.id)} type="button">
            <Plus size={17} />
            Join
          </button>
        </div>
      </section>
    </div>
  );
}

function CreateRoomModal({
  creating,
  form,
  onClose,
  onCreate,
  onUpdateField,
  setAlertMessage,
  setForm,
}) {
  const [customBackground, setCustomBackground] = useState({
    colors: ["#100519", "#7b3bb2", "#ff78a6"],
  });
  const [backgroundFilters, setBackgroundFilters] = useState({
    type: "All",
    environment: "All",
    color: "All",
  });
  const [tagDraft, setTagDraft] = useState("");
  const [showPrivatePassword, setShowPrivatePassword] = useState(false);
  const background = getBackground(form.background);
  const roomTags = normaliseTags(form.tags);
  const typeOptions = createFilterOptions(backgroundPresets, "type");
  const environmentOptions = createFilterOptions(backgroundPresets, "environment");
  const colorOptions = createFilterOptions(backgroundPresets, "color");
  const filteredBackgrounds = backgroundPresets.filter((item) =>
    matchesBackgroundFilters(item, backgroundFilters),
  );
  const gradientBackgrounds = filteredBackgrounds.filter(
    (item) => item.type === "Gradient",
  );
  const ambientBackgrounds = filteredBackgrounds.filter(
    (item) => item.type !== "Gradient",
  );

  function updateCustomColor(index, value) {
    setCustomBackground((current) => ({
      ...current,
      colors: current.colors.map((color, colorIndex) =>
        colorIndex === index ? value : color,
      ),
    }));
  }

  function useCustomBackground() {
    setForm((current) => ({
      ...current,
      background: createCustomBackgroundValue({
        name: "Custom Background",
        colors: customBackground.colors,
      }),
    }));
  }

  function updateBackgroundFilter(name, value) {
    setBackgroundFilters((current) => ({ ...current, [name]: value }));
  }

  function handleBackgroundUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAlertMessage("Please upload an image file.");
      return;
    }

    if (file.size > 900 * 1024) {
      setAlertMessage("Please keep custom background images under 900KB for now.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({
        ...current,
        background: createCustomImageBackgroundValue({
          name: "Uploaded Background",
          dataUrl: String(reader.result),
        }),
      }));
    };
    reader.onerror = () => setAlertMessage("Unable to read that image.");
    reader.readAsDataURL(file);
  }

  function updateTags(nextTags) {
    setForm((current) => ({ ...current, tags: nextTags.join(", ") }));
  }

  function addTag() {
    const nextTag = tagDraft.trim();
    if (!nextTag) return;

    if (roomTags.length >= MAX_TAGS) {
      setAlertMessage("Each room can only have up to 3 tags.");
      return;
    }

    if (roomTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      setAlertMessage("That tag has already been added.");
      return;
    }

    updateTags([...roomTags, nextTag]);
    setTagDraft("");
  }

  function handleTagKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-modal room-builder" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
        <div className="modal-header">
          <h2 id="create-room-title">Create a Study Space</h2>
          <button className="icon-button subtle on-dark" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </div>

        <form autoComplete="off" className="create-room-form" onSubmit={onCreate}>
          <div className="form-grid">
            <label className="field">
              <span>Room Name</span>
              <input
                autoComplete="off"
                name="name"
                onChange={onUpdateField}
                placeholder="CS2040S Final Push"
                value={form.name}
              />
            </label>

            <label className="field">
              <span>Module Code</span>
              <ModuleCodeCombobox
                onChange={(moduleCode) =>
                  setForm((current) => ({ ...current, moduleCode }))
                }
                options={moduleCodeOptions}
                value={form.moduleCode}
              />
            </label>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              autoComplete="off"
              onChange={onUpdateField}
              placeholder="Revision plan, focus areas, and group notes."
              rows={3}
              value={form.description}
            />
          </label>

          <div className="field">
            <span>Tags</span>
            <div className="tag-editor">
              <div className="tag-editor-list">
                {roomTags.map((tag) => (
                  <button
                    className="tag-chip-button"
                    key={tag}
                    onClick={() => updateTags(roomTags.filter((currentTag) => currentTag !== tag))}
                    title={`Remove ${tag}`}
                    type="button"
                  >
                    {tag}
                    <X size={13} />
                  </button>
                ))}
              </div>
              <div className="tag-editor-input">
                <input
                  autoComplete="off"
                  disabled={roomTags.length >= MAX_TAGS}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={roomTags.length >= MAX_TAGS ? "Maximum 3 tags" : "Add tag"}
                  value={tagDraft}
                />
                <button
                  className="secondary-button compact"
                  disabled={roomTags.length >= MAX_TAGS}
                  onClick={addTag}
                  type="button"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="visibility-settings">
            <div className="segmented-control" role="group" aria-label="Room visibility">
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

            {form.visibility === "private" ? (
              <label className="private-password-field">
                <input
                  aria-label="Private room password"
                  autoComplete="new-password"
                  name="private-room-passcode"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="Password"
                  type={showPrivatePassword ? "text" : "password"}
                  value={form.password}
                />
                <button
                  onClick={() => setShowPrivatePassword((current) => !current)}
                  title={showPrivatePassword ? "Hide password" : "Show password"}
                  type="button"
                >
                  {showPrivatePassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </label>
            ) : null}
          </div>

          <section className="theme-library-panel" aria-label="Theme library">
            <h3>Theme Library</h3>

            <div className="theme-filter-grid">
              <SelectMenu
                label="Type"
                onChange={(value) => updateBackgroundFilter("type", value)}
                options={typeOptions}
                value={backgroundFilters.type}
              />
              <SelectMenu
                label="Environment"
                onChange={(value) => updateBackgroundFilter("environment", value)}
                options={environmentOptions}
                value={backgroundFilters.environment}
              />
              <SelectMenu
                label="Colour"
                onChange={(value) => updateBackgroundFilter("color", value)}
                options={colorOptions}
                value={backgroundFilters.color}
              />
            </div>

            <BackgroundSection
              activeId={form.background}
              items={gradientBackgrounds}
              onSelect={(backgroundId) =>
                setForm((current) => ({ ...current, background: backgroundId }))
              }
              title="Gradients & Colors"
            />

            <BackgroundSection
              activeId={form.background}
              items={ambientBackgrounds}
              onSelect={(backgroundId) =>
                setForm((current) => ({ ...current, background: backgroundId }))
              }
              title="Ambient Worlds"
            />

            <div className="custom-background-panel">
              <div>
                <h4>Custom Background</h4>
                <p>Upload an image or create a custom gradient for the whole room.</p>
              </div>

              <label className="upload-dropzone">
                <Upload size={18} />
                <span>Upload image</span>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBackgroundUpload}
                  type="file"
                />
              </label>
              <div className="color-row">
                {customBackground.colors.map((color, index) => (
                  <label key={`${color}-${index}`}>
                    <span>Color {index + 1}</span>
                    <input
                      onChange={(event) => updateCustomColor(index, event.target.value)}
                      type="color"
                      value={color}
                    />
                  </label>
                ))}
              </div>
              <button className="secondary-button compact" onClick={useCustomBackground} type="button">
                <Wand2 size={17} />
                Use Custom Gradient
              </button>
            </div>
          </section>

          <div
            className="room-preview"
            style={{
              "--room-bg": background.css,
            }}
          >
            <div>
              <p>{form.moduleCode || "MODULE"}</p>
              <h3>{form.name || "Your Room"}</h3>
            </div>
          </div>

          <button className="primary-button" disabled={creating} type="submit">
            <Wand2 size={18} />
            {creating ? "Creating" : "Create Room"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ModuleCodeCombobox({ onChange, options, value }) {
  const [open, setOpen] = useState(false);
  const normalisedValue = value.trim().toLowerCase();
  const filteredOptions = options
    .filter((option) => option.toLowerCase().includes(normalisedValue))
    .slice(0, 8);

  function chooseOption(option) {
    onChange(option);
    setOpen(false);
  }

  return (
    <div
      className="module-combobox"
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <div className="input-with-icon">
        <input
          autoComplete="off"
          name="moduleCode"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filteredOptions[0]) {
              event.preventDefault();
              chooseOption(filteredOptions[0]);
            }
          }}
          placeholder="CS2040S"
          value={value}
        />
        <Search size={17} />
      </div>

      {open && filteredOptions.length ? (
        <div className="custom-option-list" role="listbox">
          {filteredOptions.map((option) => (
            <button
              key={option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
              role="option"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelectMenu({ label, onChange, options, value }) {
  const [open, setOpen] = useState(false);

  function chooseOption(option) {
    onChange(option);
    setOpen(false);
  }

  return (
    <div
      className="filter-select"
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <span>{label}</span>
      <button
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {value}
        <ChevronDown size={17} />
      </button>

      {open ? (
        <div className="custom-option-list filter-option-list" role="listbox">
          {options.map((option) => (
            <button
              className={value === option ? "active" : ""}
              key={option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
              role="option"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BackgroundSection({ activeId, items, onSelect, title }) {
  if (!items.length) return null;

  return (
    <section className="background-section">
      <h4>{title}</h4>
      <div className="background-library-grid">
        {items.map((item) => (
          <button
            className={activeId === item.id ? "picker-card active" : "picker-card"}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span
              className="background-swatch"
              style={{ "--background-swatch": item.css }}
            />
            {activeId === item.id ? (
              <span className="background-selected-mark">
                <CheckCircle2 size={22} />
              </span>
            ) : null}
            <strong>{item.name}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function AlertDialog({ message, onClose }) {
  return (
    <div className="modal-backdrop alert-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="alert-modal" role="alertdialog" aria-modal="true">
        <p>{message}</p>
        <div className="modal-actions">
          <button className="primary-button compact" onClick={onClose} type="button">
            OK
          </button>
        </div>
      </section>
    </div>
  );
}

function normaliseTags(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function createFilterOptions(items, key) {
  return ["All", ...new Set(items.map((item) => item[key]).filter(Boolean))];
}

function matchesBackgroundFilters(item, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (value === "All") return true;
    return item[key] === value;
  });
}

export default Dashboard;
