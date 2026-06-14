import { useEffect, useState } from "react";
import { api, getAuthToken, setAuthToken } from "./api.js";
import AuthView from "./components/AuthView.jsx";
import Dashboard from "./components/Dashboard.jsx";
import RoomView from "./components/RoomView.jsx";

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

  function handleAuthenticated(payload) {
    setAuthToken(payload.token);
    setToken(payload.token);
    setUser(payload.user);
  }

  function handleLogout() {
    setAuthToken("");
    setToken("");
    setUser(null);
    window.location.hash = "/";
  }

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
          user={user}
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
