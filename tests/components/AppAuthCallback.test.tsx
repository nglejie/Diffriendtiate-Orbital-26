import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../apps/client/src/App.tsx";
import { setAuthToken } from "../../apps/client/src/api.ts";

const supabaseAuthMock = vi.hoisted(() => ({
  getSupabaseSessionExpiresAtMs: vi.fn(() => 0),
  isSupabaseAuthConfigured: vi.fn(() => true),
  readSupabaseAuthTypeFromUrl: vi.fn(() => ""),
  refreshActiveSupabaseSession: vi.fn(),
  signOutSupabaseAuth: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../apps/client/src/supabaseAuth.ts", () => ({
  getSupabaseSessionExpiresAtMs: supabaseAuthMock.getSupabaseSessionExpiresAtMs,
  isSupabaseAuthConfigured: supabaseAuthMock.isSupabaseAuthConfigured,
  readSupabaseAuthTypeFromUrl: supabaseAuthMock.readSupabaseAuthTypeFromUrl,
  refreshActiveSupabaseSession: supabaseAuthMock.refreshActiveSupabaseSession,
  signOutSupabaseAuth: supabaseAuthMock.signOutSupabaseAuth,
}));

vi.mock("../../apps/client/src/features/auth/AuthView.tsx", () => ({
  default: ({ initialError = "" }) => (
    <div data-testid="auth-view">{initialError || "auth view"}</div>
  ),
}));

vi.mock("../../apps/client/src/features/dashboard/Dashboard.tsx", () => ({
  default: ({ user }) => <div data-testid="dashboard">Dashboard {user.email}</div>,
}));

vi.mock("../../apps/client/src/features/dashboard/DashboardComponents.tsx", () => ({
  JoinWorldDialog: () => <div data-testid="join-domain" />,
}));

vi.mock("../../apps/client/src/features/room/RoomView.tsx", () => ({
  default: () => <div data-testid="room-view" />,
}));

vi.mock("../../apps/client/src/shared/ui/AppLoadingScreen.tsx", () => ({
  default: () => <div data-testid="loading">Loading</div>,
}));

vi.mock("../../apps/client/src/shared/ui/AppTooltip.tsx", () => ({
  default: () => null,
}));

function jsonResponse(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("App OAuth callback handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    setAuthToken("");
    window.location.hash = "";
    supabaseAuthMock.isSupabaseAuthConfigured.mockReturnValue(true);
    supabaseAuthMock.readSupabaseAuthTypeFromUrl.mockReturnValue("");
    supabaseAuthMock.refreshActiveSupabaseSession.mockResolvedValue({
      access_token: "stale-supabase-browser-token",
    });
    supabaseAuthMock.signOutSupabaseAuth.mockResolvedValue(undefined);
  });

  it("does not recover a Supabase browser session while an app OAuth callback is pending", async () => {
    const fetchMock = vi.fn((url, init: RequestInit = {}) => {
      if (url === "/api/auth/me") {
        return Promise.resolve(
          jsonResponse({
            user: {
              authProviders: ["google"],
              email: "student@example.com",
              emailVerified: true,
              id: "usr_1",
              name: "Student",
            },
          }),
        );
      }

      return Promise.resolve(jsonResponse({ message: "unexpected request" }, 500));
    });
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/auth/callback?token=fresh-oauth-token";

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toHaveTextContent("student@example.com");
    });

    expect(supabaseAuthMock.signOutSupabaseAuth).toHaveBeenCalled();
    expect(supabaseAuthMock.refreshActiveSupabaseSession).not.toHaveBeenCalled();
    expect(localStorage.getItem("diffriendtiate_token")).toBe("fresh-oauth-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-oauth-token",
        }),
      }),
    );
  });
});
