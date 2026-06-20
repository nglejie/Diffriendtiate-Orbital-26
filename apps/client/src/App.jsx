import { useEffect, useState } from "react";
import { api, getAuthToken, setAuthToken } from "./api.js";
import AuthView from "./features/auth/AuthView.jsx";
import Dashboard from "./features/dashboard/Dashboard.jsx";
import RoomView from "./features/room/RoomView.jsx";

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

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
      />
    </main>
  );
}

export default App;
