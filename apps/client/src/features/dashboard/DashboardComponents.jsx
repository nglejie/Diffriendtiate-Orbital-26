import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Eye,
  EyeOff,
  Globe2,
  ImagePlus,
  Link2,
  Lock,
  Plus,
  Search,
  Tag,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { MAX_ROOM_TAGS } from "./dashboardConstants.js";
import {
  createAcademicTermOptions,
  createFilterOptions,
  matchesBackgroundFilters,
  normaliseTags,
} from "./dashboardUtils.js";
import {
  backgroundPresets,
  createCustomBackgroundValue,
  createCustomImageBackgroundValue,
  defaultCustomBackgroundColors,
  getBackground,
  getTheme,
  moduleCodeOptions,
} from "../../constants.js";

const DEFAULT_CARD_ACADEMIC_TERM = createAcademicTermOptions()[0] || "";

/**
 * Keeps dashboard room cards compatible with older saved rooms while newer
 * rooms use the canonical `roomLogo` and `academicTerm` fields.
 */
function getRoomCardMeta(room) {
  return {
    academicTerm: room.academicTerm || room.academicYear || room.term || DEFAULT_CARD_ACADEMIC_TERM,
    logo: room.roomLogo || room.logo || room.logoUrl || room.icon || room.image || "",
  };
}

/** Room card used by both My Rooms and Explore Rooms. */
function RoomTile({ mode, onOpenRoom, onPreviewRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const ownerName = room.owner?.name || "Room owner";
  const roomTags = (room.tags || []).slice(0, MAX_ROOM_TAGS);
  const { academicTerm } = getRoomCardMeta(room);
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

        <span className="room-card-module">
          {academicTerm ? <small>{academicTerm}</small> : null}
          {room.moduleCode}
        </span>

        <span className="room-enter-action">
          {isExploreCard ? <Plus size={18} /> : <DoorOpen size={18} />}
          {isExploreCard ? "View Details" : "Open Room"}
        </span>
      </button>

      <div className="gallery-card-meta">
        <RoomLogoMark room={room} />
        <div>
          <h2>{room.name}</h2>
          <p>{ownerName}</p>
        </div>
      </div>
    </article>
  );
}

/** Shared room logo treatment used by dashboard cards and modal previews. */
function RoomLogoMark({ room }) {
  const initial = String(room.name || "R").trim().charAt(0).toUpperCase() || "R";
  const { logo } = getRoomCardMeta(room);

  return (
    <span className="room-avatar" aria-hidden="true">
      {logo ? <img src={logo} alt="" /> : <span>{initial}</span>}
    </span>
  );
}

/** Marks required modal fields without relying on hidden alert popups. */
function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

/** Modal shown before a member joins a public room from Explore Rooms. */
function ExploreRoomModal({ onClose, onJoinRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const roomTags = (room.tags || []).slice(0, MAX_ROOM_TAGS);

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
          <span>
            {room.moduleCode}
            {room.academicTerm ? ` · ${room.academicTerm}` : ""}
          </span>
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

/** Full room creation workflow, including visibility, tags, and theme choice. */
function CreateRoomModal({
  academicTermOptions = [],
  creating,
  form,
  onClose,
  onCreate,
  onJoinInvite,
  onUpdateField,
  setAlertMessage,
  setForm,
}) {
  const [step, setStep] = useState("start");
  const [customBackground, setCustomBackground] = useState({
    colors: defaultCustomBackgroundColors,
  });
  const [backgroundFilters, setBackgroundFilters] = useState({
    type: "All",
    environment: "All",
    color: "All",
  });
  const [tagDraft, setTagDraft] = useState("");
  const [showPrivatePassword, setShowPrivatePassword] = useState(false);
  const [inviteValue, setInviteValue] = useState("");
  const logoInputRef = useRef(null);
  const background = getBackground(form.background);
  const roomTags = normaliseTags(form.tags);
  const roomInitial = String(form.name || "R").trim().charAt(0).toUpperCase() || "R";
  const selectedAcademicTerm = form.academicTerm || academicTermOptions[0] || "";
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
  const stepTitle = {
    start: "Create Your Room",
    invite: "Join a Room",
    details: "Customise Your Room",
    theme: "Set the Scene",
  }[step];
  const stepDescription = {
    start: "Create a module room tailored to your needs.",
    invite: "Paste an invite code or link from a room member.",
    details: "Set the identity for your study room.",
    theme: "Choose a background that describes the atmosphere.",
  }[step];
  const detailsReady =
    Boolean(form.name.trim()) &&
    Boolean(form.moduleCode.trim()) &&
    Boolean(selectedAcademicTerm.trim()) &&
    (form.visibility !== "private" || Boolean(form.password.trim()));

  /** Updates a single room form value from non-input controls. */
  function updateFormValue(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  /** Ensures the generated current academic term is selected before details load. */
  function startOwnRoom() {
    setForm((current) => ({
      ...current,
      academicTerm: current.academicTerm || selectedAcademicTerm,
    }));
    setStep("details");
  }

  /** Validates the first metadata page before revealing visual customization. */
  function goToThemeStep(event) {
    event.preventDefault();

    if (detailsReady) setStep("theme");
  }

  /** Updates one color stop in the custom gradient builder. */
  function updateCustomColor(index, value) {
    setCustomBackground((current) => ({
      ...current,
      colors: current.colors.map((color, colorIndex) =>
        colorIndex === index ? value : color,
      ),
    }));
  }

  /** Saves the current custom gradient into the form's background field. */
  function useCustomBackground() {
    setForm((current) => ({
      ...current,
      background: createCustomBackgroundValue({
        name: "Custom Background",
        colors: customBackground.colors,
      }),
    }));
  }

  /** Applies a theme-library filter without losing the other filter values. */
  function updateBackgroundFilter(name, value) {
    setBackgroundFilters((current) => ({ ...current, [name]: value }));
  }

  /** Converts a small uploaded image into a room background value. */
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

  /** Stores a compact room logo as a data URL so the local prototype keeps it after refresh. */
  function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAlertMessage("Please upload an image file for the room logo.");
      return;
    }

    if (file.size > 500 * 1024) {
      setAlertMessage("Please keep room logo images under 500KB for now.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateFormValue("roomLogo", String(reader.result));
    reader.onerror = () => setAlertMessage("Unable to read that room logo.");
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  /**
   * The preview doubles as the logo control: it opens the file picker when empty,
   * and removes the current logo when one is already selected.
   */
  function handleLogoPreviewClick(event) {
    event.preventDefault();

    if (form.roomLogo) {
      updateFormValue("roomLogo", "");
      return;
    }

    logoInputRef.current?.click();
  }

  /** Stores room tags as the comma-separated shape expected by the form. */
  function updateTags(nextTags) {
    setForm((current) => ({ ...current, tags: nextTags.join(", ") }));
  }

  /** Validates and adds a tag while enforcing the room-card display limit. */
  function addTag() {
    const nextTag = tagDraft.trim();
    if (!nextTag) return;

    if (roomTags.length >= MAX_ROOM_TAGS) {
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

  /** Lets Enter add a tag instead of submitting the whole room form. */
  function handleTagKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  }

  /** Accepts either a raw invite code or a full invite URL from the join step. */
  function submitInvite(event) {
    event.preventDefault();
    onJoinInvite(inviteValue);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`create-modal room-builder guided-create-modal create-step-${step}`} role="dialog" aria-modal="true" aria-labelledby="create-room-title">
        <div className="modal-header">
          <div>
            <h2 id="create-room-title">{stepTitle}</h2>
            <p>{stepDescription}</p>
          </div>
          <button className="modal-close-button" onClick={onClose} title="Close" type="button">
            <X size={24} />
          </button>
        </div>

        {step === "start" ? (
          <div className="create-flow-screen">
            <button className="create-choice-card" onClick={startOwnRoom} type="button">
              <span className="choice-icon">
                <ImagePlus size={19} />
              </span>
              <span className="choice-copy">
                Create My Own
              </span>
              <ChevronRight className="arrow-right" size={20} />
            </button>
            <div className="invite-entry">
              <h3>Have an invite already?</h3>
              <button className="secondary-button" onClick={() => setStep("invite")} type="button">
                <Link2 size={17} />
                Join a Room
              </button>
            </div>
          </div>
        ) : null}

        {step === "invite" ? (
          <form autoComplete="off" className="join-invite-form" onSubmit={submitInvite}>
            <label className="field">
              <span>Invite link</span>
              <input
                autoComplete="off"
                onChange={(event) => setInviteValue(event.target.value)}
                placeholder="Paste an invite code or link"
                value={inviteValue}
              />
            </label>
            <div className="modal-actions guided-actions">
              <button className="text-button" onClick={() => setStep("start")} type="button">
                <ArrowLeft className="arrow-left" size={16} />
                Back
              </button>
              <button className="primary-button compact" type="submit">
                Join Room
              </button>
            </div>
          </form>
        ) : null}

        {step === "details" ? (
          <form autoComplete="off" className="create-room-form compact-create-form" onSubmit={goToThemeStep}>
            <div className="room-logo-uploader">
              <button
                className="room-logo-button"
                onClick={handleLogoPreviewClick}
                title={form.roomLogo ? "Click to remove room logo" : "Upload room logo"}
                type="button"
              >
                <span className="room-logo-preview">
                  {form.roomLogo ? <img src={form.roomLogo} alt="" /> : roomInitial}
                </span>
              </button>
              <input
                accept="image/png,image/jpeg,image/webp"
                className="room-logo-file-input"
                onChange={handleLogoUpload}
                ref={logoInputRef}
                type="file"
              />
              <div>
                <h3>Room Logo</h3>
                <p>Upload a square image, or we will use the first letter of the room name.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Room Name <RequiredMark /></span>
                <input
                  autoComplete="off"
                  name="name"
                  onChange={onUpdateField}
                  placeholder=""
                  value={form.name}
                />
              </label>

              <label className="field">
                <span>Module Code <RequiredMark /></span>
                <ModuleCodeCombobox
                  onChange={(moduleCode) => updateFormValue("moduleCode", moduleCode)}
                  options={moduleCodeOptions}
                  value={form.moduleCode}
                />
              </label>
            </div>

            <label className="field">
              <span>NUS Academic Year <RequiredMark /></span>
              <AcademicTermSelect
                onChange={(term) => updateFormValue("academicTerm", term)}
                options={academicTermOptions}
                value={selectedAcademicTerm}
              />
            </label>

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
                    disabled={roomTags.length >= MAX_ROOM_TAGS}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder={roomTags.length >= MAX_ROOM_TAGS ? "Maximum 3 tags" : ""}
                    value={tagDraft}
                  />
                  <button
                    className="secondary-button compact"
                    disabled={roomTags.length >= MAX_ROOM_TAGS}
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
                  onClick={() => updateFormValue("visibility", "public")}
                  type="button"
                >
                  <Globe2 size={16} />
                  Public
                </button>
                <button
                  className={form.visibility === "private" ? "active" : ""}
                  onClick={() => updateFormValue("visibility", "private")}
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
                    onChange={(event) => updateFormValue("password", event.target.value)}
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

            <div className="modal-actions guided-actions">
              <button className="text-button" onClick={() => setStep("start")} type="button">
                <ArrowLeft className="arrow-left" size={16} />
                Back
              </button>
              <button className="primary-button compact" disabled={!detailsReady} type="submit">
                Choose Background
                <ChevronRight className="arrow-right" size={17} />
              </button>
            </div>
          </form>
        ) : null}

        {step === "theme" ? (
          <form autoComplete="off" className="create-room-form guided-theme-form" onSubmit={onCreate}>
            <section className="custom-background-panel" aria-label="Custom background">
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
            </section>

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
                onSelect={(backgroundId) => updateFormValue("background", backgroundId)}
                title="Gradients & Colors"
              />

              <BackgroundSection
                activeId={form.background}
                items={ambientBackgrounds}
                onSelect={(backgroundId) => updateFormValue("background", backgroundId)}
                title="Ambient Worlds"
              />
            </section>

            <div
              className="room-preview"
              style={{
                "--room-bg": background.css,
              }}
            >
              <RoomLogoMark room={{ name: form.name, roomLogo: form.roomLogo }} />
              <div>
                <p>
                  {form.moduleCode || "MODULE"}
                  {selectedAcademicTerm ? ` · ${selectedAcademicTerm}` : ""}
                </p>
                <h3>{form.name || "Your Room"}</h3>
              </div>
            </div>

            <div className="modal-actions guided-actions">
              <button className="text-button" onClick={() => setStep("details")} type="button">
                <ArrowLeft className="arrow-left" size={16} />
                Back
              </button>
              <button className="primary-button compact" disabled={creating || !detailsReady} type="submit">
                <Wand2 size={18} />
                {creating ? "Creating" : "Create Room"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

/** Searchable module-code field with a few demo codes and free typing. */
function ModuleCodeCombobox({ onChange, options, value }) {
  const [open, setOpen] = useState(false);
  const normalisedValue = value.trim().toLowerCase();
  const filteredOptions = options
    .filter((option) => option.toLowerCase().includes(normalisedValue))
    .slice(0, 8);

  /** Selects one suggested module code and closes the option list. */
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
          placeholder=""
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

/** Small custom select used by the theme-library filters. */
function SelectMenu({ label, onChange, options, value }) {
  const [open, setOpen] = useState(false);

  /** Applies one filter value and closes the menu. */
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

/** Custom dropdown for the academic term field, avoiding browser-native select colours. */
function AcademicTermSelect({ onChange, options, value }) {
  const [open, setOpen] = useState(false);

  /** Applies the chosen term immediately so validation and previews stay in sync. */
  function chooseTerm(term) {
    onChange(term);
    setOpen(false);
  }

  return (
    <div
      className="field-select-menu academic-term-select"
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {value}
        <ChevronDown size={17} />
      </button>

      {open ? (
        <div className="custom-option-list field-option-list" role="listbox">
          {options.map((term) => (
            <button
              className={value === term ? "active" : ""}
              key={term}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseTerm(term)}
              role="option"
              type="button"
            >
              {term}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Displays a section of available background presets. */
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

export {
  AcademicTermSelect,
  BackgroundSection,
  CreateRoomModal,
  ExploreRoomModal,
  ModuleCodeCombobox,
  RoomTile,
};
