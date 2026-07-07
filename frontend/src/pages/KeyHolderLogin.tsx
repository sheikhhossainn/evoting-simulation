import { useState } from "react";
import { useNavigate } from "react-router-dom";

const KeyHolderLogin = () => {
  const navigate = useNavigate();
  const [keyholderId, setKeyholderId] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const isValid = keyholderId.trim().length > 0 && passphrase.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    navigate("/keyholder/submit", { state: { keyholderId } });
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 w-full max-w-md">
        {/* ── Page heading ── */}
        <div className="mb-6 opacity-0-init animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            {/* Gradient key icon (matches voter page aesthetic) */}
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm text-white flex-shrink-0">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "#0A2540" }}>
                Decryption Authority
              </h1>
              <span
                className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-600"
              >
                Key Holder Portal
              </span>
            </div>
          </div>
          <p className="text-sm" style={{ color: "#627d98" }}>
            Submit your Shamir secret share to participate in 3-of-4 threshold decryption.
          </p>
        </div>

        {/* ── Login card ── */}
        <div className="glass-card overflow-hidden opacity-0-init animate-fade-in-up-delayed">
          {/* Dark navy header */}
          <div
            className="flex items-center gap-2 px-6 py-3.5"
            style={{ background: "#0A2540" }}
          >
            <svg
              className="h-4 w-4 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
            <span className="text-sm font-semibold text-white">
              Key Holder Authentication
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 p-6">
            {/* Key Holder ID */}
            <div>
              <label
                htmlFor="kh-id"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Key Holder ID
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg
                    className={`h-4 w-4 transition-colors duration-300 ${
                      isFocused ? "text-amber-500" : "text-slate-400"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                    />
                  </svg>
                </div>
                <input
                  id="kh-id"
                  type="text"
                  value={keyholderId}
                  onChange={(e) => setKeyholderId(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="e.g. KH-001"
                  autoComplete="off"
                  className="input-field pl-10 font-mono tracking-wider"
                />
              </div>
            </div>

            {/* Passphrase */}
            <div>
              <label
                htmlFor="kh-passphrase"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Passphrase
              </label>
              <div className="relative">
                <input
                  id="kh-passphrase"
                  type={showPassphrase ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="input-field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                >
                  <svg
                    className="h-4 w-4 text-slate-400 hover:text-slate-600 transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    {showPassphrase ? (
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

            {/* Election dropdown */}
            <div>
              <label
                htmlFor="kh-election"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Active Election
              </label>
              <select
                id="kh-election"
                className="input-field appearance-none bg-white cursor-pointer"
              >
                <option>Select active election</option>
                <option>NATIONAL-2026-001</option>
                <option>NATIONAL-2026-002 (test)</option>
              </select>
            </div>

            {/* Submit button — using btn-navy for keyholder authority feel */}
            <button
              type="submit"
              disabled={!isValid}
              className="btn-navy w-full text-sm shadow-sm"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              </svg>
              Authenticate &amp; Continue
            </button>
          </form>

          {/* Info note */}
          <div
            className="mx-6 mb-5 border-t pt-4"
            style={{ borderColor: "rgba(10, 37, 64, 0.08)" }}
          >
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "#627d98" }}
            >
              <svg
                className="h-4 w-4 flex-shrink-0 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <span>
                You are 1 of 4 authorized key holders. Threshold is 3-of-4 for decryption.
              </span>
            </div>
          </div>
        </div>

        {/* ── Demo credentials ── */}
        <div className="mt-5 opacity-0-init animate-fade-in-up-delayed">
          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: "rgba(200, 146, 10, 0.25)",
              background: "rgba(200, 146, 10, 0.04)",
            }}
          >
            <div className="flex items-start gap-2">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                />
              </svg>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-700">
                  Demo Credentials
                </p>
                <code
                  className="mt-1 block text-xs font-mono leading-relaxed text-amber-700/80"
                >
                  KH-001 / share001 (Election Commission)
                  <br />
                  KH-002 / share002 (Judiciary)
                  <br />
                  KH-003 / share003 (Academic Auditor)
                  <br />
                  KH-004 / share004 (Civil Society)
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* ── Public status link ── */}
        <div className="mt-4 flex justify-center gap-4 text-sm">
          <button
            onClick={() => navigate("/keyholder/status")}
            className="font-medium transition-colors text-amber-600 hover:text-amber-700"
          >
            View public submission status →
          </button>
        </div>

        {/* ── Back to home ── */}
        <div className="mt-3 text-center">
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
};

export default KeyHolderLogin;
