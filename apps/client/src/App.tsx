import { useEffect, useState } from "react";
import { api, getAuthToken, setAuthToken } from "./api.ts";
import AuthView from "./features/auth/AuthView.tsx";
import Dashboard from "./features/dashboard/Dashboard.tsx";
import { JoinWorldDialog } from "./features/dashboard/DashboardComponents.tsx";
import { extractInviteCode } from "./features/dashboard/dashboardUtils.ts";
import RoomView from "./features/room/RoomView.tsx";
import { applyThemeMode, readStoredThemeMode, storeThemeMode } from "./theme.ts";

/** Reads the current hash route without introducing a routing dependency yet. */
function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [segment, value] = hash.split("/");

  if (segment === "rooms" && value) {
    return { name: "room", roomId: value };
  }

  if (segment === "invite" && value) {
    return { name: "invite", inviteCode: value };
  }

  return { name: "dashboard" };
}

/**
 * Owns top-level authentication state and hash-based routing.
 * Keeping routing here keeps feature screens focused on their own workflows.
 */
function App() {
  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState(parseRoute);
  const [booting, setBooting] = useState(Boolean(token));
  const [inviteError, setInviteError] = useState("");
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [themeMode, setThemeMode] = useState(readStoredThemeMode);

  useEffect(() => {
    applyThemeMode(themeMode);
    storeThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    setInviteError("");
    setJoiningInvite(false);
  }, [route.name, route.inviteCode]);

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }

    let active = true;
    setBooting(true);

    api
      .me()
      .then(({ user: currentUser }) => {
        if (active) setUser(currentUser);
      })
      .catch(() => {
        if (active) {
          setAuthToken("");
          setToken("");
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  /** Stores a successful login/register payload in app state and local storage. */
  function handleAuthenticated(payload) {
    setAuthToken(payload.token);
    setToken(payload.token);
    setUser(payload.user);
  }

  /** Clears auth state and returns the user to the public auth screen. */
  function handleLogout() {
    setAuthToken("");
    setToken("");
    setUser(null);
    window.location.hash = "/";
  }

  /** Updates the hash route used by the lightweight router above. */
  function navigate(path) {
    window.location.hash = path;
  }

  /** Joins a world from a direct invite route such as #/invite/abc123. */
  async function handleDirectInviteJoin(inviteValue, password = "") {
    const inviteCode = extractInviteCode(inviteValue);

    if (!inviteCode) {
      setInviteError("Invite link is required.");
      return;
    }

    setInviteError("");
    setJoiningInvite(true);

    try {
      const payload = await api.joinInvite(inviteCode, {
        password: String(password || "").trim(),
      });
      navigate(`/rooms/${payload.room.id}`);
    } catch (err) {
      setInviteError(err.message || "Unable to join domain.");
    } finally {
      setJoiningInvite(false);
    }
  }

  if (booting) {
    return (
      <main className="loading-screen">
        <div className="loading-mark" />
      </main>
    );
  }

  if (!token || !user) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  if (route.name === "dashboard") {
    return (
      <main className="app-shell">
        <Dashboard
          onLogout={handleLogout}
          onOpenRoom={(roomId) => navigate(`/rooms/${roomId}`)}
          onThemeChange={setThemeMode}
          onUserUpdated={setUser}
          themeMode={themeMode}
          user={user}
        />
      </main>
    );
  }

  if (route.name === "invite") {
    return (
      <main className="app-shell invite-route-shell">
        <JoinWorldDialog
          error={inviteError}
          initialInviteValue={route.inviteCode}
          joining={joiningInvite}
          onBack={() => navigate("/")}
          onClose={() => navigate("/")}
          onJoinInvite={handleDirectInviteJoin}
        />
      </main>
    );
  }

  return (
    <main className="room-shell">
      <RoomView
        inviteCode={route.inviteCode}
        roomId={route.roomId}
        token={token}
        user={user}
        onBack={() => navigate("/")}
        onOpenRoom={(roomId) => navigate(`/rooms/${roomId}`)}
        onUserUpdated={setUser}
      />
    </main>
  );
}

export default App;
