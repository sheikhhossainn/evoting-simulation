import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerVoter, ApiError } from "../utils/api";

const VoterLogin = () => {
  const navigate = useNavigate();
  const [nid, setNid] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = /^\d{11}$/.test(nid);

  const handleNidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow numeric input
    const cleanValue = e.target.value.replace(/\D/g, "");
    if (cleanValue.length <= 11) {
      setNid(cleanValue);
    }
    // Clear error when user starts typing again
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const voter = await registerVoter(nid);

      if (voter.has_voted) {
        setError("You have already voted in this election.");
        setIsLoading(false);
        return;
      }

      // Navigate to voting page with voter data
      navigate("/voter/vote", {
        state: {
          nid,
          nidHash: voter.nid_hash,
          constituencyCode: voter.constituency_code,
          voterId: voter.voter_id,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof TypeError && err.message.includes("fetch")) {
        setError(
          "Unable to connect to server. Please ensure the backend is running."
        );
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
      setIsLoading(false);
    }
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
                  disabled={isLoading}
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

            {/* Error message */}
            {error && (
              <div
                className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
                style={{
                  borderColor: "rgba(244, 42, 65, 0.25)",
                  background: "rgba(244, 42, 65, 0.04)",
                  color: "#F42A41",
                }}
              >
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                  />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={!isValid || isLoading}
              id="voter-verify-btn"
              className="btn-primary w-full text-sm"
            >
              {isLoading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Verifying…
                </>
              ) : (
                <>
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
                </>
              )}
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
