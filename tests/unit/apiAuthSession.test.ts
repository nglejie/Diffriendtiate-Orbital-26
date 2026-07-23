import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

async function importFreshApi() {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  return import("../../apps/client/src/api.ts");
}

describe("API auth session handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("refreshes the bearer token before authenticated JSON requests", async () => {
    const apiModule = await importFreshApi();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        user: { id: "usr_1", email: "student@example.test", name: "Student" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    apiModule.setAuthToken("old-access-token");
    apiModule.setAuthTokenRefreshHandler(vi.fn().mockResolvedValue("fresh-access-token"));

    await apiModule.api.me();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-access-token",
        }),
      }),
    );
    expect(apiModule.getAuthToken()).toBe("fresh-access-token");
    expect(localStorage.getItem("diffriendtiate_token")).toBe("fresh-access-token");
  });

  it("notifies the app shell when an authenticated request returns session expiry", async () => {
    const apiModule = await importFreshApi();
    const onExpired = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Please log in again." }, 401)),
    );

    apiModule.setAuthToken("expired-access-token");
    apiModule.setAuthSessionExpiredHandler(onExpired);

    await expect(apiModule.api.me()).rejects.toMatchObject({
      message: "Please log in again.",
      status: 401,
    });

    expect(onExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Please log in again.",
        status: 401,
      }),
    );
  });

  it("ignores expiry responses from an older token after a newer login wins the race", async () => {
    const apiModule = await importFreshApi();
    const onExpired = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Please log in again." }, 401)),
    );

    apiModule.setAuthToken("old-access-token");
    apiModule.setAuthSessionExpiredHandler(onExpired);

    const request = apiModule.api.me();
    apiModule.setAuthToken("fresh-oauth-token");

    await expect(request).rejects.toMatchObject({
      message: "Please log in again.",
      status: 401,
    });

    expect(onExpired).not.toHaveBeenCalled();
    expect(apiModule.getAuthToken()).toBe("fresh-oauth-token");
    expect(localStorage.getItem("diffriendtiate_token")).toBe("fresh-oauth-token");
  });
});
