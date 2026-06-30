import { useState } from "react";
import { useNavigate } from "react-router-dom";

const KeyShareSubmit = () => {
  const navigate = useNavigate();
  const [shareIndex, setShareIndex] = useState("");
  const [shareValue, setShareValue] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const isValid =
    shareIndex.length > 0 &&
    shareValue.trim().length > 0 &&
    passphrase.length > 0 &&
    confirmed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setShowModal(true);
  };

  const handleConfirm = () => {
    navigate("/keyholder/status");
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* ── Header bar (matches VotingPage pattern) ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div
            className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5"
            style={{ background: "#0A2540" }}
          >
            <svg
              className="w-4 h-4 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
              />
            </svg>
            <span className="text-sm font-semibold text-white">
              Threshold Decryption · NATIONAL-2026-001
            </span>
          </div>
          <div className="px-6 py-2 w-full sm:w-auto flex items-center justify-between sm:justify-end gap-4">
            <span
              className="text-xs font-semibold"
              style={{ color: "#627d98" }}
            >
              Phase: Tallying
            </span>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-amber-50 border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: "#0A2540" }}>
                Signed in
              </span>
            </div>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{ color: "#0A2540" }}
          >
            Submit Your Secret Share
          </h1>
          <p style={{ color: "#627d98" }}>
            Your share will be combined with 2 others to reconstruct the private decryption key.
          </p>
        </div>

        {/* ── Context strip — 3 quick stats ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            {
              label: "Threshold",
              value: "3 of 4",
              theme: "from-emerald-500 to-teal-600",
              accent: "text-emerald-600",
              bg: "bg-emerald-50",
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              ),
            },
            {
              label: "Your Position",
              value: "Key Holder",
              theme: "from-amber-500 to-orange-600",
              accent: "text-amber-600",
              bg: "bg-amber-50",
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                />
              ),
            },
            {
              label: "Status",
              value: "Window Open",
              theme: "from-violet-500 to-purple-600",
              accent: "text-violet-600",
              bg: "bg-violet-50",
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              ),
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="glass-card p-5 opacity-0-init"
              style={{
                animation: `fade-in-up 0.5s ease-out ${0.1 + i * 0.1}s forwards`,
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.theme} flex items-center justify-center shadow-sm flex-shrink-0`}
                >
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    {stat.icon}
                  </svg>
                </div>
                <div className="min-w-0">
                  <p
                    className="text-xs uppercase tracking-wider font-medium"
                    style={{ color: "#627d98" }}
                  >
                    {stat.label}
                  </p>
                  <p
                    className="text-base font-semibold mt-0.5"
                    style={{ color: "#0A2540" }}
                  >
                    {stat.value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Warning notice ── */}
        <div
          className="mb-6 rounded-xl p-4 opacity-0-init"
          style={{
            background: "rgba(200, 146, 10, 0.05)",
            border: "1px solid rgba(200, 146, 10, 0.25)",
            animation: "fade-in-up 0.5s ease-out 0.4s forwards",
          }}
        >
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="h-4 w-4 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: "#0A2540" }}
              >
                Verify your share before submitting
              </p>
              <p
                className="mt-1 text-sm leading-relaxed"
                style={{ color: "#627d98" }}
              >
                Once submitted, your share is combined with others to reconstruct the private key. This action cannot be reversed.
              </p>
            </div>
          </div>
        </div>

        {/* ── Submission form card ── */}
        <div
          className="glass-card overflow-hidden opacity-0-init"
          style={{
            animation: "fade-in-up 0.5s ease-out 0.5s forwards",
          }}
        >
          {/* Dark header */}
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
              Shamir Share Submission
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Share Index */}
              <div className="md:col-span-1">
                <label
                  htmlFor="share-index"
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
                  Share Index (x)
                </label>
                <input
                  id="share-index"
                  type="number"
                  min={1}
                  max={4}
                  value={shareIndex}
                  onChange={(e) => setShareIndex(e.target.value)}
                  placeholder="1-4"
                  className="input-field font-mono text-lg text-center"
                />
                <p
                  className="mt-1.5 text-xs"
                  style={{ color: "#9fb3c8" }}
                >
                  Your polynomial position
                </p>
              </div>

              {/* Share Value */}
              <div className="md:col-span-2">
                <label
                  htmlFor="share-value"
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
                  Share Value (y)
                </label>
                <textarea
                  id="share-value"
                  rows={3}
                  value={shareValue}
                  onChange={(e) => setShareValue(e.target.value)}
                  placeholder="Paste cryptographic share (hex or decimal)"
                  className="input-field font-mono text-xs leading-relaxed resize-none"
                />
                <p
                  className="mt-1.5 text-xs"
                  style={{ color: "#9fb3c8" }}
                >
                  Value from your secure backup
                </p>
              </div>
            </div>

            {/* Confirmation passphrase */}
            <div>
              <label
                htmlFor="confirm-pass"
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "#0A2540" }}
              >
                Confirmation Passphrase
              </label>
              <input
                id="confirm-pass"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Re-enter your passphrase to authorize"
                className="input-field"
              />
            </div>

            {/* Confirmation checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded cursor-pointer"
                style={{ accentColor: "#006A4E" }}
              />
              <span
                className="text-sm leading-relaxed"
                style={{ color: "#627d98" }}
              >
                I confirm this share is from my authorized custody and I am submitting it for the lawful purpose of tallying election{" "}
                <span
                  className="font-mono font-semibold"
                  style={{ color: "#0A2540" }}
                >
                  NATIONAL-2026-001
                </span>
                .
              </span>
            </label>

            {/* Actions */}
            <div
              className="flex flex-col sm:flex-row gap-3 pt-3 border-t"
              style={{ borderColor: "rgba(10, 37, 64, 0.08)" }}
            >
              <button
                type="button"
                onClick={() => navigate("/keyholder/login")}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isValid}
                className="btn-navy flex-1 text-sm shadow-sm"
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
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                Submit Share
              </button>
            </div>
          </form>
        </div>

        {/* ── Back to home ── */}
        <div className="mt-6 text-center">
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

      {/* ── Confirmation Modal (matches VotingPage pattern) ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative glass-card overflow-hidden max-w-sm w-full animate-scale-in">
            <div
              className="flex items-center justify-center py-4"
              style={{ background: "#0A2540" }}
            >
              <h3 className="text-base font-semibold text-white">
                Confirm Share Submission
              </h3>
            </div>
            <div className="p-8">
              <div className="flex justify-center mb-5">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-amber-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                    />
                  </svg>
                </div>
              </div>

              <p
                className="text-sm text-center mb-6"
                style={{ color: "#627d98" }}
              >
                This action is irreversible. Confirm submission of share index{" "}
                <span
                  className="font-mono font-semibold"
                  style={{ color: "#0A2540" }}
                >
                  {shareIndex}
                </span>
                ?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="btn-ghost flex-1 text-sm py-2.5"
                >
                  Go Back
                </button>
                <button
                  onClick={handleConfirm}
                  className="btn-navy flex-1 text-sm py-2.5"
                >
                  Confirm Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyShareSubmit;
