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
import { computeAllPartials, type GroupParams } from "../utils/keyholderCrypto";
import { getElectionId } from "../utils/nullifier";

// ── Keyholder demo config (matches setup-shamir output) ──
const DEMO_KEYHOLDERS = [
  { id: "KH-001", role: "Election Commission", shareIndex: 1 },
  { id: "KH-002", role: "Judiciary Observer",  shareIndex: 2 },
  { id: "KH-003", role: "Academic Auditor",    shareIndex: 3 },
  { id: "KH-004", role: "Civil Society Observer", shareIndex: 4 },
];

const KeyShareSubmit = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Multi-election isolation (threat_model.md §10): read from ?election_id=
  // so this page targets whichever election it was linked into, not a value
  // hardcoded at build time — same pattern as BATCH_ID below, and as
  // getElectionId() already uses for VotingPage.tsx.
  const ELECTION_ID = getElectionId(location.search);

  // Explicit, not "latest" — batch 2 (32 votes) is confirmed contaminated
  // (test/fixture data anchored alongside real ballots). GET
  // /keyshares/verification-bundle and /keyshares/status require batch_id
  // explicitly (docs §8) precisely so this can never silently drift onto
  // whatever batch is anchored latest. Read from ?batch_id= so the portal
  // can target whichever batch is actually pending tally (e.g. a fresh
  // batch anchored after these fixes) instead of a value hardcoded at
  // build time — defaults to 0 (the original verified-clean batch) when
  // absent, unchanged for existing links/bookmarks.
  const batchIdParam = new URLSearchParams(location.search).get("batch_id");
  const BATCH_ID = batchIdParam !== null && /^\d+$/.test(batchIdParam) ? Number(batchIdParam) : 0;

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
      // Everything below happens in THIS browser tab. The share value
      // (x_i) never appears in any fetch() body — only the computed
      // (d_i, proof) pairs do (docs/tally-verifiability-design.md §7).

      const commitmentsRes = await fetch(
        `http://localhost:3000/keyshares/commitments?election_id=${encodeURIComponent(ELECTION_ID)}`
      );
      if (!commitmentsRes.ok) {
        const err = await commitmentsRes.json();
        throw new ApiError(err.error ?? "Could not load key ceremony commitments", commitmentsRes.status);
      }
      const commitmentsData = await commitmentsRes.json();
      const yEntry = commitmentsData.keyholder_commitments?.find(
        (k: { index: number }) => k.index === shareIndex
      );
      if (!yEntry) {
        throw new ApiError("No published commitment found for this keyholder index", 500);
      }

      const group: GroupParams = {
        p: BigInt("0x" + commitmentsData.group_params.p),
        g: BigInt("0x" + commitmentsData.group_params.g),
        q: (BigInt("0x" + commitmentsData.group_params.p) - 1n) / 2n,
      };

      const bundleRes = await fetch(
        `http://localhost:3000/keyshares/verification-bundle?election_id=${encodeURIComponent(ELECTION_ID)}&batch_id=${BATCH_ID}`
      );
      if (!bundleRes.ok) {
        const err = await bundleRes.json();
        throw new ApiError(err.error ?? "Could not load the anchored ballot set", bundleRes.status);
      }
      const bundle = await bundleRes.json();
      const ballots: { ballot_id: string; c1: string }[] = bundle.ballots ?? [];

      // Compute d_i + DLEQ proof for every in-scope ballot, locally.
      const partials = await computeAllPartials(
        ELECTION_ID,
        shareValue.trim(),
        yEntry.y_i,
        group,
        ballots
      );

      const res = await fetch("http://localhost:3000/keyshares/submit-partial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          election_id: ELECTION_ID,
          keyholder_id: keyholderId,
          passphrase,
          partials,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new ApiError(err.error ?? "Submission failed", res.status);
      }
      const data = await res.json();
      const failedCount = (data.results ?? []).filter((r: { verified: boolean }) => !r.verified).length;
      if (failedCount > 0) {
        throw new ApiError(
          `${failedCount} of ${data.results.length} computed partial decryptions failed verification — check your share value.`,
          422
        );
      }

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
            Partial Decryptions Submitted
          </h1>
          <p className="text-lg mb-8 opacity-0-init animate-fade-in-up-delayed" style={{ color: "#627d98" }}>
            Your partial decryptions were computed in this browser and verified for{" "}
            <span className="font-mono font-semibold" style={{ color: "#0A2540" }}>
              {ELECTION_ID}
            </span>
          </p>

          <div
            className="mb-6 rounded-xl p-4 opacity-0-init animate-fade-in-up-delayed"
            style={{ background: "rgba(0,106,78,0.06)", border: "1px solid rgba(0,106,78,0.2)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "#0F6E56" }}>
              ✓ Every proof verified before submission
            </p>
            <p className="text-xs mt-1" style={{ color: "#627d98" }}>
              Your secret share was never sent to the server — only the computed partial decryptions and
              their proofs were. Once 3 of 4 keyholders have submitted, the tally can combine them
              publicly, without anyone reconstructing the private key.
            </p>
          </div>

          <div className="flex flex-col gap-3 opacity-0-init animate-fade-in-up-delayed">
            <button
              onClick={() => navigate(`/keyholder/status${location.search}`)}
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
          <div className="px-6 py-2 flex items-center gap-2 mx-6 sm:mx-0 sm:mr-4">
            <span className="text-xs font-mono px-2 py-1 rounded bg-slate-100" style={{ color: "#0A2540" }}>
              Batch #{BATCH_ID}
            </span>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-amber-50 border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: "#0A2540" }}>Signed in</span>
            </div>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: "#0A2540" }}>
            Compute Your Partial Decryptions
          </h1>
          <p style={{ color: "#627d98" }}>
            Your share never leaves this browser. It's used here to compute a partial decryption and a
            proof for every anchored ballot — only those get sent, combined publicly with 2 other
            keyholders' at tally time.
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
                Once submitted, your computed partial decryptions are stored permanently. This cannot be
                reversed — your raw share itself is never transmitted or stored anywhere.
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
                Your Secret Share (x_i) — used locally only
              </label>
              <textarea
                rows={4}
                value={shareValue}
                onChange={(e) => setShareValue(e.target.value)}
                placeholder="Paste your Z_q share value here (from setup-shamir-zq.ts output or your secure backup)"
                className="input-field font-mono text-xs leading-relaxed resize-none"
              />
              <p className="mt-1.5 text-xs" style={{ color: "#9fb3c8" }}>
                Used in this browser to compute partial decryptions and proofs. Never sent to the server.
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
