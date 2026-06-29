import { useState } from "react";
import { useNavigate } from "react-router-dom";

const VoterLogin = () => {
  const navigate = useNavigate();
  const [nid, setNid] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const isValid = /^\d{11}$/.test(nid);

  const handleNidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow numeric input
    const cleanValue = e.target.value.replace(/\D/g, "");
    if (cleanValue.length <= 11) {
      setNid(cleanValue);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    // Navigate to voting page with NID in state — no API call
    navigate("/voter/vote", { state: { nid: nid } });
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      {/* ── Login card ── */}
      <div className="relative z-10 w-full max-w-md">
        {/* ── Page heading ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: "#0A2540" }}>
            Voter Portal
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#627d98" }}>
            Enter your National ID to access the secure voting portal
          </p>
        </div>

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
              stroke="#34d399"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
            <span className="text-sm font-semibold text-white">
              Voter Verification
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 p-6">
            {/* NID input */}
            <div>
              <label
                htmlFor="nid-input"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                National ID (NID)
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg
                    className={`h-4 w-4 transition-colors duration-300 ${
                      isFocused ? "text-bd-green-600" : "text-slate-400"
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
                  id="nid-input"
                  type="text"
                  value={nid}
                  onChange={handleNidChange}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="e.g. 12345678901"
                  autoComplete="off"
                  className="input-field pl-10 font-mono tracking-wider"
                />
              </div>
              {nid.length > 0 && !isValid && (
                <p
                  className="mt-2 text-xs"
                  style={{ color: "#C8920A" }}
                >
                  NID must be exactly 11 digits ({nid.length}/11)
                </p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={!isValid}
              id="voter-verify-btn"
              className="btn-primary w-full text-sm"
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
              Verify &amp; Continue
            </button>
          </form>

          {/* Divider */}
          <div
            className="mx-6 mb-5 border-t pt-4"
            style={{ borderColor: "rgba(10, 37, 64, 0.08)" }}
          >
            <div className="flex items-center gap-2 text-xs" style={{ color: "#627d98" }}>
              <svg
                className="h-4 w-4 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#006A4E"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <span>
                Your identity is verified using Zero-Knowledge Proofs — your NID
                is never stored in plaintext.
              </span>
            </div>
          </div>
        </div>

        {/* Back to home */}
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
};

export default VoterLogin;
