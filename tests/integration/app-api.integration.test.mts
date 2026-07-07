import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { io as connectSocket } from "socket.io-client";
import {
  apiRequest,
  createRoom,
  expectStatus,
  joinRoom,
  registerUser,
  uploadTextResource,
} from "../helpers/apiClient.mts";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mts";

function waitForSocketEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5_000);

    socket.once(event, (payload) => {
      clearTimeout(timeoutId);
      resolve(payload);
    });
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function connectRoomSocket(baseUrl, token, roomId) {
  const socket = connectSocket(baseUrl, {
    auth: { token },
    path: "/socket.io",
  });

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out connecting socket")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeoutId);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });

  const joinAck = await emitWithAck(socket, "room:join", roomId);
  expect(joinAck).toMatchObject({ ok: true });
  return socket;
}

async function uploadFixtureFile(baseUrl, token, roomId, fileName, content, mimeType, options: any = {}) {
  const formData = new FormData();
  formData.append("file", new Blob([content], { type: mimeType }), fileName);
  if (options.purpose) {
    formData.append("purpose", options.purpose);
  }
  const result = await apiRequest(baseUrl, `/api/rooms/${roomId}/resources/file`, {
    method: "POST",
    token,
    body: formData,
  });
  const payload = await expectStatus(result, 201, `upload ${fileName}`);
  return payload.resource;
}

async function getResourceById(baseUrl, token, roomId, resourceId) {
  const result = await apiRequest(baseUrl, `/api/rooms/${roomId}/resources`, { token });
  expect(result.status).toBe(200);
  return result.payload.resources.find((item) => item.id === resourceId);
}

async function waitForResourceStatus(baseUrl, token, roomId, resourceId, status) {
  let resource = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    resource = await getResourceById(baseUrl, token, roomId, resourceId);
    if (resource?.conversionStatus === status) return resource;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${resourceId} to reach ${status}. Last status: ${resource?.conversionStatus}`);
}

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
    app = await startTestApp({
      chatbotUrl: chatbot.url,
      libreOfficeBin: "__missing_libreoffice_for_conversion_tests__",
    });
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

  // Covers common malformed auth and room-creation edge cases that otherwise
  // tend to regress silently: duplicate accounts, weak passwords, missing room
  // identifiers, and private rooms without passwords should all fail cleanly.
  it("rejects duplicate accounts, weak passwords, and invalid room creation payloads", async () => {
    const weakPassword = await apiRequest(app.baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Weak Password",
        email: "weak-password@example.test",
        password: "123",
      },
    });
    expect(weakPassword.status).toBe(400);
    expect(weakPassword.payload.message).toMatch(/password/i);

    const duplicate = await apiRequest(app.baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Owner Fleming Again",
        email: owner.email,
        password: owner.password,
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.payload.message).toMatch(/already exists/i);

    const missingModule = await apiRequest(app.baseUrl, "/api/rooms", {
      method: "POST",
      token: owner.token,
      body: {
        name: "Incomplete Room",
        moduleCode: "",
      },
    });
    expect(missingModule.status).toBe(400);
    expect(missingModule.payload.message).toMatch(/room name and module code/i);

    const privateWithoutPassword = await apiRequest(app.baseUrl, "/api/rooms", {
      method: "POST",
      token: owner.token,
      body: {
        name: "Private Missing Password",
        moduleCode: "CS2105",
        visibility: "private",
      },
    });
    expect(privateWithoutPassword.status).toBe(400);
    expect(privateWithoutPassword.payload.message).toMatch(/password/i);
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

  // The document-channel upload picker is intentionally stricter than the
  // general resource library. Unsupported executables should be rejected with a
  // concrete allowed-file-types message instead of a generic failure.
  it("rejects unsupported document-channel uploads with a clear file-type message", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob(["not a document"], { type: "application/x-msdownload" }),
      "installer.exe",
    );
    formData.append("purpose", "document-channel");

    const result = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources/file`, {
      method: "POST",
      token: owner.token,
      body: formData,
    });

    expect(result.status).toBe(400);
    expect(result.payload.message).toMatch(/pdf, docx, pptx, png, jpg, jpeg, or webp/i);
  });

  // Office uploads should not block the HTTP response while LibreOffice works
  // in the background. The test app points LibreOffice at a missing binary so
  // the failure path is deterministic and proves clients still receive a
  // socket status update they can render.
  it("reports background Office conversion failures without breaking uploads", async () => {
    const socket = await connectRoomSocket(app.baseUrl, owner.token, room.id);
    const conversionEvents = [];
    socket.on("resource:conversion-done", (payload) => conversionEvents.push(payload));

    try {
      const resource = await uploadFixtureFile(
        app.baseUrl,
        owner.token,
        room.id,
        "Broken Worksheet.docx",
        "not a real docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(resource).toMatchObject({
        conversionStatus: "pending",
        resourceType: "docx",
      });
      expect(resource.pdfUrl).toBeNull();

      let conversionEvent = null;
      for (let attempt = 0; attempt < 40 && !conversionEvent; attempt += 1) {
        conversionEvent = conversionEvents.find((event) => event.resourceId === resource.id) || null;
        if (!conversionEvent) await delay(50);
      }

      expect(conversionEvent).toMatchObject({
        conversionStatus: "failed",
        resourceId: resource.id,
        roomId: room.id,
      });

      const resources = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources`, {
        token: owner.token,
      });
      const savedResource = resources.payload.resources.find((item) => item.id === resource.id);
      expect(savedResource).toMatchObject({
        conversionStatus: "failed",
        pdfUrl: null,
        resourceType: "docx",
      });
    } finally {
      socket.disconnect();
    }
  });

  // Existing rooms can contain Office files from before typed resource metadata
  // existed. They used to look like "other/not-needed", which left document
  // channels stuck on the conversion placeholder forever. Listing resources must
  // reclassify those files and restart conversion instead.
  it("repairs legacy PPTX resource metadata and resumes conversion on resource load", async () => {
    const resource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Legacy Slides.pptx",
      "not a real pptx, but enough to exercise the missing-converter path",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    await waitForResourceStatus(app.baseUrl, owner.token, room.id, resource.id, "failed");

    const dbPath = path.join(app.dataDir, "db.json");
    const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
    const savedResource = db.resources.find((item) => item.id === resource.id);
    expect(savedResource).toBeTruthy();
    savedResource.resourceType = "other";
    savedResource.conversionStatus = "not-needed";
    savedResource.pdfPath = "";
    await fs.writeFile(dbPath, JSON.stringify(db, null, 2));

    const resumed = await getResourceById(app.baseUrl, owner.token, room.id, resource.id);
    expect(resumed).toMatchObject({
      conversionStatus: "pending",
      pdfUrl: null,
      resourceType: "pptx",
    });

    const failedAgain = await waitForResourceStatus(
      app.baseUrl,
      owner.token,
      room.id,
      resource.id,
      "failed",
    );
    expect(failedAgain).toMatchObject({
      conversionStatus: "failed",
      pdfUrl: null,
      resourceType: "pptx",
    });
  });

  // Office previews generated before the server had the right document fonts
  // can be marked done while containing unreadable glyphs. Those stale previews
  // must not keep being served; loading resources should hide the old PDF and
  // queue a fresh conversion with the current pipeline.
  it("reconverts stale done Office previews instead of serving old PDFs", async () => {
    const resource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Legacy Font Worksheet.docx",
      "not a real docx, but enough to exercise stale-preview repair",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await waitForResourceStatus(app.baseUrl, owner.token, room.id, resource.id, "failed");

    const dbPath = path.join(app.dataDir, "db.json");
    const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
    const savedResource = db.resources.find((item) => item.id === resource.id);
    expect(savedResource).toBeTruthy();
    const stalePdfPath = String(savedResource.storageName).replace(/\.[^.]+$/, ".pdf");
    await fs.writeFile(path.join(process.cwd(), "apps/server/uploads", stalePdfPath), "%PDF-1.4\n% stale\n");
    savedResource.resourceType = "docx";
    savedResource.conversionStatus = "done";
    savedResource.pdfPath = stalePdfPath;
    savedResource.pdfConversionVersion = "";
    await fs.writeFile(dbPath, JSON.stringify(db, null, 2));

    const pending = await getResourceById(app.baseUrl, owner.token, room.id, resource.id);
    expect(pending).toMatchObject({
      conversionStatus: "pending",
      pdfUrl: null,
      resourceType: "docx",
    });

    const failedAgain = await waitForResourceStatus(
      app.baseUrl,
      owner.token,
      room.id,
      resource.id,
      "failed",
    );
    expect(failedAgain).toMatchObject({
      conversionStatus: "failed",
      pdfUrl: null,
      resourceType: "docx",
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

    const missingResource = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "Missing Resource", type: "document", resourceId: "res_missing" },
    });
    expect(missingResource.status).toBe(404);
    expect(missingResource.payload.message).toMatch(/resource/i);

    const missingLinkedDocument = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "No Linked Document", type: "document" },
    });
    expect(missingLinkedDocument.status).toBe(400);
    expect(missingLinkedDocument.payload.message).toMatch(/choose a supported document/i);

    const unsupportedResource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Unsupported Notes.txt",
      "Plain text is useful in resources, but not a document channel source.",
      "text/plain",
    );
    const unsupportedCreate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "Unsupported Docs", type: "document", resourceId: unsupportedResource.id },
    });
    expect(unsupportedCreate.status).toBe(400);
    expect(unsupportedCreate.payload.message).toMatch(/pdf, docx, pptx, png, jpg, jpeg, or webp/i);

    const supportedChannelResources = [
      {
        channelName: "Worksheet Docx",
        fileName: "Worksheet.docx",
        content: "docx fixture",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      {
        channelName: "Lecture Slides Pptx",
        fileName: "Lecture Slides.pptx",
        content: "pptx fixture",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      {
        channelName: "Diagram Png",
        fileName: "Diagram.png",
        content: "png fixture",
        mimeType: "image/png",
      },
      {
        channelName: "Whiteboard Jpeg",
        fileName: "Whiteboard.jpeg",
        content: "jpeg fixture",
        mimeType: "image/jpeg",
      },
      {
        channelName: "Concept Map Webp",
        fileName: "Concept Map.webp",
        content: "webp fixture",
        mimeType: "image/webp",
      },
    ];

    for (const fixture of supportedChannelResources) {
      const resource = await uploadFixtureFile(
        app.baseUrl,
        owner.token,
        room.id,
        fixture.fileName,
        fixture.content,
        fixture.mimeType,
      );
      const expectedResourceType = fixture.fileName.endsWith(".docx")
        ? "docx"
        : fixture.fileName.endsWith(".pptx")
          ? "pptx"
          : fixture.fileName.endsWith(".png") || fixture.fileName.endsWith(".jpeg") || fixture.fileName.endsWith(".webp")
            ? "image"
            : "other";
      expect(resource.resourceType).toBe(expectedResourceType);
      const created = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
        method: "POST",
        token: owner.token,
        body: { name: fixture.channelName, type: "document", resourceId: resource.id },
      });
      expect(created.status).toBe(201);
      if (fixture.fileName.endsWith(".docx") || fixture.fileName.endsWith(".pptx")) {
        expect(resource.conversionStatus).toBe("pending");
        expect(resource.pdfUrl).toBeNull();
      } else {
        expect(resource.conversionStatus).toBe("not-needed");
        expect(resource.pdfUrl).toBe(
          fixture.fileName.endsWith(".png") || fixture.fileName.endsWith(".jpeg") || fixture.fileName.endsWith(".webp")
            ? null
            : resource.fileUrl,
        );
      }
      expect(created.payload.room.channels).toContainEqual({
        name: fixture.channelName.toLowerCase().replace(/\s+/g, "-"),
        type: "document",
        resourceId: resource.id,
      });
    }

    const pdfResource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Lecture Notes.pdf",
      "%PDF-1.4\n% fixture document\n",
      "application/pdf",
    );
    expect(pdfResource).toMatchObject({
      conversionStatus: "not-needed",
      resourceType: "pdf",
    });
    expect(pdfResource.pdfUrl).toBe(pdfResource.fileUrl);
    const ownerCreate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: "Lecture Notes", type: "document", resourceId: pdfResource.id },
    });
    expect(ownerCreate.status).toBe(201);
    expect(ownerCreate.payload.channel).toBe("lecture-notes");
    expect(ownerCreate.payload.room.channels).toContainEqual({
      name: "lecture-notes",
      type: "document",
      resourceId: pdfResource.id,
    });

    const memberLayoutUpdate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channel-layout`, {
      method: "PATCH",
      token: member.token,
      body: {
        channelLayout: [
          { id: "default-text-channels", name: "Text Channels", channels: ["general"] },
          { id: "cat-documents", name: "Documents", channels: ["lecture-notes"] },
        ],
      },
    });
    expect(memberLayoutUpdate.status).toBe(403);

    const ownerLayoutUpdate = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channel-layout`, {
      method: "PATCH",
      token: owner.token,
      body: {
        channelLayout: [
          { id: "default-text-channels", name: "Text Channels", channels: ["general"] },
          { id: "cat-documents", name: "Documents", channels: ["lecture-notes"] },
        ],
      },
    });
    expect(ownerLayoutUpdate.status).toBe(200);
    expect(ownerLayoutUpdate.payload.room.channelLayout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cat-documents",
          name: "Documents",
          channels: ["lecture-notes"],
        }),
      ]),
    );

    const memberRoomView = await apiRequest(app.baseUrl, `/api/rooms/${room.id}`, {
      token: member.token,
    });
    expect(memberRoomView.status).toBe(200);
    expect(memberRoomView.payload.room.isOwner).toBe(false);
    expect(memberRoomView.payload.room.channelLayout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cat-documents",
          name: "Documents",
          channels: ["lecture-notes"],
        }),
      ]),
    );

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
    expect(ownerRename.payload.room.channels).toContainEqual({
      name: "lecture-archive",
      type: "document",
      resourceId: pdfResource.id,
    });
    expect(ownerRename.payload.room.channelLayout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cat-documents",
          channels: ["lecture-archive"],
        }),
      ]),
    );

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

  // Document channels use the same room membership boundary as chat, but their
  // annotations have finer permissions: authors own note edits, any member can
  // resolve/unresolve, and the room owner can remove obsolete annotations.
  it("supports document annotations with scoped permissions and replies", async () => {
    const channelName = "document-annotations";
    const pdfResource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Annotation Fixture.pdf",
      "%PDF-1.4\n% annotation fixture\n",
      "application/pdf",
    );
    const createChannel = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: channelName, type: "document", resourceId: pdfResource.id },
    });
    expect(createChannel.status).toBe(201);

    const outsider = await registerUser(app.baseUrl, { name: "Annotation Outsider" });
    const outsiderRead = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations`,
      { token: outsider.token },
    );
    expect(outsiderRead.status).toBe(403);

    const created = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations`,
      {
        method: "POST",
        token: member.token,
        body: {
          annotationType: "question",
          comment: "Does this definition depend on continuity?",
          content: { text: "differentiable implies continuous" },
          position: { boundingRect: { pageNumber: 2, x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.25 } },
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.payload.annotation).toMatchObject({
      annotationType: "question",
      author: { name: "Member Durin" },
      channel: channelName,
      comment: "Does this definition depend on continuity?",
      resolved: false,
      resourceId: pdfResource.id,
    });

    const annotationId = created.payload.annotation.id;
    const ownerCommentEdit = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations/${annotationId}`,
      {
        method: "PATCH",
        token: owner.token,
        body: { comment: "Owner should not rewrite the author's note." },
      },
    );
    expect(ownerCommentEdit.status).toBe(403);

    const ownerResolve = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations/${annotationId}`,
      {
        method: "PATCH",
        token: owner.token,
        body: { resolved: true },
      },
    );
    expect(ownerResolve.status).toBe(200);
    expect(ownerResolve.payload.annotation.resolved).toBe(true);
    expect(ownerResolve.payload.annotation.comment).toBe("Does this definition depend on continuity?");

    const authorEdit = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations/${annotationId}`,
      {
        method: "PATCH",
        token: member.token,
        body: { annotationType: "not-a-real-type", comment: "Clarified after reading theorem 3." },
      },
    );
    expect(authorEdit.status).toBe(200);
    expect(authorEdit.payload.annotation).toMatchObject({
      annotationType: "general",
      comment: "Clarified after reading theorem 3.",
      resolved: true,
    });

    const reply = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations/${annotationId}/replies`,
      {
        method: "POST",
        token: owner.token,
        body: { comment: "Added this to the recap checklist." },
      },
    );
    expect(reply.status).toBe(201);
    expect(reply.payload.annotation.replies).toHaveLength(1);
    expect(reply.payload.reply).toMatchObject({
      author: { name: "Owner Fleming" },
      comment: "Added this to the recap checklist.",
    });

    const listed = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations`,
      { token: owner.token },
    );
    expect(listed.status).toBe(200);
    expect(listed.payload.annotations.map((annotation) => annotation.id)).toContain(annotationId);

    const deleted = await apiRequest(
      app.baseUrl,
      `/api/rooms/${room.id}/channels/${channelName}/annotations/${annotationId}`,
      { method: "DELETE", token: owner.token },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.payload).toEqual({ id: annotationId, channel: channelName });
  });

  // The Socket.IO annotation events mirror the REST behavior used for initial
  // loads. This protects optimistic document-annotation updates from drifting
  // away from the persisted API contract.
  it("mirrors annotation create, update, and delete over the room socket", async () => {
    const channelName = "socket-annotations";
    const pdfResource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Socket Annotation Fixture.pdf",
      "%PDF-1.4\n% socket annotation fixture\n",
      "application/pdf",
    );
    const createChannel = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: channelName, type: "document", resourceId: pdfResource.id },
    });
    expect(createChannel.status).toBe(201);

    const socket = await connectRoomSocket(app.baseUrl, owner.token, room.id);

    try {
      const createdEvent = waitForSocketEvent(socket, "annotation:new");
      const createAck = await emitWithAck(socket, "annotation:create", {
        annotationType: "insight",
        channel: channelName,
        comment: "This proof links the world resource to the lecture thread.",
        content: { text: "shared context" },
        position: { pageNumber: 1 },
        roomId: room.id,
      });
      expect(createAck).toMatchObject({ ok: true });
      const createdPayload = await createdEvent;
      expect(createdPayload).toMatchObject({
        id: createAck.annotation.id,
        annotationType: "insight",
        channel: channelName,
      });

      const updatedEvent = waitForSocketEvent(socket, "annotation:updated");
      const updateAck = await emitWithAck(socket, "annotation:update", {
        annotationId: createAck.annotation.id,
        channel: channelName,
        resolved: true,
        roomId: room.id,
      });
      expect(updateAck).toMatchObject({ ok: true, annotation: { resolved: true } });
      const updatedPayload = await updatedEvent;
      expect(updatedPayload).toMatchObject({ id: createAck.annotation.id, resolved: true });

      const deletedEvent = waitForSocketEvent(socket, "annotation:deleted");
      const deleteAck = await emitWithAck(socket, "annotation:delete", {
        annotationId: createAck.annotation.id,
        channel: channelName,
        roomId: room.id,
      });
      expect(deleteAck).toMatchObject({ ok: true, id: createAck.annotation.id, channel: channelName });
      await expect(deletedEvent).resolves.toEqual({ id: createAck.annotation.id, channel: channelName });
    } finally {
      socket.disconnect();
    }
  });

  // Document channel reading presence rides on the existing room activity
  // channel. The viewer sends small page-only updates after the normal activity
  // entry exists, and the server should merge those fields into broadcasts.
  it("broadcasts document channel page numbers through room activity", async () => {
    const channelName = "reading-presence";
    const pdfResource = await uploadFixtureFile(
      app.baseUrl,
      owner.token,
      room.id,
      "Reading Presence Fixture.pdf",
      "%PDF-1.4\n% reading fixture\n",
      "application/pdf",
    );
    const createChannel = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/channels`, {
      method: "POST",
      token: owner.token,
      body: { name: channelName, type: "document", resourceId: pdfResource.id },
    });
    expect(createChannel.status).toBe(201);

    const ownerSocket = await connectRoomSocket(app.baseUrl, owner.token, room.id);
    const memberSocket = await connectRoomSocket(app.baseUrl, member.token, room.id);

    try {
      const initialState = waitForSocketEvent(memberSocket, "room:activity:state");
      const initialAck = await emitWithAck(ownerSocket, "room:activity:set", {
        profileStatus: "online",
        roomId: room.id,
        tabId: "chat",
      });
      expect(initialAck).toMatchObject({ ok: true });
      await initialState;

      const pageState = waitForSocketEvent(memberSocket, "room:activity:state");
      const pageAck = await emitWithAck(ownerSocket, "room:activity:set", {
        documentChannel: channelName,
        documentPage: 7,
      });
      expect(pageAck).toMatchObject({ ok: true });

      const pagePayload = await pageState;
      const ownerActivity = pagePayload.members.find((entry) => entry.userId === owner.user.id);
      expect(ownerActivity).toMatchObject({
        documentChannel: channelName,
        documentPage: 7,
        tabId: "chat",
      });

      const clearState = waitForSocketEvent(memberSocket, "room:activity:state");
      const clearAck = await emitWithAck(ownerSocket, "room:activity:set", {
        documentChannel: "",
        documentPage: null,
      });
      expect(clearAck).toMatchObject({ ok: true });

      const clearPayload = await clearState;
      const clearedOwnerActivity = clearPayload.members.find((entry) => entry.userId === owner.user.id);
      expect(clearedOwnerActivity).not.toHaveProperty("documentChannel");
      expect(clearedOwnerActivity).not.toHaveProperty("documentPage");
    } finally {
      ownerSocket.disconnect();
      memberSocket.disconnect();
    }
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

    const fileRead = await fetch(`${app.baseUrl}/api/resources/${upload.resource.id}/file`, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(fileRead.status).toBe(200);
    expect(fileRead.headers.get("content-type")).toContain("text/plain");
    expect(await fileRead.text()).toBe("Graph traversal notes");

    const outsider = await registerUser(app.baseUrl, { name: "Resource Outsider" });
    const outsiderFileRead = await fetch(`${app.baseUrl}/api/resources/${upload.resource.id}/file`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(outsiderFileRead.status).toBe(403);

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
    expect(listed.payload.resources.map((resource) => resource.id)).toContain(upload.resource.id);

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

  // Verifies a joined member cannot delete another user's resource. This
  // protects against a subtle but damaging collaboration bug: membership should
  // allow reading shared resources, but destructive actions belong to the owner
  // or original uploader.
  it("prevents members from deleting resources they did not upload", async () => {
    const upload = await uploadTextResource(
      app.baseUrl,
      owner.token,
      room.id,
      "Owner Only Resource.txt",
      "Only the owner or uploader should delete this",
      "Reference",
    );

    const memberDelete = await apiRequest(app.baseUrl, `/api/resources/${upload.resource.id}`, {
      method: "DELETE",
      token: member.token,
    });
    expect(memberDelete.status).toBe(403);
    expect(memberDelete.payload.message).toMatch(/cannot delete/i);

    const stillVisible = await apiRequest(app.baseUrl, `/api/rooms/${room.id}/resources`, {
      token: owner.token,
    });
    expect(stillVisible.status).toBe(200);
    expect(stillVisible.payload.resources.map((item) => item.id)).toContain(upload.resource.id);
  });
});
