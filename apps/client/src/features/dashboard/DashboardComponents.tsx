import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Crown,
  DoorOpen,
  Eye,
  EyeOff,
  Globe2,
  ImagePlus,
  Info,
  Link2,
  Lock,
  Plus,
  Search,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_ROOM_TAGS,
  MAX_WORLD_DESCRIPTION_WORDS,
  MAX_WORLD_NAME_CHARS,
} from "./dashboardConstants.ts";
import {
  createAcademicTermOptions,
  createFilterOptions,
  getCourseCodeValidationMessage,
  getNusmodsAcademicYear,
  isCourseCodeFormatValid,
  matchesBackgroundFilters,
  normaliseCourseCodeInput,
  normaliseTags,
} from "./dashboardUtils.ts";
import {
  backgroundPresets,
  createCustomBackgroundValue,
  createCustomImageBackgroundValue,
  defaultCustomBackgroundColors,
  getBackground,
  getTheme,
  moduleCodeOptions,
} from "../../constants.ts";
import { AppSelectMenu } from "../../shared/ui/AppSelectMenu.tsx";

const DEFAULT_CARD_ACADEMIC_TERM = createAcademicTermOptions()[0] || "";
const NUSMODS_API_BASE = "https://api.nusmods.com/v2";
const nusmodsCourseCache = new Map();
const COURSE_CODE_HELP_TEXT = "Course codes must follow the standard 2-3 letter prefix plus 4 digits format and an optional 1 letter suffix. e.g. CS2040S, ST2334. The prefix is case-insensitive.";

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

/** World card used by both My Worlds and Explore Worlds. */
function RoomTile({ mode, onOpenRoom, onPreviewRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const ownerName = room.owner?.name || "Room owner";
  const roomTags = normaliseTags(room.tags).slice(0, MAX_ROOM_TAGS);
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

        {roomTags.length > 0 ? (
          <span className="room-card-tags">
            {roomTags.map((tag) => <span key={tag}>{tag}</span>)}
          </span>
        ) : null}

        <span className="room-card-visibility" title={room.visibility}>
          <VisibilityIcon size={15} />
        </span>

        <span className="room-card-module">
          {academicTerm ? <small>{academicTerm}</small> : null}
          {room.moduleCode}
        </span>

        <span className="room-enter-action">
          {isExploreCard ? <Plus size={18} /> : <DoorOpen size={18} />}
          {isExploreCard ? "View Details" : "Enter Domain"}
        </span>
      </button>

      <div className="gallery-card-meta">
        <RoomLogoMark room={room} showOwnerCrown={!isExploreCard && Boolean(room.isOwner)} />
        <div>
          <h2>{room.name}</h2>
          <p>{ownerName}</p>
        </div>
      </div>
    </article>
  );
}

/** Shared room logo treatment used by dashboard cards and modal previews. */
function RoomLogoMark({ room, showOwnerCrown = false }) {
  const initial = String(room.name || "R").trim().charAt(0).toUpperCase() || "R";
  const { logo } = getRoomCardMeta(room);

  return (
    <span className={showOwnerCrown ? "room-avatar owner-marked" : "room-avatar"} aria-hidden="true">
      {logo ? <img src={logo} alt="" /> : <span>{initial}</span>}
      {showOwnerCrown ? (
        <span className="room-owner-crown">
          <Crown size={12} fill="currentColor" />
        </span>
      ) : null}
    </span>
  );
}

/** Marks required modal fields without relying on hidden alert popups. */
function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

function clampTooltipLeft(value, width) {
  const margin = 12;

  if (typeof window === "undefined") return value;
  return Math.min(Math.max(value, margin), window.innerWidth - width - margin);
}

function clampTooltipArrow(value, width) {
  const margin = 14;

  return Math.min(Math.max(value, margin), width - margin);
}

function estimateTooltipWidth(message, maxWidth = 280) {
  const textLength = typeof message === "string" ? message.length : 40;

  return Math.min(maxWidth, Math.max(112, textLength * 7 + 24));
}

function FieldTooltipTrigger({
  ariaLabel,
  className = "",
  icon: Icon = Info,
  maxWidth: preferredMaxWidth = 280,
  message,
  tooltipClassName = "",
}) {
  const [active, setActive] = useState(false);
  const [tooltipState, setTooltipState] = useState(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  useLayoutEffect(() => {
    if (!active || !triggerRef.current || typeof window === "undefined") {
      setTooltipState(null);
      return undefined;
    }

    function updateTooltipPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const maxWidth = Math.min(preferredMaxWidth, Math.max(112, window.innerWidth - 24));
      const tooltipWidth = Math.min(
        maxWidth,
        tooltipRef.current?.offsetWidth || estimateTooltipWidth(message, maxWidth),
      );
      const minimumTooltipHeight = tooltipClassName.includes("canvas-token-tooltip") ? 304 : 44;
      const tooltipHeight = Math.max(tooltipRef.current?.offsetHeight || 0, minimumTooltipHeight);
      const triggerCenter = rect.left + rect.width / 2;
      const left = clampTooltipLeft(triggerCenter - tooltipWidth / 2, tooltipWidth);
      const arrowLeft = clampTooltipArrow(triggerCenter - left, tooltipWidth);
      const roomAbove = rect.top - 12;
      const roomBelow = window.innerHeight - rect.bottom - 12;
      const placeAbove = roomAbove >= tooltipHeight || roomAbove >= roomBelow;
      const top = placeAbove
        ? Math.max(tooltipHeight + 12, rect.top - 8)
        : Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - tooltipHeight - 12);

      setTooltipState({
        placement: placeAbove ? "top" : "bottom",
        style: {
          "--tooltip-arrow-left": `${arrowLeft}px`,
          left: `${left}px`,
          maxWidth: `${maxWidth}px`,
          top: `${top}px`,
        },
      });
    }

    updateTooltipPosition();
    const frame = window.requestAnimationFrame(updateTooltipPosition);
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [active, message, preferredMaxWidth, tooltipClassName]);

  const tooltipStyle = tooltipState?.style || {
    left: "-9999px",
    maxWidth: "min(280px, calc(100vw - 24px))",
    top: "0px",
    visibility: "hidden",
  };

  return (
    <span
      aria-label={ariaLabel}
      aria-expanded={active}
      aria-haspopup="true"
      className={["field-help-indicator", className].filter(Boolean).join(" ")}
      onBlur={() => setActive(false)}
      onFocus={() => setActive(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActive((current) => !current);
        }
      }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      ref={triggerRef}
      role="button"
      tabIndex={0}
    >
      <Icon size={14} />
      {active && typeof document !== "undefined"
        ? createPortal(
            <span
              className={["field-tooltip", tooltipClassName].filter(Boolean).join(" ")}
              data-placement={tooltipState?.placement || "top"}
              ref={tooltipRef}
              role="tooltip"
              style={tooltipStyle}
            >
              {message}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function FieldInfoLabel({ children, message }) {
  return (
    <span className="field-label-row">
      <span>{children}</span>
      <FieldTooltipTrigger
        ariaLabel={message}
        message={message}
      />
    </span>
  );
}

function CourseCodeLabel({ message = "", required = false }) {
  const tooltipText = message || COURSE_CODE_HELP_TEXT;
  const Icon = message ? AlertCircle : Info;

  return (
    <span className="field-label-row">
      <span>
        Course Code {required ? <RequiredMark /> : null}
      </span>
      <FieldTooltipTrigger
        ariaLabel={message ? "Invalid NUS code format" : "NUS code format help"}
        className={message ? "error" : ""}
        icon={Icon}
        message={tooltipText}
      />
    </span>
  );
}

function JoinWorldForm({
  error = "",
  initialInviteValue = "",
  joining = false,
  onBack,
  onJoinInvite,
}) {
  const [showInvitePassword, setShowInvitePassword] = useState(false);
  const [inviteValue, setInviteValue] = useState(initialInviteValue);
  const [invitePassword, setInvitePassword] = useState("");

  useEffect(() => {
    setInviteValue(initialInviteValue);
  }, [initialInviteValue]);

  function submitInvite(event) {
    event.preventDefault();
    onJoinInvite(inviteValue, invitePassword);
  }

  return (
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
      <label className="field">
        <span>Domain password</span>
        <div className="private-password-field join-password-field">
          <input
            aria-label="Domain invite password"
            autoComplete="current-password"
            onChange={(event) => setInvitePassword(event.target.value)}
            placeholder="Enter password if required"
            type={showInvitePassword ? "text" : "password"}
            value={invitePassword}
          />
          <button
            aria-label={showInvitePassword ? "Hide invite password" : "Show invite password"}
            onClick={() => setShowInvitePassword((current) => !current)}
            title={showInvitePassword ? "Hide password" : "Show password"}
            type="button"
          >
            {showInvitePassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="modal-actions guided-actions">
        <button className="text-button" onClick={onBack} type="button">
          <ArrowLeft className="arrow-left" size={16} />
          Back
        </button>
        <button className="primary-button compact" disabled={joining} type="submit">
          {joining ? "Joining" : "Join Domain"}
        </button>
      </div>
    </form>
  );
}

function JoinWorldDialog({
  error = "",
  initialInviteValue = "",
  joining = false,
  onBack,
  onClose,
  onJoinInvite,
}) {
  const goBack = onBack || onClose;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-modal room-builder guided-create-modal create-step-invite join-world-dialog" role="dialog" aria-modal="true" aria-labelledby="join-world-title">
        <div className="modal-header">
          <div>
            <h2 id="join-world-title">Join a Domain</h2>
            <p>Paste an invite code or link from a domain member.</p>
          </div>
          <button className="modal-close-button" onClick={onClose} title="Close" type="button">
            <X size={24} />
          </button>
        </div>
        <JoinWorldForm
          error={error}
          initialInviteValue={initialInviteValue}
          joining={joining}
          onBack={goBack}
          onJoinInvite={onJoinInvite}
        />
      </section>
    </div>
  );
}

/** Modal shown before a member joins a public world from Explore Worlds. */
function ExploreRoomModal({ onClose, onJoinRoom, room }) {
  const theme = getTheme(room.theme);
  const background = getBackground(room.background);
  const roomTags = normaliseTags(room.tags).slice(0, MAX_ROOM_TAGS);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="room-details-modal world-preview-modal"
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
            <h2 id="explore-room-title">Preview</h2>
          </div>
          <button className="modal-close-button" onClick={onClose} title="Close" type="button">
            <X size={24} />
          </button>
        </div>

        <div className="world-preview-hero">
          <div className="world-preview-hero-top">
            <span className="world-preview-member-count">
              <Users size={15} />
              {room.memberCount}
            </span>
            {roomTags.length > 0 ? (
              <div className="world-preview-tags" aria-label="Domain tags">
                {roomTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="world-preview-identity">
            <RoomLogoMark room={room} />
            <div className="world-preview-title-block">
              <h3>{room.name}</h3>
              <p className="world-preview-subtitle">
                {room.moduleCode}
                {room.academicTerm ? ` \u00b7 ${room.academicTerm}` : ""}
              </p>
            </div>
          </div>
        </div>

        <p className="room-details-description">
          {room.description || "This domain has not added a description yet."}
        </p>

        <div className="modal-actions world-preview-actions">
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

/** Full world creation workflow, including visibility, tags, and theme choice. */
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
    start: "Create Your Domain",
    invite: "Join a Domain",
    details: "Customise Your Domain",
    theme: "Set the Scene",
  }[step];
  const stepDescription = {
    start: "Create a course domain tailored to your needs.",
    invite: "Paste an invite code or link from a domain member.",
    details: "Set the identity for your study domain.",
    theme: "Choose a background that describes the atmosphere.",
  }[step];
  const detailsReady =
    Boolean(form.name.trim()) &&
    isCourseCodeFormatValid(form.moduleCode) &&
    Boolean(selectedAcademicTerm.trim()) &&
    (form.visibility !== "private" || Boolean(form.password.trim()));
  const courseCodeValidationMessage = getCourseCodeValidationMessage(form.moduleCode);

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
      setAlertMessage("Please upload an image file for the domain logo.");
      return;
    }

    if (file.size > 500 * 1024) {
      setAlertMessage("Please keep domain logo images under 500KB for now.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateFormValue("roomLogo", String(reader.result));
    reader.onerror = () => setAlertMessage("Unable to read that domain logo.");
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
                Join a Domain
              </button>
            </div>
          </div>
        ) : null}

        {step === "invite" ? (
          <JoinWorldForm
            onBack={() => setStep("start")}
            onJoinInvite={onJoinInvite}
          />
        ) : null}

        {step === "details" ? (
          <form autoComplete="off" className="create-room-form compact-create-form" onSubmit={goToThemeStep}>
            <div className="room-logo-uploader">
              <button
                className="room-logo-button"
                onClick={handleLogoPreviewClick}
                title={form.roomLogo ? "Click to remove domain logo" : "Upload domain logo"}
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
                <h3>Domain Logo</h3>
                <p>Upload a square image, or we will use the first letter of the domain name.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <FieldInfoLabel message={`Maximum ${MAX_WORLD_NAME_CHARS} characters.`}>
                  Domain Name <RequiredMark />
                </FieldInfoLabel>
                <input
                  autoComplete="off"
                  maxLength={MAX_WORLD_NAME_CHARS}
                  name="name"
                  onChange={onUpdateField}
                  placeholder=""
                  value={form.name}
                />
              </label>

              <label className="field">
                <CourseCodeLabel message={courseCodeValidationMessage} required />
                <CourseCodeCombobox
                  academicTerm={selectedAcademicTerm}
                  invalid={Boolean(courseCodeValidationMessage)}
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
              <FieldInfoLabel message={`Maximum ${MAX_WORLD_DESCRIPTION_WORDS} words.`}>
                Description
              </FieldInfoLabel>
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
              <div className="segmented-control" role="group" aria-label="Domain visibility">
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
                    aria-label="Private domain password"
                    autoComplete="new-password"
                    name="private-world-passcode"
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
                <p>Upload an image or create a custom gradient for the whole domain.</p>
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
                title="Ambient Domains"
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
                  {form.moduleCode || "COURSE"}
                  {selectedAcademicTerm ? ` · ${selectedAcademicTerm}` : ""}
                </p>
                <h3>{form.name || "Your Domain"}</h3>
              </div>
            </div>

            <div className="modal-actions guided-actions">
              <button className="text-button" onClick={() => setStep("details")} type="button">
                <ArrowLeft className="arrow-left" size={16} />
                Back
              </button>
              <button className="primary-button compact" disabled={creating || !detailsReady} type="submit">
                <Wand2 size={18} />
                {creating ? "Creating" : "Create Domain"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function normaliseCourseOption(option) {
  if (typeof option === "string") {
    const code = normaliseCourseCodeInput(option);
    return isCourseCodeFormatValid(code) ? { code, title: "" } : null;
  }

  const code = normaliseCourseCodeInput(option?.moduleCode || option?.code || "");
  if (!isCourseCodeFormatValid(code)) return null;

  return {
    code,
    title: String(option?.title || option?.name || "").trim(),
  };
}

function dedupeCourseOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option || seen.has(option.code)) return false;
    seen.add(option.code);
    return true;
  });
}

function rankCourseOption(option, query) {
  if (!query) return 0;

  const code = option.code.toUpperCase();
  const title = option.title.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  if (code.includes(query)) return 2;
  if (title.startsWith(lowerQuery)) return 3;
  if (title.includes(lowerQuery)) return 4;
  return Number.POSITIVE_INFINITY;
}

/** Searchable NUS course-code field backed by NUSMods with a local fallback. */
function CourseCodeCombobox({
  academicTerm,
  describedBy,
  invalid = false,
  onChange,
  options,
  value,
}) {
  const [open, setOpen] = useState(false);
  const [nusmodsOptions, setNusmodsOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const academicYear = getNusmodsAcademicYear(academicTerm);
  const normalisedValue = normaliseCourseCodeInput(value);
  const fallbackOptions = useMemo(
    () => dedupeCourseOptions(options.map(normaliseCourseOption)),
    [options],
  );
  const searchableOptions = nusmodsOptions.length ? nusmodsOptions : fetchFailed ? fallbackOptions : [];
  const filteredOptions = useMemo(() => {
    if (!normalisedValue) return [];

    const rankedOptions = searchableOptions
      .map((option) => ({
        option,
        score: rankCourseOption(option, normalisedValue),
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => {
        if (left.score !== right.score) return left.score - right.score;
        if (left.option.code.length !== right.option.code.length) {
          return left.option.code.length - right.option.code.length;
        }
        return left.option.code.localeCompare(right.option.code);
      })
      .map(({ option }) => option);

    return rankedOptions.slice(0, 5);
  }, [normalisedValue, searchableOptions]);

  useEffect(() => {
    if (!academicYear) return undefined;

    const cachedOptions = nusmodsCourseCache.get(academicYear);
    if (cachedOptions) {
      setNusmodsOptions(cachedOptions);
      setFetchFailed(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setFetchFailed(false);

    fetch(`${NUSMODS_API_BASE}/${academicYear}/moduleList.json`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load NUSMods courses.");
        return response.json();
      })
      .then((payload) => {
        const nextOptions = dedupeCourseOptions(
          (Array.isArray(payload) ? payload : []).map(normaliseCourseOption),
        );
        nusmodsCourseCache.set(academicYear, nextOptions);
        setNusmodsOptions(nextOptions);
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setNusmodsOptions([]);
        setFetchFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [academicYear]);

  /** Selects one suggested course code and closes the option list. */
  function chooseOption(option) {
    onChange(option.code);
    setOpen(false);
  }

  return (
    <div
      className="module-combobox"
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <div className="input-with-icon">
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          name="moduleCode"
          onChange={(event) => {
            onChange(normaliseCourseCodeInput(event.target.value));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filteredOptions[0]) {
              event.preventDefault();
              chooseOption(filteredOptions[0]);
            }
          }}
          placeholder="e.g. CS2040S"
          value={value}
        />
        <Search size={17} />
      </div>

      {open && normalisedValue ? (
        <div className="custom-option-list course-option-list" role="listbox">
          {filteredOptions.length ? filteredOptions.map((option) => (
            <button
              aria-selected={normalisedValue === option.code}
              className={normalisedValue === option.code ? "active" : ""}
              key={option.code}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
              role="option"
              type="button"
            >
              <span className="course-option-code">{option.code}</span>
              {option.title ? <span className="course-option-title">{option.title}</span> : null}
            </button>
          )) : (
            <p className="course-option-empty">
              {loading
                ? "Loading NUSMods courses..."
                : fetchFailed
                  ? "NUSMods suggestions are unavailable. You can still enter a valid code."
                  : "No matching NUS courses found."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const ModuleCodeCombobox = CourseCodeCombobox;

/** Small custom select used by the theme-library filters. */
function SelectMenu({ label, onChange, options, value }) {
  return (
    <AppSelectMenu
      ariaLabel={label}
      className="filter-select"
      label={label}
      onChange={onChange}
      options={options.map((option) => ({
        label: option,
        value: option,
      }))}
      value={value}
    />
  );
}

/** Custom dropdown for the academic term field, avoiding browser-native select colours. */
function AcademicTermSelect({ onChange, options, value }) {
  return (
    <AppSelectMenu
      ariaLabel="Academic Term"
      className="field-select-menu academic-term-select"
      onChange={onChange}
      options={options.map((term) => ({
        label: term,
        value: term,
      }))}
      value={value}
    />
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
  CourseCodeLabel,
  CreateRoomModal,
  CourseCodeCombobox,
  ExploreRoomModal,
  FieldInfoLabel,
  FieldTooltipTrigger,
  JoinWorldDialog,
  ModuleCodeCombobox,
  RoomTile,
};
