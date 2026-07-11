import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditProfileDialog,
  UserProfileControls,
  getStoredProfileStatus,
  normalizeProfileStatus,
} from "./UserProfileControls.tsx";

const user = {
  avatarUrl: "",
  email: "flemingsiow@gmail.com",
  id: "user-1",
  name: "Fleming",
};

describe("UserProfileControls", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes unknown profile statuses to invisible", () => {
    expect(normalizeProfileStatus("online")).toBe("online");
    expect(normalizeProfileStatus("away")).toBe("away");
    expect(normalizeProfileStatus("nonsense")).toBe("invisible");
  });

  it("defaults stored profile status to online for a fresh browser", () => {
    expect(getStoredProfileStatus()).toBe("online");
  });

  it("opens the profile popover with identity, edit profile, and current status", () => {
    render(<UserProfileControls statusText="In World" user={user} profileStatus="online" />);

    const profileButton = screen.getByRole("button", { name: /fleming/i });
    expect(profileButton).not.toHaveAttribute("data-tooltip");
    expect(profileButton).not.toHaveAttribute("title");

    fireEvent.click(profileButton);

    expect(screen.getByText("flemingsiow@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit profile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /current status: online/i })).toBeInTheDocument();
  });

  it("updates status through the right-side status menu and persists it locally", () => {
    const onProfileStatusChange = vi.fn();
    render(
      <UserProfileControls
        onProfileStatusChange={onProfileStatusChange}
        statusText="In World"
        user={user}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fleming/i }));
    fireEvent.click(screen.getByRole("button", { name: /current status: online/i }));
    fireEvent.click(screen.getByRole("button", { name: "Idle" }));

    expect(onProfileStatusChange).toHaveBeenCalledWith("away");
    expect(localStorage.getItem("diffriendtiate_profile_status")).toBe("away");
  });

  it("closes the profile popover when clicking outside it", () => {
    render(
      <div>
        <UserProfileControls statusText="In World" user={user} profileStatus="online" />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /fleming/i }));
    expect(screen.getByRole("button", { name: /edit profile/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("button", { name: /edit profile/i })).not.toBeInTheDocument();
  });

  it("renders named profile picture and avatar edit controls", () => {
    render(<EditProfileDialog onClose={vi.fn()} user={user} />);

    expect(screen.getByRole("button", { name: /change profile picture/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change limeets avatar/i })).toBeInTheDocument();
  });
});
