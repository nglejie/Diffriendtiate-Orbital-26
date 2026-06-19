import {
  LogOut,
  Plus,
  Settings,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Dashboard navigation bar. Account actions live here so the dashboard no longer
 * needs a separate sidebar just to sign out or create a room.
 */
/** Top-level dashboard actions: account menu and room creation entry point. */
function TopBar({ onCreateRoom, onLogout }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);

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
          aria-label="Create a Room"
          className="top-create-button icon-only-tooltip"
          data-tooltip="Create a Room"
          onClick={onCreateRoom}
          type="button"
        >
          <span className="top-create-icon-circle">
            <Plus size={17} strokeWidth={3.4} />
          </span>
        </button>
      </div>
    </header>
  );
}

export default TopBar;
