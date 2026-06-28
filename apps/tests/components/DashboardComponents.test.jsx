import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomTile } from "../../client/src/features/dashboard/DashboardComponents.jsx";

const room = {
  id: "room-1",
  name: "AY26/27 S1 CS2040S",
  moduleCode: "CS2040S",
  academicTerm: "2026/2027 S1",
  owner: { name: "Fleming" },
  memberCount: 3,
  visibility: "public",
  tags: ["algos", "code"],
  theme: "twilight",
  background: "clouds",
};

describe("RoomTile", () => {
  // Owned room cards are the user's main way back into active study rooms. This
  // test checks the tile exposes the important identity details and calls the
  // open-room handler when clicked.
  it("renders readable room identity and opens owned rooms", async () => {
    const user = userEvent.setup();
    const onOpenRoom = vi.fn();

    render(<RoomTile mode="owned" onOpenRoom={onOpenRoom} onPreviewRoom={vi.fn()} room={room} />);

    expect(screen.getByRole("heading", { name: room.name })).toBeInTheDocument();
    expect(screen.getByText("CS2040S")).toBeInTheDocument();
    expect(screen.getByText("Fleming")).toBeInTheDocument();

    await user.click(screen.getByRole("button"));
    expect(onOpenRoom).toHaveBeenCalledWith("room-1");
  });

  // Explore cards should preview a room before joining/opening it. This guards
  // against accidentally reusing owned-room click behavior for discoverable
  // rooms in the Explore Rooms tab.
  it("previews explore cards instead of entering them immediately", async () => {
    const user = userEvent.setup();
    const onPreviewRoom = vi.fn();

    render(<RoomTile mode="explore" onOpenRoom={vi.fn()} onPreviewRoom={onPreviewRoom} room={room} />);

    await user.click(screen.getByRole("button"));
    expect(onPreviewRoom).toHaveBeenCalledWith(room);
  });
});
