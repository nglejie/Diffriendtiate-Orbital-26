import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TopBar from "../../apps/client/src/features/dashboard/TopBar.tsx";
import { THEME_MODES } from "../../apps/client/src/theme.ts";

describe("TopBar", () => {
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
      />,
    );

    await user.click(screen.getByRole("button", { name: /account/i }));
    await user.click(screen.getByRole("button", { name: /switch to light mode/i }));

    expect(onThemeChange).toHaveBeenCalledWith(THEME_MODES.light);
  });

  // Verifies Create Room stays as a direct dashboard action and does not get
  // hidden behind the Account menu or another wrapper. This protects the main
  // dashboard entry point after button restyling.
  it("keeps create room as a direct dashboard action", async () => {
    const user = userEvent.setup();
    const onCreateRoom = vi.fn();

    render(
      <TopBar
        onCreateRoom={onCreateRoom}
        onLogout={vi.fn()}
        onThemeChange={vi.fn()}
        themeMode={THEME_MODES.light}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create room/i }));

    expect(onCreateRoom).toHaveBeenCalledTimes(1);
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
