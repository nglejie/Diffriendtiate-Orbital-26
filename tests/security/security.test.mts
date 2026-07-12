import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiRequest,
  createRoom,
  registerUser,
} from "../helpers/apiClient.mts";
import { getRepoRoot, startMockChatbot, startTestApp } from "../helpers/testServer.mts";

function npmCommand(args) {
  // Run npm through the current Node executable so this security check behaves
  // consistently on Windows shells. Unix CI runners already expose npm on PATH.
  if (process.platform !== "win32") {
    return { command: "npm", args };
  }

  return {
    command: process.execPath,
    args: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args],
  };
}

describe("security checks", () => {
  let app;
  let chatbot;
  let owner;
  let member;
  let privateRoom;

  beforeAll(async () => {
    // Start an isolated app server and create a private room that exercises
    // authentication, password-gated membership, and owner-only mutation rules.
    chatbot = await startMockChatbot();
    app = await startTestApp({ chatbotUrl: chatbot.url });
    owner = await registerUser(app.baseUrl, { name: "Security Owner" });
    member = await registerUser(app.baseUrl, { name: "Security Member" });
    privateRoom = await createRoom(app.baseUrl, owner.token, {
      name: "Private Security Room",
      moduleCode: "CS2105",
      password: "room-password",
      visibility: "private",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  // Treats npm audit as a release gate for high and critical advisories. Lower
  // severity issues are not ignored forever, but this test catches urgent
  // dependency risks during the QA pass.
  it("keeps dependency audit clean for high and critical advisories", () => {
    const audit = npmCommand(["audit", "--audit-level=high"]);
    const result = spawnSync(audit.command, audit.args, {
      cwd: getRepoRoot(),
      encoding: "utf8",
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain("found 0 vulnerabilities");
  });

  // Verifies sensitive password hash fields are stripped from authenticated user
  // and room payloads. The assertion serializes the payload to catch accidental
  // leaks at any nesting level.
  it("does not return password hashes in public API payloads", async () => {
    const me = await apiRequest(app.baseUrl, "/api/auth/me", { token: owner.token });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.payload)).not.toMatch(/passwordHash|password_hash/i);

    const room = await apiRequest(app.baseUrl, `/api/rooms/${privateRoom.id}`, { token: owner.token });
    expect(room.status).toBe(200);
    expect(JSON.stringify(room.payload)).not.toMatch(/passwordHash|password_hash/i);
  });

  // Exercises the private-room access boundary. Non-members cannot read the
  // room, a wrong invite password is rejected, and the correct password grants
  // membership.
  it("blocks private rooms from non-members until the correct password is supplied", async () => {
    const blocked = await apiRequest(app.baseUrl, `/api/rooms/${privateRoom.id}`, {
      token: member.token,
    });
    expect(blocked.status).toBe(403);

    const wrongPassword = await apiRequest(app.baseUrl, `/api/invites/${privateRoom.inviteCode}/join`, {
      method: "POST",
      token: member.token,
      body: { password: "wrong" },
    });
    expect(wrongPassword.status).toBe(403);

    const joined = await apiRequest(app.baseUrl, `/api/invites/${privateRoom.inviteCode}/join`, {
      method: "POST",
      token: member.token,
      body: { password: "room-password" },
    });
    expect(joined.status).toBe(200);
    expect(joined.payload.room.isMember).toBe(true);
  });

  // Sends malformed JSON directly with fetch to verify the Express error handler
  // returns a generic client-error payload. Stack traces, parser names, and node
  // internals should not leak to clients.
  it("rejects malformed JSON without leaking stack traces", async () => {
    const response = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ message: "Malformed JSON request." });
    expect(JSON.stringify(payload)).not.toMatch(/stack|SyntaxError|node_modules|Unexpected token/i);
  });

  // Confirms membership alone does not grant room-management powers. Members
  // should be blocked from destructive room deletion and from creating channels.
  it("keeps room management mutations owner-only even for members", async () => {
    const memberDelete = await apiRequest(app.baseUrl, `/api/rooms/${privateRoom.id}`, {
      method: "DELETE",
      token: member.token,
    });
    expect(memberDelete.status).toBe(403);

    const memberChannel = await apiRequest(app.baseUrl, `/api/rooms/${privateRoom.id}/channels`, {
      method: "POST",
      token: member.token,
      body: { name: "not-allowed" },
    });
    expect(memberChannel.status).toBe(403);
  });

  // Performs a lightweight source scan for the most dangerous browser injection
  // and dynamic-code patterns. This is not a full SAST tool, but it catches
  // accidental use of raw HTML insertion or eval-style execution in app code.
  it("has no direct HTML injection or dynamic-code execution in app sources", async () => {
    const sourceRoots = [
      path.join(getRepoRoot(), "apps/client/src"),
      path.join(getRepoRoot(), "apps/server"),
    ];
    const forbidden = /dangerouslySetInnerHTML|\.innerHTML\s*=|eval\s*\(|new Function\s*\(/;
    const hits = [];

    async function scanDirectory(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (/\.(jsx?|mjs|css)$/.test(entry.name)) {
          const text = await fs.readFile(fullPath, "utf8");
          if (forbidden.test(text)) hits.push(fullPath);
        }
      }
    }

    for (const root of sourceRoots) {
      await scanDirectory(root);
    }

    expect(hits).toEqual([]);
  });
});
