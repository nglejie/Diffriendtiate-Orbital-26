import { ArrowRight, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function formatClockTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

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
  const [displayTime, setDisplayTime] = useState(formatClockTime);

  const isRegistering = mode === "register";

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDisplayTime(formatClockTime());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

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
        <span>Diffriendtiate</span>
        <small>shape your study space</small>
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

        <div className="auth-clock" aria-hidden="true">
          {displayTime}
        </div>

        <form className="auth-form flocus-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <h1 id="auth-title" className={isRegistering ? "register-title" : ""}>
              {isRegistering ? "Ready to Start Learning?" : "Welcome Back!"}
            </h1>
            <p>
              {isRegistering
                ? "Create to start studying with your friends."
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
                placeholder="first name"
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

          <button
            className="auth-mode-link"
            onClick={() => {
              setMode(isRegistering ? "login" : "register");
              setError("");
            }}
            type="button"
          >
            {isRegistering ? (
              <>
                Have an account? <span>Log in</span>
              </>
            ) : (
              <>
                Don't have an account? <span>Sign up here.</span>
              </>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}

export default AuthView;
