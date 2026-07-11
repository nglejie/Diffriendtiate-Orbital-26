import {
  ChevronRight,
  CircleX,
  Eye,
  EyeOff,
  Info,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PiStarFourFill } from "react-icons/pi";
import { api, getOAuthUrl } from "../../api.ts";
import {
  getActiveSupabaseSession,
  isSupabaseAuthConfigured,
  onSupabaseAuthStateChange,
  readSupabaseAuthTypeFromUrl,
  requestSupabasePasswordReset,
  resendSupabaseVerificationEmail,
  signInWithSupabasePassword,
  signUpWithSupabase,
  startSupabaseOAuth,
  updateSupabasePassword,
} from "../../supabaseAuth.ts";

const SOCIAL_PROVIDERS = [
  { id: "google", label: "Google", logo: "/brand/auth-logo-google.png" },
  { id: "github", label: "GitHub", logo: "/brand/auth-logo-github.png" },
  { id: "microsoft", label: "Microsoft", logo: "/brand/auth-logo-microsoft.png" },
];

function appendMailboxHint(message, payload) {
  return payload?.mailboxUrl ? `${message} Local inbox: ${payload.mailboxUrl}` : message;
}

/** Login/register screen that owns form state and delegates saved auth to App. */
function AuthView({ initialError = "", onAuthenticated, resetToken = "", verificationToken = "" }) {
  const [mode, setMode] = useState(verificationToken ? "verify" : resetToken ? "reset" : "login");
  const [activeResetToken, setActiveResetToken] = useState(resetToken);
  const [activeVerificationToken, setActiveVerificationToken] = useState(verificationToken);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
  });
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const completingSupabaseSession = useRef(false);

  const usesSupabaseAuth = isSupabaseAuthConfigured();
  const isRegistering = mode === "register";
  const isForgotPassword = mode === "forgot";
  const isResetPassword = mode === "reset";
  const isVerifyingEmail = mode === "verify";
  const showPasswordFields = !isForgotPassword && !isVerifyingEmail;
  const showSocialAuth = !isForgotPassword && !isResetPassword && !isVerifyingEmail;

  useEffect(() => {
    setError(initialError || "");
  }, [initialError]);

  useEffect(() => {
    if (!resetToken) return;
    setActiveResetToken(resetToken);
    setMode("reset");
    setError("");
    setNotice("");
  }, [resetToken]);

  useEffect(() => {
    if (!verificationToken) return;
    if (usesSupabaseAuth) return;
    let active = true;
    setActiveVerificationToken(verificationToken);
    setMode("verify");
    setError("");
    setNotice("Verifying your email...");
    setSubmitting(true);

    api
      .confirmEmailVerification({ token: verificationToken })
      .then((payload) => {
        if (active) onAuthenticated({ ...payload, remember: true });
      })
      .catch((err) => {
        if (!active) return;
        setNotice("");
        setError(err.message || "Verification link is invalid or expired.");
      })
      .finally(() => {
        if (active) setSubmitting(false);
      });

    return () => {
      active = false;
    };
  }, [onAuthenticated, usesSupabaseAuth, verificationToken]);

  useEffect(() => {
    if (!usesSupabaseAuth) return undefined;

    if (readSupabaseAuthTypeFromUrl() === "recovery") {
      setMode("reset");
      setActiveResetToken("supabase-recovery");
      setNotice("Choose a new password to finish resetting your account.");
    }

    return onSupabaseAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY") return;
      setMode("reset");
      setActiveResetToken("supabase-recovery");
      setError("");
      setNotice("Choose a new password to finish resetting your account.");
    });
  }, [usesSupabaseAuth]);

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPasswordVisible(false);
    if (nextMode !== "reset") {
      setActiveResetToken("");
      setForm((current) => ({
        ...current,
        password: "",
      }));
    }
    if (nextMode !== "verify") {
      setActiveVerificationToken("");
    }
  }

  function title() {
    if (isRegistering) return "Ready to Create?";
    if (isForgotPassword) return "Reset Password";
    if (isResetPassword) return "Choose New Password";
    if (isVerifyingEmail) return "Verify Email";
    return "Welcome Back";
  }

  function description() {
    if (isRegistering) {
      return (
        <>
          Create an account to study, chat, and learn with others.
        </>
      );
    }

    if (isForgotPassword) {
      return "Enter your email address and we will prepare a reset link.";
    }

    if (isResetPassword) {
      return "Create a new password for your study domain.";
    }

    if (isVerifyingEmail) {
      return "Confirm your email address before entering your study domain.";
    }

    return (
      <>
        Step back into your study domain.
      </>
    );
  }

  async function handleForgotPassword() {
    const email = form.email.trim();
    if (!email) {
      setError("Email Address is required.");
      return;
    }

    if (usesSupabaseAuth) {
      const { error: resetError } = await requestSupabasePasswordReset(email);
      if (resetError) throw resetError;
      setNotice("If an account exists, a password reset email has been sent.");
      return;
    }

    const payload = await api.requestPasswordReset({ email });
    const message = payload.resetEmailSent
      ? "Check your email for a reset link."
      : payload.message || "If an account exists, password reset instructions are available.";
    setNotice(appendMailboxHint(message, payload));
  }

  async function handleResetPassword() {
    if (!activeResetToken) {
      setError("Reset link is missing. Please request a new one.");
      return;
    }

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (usesSupabaseAuth) {
      const { error: updateError } = await updateSupabasePassword(form.password);
      if (updateError) throw updateError;

      const session = await getActiveSupabaseSession();
      if (!session?.access_token) {
        setMode("login");
        setNotice("Password updated. You can log in now.");
        return;
      }

      await completeSupabaseSession(session, true);
      return;
    }

    const payload = await api.resetPassword({
      password: form.password,
      token: activeResetToken,
    });
    setForm((current) => ({
      ...current,
      password: "",
    }));
    setMode("login");
    setActiveResetToken("");
    setNotice(payload.message || "Password updated. You can log in now.");
  }

  function showEmailVerification(payload, email = form.email) {
    setActiveVerificationToken("");
    setForm((current) => ({
      ...current,
      email: email || current.email,
      password: "",
    }));
    setMode("verify");
    setNotice(
      appendMailboxHint(
        payload.verificationEmailSent
          ? "Check your email for a verification link."
          : payload.message || "Email verification is ready.",
        payload,
      ),
    );
  }

  async function handleResendEmailVerification() {
    const email = form.email.trim();
    if (!email) {
      setError("Email Address is required.");
      return;
    }

    if (usesSupabaseAuth) {
      const { error: resendError } = await resendSupabaseVerificationEmail(email);
      if (resendError) throw resendError;
      setNotice("Check your email for a verification link.");
      setMode("verify");
      return;
    }

    const payload = await api.resendEmailVerification({ email });
    if (payload.emailVerificationRequired === false) {
      setMode("login");
      setNotice(payload.message || "Email address is already verified. You can log in.");
      return;
    }

    showEmailVerification(payload, email);
  }

  async function handleConfirmEmailVerification() {
    if (usesSupabaseAuth) {
      await handleResendEmailVerification();
      return;
    }

    if (!activeVerificationToken) {
      await handleResendEmailVerification();
      return;
    }

    const payload = await api.confirmEmailVerification({ token: activeVerificationToken });
    onAuthenticated({ ...payload, remember });
  }

  async function completeSupabaseSession(session, rememberSession = remember) {
    if (!session?.access_token || completingSupabaseSession.current) return;

    completingSupabaseSession.current = true;
    try {
      const payload = await api.completeSupabaseSession({
        accessToken: session.access_token,
        name: form.name,
      });
      onAuthenticated({ ...payload, remember: rememberSession });
    } finally {
      completingSupabaseSession.current = false;
    }
  }

  async function handleSupabaseSubmit() {
    if (isRegistering) {
      const name = form.name.trim();
      const email = form.email.trim();
      if (!name || !email || form.password.length < 6) {
        setError("Username, Email Address, and a password of at least 6 characters are required.");
        return;
      }

      const { data, error: signUpError } = await signUpWithSupabase({
        email,
        name,
        password: form.password,
      });
      if (signUpError) throw signUpError;

      if (data.session) {
        await completeSupabaseSession(data.session);
        return;
      }

      setForm((current) => ({
        ...current,
        email,
        password: "",
      }));
      setMode("verify");
      setNotice("Check your email for a verification link.");
      return;
    }

    const { data, error: signInError } = await signInWithSupabasePassword({
      email: form.email.trim(),
      password: form.password,
    });

    if (signInError) {
      if (/confirm|verified|verification/i.test(signInError.message)) {
        setMode("verify");
        setNotice("Check your email for a verification link before logging in.");
        return;
      }
      throw signInError;
    }

    if (!data.session) {
      setMode("verify");
      setNotice("Check your email for a verification link before logging in.");
      return;
    }

    await completeSupabaseSession(data.session);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (isForgotPassword) {
      setSubmitting(true);
      try {
        await handleForgotPassword();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isVerifyingEmail) {
      setSubmitting(true);
      try {
        await handleConfirmEmailVerification();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isResetPassword) {
      setSubmitting(true);
      try {
        await handleResetPassword();
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);

    try {
      if (usesSupabaseAuth) {
        await handleSupabaseSubmit();
        return;
      }

      const payload = isRegistering
        ? await api.register({
            email: form.email,
            name: form.name,
            password: form.password,
          })
        : await api.login({ email: form.email, password: form.password });
      if (payload.emailVerificationRequired) {
        showEmailVerification(payload, form.email);
        return;
      }
      onAuthenticated({ ...payload, remember });
    } catch (err) {
      if (err.emailVerificationRequired) {
        showEmailVerification(err, err.email || form.email);
        return;
      }
      const isInvalidLogin =
        !isRegistering && err.message === "Invalid email or password.";
      setError(isInvalidLogin ? "Incorrect email or password. Try again." : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout diffriendtiate-auth-shell">
      <div className="auth-shooting-stars" aria-hidden="true">
        <span><PiStarFourFill /></span>
        <span><PiStarFourFill /></span>
        <span><PiStarFourFill /></span>
        <span><PiStarFourFill /></span>
        <span><PiStarFourFill /></span>
        <span><PiStarFourFill /></span>
      </div>

      <section className="auth-onboarding-panel" aria-labelledby="auth-title">
        <div className="auth-brand-lockup">
          <img
            className="auth-brand-logo auth-brand-logo-light"
            src="/brand/diffriendtiate-domain-logo-light.png"
            alt="Diffriendtiate"
          />
          <img
            className="auth-brand-logo auth-brand-logo-dark"
            src="/brand/diffriendtiate-domain-logo-dark.png"
            alt="Diffriendtiate"
          />
        </div>

        <div className="auth-ornament" aria-hidden="true">
          <span />
          <PiStarFourFill />
          <span />
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-copy">
            <h1 id="auth-title">{title()}</h1>
            <p>{description()}</p>
          </div>

          <div className="auth-field-stack">
            {error ? (
              <div className="form-error auth-error" role="alert">
                <CircleX size={18} aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}
            {notice ? (
              <div className="form-success auth-notice" role="status">
                <Info size={18} aria-hidden="true" />
                <p>{notice}</p>
              </div>
            ) : null}

            {isRegistering ? (
              <label className="auth-field">
                <span className="auth-field-label">Username</span>
                <UserRound size={20} aria-hidden="true" />
                <input
                  autoComplete="username"
                  name="name"
                  onChange={updateField}
                  placeholder="Username"
                  value={form.name}
                />
              </label>
            ) : null}

            {!isResetPassword ? (
              <label className="auth-field">
                <span className="auth-field-label">Email Address</span>
                <Mail size={20} aria-hidden="true" />
                <input
                  autoComplete="email"
                  name="email"
                  onChange={updateField}
                  placeholder="Email Address"
                  type="email"
                  value={form.email}
                />
              </label>
            ) : null}

            {showPasswordFields ? (
              <label className={error ? "auth-field has-error" : "auth-field"}>
                <span className="auth-field-label">Password</span>
                <LockKeyhole size={20} aria-hidden="true" />
                <input
                  autoComplete={isRegistering || isResetPassword ? "new-password" : "current-password"}
                  name="password"
                  onChange={updateField}
                  placeholder="Password"
                  type={passwordVisible ? "text" : "password"}
                  value={form.password}
                />
                <button
                  aria-label={passwordVisible ? "Hide Password" : "Show Password"}
                  className="password-visibility-button"
                  onClick={() => setPasswordVisible((current) => !current)}
                  type="button"
                >
                  {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </label>
            ) : null}

          </div>

          {mode === "login" ? (
            <div className="auth-options-row">
              <label className="auth-checkbox">
                <input
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  type="checkbox"
                />
                <span className="auth-checkbox-box" aria-hidden="true" />
                <span>Remember Me</span>
              </label>

              <button
                className="auth-forgot-link"
                onClick={() => switchMode("forgot")}
                type="button"
              >
                Forgot Password?
              </button>
            </div>
          ) : null}

          {isVerifyingEmail && activeVerificationToken ? (
            <div className="auth-options-row auth-verification-actions">
              <button
                className="auth-forgot-link"
                onClick={async () => {
                  setError("");
                  setNotice("");
                  setSubmitting(true);
                  try {
                    await handleResendEmailVerification();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                type="button"
              >
                Resend Verification Email
              </button>
            </div>
          ) : null}

          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {submitting
              ? "Please Wait"
              : isRegistering
                ? "Create Account"
                : isForgotPassword
                  ? "Send Reset Link"
                  : isResetPassword
                    ? "Update Password"
                    : isVerifyingEmail
                      ? activeVerificationToken
                        ? "Verify Email"
                        : "Resend Verification Email"
                    : "Enter"}
          </button>

          {showSocialAuth ? (
            <>
              <div className="auth-social-divider" aria-hidden="true">
                <span />
                <strong>Or</strong>
                <span />
              </div>

              <div className="auth-social-grid" aria-label="Social Sign-In Options">
                {SOCIAL_PROVIDERS.map((provider) => (
                  usesSupabaseAuth ? (
                    <button
                      className="auth-social-button"
                      data-provider={provider.id}
                      key={provider.id}
                      onClick={async () => {
                        setError("");
                        setSubmitting(true);
                        try {
                          await startSupabaseOAuth(provider.id);
                        } catch (err) {
                          setError(err.message || `${provider.label} sign-in could not be started.`);
                          setSubmitting(false);
                        }
                      }}
                      type="button"
                    >
                      <img
                        alt=""
                        aria-hidden="true"
                        className="auth-social-logo"
                        src={provider.logo}
                      />
                      <span>{provider.label}</span>
                    </button>
                  ) : (
                    <a
                      className="auth-social-button"
                      data-provider={provider.id}
                      href={getOAuthUrl(provider.id)}
                      key={provider.id}
                    >
                    <img
                      alt=""
                      aria-hidden="true"
                      className="auth-social-logo"
                      src={provider.logo}
                    />
                    <span>{provider.label}</span>
                    </a>
                  )
                ))}
              </div>
            </>
          ) : null}

          <p className="auth-mode-copy">
            {isRegistering
              ? "Already have an account? "
              : isForgotPassword
                ? "Remembered it? "
                : isResetPassword
                  ? "Back to "
                  : isVerifyingEmail
                    ? "Back to "
                  : "New here? "}
            <button
              className="auth-mode-link"
              onClick={() => switchMode(isRegistering || isForgotPassword || isResetPassword || isVerifyingEmail ? "login" : "register")}
              type="button"
            >
              {isRegistering || isForgotPassword || isResetPassword || isVerifyingEmail ? "Log In" : "Register"}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}

export default AuthView;
