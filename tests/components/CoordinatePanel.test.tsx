import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoordinatePanel } from "../../apps/client/src/features/room/coordinate/CoordinatePanel.tsx";

const user = {
  id: "usr_owner",
  name: "Fleming",
};

const room = {
  id: "room_coordidate",
  isOwner: true,
  members: [{ id: "usr_owner", name: "Fleming" }],
  name: "Coordidate Focus Room",
};

describe("CoordinatePanel source focus", () => {
  it("opens the week containing a cited session and highlights the exact event", async () => {
    const session = {
      id: "sess_architecture_review",
      agenda: "Review Intelligrate source navigation.",
      createdBy: "usr_owner",
      endsAt: "2026-08-14T11:00:00.000Z",
      kind: "meeting",
      location: "Scara",
      startsAt: "2026-08-14T10:00:00.000Z",
      title: "Architecture Review",
      visibility: "room",
    };

    const { container } = render(
      <CoordinatePanel
        coordinate={{ polls: [], responses: [] }}
        focusedSource={{
          sessionId: session.id,
          startsAt: session.startsAt,
          nonce: 1,
        }}
        onChanged={vi.fn()}
        onCoordinateChanged={vi.fn()}
        onError={vi.fn()}
        room={room}
        sessions={[session]}
        user={user}
      />,
    );

    await waitFor(() => {
      const focusedEvent = container.querySelector(".coordinate-event-block.source-focused");
      expect(focusedEvent).toBeInTheDocument();
      expect(focusedEvent).toHaveTextContent("Architecture Review");
    });
  });
});
