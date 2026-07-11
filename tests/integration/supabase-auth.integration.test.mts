import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { apiRequest, createRoom, expectStatus } from "../helpers/apiClient.mts";
import { getFreePort, startTestApp } from "../helpers/testServer.mts";

async function startMockSupabaseAuth() {
  const port = await getFreePort();
  const calls: any[] = [];

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    calls.push({
      authorization: request.headers.authorization,
      path: url.pathname,
    });

    if (request.method === "GET" && url.pathname === "/auth/v1/user") {
      if (request.headers.authorization !== "Bearer mock-supabase-access-token") {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Invalid token" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "supabase-user-1",
          email: "supabase-user@example.test",
          email_confirmed_at: new Date().toISOString(),
          user_metadata: {
            name: "Supabase Linked User",
          },
        }),
      );
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    calls,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("Supabase auth bridge", () => {
  let app;
  let supabase;

  beforeAll(async () => {
    supabase = await startMockSupabaseAuth();
    app = await startTestApp({
      env: {
        SUPABASE_ANON_KEY: "mock-anon-key",
        SUPABASE_URL: supabase.url,
      },
    });
  });

  afterAll(async () => {
    await app?.stop();
    await supabase?.stop();
  });

  it("links a verified Supabase session to an internal app user", async () => {
    const session = await apiRequest(app.baseUrl, "/api/auth/supabase/session", {
      method: "POST",
      body: {
        accessToken: "mock-supabase-access-token",
      },
    });
    const sessionPayload = await expectStatus(session, 200, "exchange Supabase session");
    expect(sessionPayload.token).toBe("mock-supabase-access-token");
    expect(sessionPayload.user).toMatchObject({
      email: "supabase-user@example.test",
      emailVerified: true,
      name: "Supabase Linked User",
    });

    const me = await apiRequest(app.baseUrl, "/api/auth/me", {
      token: "mock-supabase-access-token",
    });
    const mePayload = await expectStatus(me, 200, "load Supabase-backed user");
    expect(mePayload.user.id).toBe(sessionPayload.user.id);
    expect(mePayload.user.authProviders).toContain("supabase");
    expect(mePayload.user.hasPassword).toBe(false);

    const passwordSetup = await apiRequest(app.baseUrl, "/api/auth/password", {
      method: "PATCH",
      token: "mock-supabase-access-token",
      body: {
        newPassword: "supabase-local-password-123",
      },
    });
    const passwordSetupPayload = await expectStatus(passwordSetup, 200, "set local password");
    expect(passwordSetupPayload.user.hasPassword).toBe(true);

    const localPasswordLogin = await apiRequest(app.baseUrl, "/api/auth/login", {
      method: "POST",
      body: {
        email: "supabase-user@example.test",
        password: "supabase-local-password-123",
      },
    });
    await expectStatus(localPasswordLogin, 200, "log in with configured password");

    const room = await createRoom(app.baseUrl, "mock-supabase-access-token", {
      name: "Supabase Domain",
    });
    expect(room.id).toBeTruthy();

    const rooms = await apiRequest(app.baseUrl, "/api/rooms", {
      token: "mock-supabase-access-token",
    });
    const roomsPayload = await expectStatus(rooms, 200, "list Supabase user domains");
    expect(roomsPayload.rooms.some((candidate) => candidate.id === room.id)).toBe(true);
    expect(supabase.calls.some((call) => call.path === "/auth/v1/user")).toBe(true);
  });
});
