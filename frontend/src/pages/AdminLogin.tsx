/**
 * AdminLogin.tsx
 *
 * EC Administrator login page. UI-only — no auth logic yet.
 * Matches the Figma reference: dark navy header, username + password form,
 * demo credentials hint box.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Placeholder handler — no validation, no API call yet
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/admin/dashboard");
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "#F2F5FA" }}
    >
      <div className="w-full max-w-md">
        {/* ── Page heading ── */}
        <div className="mb-6">
          <h1
            className="text-2xl font-bold"
            style={{ color: "#0A2540" }}
          >
            Election Commission Portal
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#627d98" }}>
            Restricted — Authorized EC Personnel Only
          </p>
        </div>

        {/* ── Login card ── */}
        <div className="glass-card overflow-hidden">
          {/* Dark header */}
          <div
            className="flex items-center gap-2 px-6 py-3.5"
            style={{ background: "#0A2540" }}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="#C8920A"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
            <span className="text-sm font-semibold text-white">
              EC Administrator Login
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <div>
              <label
                htmlFor="admin-username"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="EC username"
                autoComplete="username"
                className="input-field"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="input-field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="#9fb3c8"
                    strokeWidth={1.5}
                  >
                    {showPassword ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    ) : (
                      <>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                        />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="admin-login-btn"
              className="btn-navy w-full text-sm"
            >
              Access Dashboard
            </button>
          </form>
        </div>

        {/* ── Demo credentials ── */}
        <div
          className="mt-4 rounded-lg border p-4"
          style={{
            borderColor: "rgba(200, 146, 10, 0.25)",
            background: "rgba(200, 146, 10, 0.04)",
          }}
        >
          <div className="flex items-start gap-2">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="#C8920A"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
              />
            </svg>
            <div>
              <p className="text-xs font-semibold" style={{ color: "#856207" }}>
                Demo Credentials
              </p>
              <code
                className="mt-1 block text-xs font-mono"
                style={{ color: "#a77b08" }}
              >
                ec.admin / ec1234
              </code>
            </div>
          </div>
        </div>

        {/* ── Back to home ── */}
        <div className="mt-5 text-center">
          <button
            onClick={() => navigate("/")}
            className="text-sm transition-colors"
            style={{ color: "#627d98" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#0A2540")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#627d98")}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
