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
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* ── Background gradient ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-brand-950 to-surface-900" />

      {/* ── Floating orbs ── */}
      <div className="orb w-72 h-72 bg-brand-500 top-[-5%] left-[-5%] animate-float" />
      <div className="orb w-96 h-96 bg-purple-600 bottom-[-10%] right-[-8%] animate-float-delayed" />
      <div className="orb w-48 h-48 bg-indigo-400 top-[40%] right-[15%] animate-float-slow" />

      {/* ── Login card ── */}
      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        <div className="glass-card p-8 md:p-10">
          {/* Shield icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-2xl md:text-3xl font-bold text-center text-white mb-2">
            Voter Verification
          </h1>
          <p className="text-slate-400 text-center text-sm mb-8">
            Enter your National ID to access the secure voting portal
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* NID input */}
            <div>
              <label
                htmlFor="nid-input"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                National ID (NID)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg
                    className={`w-5 h-5 transition-colors duration-300 ${
                      isFocused ? "text-brand-400" : "text-slate-500"
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
                  className="input-field pl-12 font-mono tracking-wider"
                />
              </div>
              {nid.length > 0 && !isValid && (
                <p className="mt-2 text-xs text-amber-400/80">
                  NID must be exactly 11 digits ({nid.length}/11)
                </p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={!isValid}
              className="btn-primary w-full text-base"
            >
              <svg
                className="w-5 h-5 mr-2"
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
          <div className="mt-8 pt-6 border-t border-slate-700/50">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <svg
                className="w-4 h-4 text-emerald-500/70 flex-shrink-0"
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
                Your identity is verified using Zero-Knowledge Proofs — your NID
                is never stored in plaintext.
              </span>
            </div>
          </div>
        </div>

        {/* Back to home */}
        <div className="text-center mt-6">
          <button
            onClick={() => navigate("/")}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoterLogin;
