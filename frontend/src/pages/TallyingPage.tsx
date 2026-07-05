/**
 * TallyingPage.tsx
 *
 * Once 3-of-4 key shares are submitted, this page triggers POST
 * /keyshares/tally: the backend reconstructs the private key in memory
 * (never persisted or returned), decrypts every cast vote, and returns
 * results grouped by constituency and candidate.
 *
 * Requires the admin shared secret (see backend/.env ADMIN_SECRET) —
 * there's no session-based admin auth yet (see context.md), so this is
 * the interim gate on a highly sensitive, one-time ceremony action.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { runTally, ApiError, type TallyResponse } from "../utils/api";

const ELECTION_ID = "NATIONAL-2026-001";

const PARTY_ACCENTS: Record<string, string> = {
  "Progressive Alliance": "text-emerald-600 bg-emerald-50",
  "Unity Front": "text-blue-600 bg-blue-50",
  "People's Voice": "text-amber-600 bg-amber-50",
  "National Reform": "text-violet-600 bg-violet-50",
  "Democratic League": "text-rose-600 bg-rose-50",
  "Civic Coalition": "text-sky-600 bg-sky-50",
};

const TallyingPage = () => {
  const navigate = useNavigate();
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TallyResponse | null>(null);

  const handleRunTally = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const data = await runTally(ELECTION_ID, adminSecret.trim());
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Tally failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "#F2F5FA" }}>
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* ── Header bar ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            <span className="text-sm font-semibold text-white">Tallying &amp; Decryption · {ELECTION_ID}</span>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: "#0A2540" }}>
            Tally the Election
          </h1>
          <p style={{ color: "#627d98" }}>
            Reconstructs the private key from the submitted shares and decrypts every
            cast vote. This is a one-time, irreversible ceremony action.
          </p>
        </div>

        {!result && (
          <div className="glass-card overflow-hidden max-w-md mx-auto">
            <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
              <span className="text-sm font-semibold text-white">Admin Authorization</span>
            </div>
            <form onSubmit={handleRunTally} className="p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                  Admin Secret
                </label>
                <input
                  type="password"
                  value={adminSecret}
                  onChange={(e) => setAdminSecret(e.target.value)}
                  placeholder="ADMIN_SECRET"
                  className="input-field"
                  autoComplete="off"
                />
                <p className="mt-1.5 text-xs" style={{ color: "#9fb3c8" }}>
                  Configured server-side via backend/.env (ADMIN_SECRET)
                </p>
              </div>

              {error && (
                <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "rgba(244,42,65,0.25)", background: "rgba(244,42,65,0.04)", color: "#F42A41" }}>
                  ⚠ {error}
                </div>
              )}

              <button type="submit" disabled={!adminSecret.trim() || loading} className="btn-navy w-full text-sm">
                {loading ? "Decrypting…" : "Reconstruct Key & Tally"}
              </button>
            </form>
          </div>
        )}

        {result && (
          <>
            {/* ── Summary tiles ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <div className="glass-card p-5">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>Total Votes</span>
                <p className="mt-1 text-2xl font-bold" style={{ color: "#0A2540" }}>{result.total_votes}</p>
              </div>
              <div className="glass-card p-5">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>Valid</span>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{result.valid_votes}</p>
              </div>
              <div className="glass-card p-5">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>Invalid</span>
                <p className="mt-1 text-2xl font-bold" style={{ color: "#F42A41" }}>{result.invalid_votes}</p>
              </div>
              <div className="glass-card p-5">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>Shares Used</span>
                <p className="mt-1 text-2xl font-bold" style={{ color: "#0A2540" }}>{result.shares_used}/4</p>
              </div>
            </div>

            {/* ── Results by constituency ── */}
            {result.results.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <p className="text-sm" style={{ color: "#9fb3c8" }}>No valid votes to tally yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {result.results.map((constituency) => {
                  const maxVotes = Math.max(...constituency.candidates.map((c) => c.votes), 1);
                  return (
                    <div key={constituency.constituency_code} className="glass-card overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-3.5" style={{ background: "#0A2540" }}>
                        <span className="text-sm font-semibold text-white font-mono">{constituency.constituency_code}</span>
                        <span className="text-xs text-slate-300">
                          {constituency.candidates.reduce((sum, c) => sum + c.votes, 0)} votes
                        </span>
                      </div>
                      <div className="p-6 space-y-3">
                        {constituency.candidates.map((candidate, i) => (
                          <div key={candidate.candidate_id}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                {i === 0 && <span className="text-amber-500">👑</span>}
                                <span className="text-sm font-semibold" style={{ color: "#0A2540" }}>{candidate.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PARTY_ACCENTS[candidate.party] ?? "text-slate-600 bg-slate-100"}`}>
                                  {candidate.party}
                                </span>
                              </div>
                              <span className="text-sm font-mono font-bold" style={{ color: "#0A2540" }}>{candidate.votes}</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(10,37,64,0.08)" }}>
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-600"
                                style={{ width: `${(candidate.votes / maxVotes) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-6 text-center text-xs" style={{ color: "#9fb3c8" }}>
              Tallied at {new Date(result.tallied_at).toLocaleString()}
            </p>
          </>
        )}

        <div className="mt-8 text-center">
          <button onClick={() => navigate("/")} className="text-sm transition-colors" style={{ color: "#627d98" }}>
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default TallyingPage;
