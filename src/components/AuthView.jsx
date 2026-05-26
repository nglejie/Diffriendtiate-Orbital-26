import { KeyRound, LogIn, Mail, User } from "lucide-react";
import { useState } from "react";
import { api } from "../api.js";

function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegistering = mode === "register";

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
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="brand-lockup">
          <span className="brand-mark">D</span>
          <div>
            <p className="eyebrow">NUS Orbital 2026</p>
            <h1>Diffriendtiate</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <h2>{isRegistering ? "Create Account" : "Welcome Back"}</h2>
            <p>One room for every module.</p>
          </div>

          {isRegistering ? (
            <label className="field">
              <span>Name</span>
              <div className="input-shell">
                <User size={18} />
                <input
                  autoComplete="name"
                  name="name"
                  onChange={updateField}
                  placeholder="Your name"
                  value={form.name}
                />
              </div>
            </label>
          ) : null}

          <label className="field">
            <span>Email</span>
            <div className="input-shell">
              <Mail size={18} />
              <input
                autoComplete="email"
                name="email"
                onChange={updateField}
                placeholder="name@example.com"
                type="email"
                value={form.email}
              />
            </div>
          </label>

          <label className="field">
            <span>Password</span>
            <div className="input-shell">
              <KeyRound size={18} />
              <input
                autoComplete={isRegistering ? "new-password" : "current-password"}
                name="password"
                onChange={updateField}
                placeholder="At least 6 characters"
                type="password"
                value={form.password}
              />
            </div>
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" disabled={submitting} type="submit">
            <LogIn size={18} />
            {submitting ? "Please wait" : isRegistering ? "Register" : "Log In"}
          </button>
        </form>

        <button
          className="text-button"
          onClick={() => {
            setMode(isRegistering ? "login" : "register");
            setError("");
          }}
          type="button"
        >
          {isRegistering ? "Use an existing account" : "Create a new account"}
        </button>
      </section>
    </main>
  );
}

export default AuthView;
