import { ChevronRight, Edit3, Pencil, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../api.ts";
import { getInitial } from "../../../shared/utils/room.ts";
import { AvatarPreview } from "./AvatarPreview.tsx";
import {
  AVATAR_SLOT_GROUPS,
  LimeetsAvatarCategory,
  LimeetsAvatarPreset,
  getAvatarSlotChoices,
  getAvatarSlotItems,
  getAvatarSlotLabel,
  getDefaultAvatarVariantId,
  normalizeLimeetsAvatarPreset,
  withAvatarSelection,
} from "./avatarPresets.ts";

const PROFILE_STATUS_KEY = "diffriendtiate_profile_status";

export const PROFILE_STATUS_OPTIONS = [
  { id: "online", label: "Online" },
  { id: "away", label: "Idle" },
  { id: "dnd", label: "Do Not Disturb" },
  { id: "invisible", label: "Invisible" },
] as const;

export type ProfileStatusId = (typeof PROFILE_STATUS_OPTIONS)[number]["id"];

function displayName(user: any, fallback = "You") {
  return user?.name || user?.displayName || user?.email || fallback;
}

function avatarUrl(user: any) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

export function normalizeProfileStatus(value: unknown): ProfileStatusId {
  const status = String(value || "").trim();
  return PROFILE_STATUS_OPTIONS.some((option) => option.id === status)
    ? (status as ProfileStatusId)
    : "invisible";
}

export function getStoredProfileStatus(): ProfileStatusId {
  const stored = localStorage.getItem(PROFILE_STATUS_KEY) || "online";
  return normalizeProfileStatus(stored);
}

type UserProfileControlsProps = {
  active?: boolean;
  onProfileStatusChange?: (status: ProfileStatusId) => void;
  statusText: string;
  profileStatus?: ProfileStatusId;
  user: any;
  onProfileUpdated?: (user: any) => void;
};

export function UserProfileControls({
  active = false,
  onProfileStatusChange,
  onProfileUpdated,
  profileStatus: controlledProfileStatus,
  statusText,
  user,
}: UserProfileControlsProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [internalProfileStatus, setInternalProfileStatus] = useState(getStoredProfileStatus);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const name = displayName(user);
  const photo = avatarUrl(user);
  const profileStatus = normalizeProfileStatus(controlledProfileStatus || internalProfileStatus);
  const statusOption =
    PROFILE_STATUS_OPTIONS.find((option) => option.id === profileStatus) || PROFILE_STATUS_OPTIONS[0];
  const statusClass = profileStatus;

  function updateProfileStatus(nextStatus: unknown) {
    const normalizedStatus = normalizeProfileStatus(nextStatus);
    setInternalProfileStatus(normalizedStatus);
    onProfileStatusChange?.(normalizedStatus);
  }

  useEffect(() => {
    localStorage.setItem(PROFILE_STATUS_KEY, profileStatus);
  }, [profileStatus]);

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setStatusOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [menuOpen]);

  return (
    <div className="room-profile-control">
      <button
        aria-expanded={menuOpen}
        className="room-call-user room-call-user-button"
        onClick={() => setMenuOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="room-call-avatar" aria-hidden="true">
          {photo ? <img src={photo} alt="" /> : getInitial(name)}
          <i className={statusClass} />
        </span>
        <span className="room-call-copy">
          <strong title={name}>{name}</strong>
          <span>{statusText}</span>
        </span>
      </button>

      {menuOpen ? (
        <div className="room-profile-popover" ref={menuRef}>
          <div className="room-profile-popover-banner" aria-hidden="true" />
          <div className="room-profile-popover-identity">
            <span className="room-profile-popover-avatar" aria-hidden="true">
              {photo ? <img src={photo} alt="" /> : getInitial(name)}
              <i className={statusClass} />
            </span>
            <div className="room-profile-popover-nameplate">
              <strong>{name}</strong>
              <span>{user?.email || "Diffriendtiate member"}</span>
            </div>
          </div>
          <div className="room-profile-popover-actions">
            <button
              onClick={() => {
                setMenuOpen(false);
                setStatusOpen(false);
                setEditorOpen(true);
              }}
              type="button"
            >
              <Edit3 size={16} />
              Edit Profile
            </button>
            <button
              aria-expanded={statusOpen}
              aria-label={`Set status. Current status: ${statusOption.label}`}
              onClick={() => setStatusOpen((current) => !current)}
              type="button"
            >
              <i className={`room-profile-status-dot ${statusOption.id}`} aria-hidden="true" />
              <span className={`room-profile-status-chip ${statusOption.id}`}>{statusOption.label}</span>
              <ChevronRight className="room-profile-action-chevron" size={16} />
            </button>
            {statusOpen ? (
              <div className="room-profile-status-menu">
                {PROFILE_STATUS_OPTIONS.map((option) => (
                  <button
                    className={`${profileStatus === option.id ? "selected" : ""} ${option.id}`.trim()}
                    key={option.id}
                    onClick={() => {
                      updateProfileStatus(option.id);
                      setStatusOpen(false);
                    }}
                    type="button"
                  >
                    <i className={option.id} />
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <EditProfileDialog
          onClose={() => setEditorOpen(false)}
          onProfileUpdated={onProfileUpdated}
          user={user}
        />
      ) : null}
    </div>
  );
}

type EditProfileDialogProps = {
  onClose: () => void;
  onProfileUpdated?: (user: any) => void;
  user: any;
};

function EditProfileDialog({ onClose, onProfileUpdated, user }: EditProfileDialogProps) {
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [draftAvatar, setDraftAvatar] = useState<LimeetsAvatarPreset>(() =>
    normalizeLimeetsAvatarPreset(user?.avatarPreset),
  );
  const [draftName, setDraftName] = useState(displayName(user, ""));
  const [draftPhoto, setDraftPhoto] = useState(avatarUrl(user));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your profile picture.");
      return;
    }

    if (file.size > 1_500_000) {
      setError("Profile pictures must be smaller than 1.5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDraftPhoto(String(reader.result || ""));
      setError("");
    };
    reader.onerror = () => setError("Unable to read that image.");
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
      setError("Display name is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = await api.updateProfile({
        avatarPreset: normalizeLimeetsAvatarPreset(draftAvatar),
        avatarUrl: draftPhoto,
        name: trimmedName,
      });
      onProfileUpdated?.(payload.user);
      onClose();
    } catch (err: any) {
      setError(err.message || "Unable to save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop room-profile-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="room-profile-editor" role="dialog" aria-modal="true" aria-label="Edit Profile">
        <header>
          <h2>Edit Profile</h2>
          <button aria-label="Close profile editor" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>

        <div className="room-profile-editor-body">
          <div className="room-profile-editor-media">
            <div>
              <span>Profile picture</span>
              <button
                className="room-profile-image-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {draftPhoto ? <img src={draftPhoto} alt="" /> : getInitial(draftName || user?.email)}
                <i aria-hidden="true">
                  <Pencil size={15} />
                </i>
              </button>
              <input
                accept="image/*"
                hidden
                onChange={handlePhotoUpload}
                ref={fileInputRef}
                type="file"
              />
            </div>

            <div>
              <span>Avatar</span>
              <button
                className="room-profile-avatar-button"
                onClick={() => setAvatarPickerOpen(true)}
                type="button"
              >
                <AvatarPreview avatar={draftAvatar} size="profile" />
                <i aria-hidden="true">
                  <Pencil size={15} />
                </i>
              </button>
            </div>
          </div>

          <label className="field room-profile-name-field">
            <span>Display name</span>
            <input
              maxLength={80}
              onChange={(event) => setDraftName(event.target.value)}
              value={draftName}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}
        </div>

        <footer>
          <button className="secondary-button compact" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button compact" disabled={saving} onClick={saveProfile} type="button">
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>

        {avatarPickerOpen ? (
          <AvatarPickerDialog
            initialAvatar={draftAvatar}
            onBack={() => setAvatarPickerOpen(false)}
            onDone={(nextAvatar) => {
              setDraftAvatar(nextAvatar);
              setAvatarPickerOpen(false);
            }}
            userName={draftName || displayName(user)}
          />
        ) : null}
      </section>
    </div>
  );
}

type AvatarPickerDialogProps = {
  initialAvatar: LimeetsAvatarPreset;
  onBack: () => void;
  onDone: (avatar: LimeetsAvatarPreset) => void;
  userName: string;
};

function AvatarPickerDialog({ initialAvatar, onBack, onDone, userName }: AvatarPickerDialogProps) {
  const normalizedInitial = useMemo(() => normalizeLimeetsAvatarPreset(initialAvatar), [initialAvatar]);
  const [activeCategory, setActiveCategory] = useState<LimeetsAvatarCategory>("base");
  const [activeSlotId, setActiveSlotId] = useState(AVATAR_SLOT_GROUPS[0].slots[0]);
  const [selectedAvatar, setSelectedAvatar] = useState<LimeetsAvatarPreset>(normalizedInitial);
  const activeGroup = AVATAR_SLOT_GROUPS.find((group) => group.id === activeCategory) || AVATAR_SLOT_GROUPS[0];
  const activeSelection = selectedAvatar.selections[activeSlotId] || null;
  const slotItems = useMemo(() => getAvatarSlotItems(activeSlotId), [activeSlotId]);
  const choices = useMemo(
    () => (activeSelection ? getAvatarSlotChoices(activeSlotId, activeSelection.itemId) : []),
    [activeSelection, activeSlotId],
  );
  const optionalSlot = !["skin", "hair", "top", "bottom", "shoes"].includes(activeSlotId);

  function chooseCategory(category: LimeetsAvatarCategory) {
    const group = AVATAR_SLOT_GROUPS.find((candidate) => candidate.id === category) || AVATAR_SLOT_GROUPS[0];
    setActiveCategory(category);
    setActiveSlotId(group.slots[0]);
  }

  function chooseItem(itemId: string) {
    setSelectedAvatar((current) =>
      withAvatarSelection(current, activeSlotId, {
        itemId,
        variantId: getDefaultAvatarVariantId(activeSlotId, itemId),
      }),
    );
  }

  function chooseVariant(variantId: string) {
    if (!activeSelection) return;
    setSelectedAvatar((current) =>
      withAvatarSelection(current, activeSlotId, {
        itemId: activeSelection.itemId,
        variantId,
      }),
    );
  }

  return (
    <div className="room-avatar-picker" role="dialog" aria-modal="true" aria-label="Choose Avatar">
      <header>
        <span>{userName}</span>
        <button aria-label="Close avatar picker" onClick={onBack} type="button">
          <X size={20} />
        </button>
      </header>

      <div className="room-avatar-picker-hero">
        <AvatarPreview avatar={selectedAvatar} size="large" />
      </div>

      <nav className="room-avatar-picker-tabs" aria-label="Avatar categories">
        {AVATAR_SLOT_GROUPS.map((category) => (
          <button
            className={activeCategory === category.id ? "active" : ""}
            key={category.id}
            onClick={() => chooseCategory(category.id)}
            type="button"
          >
            {category.label}
          </button>
        ))}
      </nav>

      <div className="room-avatar-picker-body">
        <nav className="room-avatar-picker-slots" aria-label={`${activeGroup.label} avatar slots`}>
          {activeGroup.slots.map((slotId) => (
            <button
              className={activeSlotId === slotId ? "active" : ""}
              key={slotId}
              onClick={() => setActiveSlotId(slotId)}
              type="button"
            >
              {getAvatarSlotLabel(slotId)}
            </button>
          ))}
        </nav>

        {choices.length ? (
          <div className="room-avatar-picker-colours" aria-label={`${getAvatarSlotLabel(activeSlotId)} colours`}>
            {choices.map((choice) => (
              <button
                aria-label={choice.label}
                aria-pressed={activeSelection?.variantId === choice.id}
                className={activeSelection?.variantId === choice.id ? "selected" : ""}
                key={choice.id}
                onClick={() => chooseVariant(choice.id)}
                style={{ "--avatar-choice-colour": choice.swatch } as any}
                title={choice.label}
                type="button"
              />
            ))}
          </div>
        ) : null}

        <div className="room-avatar-picker-grid">
          {optionalSlot ? (
            <button
              aria-pressed={!activeSelection}
              className={`room-avatar-none-card ${!activeSelection ? "selected" : ""}`}
              onClick={() => setSelectedAvatar((current) => withAvatarSelection(current, activeSlotId, null))}
              type="button"
            >
              <span aria-hidden="true">None</span>
              <strong>None</strong>
            </button>
          ) : null}
          {slotItems.map((item) => (
            <button
              aria-pressed={activeSelection?.itemId === item.id}
              className={activeSelection?.itemId === item.id ? "selected" : ""}
              key={item.id}
              onClick={() => chooseItem(item.id)}
              type="button"
            >
              {item.previewSrc ? <img alt="" src={item.previewSrc} /> : <span aria-hidden="true" />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <footer>
        <button className="secondary-button compact" onClick={onBack} type="button">
          Back
        </button>
        <button className="primary-button compact" onClick={() => onDone(selectedAvatar)} type="button">
          Done
        </button>
      </footer>
    </div>
  );
}
