import { LogOut } from "lucide-react";

function TopBar({ user, onLogout }) {
  return (
    <header className="top-bar">
      <button
        className="brand-button"
        onClick={() => {
          window.location.hash = "/";
        }}
        type="button"
      >
        <span className="brand-mark">D</span>
        <span>Diffriendtiate</span>
      </button>

      <div className="top-actions">
        <span className="user-chip">{user.name}</span>
        <button className="icon-button" onClick={onLogout} title="Log out" type="button">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default TopBar;
