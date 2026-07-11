import {
  CircleX,
  Eye,
  EyeOff,
  LogOut,
  Pencil,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api.ts";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.tsx";
import SmallSettingsDialog from "../../shared/ui/SmallSettingsDialog.tsx";
import { getInitial } from "../../shared/utils/room.ts";
import {
  getActiveSupabaseSession,
  updateSupabasePassword,
} from "../../supabaseAuth.ts";
import {
  EditProfileDialog,
  getProfileAvatarUrl,
  getProfileDisplayName,
} from "../room/profile/UserProfileControls.tsx";

function maskEmail(email = "") {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return email;
  return `${"*".repeat(Math.max(8, Math.min(12, name.length + 4)))}@${domain}`;
}

function AccountSettingsScreen({ onClose, onLogout, onUserUpdated, user }) {
  const [accountForm, setAccountForm] = useState({
    email: user?.email || "",
    name: getProfileDisplayName(user, ""),
  });
  const [passwordForm, setPasswordForm] = useState({
    confirmPassword: "",
    currentPassword: "",
    newPassword: "",
  });
  const [accountError, setAccountError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [visiblePasswordFields, setVisiblePasswordFields] = useState({
    confirmPassword: false,
    currentPassword: false,
    newPassword: false,
  });
  const [emailRevealed, setEmailRevealed] = useState(false);
  const [accountEditing, setAccountEditing] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const profileName = getProfileDisplayName(user, "Account");
  const profilePhoto = getProfileAvatarUrl(user);
  const hasPassword = Boolean(user?.hasPassword);
  const usesSupabaseAccount = Array.isArray(user?.authProviders) && user.authProviders.includes("supabase");
  const displayedEmail = emailRevealed ? user?.email : maskEmail(user?.email);

  useEffect(() => {
    setAccountForm({
      email: user?.email || "",
      name: getProfileDisplayName(user, ""),
    });
  }, [user]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  function updateAccountField(event) {
    const { name, value } = event.target;
    setAccountForm((current) => ({ ...current, [name]: value }));
  }

  function updatePasswordField(event) {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  }

  function togglePasswordVisibility(name) {
    setVisiblePasswordFields((current) => ({ ...current, [name]: !current[name] }));
  }

  function closeAccountEditor() {
    setAccountEditing(false);
    setAccountError("");
  }

  function closePasswordEditor() {
    setPasswordEditing(false);
    setPasswordError("");
  }

  function renderPasswordInput({ autoComplete, label, name, required = true }) {
    const visible = Boolean(visiblePasswordFields[name]);
    const inputId = `account-${name}`;

    return (
      <div className="field account-password-field">
        <label htmlFor={inputId}>
          {label}
          {required ? <em aria-hidden="true">*</em> : null}
        </label>
        <span className="account-password-input">
          <input
            autoComplete={autoComplete}
            id={inputId}
            name={name}
            onChange={updatePasswordField}
            type={visible ? "text" : "password"}
            value={passwordForm[name]}
          />
          <button
            aria-label={visible ? "Hide password" : "Show password"}
            onClick={() => togglePasswordVisibility(name)}
            title={visible ? `Hide ${label}` : `Show ${label}`}
            type="button"
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </div>
    );
  }

  async function saveAccount(event) {
    event.preventDefault();
    setSavingAccount(true);
    setAccountError("");

    try {
      const payload = await api.updateAccount({
        name: accountForm.name,
      });
      onUserUpdated?.(payload.user);
      setAccountEditing(false);
    } catch (error: any) {
      setAccountError(error.message || "Unable to update account information.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError("");

    if (passwordForm.newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      setSavingPassword(false);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Passwords do not match.");
      setSavingPassword(false);
      return;
    }

    try {
      if (usesSupabaseAccount) {
        const session = await getActiveSupabaseSession();
        if (!session?.access_token) {
          throw new Error("Please sign in again before updating your password.");
        }

        const { error: supabasePasswordError } = await updateSupabasePassword(passwordForm.newPassword);
        if (supabasePasswordError) throw supabasePasswordError;
      }

      const payload = await api.updatePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      onUserUpdated?.(payload.user);
      setPasswordForm({
        confirmPassword: "",
        currentPassword: "",
        newPassword: "",
      });
      setPasswordEditing(false);
    } catch (error: any) {
      setPasswordError(error.message || "Unable to update password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    try {
      await api.deleteAccount();
      onLogout();
    } catch (error: any) {
      setAccountError(error.message || "Unable to delete account.");
      setDeleteConfirmOpen(false);
      setDeletingAccount(false);
    }
  }

  return (
    <div
      className="room-settings-screen account-settings-screen"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="account-settings-title"
        aria-modal="true"
        className="account-settings-dialog"
        role="dialog"
      >
        <aside className="room-settings-sidebar account-settings-sidebar" aria-label="Account settings sections">
          <button
            aria-label="Edit Profile"
            className="account-settings-user-card account-settings-user-button"
            onClick={() => setProfileEditorOpen(true)}
            type="button"
          >
            <span className="account-settings-avatar" aria-hidden="true">
              {profilePhoto ? <img alt="" src={profilePhoto} /> : getInitial(profileName)}
            </span>
            <div>
              <strong>{profileName}</strong>
              <span>Edit Profile</span>
            </div>
            <Pencil size={13} aria-hidden="true" />
          </button>

          <nav className="account-settings-nav">
            <button className="active" type="button">
              <UserRound size={17} />
              Account
            </button>
            <button className="account-settings-logout" onClick={onLogout} type="button">
              <LogOut size={16} />
              Log Out
            </button>
          </nav>
        </aside>

        <main className="room-settings-main account-settings-main">
        <button
          aria-label="Close Account Settings"
          className="room-settings-close"
          onClick={onClose}
          type="button"
        >
          <X size={24} />
          <span>ESC</span>
        </button>

        <div className="account-settings-content">
          <header className="room-settings-header account-settings-header">
            <h1 id="account-settings-title">Account</h1>
          </header>

          <section className="account-settings-section" aria-labelledby="account-info-title">
            <div className="settings-section-heading">
              <h2 id="account-info-title">Account Information</h2>
            </div>

            <div className="account-settings-list">
              <div className="account-settings-row">
                <span>Username</span>
                <strong>{profileName}</strong>
                <button
                  className="secondary-button compact"
                  onClick={() => setAccountEditing(true)}
                  type="button"
                >
                  Edit
                </button>
              </div>

              <div className="account-settings-row">
                <span>Email</span>
                <strong>
                  {displayedEmail}
                  <button
                    className="account-settings-inline-link"
                    onClick={() => setEmailRevealed((current) => !current)}
                    type="button"
                  >
                    {emailRevealed ? "Hide" : "Reveal"}
                  </button>
                </strong>
                <button
                  className="secondary-button compact"
                  disabled
                  type="button"
                >
                  Edit
                </button>
              </div>
            </div>

            {accountError ? <p className="form-error">{accountError}</p> : null}
          </section>

          <section className="account-settings-section" aria-labelledby="account-password-title">
            <div className="settings-section-heading">
              <h2 id="account-password-title">Password & Security</h2>
            </div>

            <div className="account-settings-list">
              <div className="account-settings-row account-settings-password-row">
                <span>Password</span>
                <button
                  className="secondary-button compact"
                  onClick={() => setPasswordEditing(true)}
                  type="button"
                >
                  Edit
                </button>
              </div>
            </div>

            {passwordError ? <p className="form-error">{passwordError}</p> : null}
          </section>

          <section className="account-settings-section account-danger-section" aria-labelledby="account-danger-title">
            <div className="account-delete-panel">
              <div>
                <h2 id="account-danger-title">Delete Your Account</h2>
                <p>Permanently close your account.</p>
              </div>
              <button
                className="danger-button compact"
                disabled={deletingAccount}
                onClick={() => setDeleteConfirmOpen(true)}
                type="button"
              >
                Delete
              </button>
            </div>
          </section>
        </div>

        {accountEditing ? createPortal(
          <SmallSettingsDialog
            ariaLabel="Edit Username"
            footer={
              <button className="primary-button compact" disabled={savingAccount} type="submit">
                {savingAccount ? "Saving" : "Save Changes"}
              </button>
            }
            onClose={closeAccountEditor}
            onSubmit={saveAccount}
            title="Edit Username"
          >
              {accountError ? (
                <div className="form-error account-settings-error" role="alert">
                  <CircleX size={18} aria-hidden="true" />
                  <p>{accountError}</p>
                </div>
              ) : null}
              <label className="field">
                <span>Username</span>
                <input
                  maxLength={80}
                  name="name"
                  onChange={updateAccountField}
                  value={accountForm.name}
                />
              </label>
          </SmallSettingsDialog>,
          document.body,
        ) : null}

        {passwordEditing ? createPortal(
          <SmallSettingsDialog
            ariaLabel="Update Password"
            footer={
              <button className="primary-button compact" disabled={savingPassword} type="submit">
                {savingPassword ? "Saving" : "Done"}
              </button>
            }
            onClose={closePasswordEditor}
            onSubmit={savePassword}
            title="Update Your Password"
          >
              {passwordError ? (
                <div className="form-error account-settings-error" role="alert">
                  <CircleX size={18} aria-hidden="true" />
                  <p>{passwordError}</p>
                </div>
              ) : null}

              <div className="create-room-form account-settings-password-form">
                {hasPassword ? (
                  renderPasswordInput({
                    autoComplete: "current-password",
                    label: "Current Password",
                    name: "currentPassword",
                  })
                ) : null}

                {renderPasswordInput({
                  autoComplete: "new-password",
                  label: hasPassword ? "New Password" : "Password",
                  name: "newPassword",
                })}
                {renderPasswordInput({
                  autoComplete: "new-password",
                  label: "Confirm New Password",
                  name: "confirmPassword",
                })}
              </div>
          </SmallSettingsDialog>,
          document.body,
        ) : null}

        {deleteConfirmOpen ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message="Delete your account? Domains you own will transfer to another member when possible. Owner-only domains will be closed. This cannot be undone."
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={deleteAccount}
            submittingLabel="Deleting"
            title="Delete Account"
          />
        ) : null}

        {profileEditorOpen ? createPortal(
          <EditProfileDialog
            onClose={() => setProfileEditorOpen(false)}
            onProfileUpdated={onUserUpdated}
            user={user}
          />,
          document.body,
        ) : null}
        </main>
      </section>
    </div>
  );
}

export default AccountSettingsScreen;
