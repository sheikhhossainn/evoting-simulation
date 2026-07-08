/**
 * PublicWatchdog.tsx
 *
 * Public election transparency dashboard — no login required.
 * 
 * Shows:
 *   - Live turnout stats with a CSS donut chart
 *   - Per-constituency turnout with inline progress bars
 *   - Key ceremony progress with slot indicators
 *   - Merkle-anchoring / blockchain status
 *   - Vote-anchor verification tool
 *   - Per-candidate results (ONLY shown post-tally)
 *
 * All data from GET /public/stats (real counts) and
 * GET /public/results (post-tally only).
 */

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getPublicStats,
  verifyVoteAnchor,
  getPublicResults,
  ApiError,
  type PublicStatsResponse,
  type VoteVerifyResponse,
  type PublicResultsResponse,
} from "../utils/api";

const REFRESH_INTERVAL_MS = 15000;

const PARTY_COLORS: Record<string, { text: string; bg: string; bar: string }> = {
  "Progressive Alliance": { text: "#059669", bg: "rgba(5,150,105,0.08)", bar: "#059669" },
  "Unity Front":          { text: "#2563eb", bg: "rgba(37,99,235,0.08)", bar: "#2563eb" },
  "People's Voice":       { text: "#d97706", bg: "rgba(217,119,6,0.08)", bar: "#d97706" },
  "National Reform":      { text: "#7c3aed", bg: "rgba(124,58,237,0.08)", bar: "#7c3aed" },
  "Democratic League":    { text: "#e11d48", bg: "rgba(225,29,72,0.08)", bar: "#e11d48" },
  "Civic Coalition":      { text: "#0891b2", bg: "rgba(8,145,178,0.08)", bar: "#0891b2" },
};

const defaultPartyColor = { text: "#627d98", bg: "rgba(98,125,152,0.08)", bar: "#627d98" };

export default function PublicWatchdog() {
  const [stats, setStats] = useState<PublicStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [results, setResults] = useState<PublicResultsResponse | null>(null);

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

  const fetchResults = useCallback(async () => {
    try {
      const data = await getPublicResults();
      setResults(data);
    } catch {
      // silently ignore — results simply won't render
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchResults();
    const interval = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats, fetchResults]);

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

  /* ── Helpers ── */
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ════════ HERO ════════ */}
      <section className="watchdog-grid-bg px-4 pb-6 pt-12 text-center sm:pt-16">
        {/* Live badge */}
        <div className="mb-4 flex justify-center anim-fade-in-up">
          <div className="live-badge">
            <span className="live-dot" />
            Live Election Dashboard
          </div>
        </div>

        <h1
          className="text-3xl font-bold tracking-tight sm:text-4xl anim-fade-in-up anim-delay-1"
          style={{ color: "#0A2540" }}
        >
          Public Election Watchdog
        </h1>
        <p
          className="mx-auto mt-3 max-w-2xl text-base leading-relaxed anim-fade-in-up anim-delay-2"
          style={{ color: "#627d98" }}
        >
          Verifiable election transparency — no login required. Turnout, on-chain
          anchoring, and key-ceremony progress update in real time.
        </p>

        {/* Election ID pill */}
        {stats && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 anim-fade-in-up anim-delay-3"
            style={{ background: "rgba(200,146,10,0.08)", border: "1px solid rgba(200,146,10,0.15)" }}
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "#C8920A" }}>
              Election
            </span>
            <span className="font-mono text-xs font-semibold" style={{ color: "#0A2540" }}>
              {stats.election_id}
            </span>
          </div>
        )}
      </section>

      {/* ════════ MAIN CONTENT ════════ */}
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-2">
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
            {/* ── National overview: ring chart + stat tiles ── */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mb-8 anim-fade-in-up anim-delay-3">
              {/* Turnout donut */}
              <div className="glass-card p-6 md:col-span-4 flex flex-col items-center justify-center">
                <span className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "#9fb3c8" }}>
                  National Turnout
                </span>
                <div
                  className="stat-ring"
                  style={{
                    "--ring-pct": stats.turnout_pct,
                    "--ring-size": "130px",
                    "--ring-width": "12px",
                  } as React.CSSProperties}
                >
                  <div className="text-center">
                    <p className="text-2xl font-bold" style={{ color: "#006A4E" }}>
                      {stats.turnout_pct}%
                    </p>
                  </div>
                </div>
                <p className="text-xs mt-3 text-center" style={{ color: "#627d98" }}>
                  {fmt(stats.total_votes_cast)} of {fmt(stats.total_registered_voters)}
                </p>
              </div>

              {/* Right stat tiles */}
              <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Status */}
                <div className="glass-card p-5 stat-accent-green">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      stats.status === "active" ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    }`} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                      Election Status
                    </span>
                  </div>
                  <p className="text-xl font-bold capitalize" style={{ color: "#0A2540" }}>
                    {stats.status === "active" ? "Voting Active" : "Not Started"}
                  </p>
                </div>

                {/* Total votes */}
                <div className="glass-card p-5 stat-accent-navy">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                    Total Votes Cast
                  </span>
                  <p className="mt-1.5 text-xl font-bold" style={{ color: "#0A2540" }}>
                    {fmt(stats.total_votes_cast)}
                  </p>
                </div>

                {/* Batches anchored */}
                <div className="glass-card p-5 stat-accent-teal">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                    On-Chain Batches
                  </span>
                  <p className="mt-1.5 text-xl font-bold" style={{ color: "#0A2540" }}>
                    {fmt(stats.anchoring.batches_anchored)}
                  </p>
                  <p className="text-xs mt-0.5 truncate font-mono" style={{ color: "#627d98" }}>
                    {stats.anchoring.latest_batch
                      ? `Latest tx: ${stats.anchoring.latest_batch.tx_hash.slice(0, 14)}…`
                      : "No batches yet"}
                  </p>
                </div>

                {/* Key ceremony mini */}
                <div className="glass-card p-5 stat-accent-gold">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9fb3c8" }}>
                    Key Ceremony
                  </span>
                  <p className="mt-1.5 text-xl font-bold" style={{ color: "#0A2540" }}>
                    {stats.key_ceremony.submitted_count}/{stats.key_ceremony.total}
                    <span className="text-sm font-normal ml-1" style={{ color: "#627d98" }}>shares</span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: stats.key_ceremony.threshold_met ? "#006A4E" : "#C8920A" }}>
                    {stats.key_ceremony.threshold_met ? "✓ Threshold met" : `Need ${stats.key_ceremony.threshold} of ${stats.key_ceremony.total}`}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Per-constituency turnout ── */}
            <div className="glass-card overflow-hidden mb-8 anim-fade-in-up anim-delay-4">
              <div className="flex items-center justify-between px-6 py-3.5" style={{ background: "#0A2540" }}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                  </svg>
                  <span className="text-sm font-semibold text-white">Turnout by Constituency</span>
                </div>
                <span className="text-xs text-slate-400">{stats.constituencies.length} constituencies</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "rgba(10,37,64,0.03)" }}>
                      <th className="px-6 py-3 text-left font-semibold" style={{ color: "#627d98" }}>Constituency</th>
                      <th className="px-6 py-3 text-right font-semibold" style={{ color: "#627d98" }}>Registered</th>
                      <th className="px-6 py-3 text-right font-semibold" style={{ color: "#627d98" }}>Voted</th>
                      <th className="px-6 py-3 text-right font-semibold" style={{ color: "#627d98" }}>Turnout</th>
                      <th className="px-6 py-3 font-semibold hidden sm:table-cell" style={{ color: "#627d98", minWidth: "100px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.constituencies.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center" style={{ color: "#9fb3c8" }}>
                          No voters registered yet
                        </td>
                      </tr>
                    ) : (
                      stats.constituencies.map((c, i) => (
                        <tr
                          key={c.constituency_code}
                          className="border-t transition-colors hover:bg-slate-50/60"
                          style={{ borderColor: "rgba(10,37,64,0.06)", background: i % 2 === 1 ? "rgba(10,37,64,0.015)" : undefined }}
                        >
                          <td className="px-6 py-3.5 font-mono font-semibold text-sm" style={{ color: "#0A2540" }}>
                            {c.constituency_code}
                          </td>
                          <td className="px-6 py-3.5 text-right tabular-nums" style={{ color: "#0A2540" }}>
                            {fmt(c.registered_voters)}
                          </td>
                          <td className="px-6 py-3.5 text-right tabular-nums" style={{ color: "#0A2540" }}>
                            {fmt(c.votes_cast)}
                          </td>
                          <td className="px-6 py-3.5 text-right font-semibold tabular-nums" style={{ color: "#006A4E" }}>
                            {c.turnout_pct}%
                          </td>
                          <td className="px-6 py-3.5 hidden sm:table-cell">
                            <div className="turnout-bar">
                              <div className="turnout-bar-fill" style={{ width: `${c.turnout_pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Key Ceremony detail ── */}
            <div className="glass-card p-6 mb-8 anim-fade-in-up anim-delay-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                <div>
                  <h3 className="text-base font-bold" style={{ color: "#0A2540" }}>
                    Decryption Key Ceremony
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "#627d98" }}>
                    {stats.key_ceremony.threshold}-of-{stats.key_ceremony.total} threshold · Shamir's Secret Sharing
                  </p>
                </div>
                <Link
                  to="/keyholder/status"
                  className="inline-flex items-center gap-1 text-xs font-semibold transition-colors"
                  style={{ color: "#C8920A" }}
                >
                  Full ceremony status
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </div>

              {/* Slot indicators */}
              <div className="flex items-center gap-3 mb-4">
                {Array.from({ length: stats.key_ceremony.total }, (_, i) => (
                  <div key={i} className={`ceremony-slot ${i < stats.key_ceremony.submitted_count ? "filled" : ""}`}>
                    {i < stats.key_ceremony.submitted_count ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      <span>K{i + 1}</span>
                    )}
                  </div>
                ))}

                {/* Threshold marker */}
                <div className="flex-1 flex items-center gap-2 ml-2">
                  <div className="flex-1 h-px" style={{ background: "rgba(10,37,64,0.1)" }} />
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{
                      color: stats.key_ceremony.threshold_met ? "#006A4E" : "#C8920A",
                      background: stats.key_ceremony.threshold_met ? "rgba(0,106,78,0.08)" : "rgba(200,146,10,0.08)",
                    }}
                  >
                    {stats.key_ceremony.threshold_met ? "✓ Threshold Met" : `${stats.key_ceremony.submitted_count}/${stats.key_ceremony.threshold} needed`}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(10,37,64,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${(stats.key_ceremony.submitted_count / stats.key_ceremony.total) * 100}%`,
                    background: stats.key_ceremony.threshold_met
                      ? "linear-gradient(90deg, #006A4E, #00875A)"
                      : "linear-gradient(90deg, #C8920A, #fbbf24)",
                  }}
                />
              </div>

              {stats.key_ceremony.threshold_met && (
                <div className="mt-4 flex items-center gap-2 rounded-lg px-4 py-2.5"
                  style={{ background: "rgba(0,106,78,0.06)", border: "1px solid rgba(0,106,78,0.12)" }}
                >
                  <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-xs font-medium" style={{ color: "#006A4E" }}>
                    The decryption threshold has been met. Results can now be tallied by an authorized admin.
                  </span>
                </div>
              )}
            </div>

            {/* ── Post-Tally Results ── */}
            <div className="mb-8 anim-fade-in-up anim-delay-5">
              {results?.status === "tallied" && results.results ? (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(0,106,78,0.08)" }}>
                        <svg className="w-4 h-4" style={{ color: "#006A4E" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-lg font-bold" style={{ color: "#0A2540" }}>Election Results</h2>
                        <p className="text-xs" style={{ color: "#627d98" }}>
                          Tallied {results.tallied_at ? new Date(results.tallied_at).toLocaleString() : ""}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {results.results.map((constituency) => {
                      const maxVotes = Math.max(...constituency.candidates.map((c) => c.votes), 1);
                      const totalVotes = constituency.candidates.reduce((s, c) => s + c.votes, 0);
                      return (
                        <div key={constituency.constituency_code} className="glass-card overflow-hidden">
                          <div className="flex items-center justify-between px-6 py-3.5" style={{ background: "#0A2540" }}>
                            <span className="text-sm font-semibold text-white font-mono">
                              {constituency.constituency_code}
                            </span>
                            <span className="text-xs text-slate-400">
                              {fmt(totalVotes)} total votes
                            </span>
                          </div>
                          <div className="p-5 space-y-3">
                            {constituency.candidates.map((candidate, i) => {
                              const pct = totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(1) : "0.0";
                              const party = PARTY_COLORS[candidate.party] || defaultPartyColor;
                              return (
                                <div key={candidate.candidate_id}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {i === 0 && (
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
                                          style={{ background: "rgba(200,146,10,0.12)", color: "#C8920A" }}>
                                          ★
                                        </span>
                                      )}
                                      <span className="text-sm font-semibold truncate" style={{ color: "#0A2540" }}>
                                        {candidate.name}
                                      </span>
                                      <span
                                        className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                                        style={{ color: party.text, background: party.bg }}
                                      >
                                        {candidate.party}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                      <span className="text-xs tabular-nums" style={{ color: "#627d98" }}>{pct}%</span>
                                      <span className="text-sm font-mono font-bold tabular-nums" style={{ color: "#0A2540" }}>
                                        {fmt(candidate.votes)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(10,37,64,0.06)" }}>
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${(candidate.votes / maxVotes) * 100}%`,
                                        background: party.bar,
                                        opacity: 0.8,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div
                  className="glass-card p-8 text-center"
                  style={{ border: "1px dashed rgba(10,37,64,0.12)" }}
                >
                  <div className="flex justify-center mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(10,37,64,0.04)" }}>
                      <svg className="w-5 h-5" style={{ color: "#9fb3c8" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-sm font-semibold" style={{ color: "#0A2540" }}>Results Pending</p>
                  <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: "#9fb3c8" }}>
                    Per-candidate results will appear here once the key ceremony completes and
                    an authorized admin runs the decryption tally.
                  </p>
                </div>
              )}
            </div>

            {/* ── Verify Vote Anchor ── */}
            <div className="glass-card overflow-hidden mb-8 anim-fade-in-up anim-delay-6">
              <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
                <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <span className="text-sm font-semibold text-white">Verify Your Vote Was Anchored</span>
              </div>
              <div className="p-6">
                <p className="text-sm mb-4" style={{ color: "#627d98" }}>
                  Paste the vote ID from your confirmation receipt to verify it was included
                  in an on-chain Merkle batch.
                </p>
                <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <svg
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4"
                      style={{ color: "#9fb3c8" }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                      id="vote-verify-input"
                      type="text"
                      value={voteIdInput}
                      onChange={(e) => setVoteIdInput(e.target.value)}
                      placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
                      className="input-field font-mono text-xs !pl-10"
                    />
                  </div>
                  <button
                    id="vote-verify-btn"
                    type="submit"
                    disabled={verifying || !voteIdInput.trim()}
                    className="btn-navy text-sm px-6 shrink-0"
                  >
                    {verifying ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Checking…
                      </span>
                    ) : "Verify"}
                  </button>
                </form>

                {verifyError && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg px-4 py-3"
                    style={{ background: "rgba(244,42,65,0.05)", border: "1px solid rgba(244,42,65,0.15)" }}
                  >
                    <svg className="w-4 h-4 shrink-0" style={{ color: "#F42A41" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <p className="text-sm font-medium" style={{ color: "#F42A41" }}>{verifyError}</p>
                  </div>
                )}

                {verifyResult && (
                  <div
                    className="mt-4 rounded-xl p-5"
                    style={{
                      background: verifyResult.included_locally ? "rgba(0,106,78,0.04)" : "rgba(244,42,65,0.04)",
                      border: `1px solid ${verifyResult.included_locally ? "rgba(0,106,78,0.15)" : "rgba(244,42,65,0.15)"}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {verifyResult.included_locally ? (
                        <svg className="w-5 h-5" style={{ color: "#006A4E" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" style={{ color: "#F42A41" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      )}
                      <p className="text-sm font-bold" style={{ color: verifyResult.included_locally ? "#006A4E" : "#F42A41" }}>
                        {verifyResult.included_locally ? "Vote Verified in Merkle Batch" : "Verification Failed"}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.6)" }}>
                        <span className="font-semibold block mb-0.5" style={{ color: "#9fb3c8" }}>Batch ID</span>
                        <span className="font-mono font-semibold" style={{ color: "#0A2540" }}>{verifyResult.batch_id}</span>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.6)" }}>
                        <span className="font-semibold block mb-0.5" style={{ color: "#9fb3c8" }}>Tx Hash</span>
                        <span className="font-mono font-semibold truncate block" style={{ color: "#0A2540" }}>{verifyResult.tx_hash}</span>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.6)" }}>
                        <span className="font-semibold block mb-0.5" style={{ color: "#9fb3c8" }}>On-Chain</span>
                        <span className="font-semibold" style={{
                          color: verifyResult.included_on_chain === null ? "#9fb3c8"
                            : verifyResult.included_on_chain ? "#006A4E" : "#F42A41"
                        }}>
                          {verifyResult.included_on_chain === null
                            ? "Not configured"
                            : verifyResult.included_on_chain ? "✓ Confirmed" : "✗ Failed"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Footer ── */}
            {lastUpdated && (
              <p className="text-center text-xs anim-fade-in-up anim-delay-6" style={{ color: "#9fb3c8" }}>
                Last updated {lastUpdated.toLocaleTimeString()} · auto-refreshes every 15s
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
