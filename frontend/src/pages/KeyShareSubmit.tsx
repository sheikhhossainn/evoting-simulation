/**
 * KeyShareSubmit.tsx
 *
 * Key holder submits their Shamir share — wired to real backend.
 * POST /keyshares/submit → stores in key_shares table.
 *
 */

import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ApiError } from "../utils/api";

// ── Keyholder demo config (matches setup-shamir output) ──
const DEMO_KEYHOLDERS = [
  { id: "KH-001", role: "Election Commission", shareIndex: 1 },
  { id: "KH-002", role: "Judiciary Observer",  shareIndex: 2 },
  { id: "KH-003", role: "Academic Auditor",    shareIndex: 3 },
  { id: "KH-004", role: "Civil Society Observer", shareIndex: 4 },
];

const ELECTION_ID = "NATIONAL-2026-001";

const KeyShareSubmit = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // keyholderId passed from login page via state
  const passedId = (location.state as { keyholderId?: string })?.keyholderId ?? "";

  const [keyholderId, setKeyholderId] = useState(passedId);
  const [shareValue, setShareValue]   = useState("");
  const [passphrase, setPassphrase]   = useState("");
  const [confirmed, setConfirmed]     = useState(false);
  const [showModal, setShowModal]     = useState(false);

  // UI state
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);
  const [thresholdMet, setThresholdMet] = useState(false);

  // Derive share_index from keyholder_id
  const keyholderInfo = DEMO_KEYHOLDERS.find((k) => k.id === keyholderId);
  const shareIndex = keyholderInfo?.shareIndex ?? 0;

  const isValid =
    keyholderId.length > 0 &&
    shareIndex > 0 &&
    shareValue.trim().length > 0 &&
    passphrase.length > 0 &&
    confirmed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setShowModal(true);
  };

  const handleConfirm = async () => {
    setShowModal(false);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("http://localhost:3000/keyshares/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    election_id: ELECTION_ID,
    keyholder_id: keyholderId,
    share_index: shareIndex,
    share_value: shareValue.trim(),
    passphrase,
  }),
});
if (!res.ok) {
  const err = await res.json();
  throw new ApiError(err.error ?? "Submission failed", res.status);
}
const data = await res.json();

      setThresholdMet(data.threshold_status?.threshold_met ?? false);
      setSuccess(true);

    } catch (err: any) {
      const msg = err?.message ?? "Submission failed. Please try again.";
      if (msg.includes("already submitted")) {
        setError("You have already submitted your share for this election.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ──
  if (success) {
    return (
      <div
        className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden"
        style={{ background: "#F2F5FA" }}
      >
        <div className="relative z-10 w-full max-w-md text-center">
          {/* Success icon */}
          <div className="flex justify-center mb-8 animate-scale-in">
            <div className="relative">
              <div className="absolute inset-0 w-24 h-24 rounded-full bg-emerald-500/10 animate-ping" />
              <div className="relative w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            </div>
          </div>

          <h1 className="text-3xl font-bold mb-3 opacity-0-init animate-fade-in-up" style={{ color: "#0A2540" }}>
            Share Submitted
          </h1>
          <p className="text-lg mb-8 opacity-0-init animate-fade-in-up-delayed" style={{ color: "#627d98" }}>
            Your Shamir share has been recorded for{" "}
            <span className="font-mono font-semibold" style={{ color: "#0A2540" }}>
              {ELECTION_ID}
            </span>
          </p>

          {thresholdMet && (
            <div
              className="mb-6 rounded-xl p-4 opacity-0-init animate-fade-in-up-delayed"
              style={{ background: "rgba(0,106,78,0.06)", border: "1px solid rgba(0,106,78,0.2)" }}
            >
              <p className="text-sm font-semibold" style={{ color: "#0F6E56" }}>
                ✓ Threshold met — 3 of 4 shares received
              </p>
              <p className="text-xs mt-1" style={{ color: "#627d98" }}>
                The private key can now be reconstructed for tallying.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 opacity-0-init animate-fade-in-up-delayed">
            <button
              onClick={() => navigate("/keyholder/status")}
              className="btn-navy w-full text-sm"
            >
              View Submission Status →
            </button>
            <button
              onClick={() => navigate("/")}
              className="text-sm transition-colors"
              style={{ color: "#627d98" }}
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* ── Header bar ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <span className="text-sm font-semibold text-white">
              Threshold Decryption · {ELECTION_ID}
            </span>
          </div>
          <div className="px-6 py-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 mx-6 sm:mx-0 sm:mr-4">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-mono" style={{ color: "#0A2540" }}>Signed in</span>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: "#0A2540" }}>
            Submit Your Secret Share
          </h1>
          <p style={{ color: "#627d98" }}>
            Your share will be combined with 2 others to reconstruct the private decryption key.
          </p>
        </div>

        {/* ── Warning ── */}
        <div className="mb-6 rounded-xl p-4" style={{ background: "rgba(200,146,10,0.05)", border: "1px solid rgba(200,146,10,0.25)" }}>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#0A2540" }}>Verify before submitting</p>
              <p className="mt-1 text-sm" style={{ color: "#627d98" }}>
                Once submitted, your share is stored permanently. This cannot be reversed.
              </p>
            </div>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="mb-5 rounded-xl p-4" style={{ background: "rgba(244,42,65,0.05)", border: "1px solid rgba(244,42,65,0.2)" }}>
            <p className="text-sm font-medium" style={{ color: "#F42A41" }}>⚠ {error}</p>
          </div>
        )}

        {/* ── Form card ── */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
            <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            <span className="text-sm font-semibold text-white">Shamir Share Submission</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-6 md:p-8">
            {/* Keyholder selector */}
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                Key Holder ID
              </label>
              <select
                value={keyholderId}
                onChange={(e) => setKeyholderId(e.target.value)}
                className="input-field bg-white cursor-pointer"
              >
                <option value="">Select your Key Holder ID</option>
                {DEMO_KEYHOLDERS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.id} — {k.role} (Share #{k.shareIndex})
                  </option>
                ))}
              </select>
            </div>

            {/* Share Index (auto-derived, read-only) */}
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                Share Index (x value — auto-filled)
              </label>
              <input
                type="text"
                value={shareIndex > 0 ? `Share #${shareIndex}` : "Select Key Holder ID above"}
                readOnly
                className="input-field font-mono cursor-not-allowed"
                style={{ background: "rgba(10,37,64,0.03)" }}
              />
            </div>

            {/* Share Value */}
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                Share Value (y value)
              </label>
              <textarea
                rows={4}
                value={shareValue}
                onChange={(e) => setShareValue(e.target.value)}
                placeholder="Paste your Shamir share value here (from setup-shamir.ts output or your secure backup)"
                className="input-field font-mono text-xs leading-relaxed resize-none"
              />
              <p className="mt-1.5 text-xs" style={{ color: "#9fb3c8" }}>
                The long hex string from your secure backup
              </p>
            </div>

            {/* Passphrase */}
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                Confirmation Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Re-enter your passphrase to authorize"
                className="input-field"
              />
            </div>

            {/* Checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded cursor-pointer"
                style={{ accentColor: "#006A4E" }}
              />
              <span className="text-sm" style={{ color: "#627d98" }}>
                I confirm this share is from my authorized custody and I am submitting it for the lawful purpose of tallying election{" "}
                <span className="font-mono font-semibold" style={{ color: "#0A2540" }}>
                  {ELECTION_ID}
                </span>.
              </span>
            </label>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t" style={{ borderColor: "rgba(10,37,64,0.08)" }}>
              <button
                type="button"
                onClick={() => navigate("/keyholder/login")}
                className="btn-ghost text-sm"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isValid || loading}
                className="btn-navy flex-1 text-sm"
              >
                {loading ? "Submitting…" : "Submit Share"}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center">
          <button onClick={() => navigate("/")} className="text-sm transition-colors" style={{ color: "#627d98" }}>
            ← Back to Home
          </button>
        </div>
      </div>

      {/* ── Confirm Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative glass-card overflow-hidden max-w-sm w-full animate-scale-in">
            <div className="flex items-center justify-center py-4" style={{ background: "#0A2540" }}>
              <h3 className="text-base font-semibold text-white">Confirm Share Submission</h3>
            </div>
            <div className="p-8">
              <div className="flex justify-center mb-5">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
              </div>
              <p className="text-sm text-center mb-2" style={{ color: "#0A2540" }}>
                <strong>{keyholderId}</strong> — Share #{shareIndex}
              </p>
              <p className="text-sm text-center mb-6" style={{ color: "#627d98" }}>
                This action is irreversible. Confirm submission?
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowModal(false)} className="btn-ghost flex-1 text-sm py-2.5">Go Back</button>
                <button onClick={handleConfirm} className="btn-navy flex-1 text-sm py-2.5">Confirm Submit</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyShareSubmit;
