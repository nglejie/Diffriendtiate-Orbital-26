import {
  LogOut,
  Moon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { THEME_MODES, normaliseThemeMode } from "../../theme.ts";

/**
 * Dashboard navigation bar. Account actions live here so the dashboard no longer
 * needs a separate sidebar just to sign out or create a room.
 */
/** Top-level dashboard actions: account menu and room creation entry point. */
function TopBar({ onCreateRoom, onLogout, onThemeChange, themeMode }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const activeThemeMode = normaliseThemeMode(themeMode);
  const isLightMode = activeThemeMode === THEME_MODES.light;

  // Close the account menu when the user clicks elsewhere, matching the modal/dropdown
  // behaviour used across the rest of the app.
  useEffect(() => {
    function handleOutsideClick(event) {
      if (!accountMenuRef.current?.contains(event.target)) {
        setAccountOpen(false);
      }
    }

    if (accountOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [accountOpen]);

  return (
    <header className="top-bar" aria-label="Main navigation">
      <div className="top-bar-brand">
        <img
          className="dashboard-brand-logo"
          src="/brand/diffriendtiate-square-logo.png"
          alt="Diffriendtiate"
        />
      </div>

      <div className="top-bar-actions">
        <div className="account-menu-shell" ref={accountMenuRef}>
          <button
            aria-expanded={accountOpen}
            className="top-account-button"
            onClick={() => setAccountOpen((current) => !current)}
            type="button"
          >
            <UserRound size={18} />
            Account
          </button>
          {accountOpen ? (
            <div className="account-menu" role="menu" aria-label="Account menu">
              <div className="account-theme-row" aria-label="Theme mode">
                <span className="account-theme-label">
                  {isLightMode ? <Sun size={18} /> : <Moon size={18} />}
                  Theme
                </span>
                <button
                  aria-label={`Switch to ${isLightMode ? "dark" : "light"} mode`}
                  aria-pressed={isLightMode}
                  className={`theme-mode-toggle ${isLightMode ? "light" : "dark"}`}
                  onClick={() =>
                    onThemeChange(isLightMode ? THEME_MODES.dark : THEME_MODES.light)
                  }
                  type="button"
                >
                  <span>Dark</span>
                  <span>Light</span>
                  <i aria-hidden="true" />
                </button>
              </div>
              <button role="menuitem" type="button">
                <UserRound size={18} />
                Profile
              </button>
              <button role="menuitem" type="button">
                <Settings size={18} />
                Settings
              </button>
              <button className="danger" onClick={onLogout} role="menuitem" type="button">
                <LogOut size={16} />
                Logout
              </button>
            </div>
          ) : null}
        </div>
        <button
          className="top-create-button"
          onClick={onCreateRoom}
          type="button"
        >
          Create Room
        </button>
      </div>
    </header>
  );
}

export default TopBar;
