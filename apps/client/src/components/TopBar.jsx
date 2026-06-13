import {
  LogOut,
  Plus,
  UserRound,
} from "lucide-react";
import { useState } from "react";

function TopBar({ onCreateRoom, onLogout, user }) {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="top-bar" aria-label="Main navigation">
      <div className="top-bar-brand">
        <span className="sidebar-logo" aria-label="Diffriendtiate">
          D
        </span>
        <span>Diffriendtiate</span>
      </div>

      <div className="top-bar-actions">
        <div className="account-menu-shell">
          <button
            className="top-account-button"
            onClick={() => setAccountOpen((current) => !current)}
            type="button"
          >
            <UserRound size={18} />
            Account
          </button>
          {accountOpen ? (
            <div className="account-menu" role="menu">
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <button onClick={onLogout} role="menuitem" type="button">
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
        <button className="top-create-button" onClick={onCreateRoom} type="button">
          <Plus size={18} />
          Create Room
        </button>
      </div>
    </header>
  );
}

export default TopBar;
