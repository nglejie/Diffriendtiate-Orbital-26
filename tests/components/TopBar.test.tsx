import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TopBar from "../../apps/client/src/features/dashboard/TopBar.tsx";
import { THEME_MODES } from "../../apps/client/src/theme.ts";

describe("TopBar", () => {
  const userProfile = {
    avatarUrl: "data:image/png;base64,iVBORw0KGgo=",
    email: "test@example.test",
    id: "user-1",
    name: "Test User",
  };

  // Exercises the Account popup path used by logged-in users. The test opens
  // the menu and clicks the theme toggle, proving the TopBar asks the app shell
  // to switch from dark to light mode.
  it("opens account actions and toggles theme mode", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();

    render(
      <TopBar
        onCreateRoom={vi.fn()}
        onLogout={vi.fn()}
        onThemeChange={onThemeChange}
        themeMode={THEME_MODES.dark}
        user={userProfile}
      />,
    );

    await user.click(screen.getByRole("button", { name: /account/i }));
    await user.click(screen.getByRole("button", { name: /switch to light mode/i }));

    expect(onThemeChange).toHaveBeenCalledWith(THEME_MODES.light);
  });

  // Verifies Create Domain stays as a direct dashboard action and does not get
  // hidden behind the Account menu or another wrapper. This protects the main
  // dashboard entry point after button restyling.
  it("keeps create domain as a direct dashboard action", async () => {
    const user = userEvent.setup();
    const onCreateRoom = vi.fn();

    render(
      <TopBar
        onCreateRoom={onCreateRoom}
        onLogout={vi.fn()}
        onThemeChange={vi.fn()}
        themeMode={THEME_MODES.light}
        user={userProfile}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create domain/i }));

    expect(onCreateRoom).toHaveBeenCalledTimes(1);
  });

  // The top bar account trigger should be just the user's profile picture, but
  // still have an accessible label for keyboard and screen reader users.
  it("uses the user profile picture as the account trigger", () => {
    const { container } = render(
      <TopBar
        onCreateRoom={vi.fn()}
        onLogout={vi.fn()}
        onThemeChange={vi.fn()}
        themeMode={THEME_MODES.light}
        user={userProfile}
      />,
    );

    expect(screen.getByRole("button", { name: /account menu for test user/i })).toBeInTheDocument();
    expect(container.querySelector(".dashboard-account-avatar img")).toBeInTheDocument();
  });

  // Dashboard Profile should reuse the same editor surfaced from the in-world
  // profile controls, while Settings opens the full account settings surface.
  it("opens the shared profile editor and account settings", async () => {
    const user = userEvent.setup();

    render(
      <TopBar
        onCreateRoom={vi.fn()}
        onLogout={vi.fn()}
        onThemeChange={vi.fn()}
        themeMode={THEME_MODES.dark}
        user={userProfile}
      />,
    );

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /settings/i }));
    expect(screen.getByRole("dialog", { name: /^account$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close account settings/i }));

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /^profile$/i }));

    const editor = screen.getByRole("dialog", { name: /edit profile/i });
    expect(editor).toBeInTheDocument();
    expect(editor.closest(".top-bar")).toBeNull();
    expect(screen.getByLabelText(/username/i)).toHaveValue("Test User");
  });

  // Checks outside-click dismissal for the Account popup. Popups throughout the
  // app are expected to close when focus moves elsewhere, so this prevents the
  // account menu from lingering over the dashboard.
  it("closes the account menu when the user clicks outside", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <TopBar
          onCreateRoom={vi.fn()}
          onLogout={vi.fn()}
          onThemeChange={vi.fn()}
          themeMode={THEME_MODES.dark}
          user={userProfile}
        />
        <button type="button">Outside target</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.getByRole("menu", { name: /account menu/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /outside target/i }));
    expect(screen.queryByRole("menu", { name: /account menu/i })).not.toBeInTheDocument();
  });
});
