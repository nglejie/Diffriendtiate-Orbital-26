import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  createRoom,
  expectStatus,
  joinRoom,
  registerUser,
  uploadTextResource,
} from "../helpers/apiClient.mjs";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mjs";

describe("app API integration", () => {
  let app;
  let chatbot;
  let owner;
  let member;
  let room;

  beforeAll(async () => {
    // Start the real app API against isolated temporary storage and a local
    // mock Intelligrate endpoint. The setup creates an owner/member pair and a
    // shared room so every test exercises realistic authenticated requests.
    chatbot = await startMockChatbot();
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "Owner Fleming" });
    member = await registerUser(app.baseUrl, { name: "Member Durin" });
    room = await createRoom(app.baseUrl, owner.token, {
      name: "API Integration Room",
      moduleCode: "CS2040S",
    });
    await joinRoom(app.baseUrl, member.token, room.id);
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  // Confirms the public health endpoint is available while protected API routes
  // still require authentication. This is the basic server readiness and auth
  // boundary check for the app API.
  it("reports health and protects authenticated API routes", async () => {
    const health = await apiRequest(app.baseUrl, "/api/health");
    expect(health.status).toBe(200);
    expect(health.payload).toMatchObject({ ok: true, service: "Diffriendtiate API", storage: "json" });

    const rooms = await apiRequest(app.baseUrl, "/api/rooms");
    expect(rooms.status).toBe(401);
    expect(rooms.payload.message).toMatch(/log in/i);
  });

  // Verifies the auth lifecycle against the running server: an already-created
  // user can log in, receive a session payload, and then list rooms they own or
  // belong to.
  it("registers, logs in, and lists rooms visible to the owner", async () => {
    const login = await apiRequest(app.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: owner.email, password: owner.password },
    });
    expect(login.status).toBe(200);
    expect(login.payload.user.email).toBe(owner.email);

    const list = await apiRequest(app.baseUrl, "/api/rooms", { token: owner.token });
    expect(list.status).toBe(200);
    expect(list.payload.rooms.some((item) => item.id === room.id)).toBe(true);
  });

  // Protects Room Settings permissions. A normal member should be blocked from
  // changing room profile fields, while the owner can save profile edits and
  // receives the updated room payload.
  it("lets only the owner update room profile fields", async () => {
    const blocked = await apiRequest(app.baseUrl, `/api/rooms/${room.id}`, {
      method: "PATCH",
      token: member.token,
      body: { name: "Member Rename", moduleCode: "CS2040S" },
    });
    expect(blocked.status).toBe(403);

    const updated = await apiRequest(app.baseUrl, `/api/rooms/${room.id}`, {
      method: "PATCH",
      token: owner.token,
      body: {
        ...room,
        description: "Updated through integration test",
        name: "API Integration Room Updated",
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.payload.room).toMatchObject({
      description: "Updated through integration test",
      isOwner: true,
      name: "API Integration Room Updated",
    });
  });

  // Exercises the full channel-management API from both roles. Members should
  // receive 403s for create/rename/delete, and owners should be able to create a
  // normalized channel, rename it, then delete it with the active channel
  // falling back to #general.
  it("enforces owner-only channel creation, rename, and deletion", async () => {
    const memberCreate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: member.token,
      body: { name: "member-channel" },
    });
    expect(memberCreate.status).toBe(403);

    const ownerCreate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "Lecture Notes" },
    });
    expect(ownerCreate.status).toBe(201);
    expect(ownerCreate.payload.channel).toBe("lecture-notes");

    const memberRename = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels/lecture-notes`, {
      method: "PATCH",
      token: member.token,
      body: { name: "wrong" },
    });
    expect(memberRename.status).toBe(403);

    const ownerRename = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels/lecture-notes`, {
      method: "PATCH",
      token: owner.token,
      body: { name: "Lecture Archive" },
    });
    expect(ownerRename.status).toBe(200);
    expect(ownerRename.payload.channel).toBe("lecture-archive");

    const memberDelete = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels/lecture-archive`, {
      method: "DELETE",
      token: member.token,
    });
    expect(memberDelete.status).toBe(403);

    const ownerDelete = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels/lecture-archive`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(ownerDelete.status).toBe(200);
    expect(ownerDelete.payload.channel).toBe("general");
  });

  // Covers the ordinary chat write/read loop for a non-owner member. The message
  // should be stored in the requested channel and returned with sender metadata
  // so the UI can render the display name and grouping correctly.
  it("stores and retrieves channel messages with sender metadata", async () => {
    const createChannel = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "questions" },
    });
    expect(createChannel.status).toBe(201);

    const message = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/messages`, {
      method: "POST",
      token: member.token,
      body: { body: "Can someone explain amortized analysis?", channel: "questions" },
    });
    expect(message.status).toBe(201);
    expect(message.payload.message).toMatchObject({
      body: "Can someone explain amortized analysis?",
      channel: "questions",
      sender: { name: "Member Durin" },
    });

    const messages = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/messages?channel=questions`, {
      token: owner.token,
    });
    expect(messages.status).toBe(200);
    expect(messages.payload.messages.map((item) => item.body)).toContain("Can someone explain amortized analysis?");
  });

  // Validates the room resource lifecycle used by the Resources tab. It uploads
  // a file, proves duplicate content is deduplicated by hash, lists it as a
  // member, soft-deletes it, restores it, and finally permanently deletes it.
  it("supports room resources, deduplication, deletion, restore, and permanent delete", async () => {
    const upload = await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "Lecture 01 Graphs.txt",
      "Graph traversal notes",
      "Lecture Notes",
    );
    expect(upload.resource).toMatchObject({
      folder: "Lecture Notes",
      originalName: "Lecture 01 Graphs.txt",
      uploader: { name: "Owner Fleming" },
    });

    const duplicateForm = new FormData();
    duplicateForm.append("file", new Blob(["Graph traversal notes"], { type: "text/plain" }), "Copy.txt");
    duplicateForm.append("folder", "Reference");
    const duplicate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources/file`, {
      method: "POST",
      token: owner.token,
      body: duplicateForm,
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.payload.deduplicated).toBe(true);
    expect(duplicate.payload.resource.id).toBe(upload.resource.id);

    const listed = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources`, {
      token: member.token,
    });
    expect(listed.status).toBe(200);
    expect(listed.payload.resources).toHaveLength(1);

    const deleted = await apiRequest(app.baseUrl, `/api/resources/${upload.resource.id}`, {
      method: "DELETE",
      token: owner.token,
    });
    await expectStatus(deleted, 204, "soft delete resource");

    const deletedOnly = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources?deleted=true`, {
      token: owner.token,
    });
    expect(deletedOnly.status).toBe(200);
    expect(deletedOnly.payload.resources[0].deletedAt).toBeTruthy();

    const restored = await apiRequest(app.baseUrl, `/api/resources/${upload.resource.id}/restore`, {
      method: "PATCH",
      token: owner.token,
    });
    expect(restored.status).toBe(200);
    expect(restored.payload.resource.deletedAt).toBe("");

    await apiRequest(app.baseUrl, `/api/resources/${upload.resource.id}`, {
      method: "DELETE",
      token: owner.token,
    });
    const permanent = await apiRequest(app.baseUrl, `/api/resources/${upload.resource.id}/permanent`, {
      method: "DELETE",
      token: owner.token,
    });
    await expectStatus(permanent, 204, "permanent delete resource");
  });
});
