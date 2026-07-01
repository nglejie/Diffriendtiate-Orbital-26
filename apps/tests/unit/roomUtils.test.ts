import { describe, expect, it } from "vitest";
import {
  buildVisibleMembers,
  formatBytes,
  getInitial,
  resourceToAttachment,
  sessionFallsInSlot,
} from "../../client/src/shared/utils/room.ts";

describe("room shared utilities", () => {
  // Ensures the member list shown inside a room is stable and deduplicated. The
  // owner should not appear twice, regular members keep their role, and the
  // current user is appended with a clear "You" role and fallback initial.
  it("builds deduplicated member rows with owner and current-user roles", () => {
    const members = buildVisibleMembers(
      {
        owner: { id: "owner", name: "Fleming" },
        members: [{ id: "owner", name: "Fleming" }, { id: "member", email: "member@example.test" }],
      },
      { id: "guest", name: "Guest" },
    );

    expect(members.map((member) => member.role)).toEqual(["Owner", "Member", "You"]);
    expect(members.map((member) => member.initial)).toEqual(["F", "M", "G"]);
  });

  // Covers small formatting helpers shared by chat, resources, and attachments.
  // These assertions keep initials, byte sizes, and uploaded-resource attachment
  // shapes consistent wherever the same room data is displayed.
  it("formats common resource details for UI rows and attachments", () => {
    expect(getInitial("  durin")).toBe("D");
    expect(formatBytes(63)).toBe("63 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(resourceToAttachment({ id: "r1", originalName: "Notes.txt", url: "/uploads/notes.txt" })).toMatchObject({
      id: "r1",
      originalName: "Notes.txt",
      title: "Notes.txt",
    });
  });

  // Validates calendar slot placement without enabling the broken Calendar tab.
  // A session should appear only in the hour where it starts, not in adjacent
  // hour rows that happen to be on the same day.
  it("places sessions in their matching calendar hour only", () => {
    const day = new Date("2026-06-18T00:00:00+08:00");
    const session = { startsAt: "2026-06-18T14:30:00+08:00" };

    expect(sessionFallsInSlot(session, day, 14)).toBe(true);
    expect(sessionFallsInSlot(session, day, 15)).toBe(false);
  });
});
