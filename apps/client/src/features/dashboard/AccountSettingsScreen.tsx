import {
  CheckCircle2,
  CircleMinus,
  CircleX,
  Eye,
  EyeOff,
  KeyRound,
  ListPlus,
  LogOut,
  Pencil,
  PlugZap,
  Plus,
  Search,
  Trash2,
  Unplug,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api.ts";
import { AppSelectMenu } from "../../shared/ui/AppSelectMenu.tsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.tsx";
import { formatModelLabel, ProviderIcon } from "../../shared/ui/LlmProviderIcon.tsx";
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

const emptyLlmKeyPayload = {
  encryptionAvailable: true,
  providerCatalogAvailable: true,
  providerCatalogError: "",
  providerCatalogStale: false,
  providers: [],
  keys: [],
};

const commonLlmProviderGroups = [
  { ids: ["openai"], terms: ["chatgpt"] },
  { ids: ["anthropic"], terms: ["claude"] },
  { ids: ["gemini"], terms: ["google"] },
  { ids: ["openrouter"], terms: [] },
  { ids: ["groq"], terms: [] },
  { ids: ["mistral"], terms: [] },
  { ids: ["cohere"], terms: [] },
  { ids: ["together_ai", "together"], terms: ["together"] },
  { ids: ["perplexity"], terms: [] },
  { ids: ["xai"], terms: ["grok"] },
];
// Picks a stable default provider for the Add Key dialog once the catalog loads.
function getFirstLlmProvider(payload) {
  for (const group of commonLlmProviderGroups) {
    const provider = findCommonProvider(payload.providers || [], group);
    if (provider) return provider;
  }
  return payload.providers?.[0] || null;
}

function getProviderSearchText(provider) {
  return [provider?.id, provider?.providerName, provider?.defaultLabel]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function providerMatchesAny(provider, terms) {
  const searchText = getProviderSearchText(provider);
  return terms.some((term) => searchText.includes(String(term || "").toLowerCase()));
}

function findCommonProvider(providers, group) {
  const exactProvider = providers.find((provider) => group.ids.includes(String(provider.id || "").toLowerCase()));
  if (exactProvider) return exactProvider;
  return group.terms.length
    ? providers.find((provider) => providerMatchesAny(provider, group.terms))
    : null;
}

function AccountSettingsScreen({ onClose, onLogout, onUserUpdated, user }) {
  const [activeSection, setActiveSection] = useState("account");
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
  const [llmKeyPayload, setLlmKeyPayload] = useState(emptyLlmKeyPayload);
  const [llmKeyDialogOpen, setLlmKeyDialogOpen] = useState(false);
  const [llmKeyDeleteTarget, setLlmKeyDeleteTarget] = useState(null);
  const [llmKeyError, setLlmKeyError] = useState("");
  const [llmKeyLoading, setLlmKeyLoading] = useState(false);
  const [llmKeySaving, setLlmKeySaving] = useState(false);
  const [llmKeyVisible, setLlmKeyVisible] = useState(false);
  const [llmProviderBrowserOpen, setLlmProviderBrowserOpen] = useState(false);
  const [llmProviderBrowserSearch, setLlmProviderBrowserSearch] = useState("");
  const [llmDisconnectedProviders, setLlmDisconnectedProviders] = useState(() => new Set());
  const [pinnedLlmProviderIds, setPinnedLlmProviderIds] = useState(() => new Set());
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState("");
  const [llmKeyForm, setLlmKeyForm] = useState({
    apiKey: "",
    id: "",
    label: "",
    model: "",
    providerId: "",
    reuseKeyId: "",
  });
  const profileName = getProfileDisplayName(user, "Account");
  const profilePhoto = getProfileAvatarUrl(user);
  const hasPassword = Boolean(user?.hasPassword);
  const usesSupabaseAccount = Array.isArray(user?.authProviders) && user.authProviders.includes("supabase");
  const displayedEmail = emailRevealed ? user?.email : maskEmail(user?.email);
  const selectedLlmProvider =
    llmKeyPayload.providers.find((provider) => provider.id === selectedLlmProviderId) ||
    getFirstLlmProvider(llmKeyPayload);
  const commonLlmProviders = useMemo(() => {
    const byId = new Map();
    for (const group of commonLlmProviderGroups) {
      const match = findCommonProvider(llmKeyPayload.providers, group);
      if (match) byId.set(match.id, match);
    }
    for (const key of llmKeyPayload.keys) {
      const provider = llmKeyPayload.providers.find((candidate) => candidate.id === key.providerId);
      if (provider) byId.set(provider.id, provider);
    }
    for (const providerId of pinnedLlmProviderIds) {
      const provider = llmKeyPayload.providers.find((candidate) => candidate.id === providerId);
      if (provider) byId.set(provider.id, provider);
    }
    if (selectedLlmProvider) byId.set(selectedLlmProvider.id, selectedLlmProvider);
    const providers = [...byId.values()];
    return providers.length ? providers.slice(0, 11) : llmKeyPayload.providers.slice(0, 10);
  }, [llmKeyPayload.keys, llmKeyPayload.providers, pinnedLlmProviderIds, selectedLlmProviderId]);
  const filteredLlmProviderBrowserProviders = useMemo(() => {
    const search = llmProviderBrowserSearch.trim().toLowerCase();
    return llmKeyPayload.providers.filter((provider) => {
      if (!search) return true;
      return getProviderSearchText(provider).includes(search);
    });
  }, [llmKeyPayload.providers, llmProviderBrowserSearch]);
  const selectedLlmKeys = selectedLlmProvider
    ? llmKeyPayload.keys.filter((key) => key.providerId === selectedLlmProvider.id)
    : [];
  const selectedLlmStatus = selectedLlmKeys.length
    ? "connected"
    : selectedLlmProvider && llmDisconnectedProviders.has(selectedLlmProvider.id)
      ? "disconnected"
      : "not-connected";
  const selectedLlmStatusLabel =
    selectedLlmStatus === "connected"
      ? "Connected"
      : selectedLlmStatus === "disconnected"
        ? "Disconnected"
        : "Not Connected";
  const formLlmProvider =
    llmKeyPayload.providers.find((provider) => provider.id === llmKeyForm.providerId) ||
    selectedLlmProvider;
  const editingLlmKey = llmKeyForm.id
    ? llmKeyPayload.keys.find((key) => key.id === llmKeyForm.id)
    : null;
  const formLlmModelOptions = (formLlmProvider?.models || []).map((model) => ({
    label: formatModelLabel(model),
    value: model,
  }));

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

  useEffect(() => {
    if (activeSection !== "llmKeys") return undefined;

    // LLM key metadata is fetched lazily so Account Settings stays cheap until the BYOK tab is opened.
    let cancelled = false;
    setLlmKeyLoading(true);
    setLlmKeyError("");

    api.getLlmApiKeys()
      .then((payload) => {
        if (cancelled) return;
        const nextPayload = {
          ...emptyLlmKeyPayload,
          ...payload,
          providers: Array.isArray(payload.providers) ? payload.providers : [],
          keys: Array.isArray(payload.keys) ? payload.keys : [],
        };
        setLlmKeyPayload(nextPayload);

        const firstProvider = getFirstLlmProvider(nextPayload);
        if (firstProvider && !selectedLlmProviderId) {
          setSelectedLlmProviderId(firstProvider.id);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLlmKeyError(error.message || "Unable to load LLM API keys.");
        }
      })
      .finally(() => {
        if (!cancelled) setLlmKeyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection]);

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

  function getLlmKeysForProvider(providerId) {
    return llmKeyPayload.keys.filter((key) => key.providerId === providerId);
  }

  function getLlmKeyStripTitle(key, provider) {
    const providerName = String(provider?.providerName || "").trim();
    const label = String(key?.label || "").trim();
    const modelLabel = formatModelLabel(key?.model);

    if (label && label.toLowerCase() !== providerName.toLowerCase()) return label;
    return modelLabel || label || providerName || "LLM model";
  }

  // Opens the shared small-dialog shell with provider-specific defaults and redacted saved state.
  function openLlmKeyDialog(providerId = selectedLlmProvider?.id, keyId = "") {
    const provider =
      llmKeyPayload.providers.find((candidate) => candidate.id === providerId) ||
      selectedLlmProvider ||
      getFirstLlmProvider(llmKeyPayload);
    const providerKeys = provider ? getLlmKeysForProvider(provider.id) : [];
    const savedKey = keyId ? providerKeys.find((key) => key.id === keyId) : null;
    if (!provider) return;

    setLlmKeyError("");
    setLlmKeyVisible(false);
    setLlmKeyForm({
      apiKey: "",
      id: savedKey?.id || "",
      label: savedKey?.label || "",
      model: savedKey?.model || provider.defaultModel || provider.models?.[0] || "",
      providerId: provider.id,
      reuseKeyId: "",
    });
    setLlmKeyDialogOpen(true);
  }

  // Clears secret form state whenever the dialog closes so keys never linger in the UI.
  function closeLlmKeyDialog() {
    setLlmKeyDialogOpen(false);
    setLlmKeyError("");
    setLlmKeyVisible(false);
  }

  function updateLlmKeyField(event) {
    const { name, value } = event.target;
    setLlmKeyForm((current) => ({ ...current, [name]: value }));
  }

  function selectLlmModel(model) {
    setLlmKeyForm((current) => ({ ...current, model }));
  }

  function selectProviderFromBrowser(providerId) {
    setPinnedLlmProviderIds((current) => {
      const next = new Set(current);
      next.add(providerId);
      return next;
    });
    setSelectedLlmProviderId(providerId);
    setLlmProviderBrowserOpen(false);
    setLlmProviderBrowserSearch("");
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
            className="account-password-toggle"
            data-tooltip={visible ? `Hide ${label}` : `Show ${label}`}
            onClick={() => togglePasswordVisibility(name)}
            type="button"
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </div>
    );
  }

  // The API-key field reuses the password visibility shell so tooltip and layout behavior stay shared.
  function renderLlmApiKeyInput({ required = true } = {}) {
    return (
      <div className="field account-password-field">
        <label htmlFor="llm-api-key">
          API Key
          {required ? <em aria-hidden="true">*</em> : null}
        </label>
        <span className="account-password-input">
          <input
            autoComplete="off"
            id="llm-api-key"
            name="apiKey"
            onChange={updateLlmKeyField}
            placeholder={required ? "" : "Leave blank to keep the saved key"}
            type={llmKeyVisible ? "text" : "password"}
            value={llmKeyForm.apiKey}
          />
          <button
            aria-label={llmKeyVisible ? "Hide API Key" : "Show API Key"}
            className="account-password-toggle"
            data-tooltip={llmKeyVisible ? "Hide API Key" : "Show API Key"}
            onClick={() => setLlmKeyVisible((current) => !current)}
            type="button"
          >
            {llmKeyVisible ? <EyeOff size={18} /> : <Eye size={18} />}
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

  // Persists only through the server endpoint; the returned payload is redacted metadata.
  async function saveLlmKey(event) {
    event.preventDefault();
    setLlmKeySaving(true);
    setLlmKeyError("");

    if (
      !llmKeyForm.providerId ||
      !llmKeyForm.model.trim() ||
      (!llmKeyForm.id && !llmKeyForm.apiKey.trim())
    ) {
      setLlmKeyError("Choose a provider, model, and API key.");
      setLlmKeySaving(false);
      return;
    }

    try {
      const payload = await api.saveLlmApiKey({
        id: llmKeyForm.id,
        providerId: llmKeyForm.providerId,
        label: llmKeyForm.label,
        model: llmKeyForm.model,
        apiKey: llmKeyForm.apiKey,
        reuseKeyId: llmKeyForm.reuseKeyId,
      });
      setLlmKeyPayload((current) => ({
        ...current,
        keys: Array.isArray(payload.keys) ? payload.keys : current.keys,
      }));
      setLlmDisconnectedProviders((current) => {
        const next = new Set(current);
        next.delete(llmKeyForm.providerId);
        return next;
      });
      setLlmKeyDialogOpen(false);
      setLlmKeyForm({ apiKey: "", id: "", label: "", model: "", providerId: "", reuseKeyId: "" });
    } catch (error: any) {
      setLlmKeyError(error.message || "Unable to save this LLM API key.");
    } finally {
      setLlmKeySaving(false);
    }
  }

  // Delete uses the shared confirm dialog and refreshes the redacted key list after success.
  async function deleteLlmKey() {
    if (!llmKeyDeleteTarget?.id) return;

    try {
      const payload = await api.deleteLlmApiKey(llmKeyDeleteTarget.id);
      setLlmKeyPayload((current) => ({
        ...current,
        keys: Array.isArray(payload.keys) ? payload.keys : current.keys,
      }));
      setLlmDisconnectedProviders((current) => {
        const next = new Set(current);
        const nextKeys = Array.isArray(payload.keys) ? payload.keys : [];
        if (nextKeys.some((key) => key.providerId === llmKeyDeleteTarget.providerId)) {
          next.delete(llmKeyDeleteTarget.providerId);
        } else {
          next.add(llmKeyDeleteTarget.providerId);
        }
        return next;
      });
      setLlmKeyDeleteTarget(null);
      setLlmKeyDialogOpen(false);
    } catch (error: any) {
      setLlmKeyError(error.message || "Unable to delete this LLM API key.");
      setLlmKeyDeleteTarget(null);
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
            <button
              className={activeSection === "account" ? "active" : ""}
              onClick={() => setActiveSection("account")}
              type="button"
            >
              <UserRound size={17} />
              Account
            </button>
            <button
              className={activeSection === "llmKeys" ? "active" : ""}
              onClick={() => setActiveSection("llmKeys")}
              type="button"
            >
              <KeyRound size={17} />
              LLM API Keys
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
            <h1 id="account-settings-title">
              {activeSection === "llmKeys" ? "LLM API Keys" : "Account"}
            </h1>
          </header>

          {activeSection === "account" ? (
            <>
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
            </>
          ) : (
            <section className="account-settings-section llm-provider-settings-section" aria-labelledby="llm-keys-title">
              <div className="settings-section-heading">
                <h2 id="llm-keys-title">Add LLM providers tied to your account</h2>
                <p>API keys added to Diffriendtiate are encrypted at rest and are only used to route your Intelligrate requests.</p>
              </div>

              {llmKeyError ? (
                <div className="form-error account-settings-error" role="alert">
                  <CircleX size={18} aria-hidden="true" />
                  <p>{llmKeyError}</p>
                </div>
              ) : null}

              {!llmKeyPayload.encryptionAvailable ? (
                <p className="account-settings-muted">
                  LLM API key encryption is not configured on this server.
                </p>
              ) : null}

              {!llmKeyPayload.providerCatalogAvailable ? (
                <p className="account-settings-muted">
                  {llmKeyPayload.providerCatalogError || "LiteLLM providers are unavailable right now."}
                </p>
              ) : null}

              <div className="llm-provider-grid-row">
                <div className="llm-provider-grid" aria-label="Common LLM providers">
                  {llmKeyLoading ? (
                    <span className="account-settings-muted">Loading providers</span>
                  ) : commonLlmProviders.length ? (
                    commonLlmProviders.map((provider) => {
                      const savedKeyCount = getLlmKeysForProvider(provider.id).length;
                      const active = selectedLlmProvider?.id === provider.id;
                      return (
                        <button
                          aria-label={`Select ${provider.providerName}`}
                          aria-pressed={active}
                          className={active ? "active" : ""}
                          data-tooltip={provider.providerName}
                          key={provider.id}
                          onClick={() => setSelectedLlmProviderId(provider.id)}
                          type="button"
                        >
                          <ProviderIcon provider={provider} />
                          {savedKeyCount ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
                        </button>
                      );
                    })
                  ) : (
                    <span className="account-settings-muted">No providers available.</span>
                  )}
                </div>
                <button
                  className="llm-provider-more-button"
                  disabled={llmKeyLoading || !llmKeyPayload.providers.length}
                  onClick={() => setLlmProviderBrowserOpen(true)}
                  type="button"
                >
                  <ListPlus size={18} aria-hidden="true" />
                  View More
                </button>
              </div>

              <div className="llm-provider-strip-area">
                {selectedLlmProvider ? (
                  <>
                    {selectedLlmKeys.length ? (
                      selectedLlmKeys.map((key) => {
                        const stripTitle = getLlmKeyStripTitle(key, selectedLlmProvider);
                        const stripModel = formatModelLabel(key.model);
                        const showModelSubtitle =
                          stripModel && stripModel.toLowerCase() !== stripTitle.toLowerCase();

                        return (
                          <button
                            aria-label={`Edit ${key.label || key.model}`}
                            className="llm-provider-strip connected"
                            key={key.id}
                            disabled={!llmKeyPayload.encryptionAvailable || llmKeyLoading}
                            onClick={() => openLlmKeyDialog(selectedLlmProvider.id, key.id)}
                            type="button"
                          >
                            <ProviderIcon provider={selectedLlmProvider} />
                            <span className="llm-provider-strip-copy">
                              <strong>{stripTitle}</strong>
                              {showModelSubtitle ? <span>{stripModel}</span> : null}
                            </span>
                            <span className="llm-provider-status connected">
                              <CheckCircle2 size={15} />
                              Connected
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <button
                        className={`llm-provider-strip ${selectedLlmStatus}`}
                        disabled={!llmKeyPayload.encryptionAvailable || llmKeyLoading}
                        onClick={() => openLlmKeyDialog(selectedLlmProvider.id)}
                        type="button"
                      >
                        <ProviderIcon provider={selectedLlmProvider} />
                        <span className="llm-provider-strip-copy">
                          <strong>{selectedLlmProvider.providerName}</strong>
                          <span>{selectedLlmProvider.models?.length || 0} variants available</span>
                        </span>
                        <span className={`llm-provider-status ${selectedLlmStatus}`}>
                          {selectedLlmStatus === "disconnected" ? <CircleMinus size={15} /> : null}
                          {selectedLlmStatus === "not-connected" ? <PlugZap size={15} /> : null}
                          {selectedLlmStatusLabel}
                        </span>
                      </button>
                    )}

                    {selectedLlmKeys.length ? (
                      <div className="llm-provider-add-row">
                        <button
                          aria-label={`Add ${selectedLlmProvider.providerName} model, ${selectedLlmProvider.models?.length || 0} variants available`}
                          className="llm-provider-add-model-button"
                          data-tooltip={`${selectedLlmProvider.models?.length || 0} variants available`}
                          disabled={!llmKeyPayload.encryptionAvailable || llmKeyLoading}
                          onClick={() => openLlmKeyDialog(selectedLlmProvider.id)}
                          type="button"
                        >
                          <Plus size={16} aria-hidden="true" />
                          Add Model
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="llm-provider-strip-placeholder">
                    <span>Select a provider to configure its API key.</span>
                  </div>
                )}
              </div>
            </section>
          )}
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

        {llmProviderBrowserOpen ? createPortal(
          <SmallSettingsDialog
            ariaLabel="Add LLM Provider"
            className="medium-dialog llm-provider-browser-dialog"
            description="Choose a provider to pin it to your quick provider row."
            onClose={() => {
              setLlmProviderBrowserOpen(false);
              setLlmProviderBrowserSearch("");
            }}
            title="Add LLM Provider"
          >
            <label className="llm-provider-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search LLM providers</span>
              <input
                autoFocus
                onChange={(event) => setLlmProviderBrowserSearch(event.target.value)}
                placeholder="Search providers"
                value={llmProviderBrowserSearch}
              />
            </label>

            <div className="llm-provider-browser-list">
              {filteredLlmProviderBrowserProviders.length ? (
                filteredLlmProviderBrowserProviders.map((provider) => {
                  const savedKeyCount = getLlmKeysForProvider(provider.id).length;
                  const pinned = commonLlmProviders.some((candidate) => candidate.id === provider.id);
                  return (
                    <button
                      key={provider.id}
                      onClick={() => selectProviderFromBrowser(provider.id)}
                      type="button"
                    >
                      <ProviderIcon provider={provider} />
                      <span>
                        <strong>{provider.providerName}</strong>
                        <small>{provider.models?.length || 0} variants available</small>
                      </span>
                      {savedKeyCount ? <em>{savedKeyCount} saved</em> : pinned ? <em>Pinned</em> : null}
                    </button>
                  );
                })
              ) : (
                <p className="account-settings-muted">No providers match your search.</p>
              )}
            </div>
          </SmallSettingsDialog>,
          document.body,
        ) : null}

        {llmKeyDialogOpen ? createPortal(
          <SmallSettingsDialog
            ariaLabel={`Edit ${formLlmProvider?.providerName || "LLM Provider"}`}
            description="Saved keys become selectable in Intelligrate."
            footer={
              <>
                {llmKeyForm.id ? (
                  <button
                    className="danger-button compact"
                    disabled={llmKeySaving}
                    onClick={() => setLlmKeyDeleteTarget({
                      ...editingLlmKey,
                      id: llmKeyForm.id,
                      label: llmKeyForm.label || editingLlmKey?.label || formatModelLabel(llmKeyForm.model),
                      providerId: llmKeyForm.providerId,
                    })}
                    type="button"
                  >
                    <Unplug size={15} />
                    Disconnect
                  </button>
                ) : null}
                <button className="primary-button compact" disabled={llmKeySaving} type="submit">
                  {llmKeySaving ? "Saving" : "Save Changes"}
                </button>
              </>
            }
            onClose={closeLlmKeyDialog}
            onSubmit={saveLlmKey}
            title={`Edit: ${formLlmProvider?.providerName || "LLM Provider"}`}
          >
              {llmKeyError ? (
                <div className="form-error account-settings-error" role="alert">
                  <CircleX size={18} aria-hidden="true" />
                  <p>{llmKeyError}</p>
                </div>
              ) : null}

              <div className="create-room-form account-settings-password-form llm-key-form">
                <label className="field">
                  <span>Display Name</span>
                  <input
                    maxLength={80}
                    name="label"
                    onChange={updateLlmKeyField}
                    placeholder={formLlmProvider?.defaultLabel || formLlmProvider?.providerName || "Provider"}
                    value={llmKeyForm.label}
                  />
                </label>

                <label className="field">
                  <span>Provider</span>
                  <input
                    readOnly
                    value={formLlmProvider?.providerName || ""}
                  />
                </label>

                <AppSelectMenu
                  ariaLabel="Model or Variant"
                  className="llm-model-select"
                  label="Model / Variant"
                  maxMenuHeight={300}
                  onChange={selectLlmModel}
                  options={formLlmModelOptions}
                  placeholder="Choose a model"
                  portal
                  searchable
                  searchPlaceholder="Search models"
                  value={llmKeyForm.model}
                />

                {renderLlmApiKeyInput({ required: !llmKeyForm.id })}
              </div>
          </SmallSettingsDialog>,
          document.body,
        ) : null}

        {llmKeyDeleteTarget ? (
          <ConfirmDialog
            confirmLabel="Delete"
            message={`Delete ${llmKeyDeleteTarget.label}? Intelligrate will stop offering this provider for your messages.`}
            onCancel={() => setLlmKeyDeleteTarget(null)}
            onConfirm={deleteLlmKey}
            submittingLabel="Deleting"
            title="Delete LLM API Key"
          />
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
