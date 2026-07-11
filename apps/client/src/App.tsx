import { useEffect, useRef, useState } from "react";
import { api, getAuthToken, setAuthToken } from "./api.ts";
import AuthView from "./features/auth/AuthView.tsx";
import Dashboard from "./features/dashboard/Dashboard.tsx";
import { JoinWorldDialog } from "./features/dashboard/DashboardComponents.tsx";
import { extractInviteCode } from "./features/dashboard/dashboardUtils.ts";
import RoomView from "./features/room/RoomView.tsx";
import AppLoadingScreen from "./shared/ui/AppLoadingScreen.tsx";
import AppTooltip from "./shared/ui/AppTooltip.tsx";
import {
  getActiveSupabaseSession,
  isSupabaseAuthConfigured,
  readSupabaseAuthTypeFromUrl,
  signOutSupabaseAuth,
} from "./supabaseAuth.ts";
import { applyThemeMode, readStoredThemeMode, storeThemeMode } from "./theme.ts";

/** Reads the current hash route without introducing a routing dependency yet. */
function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [path, queryString = ""] = hash.split("?");
  const [segment, value] = path.split("/");

  if (segment === "auth" && value === "callback") {
    const params = new URLSearchParams(queryString);
    return {
      name: "auth-callback",
      error: params.get("error") || "",
      token: params.get("token") || "",
    };
  }

  if (segment === "reset-password") {
    const params = new URLSearchParams(queryString);
    return {
      name: "password-reset",
      resetToken: params.get("token") || "",
    };
  }

  if (segment === "verify-email") {
    const params = new URLSearchParams(queryString);
    return {
      name: "email-verification",
      verificationToken: params.get("token") || "",
    };
  }

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
  const [authError, setAuthError] = useState("");
  const [themeMode, setThemeMode] = useState(readStoredThemeMode);
  const suppressNextSupabaseSessionError = useRef(false);

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
    if (route.name !== "auth-callback") return;

    if (route.error) {
      setAuthError(route.error);
      navigate("/");
      return;
    }

    if (!route.token) {
      setAuthError("Sign-in did not return a usable session.");
      navigate("/");
      return;
    }

    setAuthToken(route.token);
    setToken(route.token);
    setUser(null);
    setBooting(true);
    setAuthError("");
    navigate("/");
  }, [route]);

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
        if (active) {
          setUser(currentUser);
          setAuthError("");
        }
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

  useEffect(() => {
    if (!isSupabaseAuthConfigured() || token) return;
    if (readSupabaseAuthTypeFromUrl() === "recovery") return;

    let active = true;
    setBooting(true);

    getActiveSupabaseSession()
      .then(async (session) => {
        if (!active || !session?.access_token) return;
        const payload = await api.completeSupabaseSession({
          accessToken: session.access_token,
        });
        if (!active) return;
        handleAuthenticated({ ...payload, remember: true });
        navigate("/");
      })
      .catch(() => {
        if (active && !suppressNextSupabaseSessionError.current) {
          setAuthError("Sign-in could not be completed.");
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
    suppressNextSupabaseSessionError.current = false;
    setAuthToken(payload.token, { remember: payload.remember });
    setToken(payload.token);
    setUser(payload.user);
    setAuthError("");
    if (["auth-callback", "email-verification", "password-reset"].includes(route.name)) {
      navigate("/");
    }
  }

  /** Clears auth state and returns the user to the public auth screen. */
  function handleLogout() {
    suppressNextSupabaseSessionError.current = true;
    void signOutSupabaseAuth();
    setAuthToken("");
    setToken("");
    setUser(null);
    setAuthError("");
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
      <>
        <AppTooltip />
        <AppLoadingScreen />
      </>
    );
  }

  if (!token || !user) {
    return (
      <>
        <AppTooltip />
        <AuthView
          initialError={authError}
          onAuthenticated={handleAuthenticated}
          resetToken={route.name === "password-reset" ? route.resetToken : ""}
          verificationToken={route.name === "email-verification" ? route.verificationToken : ""}
        />
      </>
    );
  }

  if (route.name === "dashboard") {
    return (
      <>
        <AppTooltip />
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
      </>
    );
  }

  if (route.name === "invite") {
    return (
      <>
        <AppTooltip />
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
      </>
    );
  }

  return (
    <>
      <AppTooltip />
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
    </>
  );
}

export default App;
