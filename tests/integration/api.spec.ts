import { expect, test } from "@playwright/test";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

test.describe("Diffriendtiate API integration", () => {
  test("health endpoint reports the app API status", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "Diffriendtiate API",
      storage: expect.any(String),
    });
  });

  test("protected room routes require authentication", async ({ request }) => {
    const response = await request.get("/api/rooms");

    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      message: "Please log in again.",
    });
  });

  test("a registered user can create and list a room", async ({ request }) => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = await request.post("/api/auth/register", {
      data: {
        name: "QA Tester",
        email: `qa-${stamp}@example.com`,
        password: "quality-pass-123",
      },
    });

    expect(register.status()).toBe(201);
    const auth = await register.json();
    expect(auth.token).toEqual(expect.any(String));
    expect(auth.user.email).toContain("@example.com");

    const roomName = `QA Room ${stamp}`;
    const createRoom = await request.post("/api/rooms", {
      headers: authHeaders(auth.token),
      data: {
        name: roomName,
        moduleCode: "CS2100",
        academicTerm: "AY2026/2027 Sem 1",
        visibility: "public",
        tags: ["qa", "testing"],
      },
    });

    expect(createRoom.status()).toBe(201);
    const created = await createRoom.json();
    expect(created.room).toMatchObject({
      name: roomName,
      moduleCode: "CS2100",
      isOwner: true,
    });

    const rooms = await request.get("/api/rooms", {
      headers: authHeaders(auth.token),
    });
    expect(rooms.ok()).toBe(true);
    const payload = await rooms.json();
    expect(payload.rooms.map((room) => room.id)).toContain(created.room.id);
  });
});
