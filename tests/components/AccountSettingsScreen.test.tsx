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
    deleteLlmApiKey: vi.fn(),
    updateAccount: vi.fn(),
    updatePassword: vi.fn(),
    deleteAccount: vi.fn(),
    getLlmApiKeys: vi.fn(),
    saveLlmApiKey: vi.fn(),
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
    vi.mocked(api.getLlmApiKeys).mockResolvedValue({
      encryptionAvailable: true,
      providerCatalogAvailable: true,
      providerCatalogError: "",
      providerCatalogStale: false,
      providers: [
        {
          id: "openai",
          providerName: "OpenAI",
          defaultLabel: "OpenAI",
          defaultModel: "openai/gpt-4o-mini",
          models: ["openai/gpt-4o-mini", "openai/gpt-4o"],
        },
      ],
      keys: [],
    });
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

  it("adds and deletes an encrypted LLM API key through the shared settings dialogs", async () => {
    const firstKey = {
      id: "llmkey_openai",
      providerId: "openai",
      providerName: "OpenAI",
      label: "Project OpenAI",
      model: "openai/gpt-4o-mini",
      keyPreview: "sk-t...7890",
    };
    const secondKey = {
      id: "llmkey_openai_gpt4o",
      providerId: "openai",
      providerName: "OpenAI",
      label: "OpenAI",
      model: "openai/gpt-4o",
      keyPreview: "sk-t...7890",
    };
    vi.mocked(api.saveLlmApiKey)
      .mockResolvedValueOnce({
      key: {
        ...firstKey,
      },
        keys: [firstKey],
      })
      .mockResolvedValueOnce({
        key: secondKey,
        keys: [secondKey, firstKey],
      });
    vi.mocked(api.deleteLlmApiKey).mockResolvedValue({ keys: [secondKey] });
    const tester = userEvent.setup();

    render(
      <AccountSettingsScreen
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onUserUpdated={vi.fn()}
        user={user}
      />,
    );

    await tester.click(screen.getByRole("button", { name: /llm api keys/i }));
    await waitFor(() => expect(api.getLlmApiKeys).toHaveBeenCalled());
    await tester.click(screen.getByRole("button", { name: /2 variants available/i }));

    const dialog = screen.getByRole("dialog", { name: "Edit OpenAI" });
    expect(within(dialog).getByLabelText("Provider")).toHaveValue("OpenAI");
    await tester.type(within(dialog).getByLabelText("Display Name"), "Project OpenAI");
    await tester.type(
      within(dialog).getByLabelText(/api key/i, { selector: "input" }),
      "sk-test-secret-1234567890",
    );
    await tester.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(api.saveLlmApiKey).toHaveBeenCalledWith({
        id: "",
        providerId: "openai",
        label: "Project OpenAI",
        model: "openai/gpt-4o-mini",
        apiKey: "sk-test-secret-1234567890",
        reuseKeyId: "",
      }),
    );
    expect(await screen.findByText("Project OpenAI")).toBeInTheDocument();
    expect(screen.queryByText(/sk-t/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add another model/i })).not.toBeInTheDocument();

    await tester.click(screen.getByRole("button", { name: /add openai model/i }));
    const addModelDialog = screen.getByRole("dialog", { name: "Edit OpenAI" });
    expect(within(addModelDialog).getByLabelText(/api key/i, { selector: "input" })).toBeInTheDocument();
    expect(within(addModelDialog).queryByLabelText("Credential")).not.toBeInTheDocument();
    expect(within(addModelDialog).queryByText(/saved credential/i)).not.toBeInTheDocument();

    await tester.click(within(addModelDialog).getByRole("button", { name: "Model or Variant" }));
    await tester.click(screen.getByRole("option", { name: "gpt-4o" }));
    await tester.type(
      within(addModelDialog).getByLabelText(/api key/i, { selector: "input" }),
      "sk-test-secret-gpt4o",
    );
    await tester.click(within(addModelDialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(api.saveLlmApiKey).toHaveBeenLastCalledWith({
        id: "",
        providerId: "openai",
        label: "",
        model: "openai/gpt-4o",
        apiKey: "sk-test-secret-gpt4o",
        reuseKeyId: "",
      }),
    );
    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();

    await tester.click(screen.getByRole("button", { name: /project openai/i }));
    const connectedDialog = screen.getByRole("dialog", { name: "Edit OpenAI" });
    await tester.click(within(connectedDialog).getByRole("button", { name: /disconnect/i }));
    await tester.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.deleteLlmApiKey).toHaveBeenCalledWith("llmkey_openai"));
  });
});
