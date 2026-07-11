import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountSettingsScreen from "../../apps/client/src/features/dashboard/AccountSettingsScreen.tsx";
import { api } from "../../apps/client/src/api.ts";
import {
  getActiveSupabaseSession,
  updateSupabasePassword,
} from "../../apps/client/src/supabaseAuth.ts";

vi.mock("../../apps/client/src/api.ts", () => ({
  api: {
    updateAccount: vi.fn(),
    updatePassword: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock("../../apps/client/src/supabaseAuth.ts", () => ({
  getActiveSupabaseSession: vi.fn(),
  updateSupabasePassword: vi.fn(),
}));

const user = {
  authProviders: [],
  avatarPreset: null,
  avatarUrl: "",
  email: "qa@example.com",
  emailVerified: true,
  hasPassword: true,
  id: "usr_qa",
  name: "QA User",
};

describe("AccountSettingsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("edits username only and keeps email changes disabled", async () => {
    vi.mocked(api.updateAccount).mockResolvedValue({
      user: { ...user, name: "Updated QA" },
    });
    const onUserUpdated = vi.fn();
    const tester = userEvent.setup();

    render(
      <AccountSettingsScreen
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onUserUpdated={onUserUpdated}
        user={user}
      />,
    );

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons[1]).toBeDisabled();

    await tester.click(editButtons[0]);
    const dialog = screen.getByRole("dialog", { name: "Edit Username" });
    expect(within(dialog).getByLabelText("Username")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Email Address")).not.toBeInTheDocument();

    await tester.clear(within(dialog).getByLabelText("Username"));
    await tester.type(within(dialog).getByLabelText("Username"), "Updated QA");
    await tester.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith({ name: "Updated QA" }));
    expect(onUserUpdated).toHaveBeenCalledWith({ ...user, name: "Updated QA" });
    expect(screen.queryByText("Account information updated.")).not.toBeInTheDocument();
  });

  it("sets a Supabase-backed account password before syncing the app account", async () => {
    vi.mocked(getActiveSupabaseSession).mockResolvedValue({ access_token: "supabase-token" } as any);
    vi.mocked(updateSupabasePassword).mockResolvedValue({ error: null } as any);
    vi.mocked(api.updatePassword).mockResolvedValue({
      user: { ...user, authProviders: ["supabase"], hasPassword: true },
    });
    const onUserUpdated = vi.fn();
    const tester = userEvent.setup();

    render(
      <AccountSettingsScreen
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onUserUpdated={onUserUpdated}
        user={{ ...user, authProviders: ["supabase"], hasPassword: false }}
      />,
    );

    await tester.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    const dialog = screen.getByRole("dialog", { name: "Update Password" });
    await tester.type(within(dialog).getByLabelText(/^Password/), "new-oauth-password");
    await tester.type(within(dialog).getByLabelText(/^Confirm New Password/), "new-oauth-password");
    await tester.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(updateSupabasePassword).toHaveBeenCalledWith("new-oauth-password"));
    expect(api.updatePassword).toHaveBeenCalledWith({
      currentPassword: "",
      newPassword: "new-oauth-password",
    });
    expect(onUserUpdated).toHaveBeenCalledWith({ ...user, authProviders: ["supabase"], hasPassword: true });
  });
});
