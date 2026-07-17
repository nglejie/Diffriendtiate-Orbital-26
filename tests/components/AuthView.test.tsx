import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthView from "../../apps/client/src/features/auth/AuthView.tsx";

const supabaseAuthMock = vi.hoisted(() => ({
  getActiveSupabaseSession: vi.fn(),
  isSupabaseAuthConfigured: vi.fn(() => false),
  onSupabaseAuthStateChange: vi.fn(() => () => {}),
  readSupabaseAuthTypeFromUrl: vi.fn(() => ""),
  requestSupabasePasswordReset: vi.fn(),
  resendSupabaseVerificationEmail: vi.fn(),
  signInWithSupabasePassword: vi.fn(),
  signOutSupabaseAuth: vi.fn(),
  signUpWithSupabase: vi.fn(),
  startSupabaseOAuth: vi.fn(),
  updateSupabasePassword: vi.fn(),
}));

vi.mock("../../apps/client/src/supabaseAuth.ts", () => ({
  getActiveSupabaseSession: supabaseAuthMock.getActiveSupabaseSession,
  isSupabaseAuthConfigured: supabaseAuthMock.isSupabaseAuthConfigured,
  onSupabaseAuthStateChange: supabaseAuthMock.onSupabaseAuthStateChange,
  readSupabaseAuthTypeFromUrl: supabaseAuthMock.readSupabaseAuthTypeFromUrl,
  requestSupabasePasswordReset: supabaseAuthMock.requestSupabasePasswordReset,
  resendSupabaseVerificationEmail: supabaseAuthMock.resendSupabaseVerificationEmail,
  signInWithSupabasePassword: supabaseAuthMock.signInWithSupabasePassword,
  signOutSupabaseAuth: supabaseAuthMock.signOutSupabaseAuth,
  signUpWithSupabase: supabaseAuthMock.signUpWithSupabase,
  startSupabaseOAuth: supabaseAuthMock.startSupabaseOAuth,
  updateSupabasePassword: supabaseAuthMock.updateSupabasePassword,
}));

function jsonResponse(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("AuthView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseAuthMock.isSupabaseAuthConfigured.mockReturnValue(false);
    supabaseAuthMock.onSupabaseAuthStateChange.mockReturnValue(() => {});
    supabaseAuthMock.readSupabaseAuthTypeFromUrl.mockReturnValue("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  // The onboarding panel is now the public entry point for both password and
  // provider auth, so these links must point at the app-server OAuth routes.
  it("renders provider sign-in links from the centered onboarding panel", () => {
    render(<AuthView onAuthenticated={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /google/i })).toHaveAttribute("href", "/api/auth/oauth/google");
    expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute("href", "/api/auth/oauth/github");
    expect(screen.getByRole("link", { name: /microsoft/i })).toHaveAttribute(
      "href",
      "/api/auth/oauth/microsoft",
    );
  });

  // Remember Me controls where App stores the returned JWT. AuthView forwards
  // that preference with the normal login payload instead of treating it as
  // decoration.
  it("logs in with the selected remember preference", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        token: "login-token",
        user: { id: "usr_1", email: "qa@example.com", name: "QA" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByPlaceholderText(/email address/i), "qa@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "quality-pass-123");
    await user.click(screen.getByLabelText(/remember me/i));
    await user.click(screen.getByRole("button", { name: /enter/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({
          body: JSON.stringify({ email: "qa@example.com", password: "quality-pass-123" }),
          method: "POST",
        }),
      );
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          remember: false,
          token: "login-token",
        }),
      );
    });
  });

  // Registration keeps the panel compact and relies on the API to start the
  // email-verification flow after one password entry.
  it("registers with one password field and starts email verification", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          emailVerificationRequired: true,
          message: "Check your email to verify your account.",
          user: { id: "usr_2", email: "new@example.com", name: "New User" },
        }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          emailVerificationRequired: true,
          message: "Check your email to verify your account.",
          verificationEmailSent: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={onAuthenticated} />);

    await user.click(screen.getByRole("button", { name: /register/i }));
    expect(screen.getByRole("heading", { name: /ready to create/i })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/username/i), "New User");
    await user.type(screen.getByPlaceholderText(/email address/i), "new@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "quality-pass-123");
    expect(screen.queryByPlaceholderText(/confirm password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/auth/register",
        expect.objectContaining({
          body: JSON.stringify({
            email: "new@example.com",
            name: "New User",
            password: "quality-pass-123",
          }),
          method: "POST",
        }),
      );
      expect(screen.getByRole("heading", { name: /verify email/i })).toBeInTheDocument();
      expect(onAuthenticated).not.toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/auth/email-verification/resend",
        expect.objectContaining({
          body: JSON.stringify({ email: "new@example.com" }),
          method: "POST",
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
      expect(screen.getByRole("status").querySelector("svg")).toBeInTheDocument();
      expect(onAuthenticated).not.toHaveBeenCalled();
    });
  });

  it("disables verification resend while the cooldown is active", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        emailVerificationRequired: true,
        message: "Check your email to verify your account.",
        verificationEmailSent: true,
        user: { id: "usr_2", email: "new@example.com", name: "New User" },
      }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /register/i }));
    await user.type(screen.getByPlaceholderText(/username/i), "New User");
    await user.type(screen.getByPlaceholderText(/email address/i), "new@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "quality-pass-123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /verify email/i })).toBeInTheDocument();
    });

    const resendButton = screen.getByRole("button", { name: /resend in/i });
    expect(resendButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      /if this email address can receive mail, check your email/i,
    );
  });

  it("resends Supabase verification when signup returns a duplicate fake user", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    supabaseAuthMock.isSupabaseAuthConfigured.mockReturnValue(true);
    supabaseAuthMock.signUpWithSupabase.mockResolvedValue({
      data: {
        session: null,
        user: {
          email: "existing@example.com",
          identities: [],
        },
      },
      error: null,
    });
    supabaseAuthMock.resendSupabaseVerificationEmail.mockResolvedValue({ data: {}, error: null });

    render(<AuthView onAuthenticated={onAuthenticated} />);

    await user.click(screen.getByRole("button", { name: /register/i }));
    await user.type(screen.getByPlaceholderText(/username/i), "Existing User");
    await user.type(screen.getByPlaceholderText(/email address/i), "existing@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "quality-pass-123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(supabaseAuthMock.signUpWithSupabase).toHaveBeenCalledWith({
        email: "existing@example.com",
        name: "Existing User",
        password: "quality-pass-123",
      });
      expect(supabaseAuthMock.resendSupabaseVerificationEmail).toHaveBeenCalledWith(
        "existing@example.com",
      );
      expect(screen.getByRole("heading", { name: /verify email/i })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        /if this email address can receive mail, check your email/i,
      );
      expect(onAuthenticated).not.toHaveBeenCalled();
    });
  });

  it("places registration errors above the username field", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: "Username is already taken." }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /register/i }));
    await user.type(screen.getByPlaceholderText(/username/i), "Existing User");
    await user.type(screen.getByPlaceholderText(/email address/i), "existing@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "quality-pass-123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      const username = screen.getByPlaceholderText(/username/i);

      expect(alert).toHaveTextContent(/username is already taken/i);
      expect(alert.querySelector("svg")).toBeInTheDocument();
      expect(Boolean(alert.compareDocumentPosition(username) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });
  });

  // A verification link from the user's inbox is the only path that should
  // exchange a verification token for a signed-in app session.
  it("confirms email verification from an emailed link token", async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: "Email verified. Welcome to Diffriendtiate.",
        token: "register-token",
        user: { id: "usr_2", email: "new@example.com", name: "New User" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={onAuthenticated} verificationToken="verify-token" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/email-verification/confirm",
        expect.objectContaining({
          body: JSON.stringify({ token: "verify-token" }),
          method: "POST",
        }),
      );
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          remember: true,
          token: "register-token",
        }),
      );
    });
  });

  // Forgot Password sends an email and stays on the request screen. The reset
  // form only opens after the user follows the emailed signed link.
  it("requests a password reset email without exposing a reset token in the UI", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: "If an account exists, a password reset email has been sent.",
        resetEmailSent: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    await user.type(screen.getByPlaceholderText(/email address/i), "qa@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/password-reset/request",
        expect.objectContaining({
          body: JSON.stringify({ email: "qa@example.com" }),
          method: "POST",
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);
      expect(screen.getByRole("status").querySelector("svg")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /choose new password/i })).not.toBeInTheDocument();
    });
  });

  // The reset-password route carries the token from the user's email. Only that
  // route renders the new-password form and calls the reset confirmation API.
  it("confirms a password reset from an emailed link token", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Password updated. You can log in now." }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthView onAuthenticated={vi.fn()} resetToken="reset-token" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /choose new password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/^password$/i), "new-quality-pass-123");
    expect(screen.queryByPlaceholderText(/confirm password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/auth/password-reset/confirm",
        expect.objectContaining({
          body: JSON.stringify({
            password: "new-quality-pass-123",
            token: "reset-token",
          }),
          method: "POST",
        }),
      );
      expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/password updated/i);
    });
  });
});
