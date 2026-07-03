import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetingSidebarPanel } from "./MeetingSidebarPanel.tsx";

const owner = { avatarUrl: "", email: "owner@example.com", id: "owner", name: "Fleming" };
const member = { avatarUrl: "", email: "member@example.com", id: "member", name: "Durin" };
const offline = { avatarUrl: "", email: "offline@example.com", id: "offline", name: "Ellis" };

const room = {
  inviteCode: "ROOM123",
  members: [member, offline],
  owner,
  worldConfig: {
    privateAreas: [
      { id: "area-1", name: "Nautical Huddle" },
      { id: "area-2", label: "Quiet Pairing" },
    ],
  },
};

describe("MeetingSidebarPanel", () => {
  it("shows invite, ongoing named meetings, and all room members", () => {
    // Limeets sidebar should be useful outside the current meeting: it shows all
    // ongoing meeting areas plus all members, including offline members.
    render(
      <MeetingSidebarPanel
        copyInviteLink={vi.fn()}
        currentProfileStatus="online"
        inviteCopied={false}
        meeting={{
          activeAreaId: "area-1",
          isActive: true,
          meetings: [
            { areaId: "area-1", users: [{ user: owner, userId: "owner" }] },
            { areaId: "area-2", users: [{ user: member, userId: "member" }] },
          ],
          participants: [{ user: owner, userId: "owner" }],
        }}
        room={room}
        roomActivityMembers={[{ profileStatus: "online", tabId: "space", user: owner, userId: "owner" }]}
        user={owner}
      />,
    );

    expect(screen.getByRole("button", { name: /invite/i })).toBeEnabled();
    expect(screen.getByText("Nautical Huddle")).toBeInTheDocument();
    expect(screen.getByText("Quiet Pairing")).toBeInTheDocument();
    expect(screen.getByText("Fleming")).toBeInTheDocument();
    expect(screen.getByText("Durin")).toBeInTheDocument();
    expect(screen.getByText("Ellis")).toBeInTheDocument();
  });

  it("does not duplicate profile status text beside member names", () => {
    render(
      <MeetingSidebarPanel
        copyInviteLink={vi.fn()}
        currentProfileStatus="online"
        inviteCopied={false}
        meeting={{ isActive: false, meetings: [], participants: [] }}
        room={room}
        roomActivityMembers={[{ profileStatus: "away", tabId: "buddy", user: member, userId: "member" }]}
        user={owner}
      />,
    );

    const durinRow = screen.getByText("Durin").closest("article");
    expect(durinRow).toBeTruthy();
    expect(within(durinRow!).queryByText("Idle")).not.toBeInTheDocument();
    expect(within(durinRow!).queryByText("Online")).not.toBeInTheDocument();
    expect(within(durinRow!).getByText("In Intelligrate")).toBeInTheDocument();
  });

  it("treats invisible members as offline in the member list", () => {
    render(
      <MeetingSidebarPanel
        copyInviteLink={vi.fn()}
        currentProfileStatus="online"
        inviteCopied={false}
        meeting={{ isActive: false, meetings: [], participants: [] }}
        room={room}
        roomActivityMembers={[{ profileStatus: "invisible", tabId: "space", user: member, userId: "member" }]}
        user={owner}
      />,
    );

    const durinRow = screen.getByText("Durin").closest("article");
    expect(durinRow).toHaveClass("offline");
    expect(within(durinRow!).getByText("Offline")).toBeInTheDocument();
    expect(within(durinRow!).queryByText("In World")).not.toBeInTheDocument();
  });

  it("collapses the Limeets and Members sections independently", () => {
    render(
      <MeetingSidebarPanel
        copyInviteLink={vi.fn()}
        currentProfileStatus="online"
        inviteCopied={false}
        meeting={{
          isActive: true,
          meetings: [{ areaId: "area-1", users: [{ user: owner, userId: "owner" }] }],
          participants: [],
        }}
        room={room}
        roomActivityMembers={[]}
        user={owner}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /limeets/i }));
    expect(screen.queryByText("Nautical Huddle")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    expect(screen.queryByText("Fleming")).not.toBeInTheDocument();
  });
});
