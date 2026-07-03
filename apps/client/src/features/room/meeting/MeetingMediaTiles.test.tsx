import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeetingDisplayStage,
  MeetingMediaStrip,
  buildMeetingTiles,
} from "./MeetingMediaTiles.tsx";

function fakeStream(live = true) {
  return {
    getVideoTracks: () => [{ readyState: live ? "live" : "ended" }],
  };
}

const user = { id: "user-a", name: "Fleming" };

function activeMeeting(overrides = {}) {
  return {
    activeAreaId: "area-1",
    deafened: false,
    isActive: true,
    localStream: fakeStream(),
    participants: [
      { media: { cameraOff: false, muted: true, screenSharing: true }, user, userId: "user-a" },
      { media: { cameraOff: true, muted: true, screenSharing: true }, user: { id: "user-b", name: "Durin" }, userId: "user-b" },
    ],
    remoteScreenStreams: { "user-b": fakeStream() },
    remoteStreams: { "user-b": fakeStream() },
    screenSharing: true,
    screenStream: fakeStream(),
    ...overrides,
  };
}

describe("MeetingMediaTiles", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
  });

  it("renders camera and screen share as separate meeting tiles", () => {
    // Screen sharing must not replace the member camera tile; late joiners need
    // both tracks represented so renegotiation has a stable target.
    const tiles = buildMeetingTiles(activeMeeting(), user);

    expect(tiles.map((tile) => tile.id)).toEqual([
      "camera:user-a",
      "camera:user-b",
      "screen:user-a",
      "screen:user-b",
    ]);
    expect(tiles.filter((tile) => tile.kind === "screen")).toHaveLength(2);
  });

  it("does not render media UI when the user is outside a meeting", () => {
    expect(buildMeetingTiles({ isActive: false }, user)).toEqual([]);
  });

  it("opens Limeets when the compact meeting strip is clicked", () => {
    const onOpen = vi.fn();
    render(<MeetingMediaStrip meeting={activeMeeting()} onOpen={onOpen} user={user} />);

    fireEvent.click(screen.getByTitle("Open Limeets"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Show next meeting tile")).toBeInTheDocument();
  });

  it("uses a named meeting area and exposes a maximise control in the expanded stage", () => {
    render(<MeetingDisplayStage meeting={activeMeeting()} meetingAreaName="Nautical Huddle" user={user} />);

    expect(screen.getByText("Nautical Huddle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximise/i })).toBeInTheDocument();
    expect(screen.getByText("Fleming screen")).toBeInTheDocument();
    expect(screen.getByText("Durin screen")).toBeInTheDocument();
  });
});
