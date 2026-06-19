import { ArrowRight, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { api } from "../../api.js";

/** Login/register screen that owns form state and delegates saved auth to App. */
function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const isRegistering = mode === "register";

  /**
   * Keeps all auth fields in one object so switching between login/register
   * preserves shared email/password input while only showing the fields needed.
   */
  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  /**
   * Uses the same submit path for login and registration, then lets App own the
   * resulting token/user state. This keeps auth storage out of the view layer.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const payload = isRegistering
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password });
      onAuthenticated(payload);
    } catch (err) {
      const isInvalidLogin =
        !isRegistering && err.message === "Invalid email or password.";
      setError(isInvalidLogin ? "Incorrect email or password. Try again." : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout flocus-auth">
      <div className="auth-logo">
        <img src="/brand/diffriendtiate-webapp-logo.png" alt="Diffriendtiate" />
      </div>

      {/* Decorative stars are kept outside the form so they never affect auth layout or tab order. */}
      <div className="auth-shooting-stars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <section className="auth-glass-panel" aria-labelledby="auth-title">
        {isRegistering ? (
          <button
            className="auth-back-button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            type="button"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        ) : null}

        <form className="auth-form flocus-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <h1 id="auth-title" className={isRegistering ? "register-title" : ""}>
              {isRegistering ? "New here?" : "Your friends are waiting!"}
            </h1>
            <p>
              {isRegistering
                ? "Create an account to start now!"
                : "Log in below."}
            </p>
          </div>

          {isRegistering ? (
            <label className="line-field">
              <span>First name</span>
              <input
                autoComplete="name"
                name="name"
                onChange={updateField}
                placeholder="First name"
                value={form.name}
              />
            </label>
          ) : null}

          <label className="line-field">
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              onChange={updateField}
              placeholder="name@example.com"
              type="email"
              value={form.email}
            />
          </label>

          <label className={error ? "line-field has-error" : "line-field"}>
            <span>Password</span>
            <div className="line-input-row">
              <input
                autoComplete={isRegistering ? "new-password" : "current-password"}
                name="password"
                onChange={updateField}
                placeholder="password"
                type={passwordVisible ? "text" : "password"}
                value={form.password}
              />
              <button
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                className="password-visibility-button"
                onClick={() => setPasswordVisible((current) => !current)}
                type="button"
              >
                {passwordVisible ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </label>

          {error ? <p className="form-error glass-error">{error}</p> : null}

          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {submitting ? "Please wait" : isRegistering ? "Let's Go" : "Head to Dashboard"}
            <ArrowRight size={18} />
          </button>

          <p className="auth-mode-copy">
            {isRegistering ? (
              <>
                Have an account?{" "}
                <button
                  className="auth-mode-link"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  type="button"
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                Don't have an account?{" "}
                <button
                  className="auth-mode-link"
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                  type="button"
                >
                  Sign up here
                </button>
              </>
            )}
          </p>
        </form>
      </section>
    </main>
  );
}

export default AuthView;
