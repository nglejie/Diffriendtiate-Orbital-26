import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CourseCodeCombobox,
  CreateRoomModal,
  ExploreRoomModal,
  JoinWorldDialog,
  RoomTile,
} from "../../apps/client/src/features/dashboard/DashboardComponents.tsx";
import { emptyRoomForm } from "../../apps/client/src/constants.ts";

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

    const { container } = render(
      <RoomTile
        mode="owned"
        onOpenRoom={onOpenRoom}
        onPreviewRoom={vi.fn()}
        room={{ ...room, isOwner: true }}
      />,
    );

    expect(screen.getByRole("heading", { name: room.name })).toBeInTheDocument();
    expect(screen.getByText("CS2040S")).toBeInTheDocument();
    expect(screen.getByText("Fleming")).toBeInTheDocument();
    expect(container.querySelector(".room-owner-crown")).toBeInTheDocument();

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

  it("does not show the owner crown on Explore Domains cards", () => {
    const { container } = render(
      <RoomTile
        mode="explore"
        onOpenRoom={vi.fn()}
        onPreviewRoom={vi.fn()}
        room={{ ...room, isOwner: true }}
      />,
    );

    expect(container.querySelector(".room-owner-crown")).not.toBeInTheDocument();
  });

  it("does not invent fallback tags for untagged world cards", () => {
    const { container } = render(
      <RoomTile
        mode="explore"
        onOpenRoom={vi.fn()}
        onPreviewRoom={vi.fn()}
        room={{ ...room, tags: [] }}
      />,
    );

    expect(container.querySelector(".room-card-tags")).not.toBeInTheDocument();
    expect(screen.queryByText("study")).not.toBeInTheDocument();
  });
});

describe("CourseCodeCombobox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The create-world course picker should use NUSMods data when available,
  // keep results small enough to scan, and avoid suggesting codes that do not
  // match the NUS course-code format enforced by the form.
  it("loads five relevant valid NUSMods course suggestions", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { moduleCode: "CS2040S", title: "Data Structures and Algorithms" },
          { moduleCode: "CS2100", title: "Computer Organisation" },
          { moduleCode: "CS2103T", title: "Software Engineering" },
          { moduleCode: "CS2105", title: "Introduction to Computer Networks" },
          { moduleCode: "CS2106", title: "Introduction to Operating Systems" },
          { moduleCode: "CS3230", title: "Design and Analysis of Algorithms" },
          { moduleCode: "GESS1000", title: "Invalid four-letter prefix" },
        ],
      }),
    );

    function CourseHarness() {
      const [value, setValue] = useState("");
      return (
        <label>
          Course Code
          <CourseCodeCombobox
            academicTerm="2026/2027 S1"
            onChange={(nextValue) => {
              onChange(nextValue);
              setValue(nextValue);
            }}
            options={["CS1010S", "CS1231S"]}
            value={value}
          />
        </label>
      );
    }

    render(<CourseHarness />);

    const input = screen.getByLabelText(/course code/i);
    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText("CS1010S")).not.toBeInTheDocument();

    await user.type(input, "cs2");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://api.nusmods.com/v2/2026-2027/moduleList.json",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(screen.getByText("Data Structures and Algorithms")).toBeInTheDocument();
    });

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(screen.getByText("CS2040S")).toBeInTheDocument();
    expect(screen.getByText("CS2106")).toBeInTheDocument();
    expect(screen.queryByText("CS3230")).not.toBeInTheDocument();
    expect(screen.queryByText("GESS1000")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith("CS2");
  });
});

describe("ExploreRoomModal", () => {
  // Explore previews should feel like a proper world preview instead of an old
  // generic alert. This checks the visible identity, metadata, and join action.
  it("renders a polished world preview before joining", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();

    const { container } = render(<ExploreRoomModal onClose={vi.fn()} onJoinRoom={onJoinRoom} room={room} />);

    expect(screen.getByRole("heading", { name: /^preview$/i })).toBeInTheDocument();
    expect(screen.queryByText("Explore World")).not.toBeInTheDocument();
    expect(screen.getByText(room.name)).toBeInTheDocument();
    expect(screen.queryByText("Public domain")).not.toBeInTheDocument();
    expect(screen.queryByText("Public")).not.toBeInTheDocument();
    expect(screen.getByText("CS2040S · 2026/2027 S1")).toBeInTheDocument();
    expect(container.querySelector(".world-preview-member-count")).toHaveTextContent("3");
    expect(container.querySelector(".world-preview-member-count")).not.toHaveTextContent("members");
    expect(screen.getByText("algos")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^join$/i }));
    expect(onJoinRoom).toHaveBeenCalledWith("room-1");
  });

  it("does not invent fallback tags when a previewed world has no tags", () => {
    const { container } = render(
      <ExploreRoomModal
        onClose={vi.fn()}
        onJoinRoom={vi.fn()}
        room={{ ...room, tags: [] }}
      />,
    );

    expect(container.querySelector(".world-preview-tags")).not.toBeInTheDocument();
    expect(screen.queryByText("study")).not.toBeInTheDocument();
  });
});

describe("CreateRoomModal invite join", () => {
  // Private domains are invite-only, but the invite endpoint still requires the
  // domain password. This test protects the UI path that lets members supply it.
  it("labels the invite flow as Domain and forwards the optional password", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi.fn();

    render(
      <CreateRoomModal
        academicTermOptions={["2026/2027 S1"]}
        creating={false}
        form={{ ...emptyRoomForm, academicTerm: "2026/2027 S1" }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onJoinInvite={onJoinInvite}
        onUpdateField={vi.fn()}
        setAlertMessage={vi.fn()}
        setForm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /join a domain/i }));

    expect(screen.getByRole("heading", { name: /join a domain/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /join a room/i })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/paste an invite code or link/i), "https://app.test/invites/q01CPdf9");
    await user.type(screen.getByLabelText(/domain invite password/i), "room-password");
    await user.click(screen.getByRole("button", { name: /join domain/i }));

    expect(onJoinInvite).toHaveBeenCalledWith(
      "https://app.test/invites/q01CPdf9",
      "room-password",
    );
  });
});

describe("JoinWorldDialog", () => {
  // Direct invite links should use the same dialog as the Create Domain flow,
  // with the invite code already filled so users only need to enter a password.
  it("prefills direct invite codes and submits the password", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi.fn();

    render(
      <JoinWorldDialog
        initialInviteValue="q01CPdf9"
        onBack={vi.fn()}
        onClose={vi.fn()}
        onJoinInvite={onJoinInvite}
      />,
    );

    expect(screen.getByRole("heading", { name: /join a domain/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste an invite code or link/i)).toHaveValue("q01CPdf9");

    await user.type(screen.getByLabelText(/domain invite password/i), "room-password");
    await user.click(screen.getByRole("button", { name: /join domain/i }));

    expect(onJoinInvite).toHaveBeenCalledWith("q01CPdf9", "room-password");
  });
});
