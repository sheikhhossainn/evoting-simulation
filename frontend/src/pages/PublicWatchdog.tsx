/**
 * PublicWatchdog.tsx
 *
 * Public results/audit page — no login required. Shows live turnout per
 * constituency, key-ceremony progress, and Merkle-anchoring status, all
 * sourced from GET /public/stats (real counts — nothing here requires
 * decrypting a ballot). Also lets anyone verify a specific vote id was
 * anchored on-chain via GET /anchor/verify/:voteId.
 *
 * Per-candidate results intentionally are NOT shown here — those only
 * exist once the 3-of-4 key ceremony completes and tallying decrypts the
 * batch (see the Tallying & Decryption page).
 */

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getPublicStats,
  verifyVoteAnchor,
  ApiError,
  type PublicStatsResponse,
  type VoteVerifyResponse,
} from "../utils/api";

const REFRESH_INTERVAL_MS = 15000;

export default function PublicWatchdog() {
  const [stats, setStats] = useState<PublicStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [voteIdInput, setVoteIdInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<VoteVerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getPublicStats();
      setStats(data);
      setError(null);
      setLastUpdated(new Date());
    } catch {
      setError("Unable to load live election data. Please ensure the backend is running.");
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voteIdInput.trim()) return;

    setVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const result = await verifyVoteAnchor(voteIdInput.trim());
      setVerifyResult(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setVerifyError(err.message);
      } else {
        setVerifyError("Verification failed. Please try again.");
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ── Header ── */}
      <section className="px-4 pb-4 pt-14 text-center sm:pt-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "#0A2540" }}>
          Public Election Watchdog
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed" style={{ color: "#627d98" }}>
          Live, verifiable election data — no login required. Turnout counts and
          on-chain anchoring are real-time; per-candidate results appear once the
          3-of-4 key ceremony completes.
        </p>
      </section>

      <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
        {error && (
          <div
            className="mb-6 rounded-xl p-4 text-center"
            style={{ background: "rgba(244, 42, 65, 0.05)", border: "1px solid rgba(244, 42, 65, 0.2)" }}
          >
            <p className="text-sm font-medium" style={{ color: "#F42A41" }}>⚠ {error}</p>
          </div>
        )}

        {stats && (
          <>
            {/* ── Top stat tiles ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-2 h-2 rounded-full ${stats.status === "active" ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                    Status
                  </span>
                </div>
                <p className="text-2xl font-bold capitalize" style={{ color: "#0A2540" }}>
                  {stats.status === "active" ? "Voting Active" : "Not Started"}
                </p>
              </div>

              <div className="glass-card p-6">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                  Total Votes Cast
                </span>
                <p className="mt-2 text-2xl font-bold" style={{ color: "#0A2540" }}>
                  {stats.total_votes_cast.toLocaleString()}
                </p>
                <p className="text-xs mt-1" style={{ color: "#627d98" }}>
                  {stats.turnout_pct}% turnout of {stats.total_registered_voters.toLocaleString()} registered
                </p>
              </div>

              <div className="glass-card p-6">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                  Batches Anchored
                </span>
                <p className="mt-2 text-2xl font-bold" style={{ color: "#0A2540" }}>
                  {stats.anchoring.batches_anchored}
                </p>
                <p className="text-xs mt-1 truncate" style={{ color: "#627d98" }}>
                  {stats.anchoring.latest_batch
                    ? `Latest: ${stats.anchoring.latest_batch.tx_hash.slice(0, 10)}…`
                    : "No batches anchored yet"}
                </p>
              </div>
            </div>

            {/* ── Per-constituency turnout ── */}
            <div className="glass-card overflow-hidden mb-8">
              <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
                <span className="text-sm font-semibold text-white">Turnout by Constituency</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "rgba(10,37,64,0.03)" }}>
                      <th className="px-6 py-2.5 text-left font-semibold" style={{ color: "#627d98" }}>Constituency</th>
                      <th className="px-6 py-2.5 text-right font-semibold" style={{ color: "#627d98" }}>Registered</th>
                      <th className="px-6 py-2.5 text-right font-semibold" style={{ color: "#627d98" }}>Voted</th>
                      <th className="px-6 py-2.5 text-right font-semibold" style={{ color: "#627d98" }}>Turnout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.constituencies.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-6 text-center" style={{ color: "#9fb3c8" }}>
                          No voters registered yet
                        </td>
                      </tr>
                    ) : (
                      stats.constituencies.map((c) => (
                        <tr key={c.constituency_code} className="border-t" style={{ borderColor: "rgba(10,37,64,0.06)" }}>
                          <td className="px-6 py-3 font-mono font-semibold" style={{ color: "#0A2540" }}>{c.constituency_code}</td>
                          <td className="px-6 py-3 text-right" style={{ color: "#0A2540" }}>{c.registered_voters}</td>
                          <td className="px-6 py-3 text-right" style={{ color: "#0A2540" }}>{c.votes_cast}</td>
                          <td className="px-6 py-3 text-right font-semibold text-emerald-600">{c.turnout_pct}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Key ceremony progress ── */}
            <div className="glass-card p-6 mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: "#0A2540" }}>Decryption Key Ceremony</h3>
                <Link to="/keyholder/status" className="text-xs font-medium text-amber-600 hover:text-amber-700">
                  Full status →
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(10,37,64,0.08)" }}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (stats.key_ceremony.submitted_count / stats.key_ceremony.total) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-mono font-semibold" style={{ color: "#0A2540" }}>
                  {stats.key_ceremony.submitted_count}/{stats.key_ceremony.total}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: "#627d98" }}>
                {stats.key_ceremony.threshold_met
                  ? "Threshold met — the private key can be reconstructed for tallying."
                  : `Waiting for ${stats.key_ceremony.threshold} of ${stats.key_ceremony.total} key holders to submit their share.`}
              </p>
            </div>

            {/* ── Verify a vote's anchoring ── */}
            <div className="glass-card overflow-hidden">
              <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
                <span className="text-sm font-semibold text-white">Verify Your Vote Was Anchored</span>
              </div>
              <div className="p-6">
                <p className="text-sm mb-4" style={{ color: "#627d98" }}>
                  Paste the vote id from your confirmation screen to check whether it was
                  included in an on-chain Merkle batch.
                </p>
                <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={voteIdInput}
                    onChange={(e) => setVoteIdInput(e.target.value)}
                    placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
                    className="input-field font-mono text-xs flex-1"
                  />
                  <button type="submit" disabled={verifying || !voteIdInput.trim()} className="btn-navy text-sm px-6">
                    {verifying ? "Checking…" : "Verify"}
                  </button>
                </form>

                {verifyError && (
                  <p className="mt-3 text-sm font-medium" style={{ color: "#F42A41" }}>⚠ {verifyError}</p>
                )}

                {verifyResult && (
                  <div
                    className="mt-4 rounded-xl p-4"
                    style={{
                      background: verifyResult.included_locally ? "rgba(0,106,78,0.06)" : "rgba(244,42,65,0.05)",
                      border: `1px solid ${verifyResult.included_locally ? "rgba(0,106,78,0.2)" : "rgba(244,42,65,0.2)"}`,
                    }}
                  >
                    <p className="text-sm font-semibold" style={{ color: verifyResult.included_locally ? "#0F6E56" : "#F42A41" }}>
                      {verifyResult.included_locally ? "✓ Vote verified in Merkle batch" : "✗ Verification failed"}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-1 text-xs font-mono" style={{ color: "#627d98" }}>
                      <dt>Batch ID</dt>
                      <dd>{verifyResult.batch_id}</dd>
                      <dt>Tx hash</dt>
                      <dd className="truncate">{verifyResult.tx_hash}</dd>
                      <dt>On-chain check</dt>
                      <dd>
                        {verifyResult.included_on_chain === null
                          ? "not configured"
                          : verifyResult.included_on_chain
                          ? "confirmed"
                          : "failed"}
                      </dd>
                    </dl>
                  </div>
                )}
              </div>
            </div>

            {lastUpdated && (
              <p className="mt-6 text-center text-xs" style={{ color: "#9fb3c8" }}>
                Last updated {lastUpdated.toLocaleTimeString()} · refreshes automatically every 15s
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
