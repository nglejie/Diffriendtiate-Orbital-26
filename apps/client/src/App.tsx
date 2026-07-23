import { Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  getAuthToken,
  replaceAuthToken,
  setAuthSessionExpiredHandler,
  setAuthToken,
  setAuthTokenRefreshHandler,
} from "./api.ts";
import AuthView from "./features/auth/AuthView.tsx";
import Dashboard from "./features/dashboard/Dashboard.tsx";
import { JoinWorldDialog } from "./features/dashboard/DashboardComponents.tsx";
import { extractInviteCode } from "./features/dashboard/dashboardUtils.ts";
import RoomView from "./features/room/RoomView.tsx";
import AppLoadingScreen from "./shared/ui/AppLoadingScreen.tsx";
import AppTooltip from "./shared/ui/AppTooltip.tsx";
import {
  looksLikeSupabaseAccessToken,
  readJwtExpiresAtMs,
  usesSupabaseBrowserSession,
} from "./authSession.ts";
import {
  getSupabaseSessionExpiresAtMs,
  isSupabaseAuthConfigured,
  readSupabaseAuthTypeFromUrl,
  refreshActiveSupabaseSession,
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

const SESSION_REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const SESSION_WARNING_LEEWAY_MS = 5 * 60 * 1000;
const SESSION_EXPIRED_MESSAGE = "Your session expired. Please log in again.";

function SessionNotice({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div className="room-toast" role="status">
      <Info size={18} aria-hidden="true" />
      <span>{message}</span>
      <button aria-label="Dismiss session warning" onClick={onDismiss} type="button">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
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
  const [sessionNotice, setSessionNotice] = useState("");
  const [themeMode, setThemeMode] = useState(readStoredThemeMode);
  const suppressNextSupabaseSessionError = useRef(false);
  const usesSupabaseSession = usesSupabaseBrowserSession(user, token);

  const handleSessionExpired = useCallback((message = SESSION_EXPIRED_MESSAGE) => {
    suppressNextSupabaseSessionError.current = true;
    void signOutSupabaseAuth();
    setAuthToken("");
    setAuthTokenRefreshHandler(null);
    setToken("");
    setUser(null);
    setBooting(false);
    setSessionNotice("");
    setAuthError(message);
    window.location.hash = "/";
  }, []);

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

    suppressNextSupabaseSessionError.current = true;
    void signOutSupabaseAuth();
    setAuthToken(route.token);
    setToken(route.token);
    setUser(null);
    setBooting(true);
    setAuthError("");
    navigate("/");
  }, [route]);

  useEffect(() => {
    setAuthSessionExpiredHandler((error) => {
      handleSessionExpired(error.message || SESSION_EXPIRED_MESSAGE);
    });
    return () => setAuthSessionExpiredHandler(null);
  }, [handleSessionExpired]);

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
          suppressNextSupabaseSessionError.current = false;
        }
      })
      .catch(async () => {
        if (!active) return;

        if (isSupabaseAuthConfigured() && looksLikeSupabaseAccessToken(token)) {
          try {
            const session = await refreshActiveSupabaseSession(SESSION_REFRESH_LEEWAY_MS);
            if (active && session?.access_token) {
              replaceAuthToken(session.access_token);
              setToken(session.access_token);
              const payload = await api.completeSupabaseSession({
                accessToken: session.access_token,
              });
              if (active) {
                handleAuthenticated({ ...payload, remember: true });
              }
              return;
            }
          } catch {
            // Fall through to the normal expired-session path below.
          }
        }

        handleSessionExpired();
      })
      .finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
    };
  }, [handleSessionExpired, token]);

  useEffect(() => {
    if (!token || !usesSupabaseSession || !isSupabaseAuthConfigured()) {
      setAuthTokenRefreshHandler(null);
      return () => setAuthTokenRefreshHandler(null);
    }

    let active = true;
    setAuthTokenRefreshHandler(async () => {
      try {
        const session = await refreshActiveSupabaseSession(SESSION_REFRESH_LEEWAY_MS);
        if (!session?.access_token) {
          if (active) handleSessionExpired();
          return "";
        }

        if (active && session.access_token !== getAuthToken()) {
          replaceAuthToken(session.access_token);
          setToken(session.access_token);
        }

        return session.access_token;
      } catch {
        if (active) handleSessionExpired();
        return "";
      }
    });

    return () => {
      active = false;
      setAuthTokenRefreshHandler(null);
    };
  }, [handleSessionExpired, token, usesSupabaseSession]);

  useEffect(() => {
    if (!token || !usesSupabaseSession || !isSupabaseAuthConfigured()) return undefined;

    let active = true;
    let refreshTimeoutId = 0;

    const syncSupabaseSession = async () => {
      window.clearTimeout(refreshTimeoutId);

      try {
        const session = await refreshActiveSupabaseSession(SESSION_REFRESH_LEEWAY_MS);
        if (!active) return;

        if (!session?.access_token) {
          handleSessionExpired();
          return;
        }

        if (session.access_token !== getAuthToken()) {
          replaceAuthToken(session.access_token);
          setToken(session.access_token);
        }

        const expiresAtMs = getSupabaseSessionExpiresAtMs(session);
        if (!expiresAtMs) return;

        const nextRefreshDelayMs = Math.max(
          30_000,
          expiresAtMs - Date.now() - SESSION_REFRESH_LEEWAY_MS,
        );
        refreshTimeoutId = window.setTimeout(syncSupabaseSession, nextRefreshDelayMs);
      } catch {
        if (active) handleSessionExpired();
      }
    };

    const handleWake = () => {
      if (document.visibilityState !== "hidden") {
        void syncSupabaseSession();
      }
    };

    void syncSupabaseSession();
    window.addEventListener("focus", handleWake);
    document.addEventListener("visibilitychange", handleWake);

    return () => {
      active = false;
      window.clearTimeout(refreshTimeoutId);
      window.removeEventListener("focus", handleWake);
      document.removeEventListener("visibilitychange", handleWake);
    };
  }, [handleSessionExpired, token, usesSupabaseSession]);

  useEffect(() => {
    setSessionNotice("");
    if (!token || usesSupabaseSession) return undefined;

    const expiresAtMs = readJwtExpiresAtMs(token);
    if (!expiresAtMs) return undefined;

    if (expiresAtMs <= Date.now()) {
      handleSessionExpired();
      return undefined;
    }

    const warningDelayMs = expiresAtMs - Date.now() - SESSION_WARNING_LEEWAY_MS;
    const warningTimeoutId = window.setTimeout(() => {
      setSessionNotice("Your session will expire soon. Save your work and log in again.");
    }, Math.max(0, warningDelayMs));
    const expiryTimeoutId = window.setTimeout(() => {
      handleSessionExpired();
    }, Math.max(0, expiresAtMs - Date.now()));

    return () => {
      window.clearTimeout(warningTimeoutId);
      window.clearTimeout(expiryTimeoutId);
    };
  }, [handleSessionExpired, token, usesSupabaseSession]);

  useEffect(() => {
    if (!isSupabaseAuthConfigured() || token || route.name === "auth-callback") return;
    if (readSupabaseAuthTypeFromUrl() === "recovery") return;

    let active = true;
    setBooting(true);

    refreshActiveSupabaseSession(SESSION_REFRESH_LEEWAY_MS)
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
  }, [route.name, token]);

  /** Stores a successful login/register payload in app state and local storage. */
  function handleAuthenticated(payload) {
    suppressNextSupabaseSessionError.current = false;
    setAuthToken(payload.token, { remember: payload.remember });
    setToken(payload.token);
    setUser(payload.user);
    setAuthError("");
    setSessionNotice("");
    if (["auth-callback", "email-verification", "password-reset"].includes(route.name)) {
      navigate("/");
    }
  }

  /** Clears auth state and returns the user to the public auth screen. */
  function handleLogout() {
    suppressNextSupabaseSessionError.current = true;
    void signOutSupabaseAuth();
    setAuthToken("");
    setAuthTokenRefreshHandler(null);
    setToken("");
    setUser(null);
    setAuthError("");
    setSessionNotice("");
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

  const sessionNoticeNode = (
    <SessionNotice message={sessionNotice} onDismiss={() => setSessionNotice("")} />
  );

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
        {sessionNoticeNode}
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
        {sessionNoticeNode}
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
      {sessionNoticeNode}
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
