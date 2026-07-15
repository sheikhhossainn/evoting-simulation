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

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  runTally,
  ApiError,
  type TallyResponse,
  type RejectedVote,
} from "../utils/api";

const ELECTION_ID = "NATIONAL-2026-001";

const PARTY_ACCENTS: Record<string, string> = {
  "Progressive Alliance": "text-emerald-600 bg-emerald-50",
  "Unity Front": "text-blue-600 bg-blue-50",
  "People's Voice": "text-amber-600 bg-amber-50",
  "National Reform": "text-violet-600 bg-violet-50",
  "Democratic League": "text-rose-600 bg-rose-50",
  "Civic Coalition": "text-sky-600 bg-sky-50",
};

// Human-readable labels for rejection reasons
const REJECTION_LABELS: Record<RejectedVote["reason"], string> = {
  decryption_failed: "Decryption Failed",
  candidate_not_found: "Candidate Not Found",
  constituency_mismatch: "Constituency Mismatch",
  duplicate_nullifier: "Duplicate Vote",
  invalid_signature: "Invalid Signature",
};

const REJECTION_DESCRIPTIONS: Record<RejectedVote["reason"], string> = {
  decryption_failed: "The ciphertext could not be decrypted with the reconstructed key.",
  candidate_not_found: "Decrypted candidate ID does not match any registered candidate.",
  constituency_mismatch: "Candidate is not standing in the voter's constituency.",
  duplicate_nullifier: "A vote with this nullifier was already recorded.",
  invalid_signature: "The vote's Ed25519 signature failed verification.",
};

// ── Count-up animation hook ──
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startTimeRef.current = null;
    let rafId: number;

    const step = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic — starts fast, slows down at end
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));

      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setValue(target);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);

  return value;
}

// ── Summary tile component ──
const SummaryTile = ({
  label,
  value,
  color,
  delay = 0,
}: {
  label: string;
  value: number | string;
  color?: string;
  delay?: number;
}) => {
  const isNumber = typeof value === "number";
  const animated = useCountUp(isNumber ? value : 0);
  const displayValue = isNumber ? animated : value;

  return (
    <div
      className="glass-card p-5 opacity-0-init"
      style={{ animation: `fade-in-up 0.5s ease-out ${delay}s forwards` }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "#9fb3c8" }}
      >
        {label}
      </span>
      <p
        className="mt-1 text-2xl font-bold"
        style={{ color: color ?? "#0A2540" }}
      >
        {displayValue}
      </p>
    </div>
  );
};

// ── Animated progress bar ──
const AnimatedBar = ({ percent }: { percent: number }) => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // Small delay so bar starts at 0, then animates
    const timer = setTimeout(() => setWidth(percent), 100);
    return () => clearTimeout(timer);
  }, [percent]);

  return (
    <div
      className="h-2 rounded-full overflow-hidden"
      style={{ background: "rgba(10,37,64,0.08)" }}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-1000 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

// ── Loading skeleton — shown while decryption is in progress ──
const TallySkeleton = () => (
  <div className="mt-8 space-y-6 animate-fade-in-up">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass-card p-5">
          <div
            className="h-3 w-16 rounded mb-3 animate-pulse"
            style={{ background: "rgba(10,37,64,0.08)" }}
          />
          <div
            className="h-7 w-10 rounded animate-pulse"
            style={{ background: "rgba(10,37,64,0.12)" }}
          />
        </div>
      ))}
    </div>
    {[0, 1].map((i) => (
      <div key={i} className="glass-card overflow-hidden">
        <div
          className="h-11 animate-pulse"
          style={{ background: "rgba(10,37,64,0.15)" }}
        />
        <div className="p-6 space-y-4">
          {[0, 1].map((j) => (
            <div key={j}>
              <div className="flex justify-between mb-1.5">
                <div
                  className="h-4 w-32 rounded animate-pulse"
                  style={{ background: "rgba(10,37,64,0.08)" }}
                />
                <div
                  className="h-4 w-6 rounded animate-pulse"
                  style={{ background: "rgba(10,37,64,0.08)" }}
                />
              </div>
              <div
                className="h-2 w-full rounded-full animate-pulse"
                style={{ background: "rgba(10,37,64,0.06)" }}
              />
            </div>
          ))}
        </div>
      </div>
    ))}
    <p className="text-center text-sm" style={{ color: "#9fb3c8" }}>
      Reconstructing key and decrypting votes…
    </p>
  </div>
);

const TallyingPage = () => {
  const navigate = useNavigate();
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TallyResponse | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

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

  // Group rejected votes by reason for summary display
  const rejectedByReason = result?.rejected_votes.reduce((acc, rv) => {
    acc[rv.reason] = (acc[rv.reason] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Aggregate votes by party across all constituencies
  const partyTotals = result?.results.reduce((acc, constituency) => {
    for (const candidate of constituency.candidates) {
      acc[candidate.party] = (acc[candidate.party] ?? 0) + candidate.votes;
    }
    return acc;
  }, {} as Record<string, number>);

  const sortedParties = partyTotals
    ? Object.entries(partyTotals).sort(([, a], [, b]) => b - a)
    : [];
  const maxPartyVotes = sortedParties.length > 0 ? sortedParties[0][1] : 1;

  // Filter constituencies by search query
  const filteredResults =
    result?.results.filter((c) =>
      c.constituency_code.toLowerCase().includes(filterQuery.toLowerCase())
    ) ?? [];

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* ── Header bar ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div
            className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5"
            style={{ background: "#0A2540" }}
          >
            <svg
              className="w-4 h-4 text-emerald-400"
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
              Tallying &amp; Decryption · {ELECTION_ID}
            </span>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{ color: "#0A2540" }}
          >
            Tally the Election
          </h1>
          <p style={{ color: "#627d98" }}>
            Reconstructs the private key from the submitted shares and decrypts every
            cast vote. This is a one-time, irreversible ceremony action.
          </p>
        </div>

        {!result && (
          <div className="glass-card overflow-hidden max-w-md mx-auto animate-scale-in">
            <div
              className="flex items-center gap-2 px-6 py-3.5"
              style={{ background: "#0A2540" }}
            >
              <span className="text-sm font-semibold text-white">
                Admin Authorization
              </span>
            </div>
            <form onSubmit={handleRunTally} className="p-6 space-y-4">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
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
                <div
                  className="rounded-lg border px-4 py-3 text-sm animate-fade-in-up"
                  style={{
                    borderColor: "rgba(244,42,65,0.25)",
                    background: "rgba(244,42,65,0.04)",
                    color: "#F42A41",
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!adminSecret.trim() || loading}
                className="btn-navy w-full text-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
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
                    Decrypting…
                  </span>
                ) : (
                  "Reconstruct Key & Tally"
                )}
              </button>
            </form>
          </div>
        )}

        {loading && !result && <TallySkeleton />}

        {result && (
          <>
            {/* ── Summary tiles with count-up animation ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <SummaryTile label="Total Votes" value={result.total_votes} delay={0} />
              <SummaryTile
                label="Valid"
                value={result.valid_votes}
                color="#059669"
                delay={0.1}
              />
              <SummaryTile
                label="Invalid"
                value={result.invalid_votes}
                color="#F42A41"
                delay={0.2}
              />
              <SummaryTile
                label="Shares Used"
                value={`${result.shares_used}/4`}
                delay={0.3}
              />
            </div>

            {/* ── Rejected votes section ── */}
            {result.rejected_votes.length > 0 && (
              <div
                className="glass-card overflow-hidden mb-8 opacity-0-init"
                style={{
                  animation: "fade-in-up 0.5s ease-out 0.4s forwards",
                }}
              >
                <button
                  onClick={() => setShowRejected(!showRejected)}
                  className="w-full flex items-center justify-between px-6 py-3.5 transition-colors hover:brightness-110"
                  style={{ background: "#7f1d1d" }}
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-red-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                      />
                    </svg>
                    <span className="text-sm font-semibold text-white">
                      Rejected Votes ({result.rejected_votes.length})
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-white transition-transform duration-300 ${
                      showRejected ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>

                {/* Reason count summary — always visible */}
                <div className="px-6 py-4 border-b border-slate-200">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(rejectedByReason ?? {}).map(([reason, count]) => (
                      <span
                        key={reason}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                        style={{
                          background: "rgba(244,42,65,0.08)",
                          color: "#991b1b",
                        }}
                      >
                        {REJECTION_LABELS[reason as RejectedVote["reason"]]}
                        <span className="font-bold">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Expandable detail list */}
                <div
                  className="overflow-hidden transition-all duration-500 ease-in-out"
                  style={{
                    maxHeight: showRejected ? "600px" : "0px",
                  }}
                >
                  <div className="p-6 space-y-3">
                    {result.rejected_votes.map((rv, i) => (
                      <div
                        key={rv.vote_id}
                        className="rounded-lg border p-3"
                        style={{
                          borderColor: "rgba(244,42,65,0.15)",
                          background: "rgba(244,42,65,0.03)",
                          animation: showRejected
                            ? `fade-in-up 0.3s ease-out ${i * 0.05}s forwards`
                            : "none",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-semibold"
                              style={{ color: "#991b1b" }}
                            >
                              {REJECTION_LABELS[rv.reason]}
                            </p>
                            <p
                              className="text-xs mt-0.5"
                              style={{ color: "#627d98" }}
                            >
                              {REJECTION_DESCRIPTIONS[rv.reason]}
                            </p>
                          </div>
                          <span
                            className="text-xs font-mono"
                            style={{ color: "#9fb3c8" }}
                          >
                            {rv.vote_id.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Party-wise aggregate ── */}
            {sortedParties.length > 0 && (
              <div
                className="glass-card overflow-hidden mb-8 opacity-0-init"
                style={{ animation: "fade-in-up 0.5s ease-out 0.45s forwards" }}
              >
                <div
                  className="px-6 py-3.5"
                  style={{ background: "#0A2540" }}
                >
                  <span className="text-sm font-semibold text-white">
                    Overall Party Standings
                  </span>
                </div>
                <div className="p-6 space-y-3">
                  {sortedParties.map(([party, votes]) => (
                    <div key={party}>
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            PARTY_ACCENTS[party] ?? "text-slate-600 bg-slate-100"
                          }`}
                        >
                          {party}
                        </span>
                        <span
                          className="text-sm font-mono font-bold"
                          style={{ color: "#0A2540" }}
                        >
                          {votes}
                        </span>
                      </div>
                      <AnimatedBar percent={(votes / maxPartyVotes) * 100} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Results by constituency ── */}
            {result.results.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <p className="text-sm" style={{ color: "#9fb3c8" }}>
                  No valid votes to tally yet.
                </p>
              </div>
            ) : (
              <>
                {result.results.length > 1 && (
                  <div className="mb-4">
                    <input
                      type="text"
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Filter by constituency code…"
                      className="input-field max-w-xs"
                    />
                  </div>
                )}
                {filteredResults.length === 0 ? (
                  <div className="glass-card p-8 text-center">
                    <p className="text-sm" style={{ color: "#9fb3c8" }}>
                      No constituency matches "{filterQuery}".
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {filteredResults.map((constituency, cIdx) => {
                      const maxVotes = Math.max(
                        ...constituency.candidates.map((c) => c.votes),
                        1
                      );
                      const totalVotes = constituency.candidates.reduce(
                        (sum, c) => sum + c.votes,
                        0
                      );
                      return (
                        <div
                          key={constituency.constituency_code}
                          className="glass-card overflow-hidden opacity-0-init"
                          style={{
                            animation: `fade-in-up 0.5s ease-out ${
                              0.5 + cIdx * 0.1
                            }s forwards`,
                          }}
                        >
                          <div
                            className="flex items-center justify-between px-6 py-3.5"
                            style={{ background: "#0A2540" }}
                          >
                            <span className="text-sm font-semibold text-white font-mono">
                              {constituency.constituency_code}
                            </span>
                            <span className="text-xs text-slate-300">
                              {totalVotes} votes
                            </span>
                          </div>
                          <div className="p-6 space-y-3">
                            {constituency.candidates.map((candidate, i) => (
                              <div key={candidate.candidate_id}>
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-2">
                                    {i === 0 && candidate.votes > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                                        style={{
                                          background:
                                            "linear-gradient(135deg, #fef3c7, #fde68a)",
                                          color: "#92400e",
                                          animation: "pulse 2s ease-in-out infinite",
                                        }}
                                      >
                                        <svg
                                          className="w-3 h-3"
                                          fill="currentColor"
                                          viewBox="0 0 20 20"
                                        >
                                          <path d="M10 1.5a1 1 0 0 1 .894.553l2.11 4.28 4.723.687a1 1 0 0 1 .554 1.706l-3.417 3.33.807 4.705a1 1 0 0 1-1.451 1.054L10 15.626l-4.22 2.19a1 1 0 0 1-1.451-1.054l.807-4.705-3.417-3.33a1 1 0 0 1 .554-1.706l4.723-.687 2.11-4.28A1 1 0 0 1 10 1.5Z" />
                                        </svg>
                                        Leading
                                      </span>
                                    )}
                                    <span
                                      className="text-sm font-semibold"
                                      style={{ color: "#0A2540" }}
                                    >
                                      {candidate.name}
                                    </span>
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        PARTY_ACCENTS[candidate.party] ??
                                        "text-slate-600 bg-slate-100"
                                      }`}
                                    >
                                      {candidate.party}
                                    </span>
                                  </div>
                                  <span
                                    className="text-sm font-mono font-bold"
                                    style={{ color: "#0A2540" }}
                                  >
                                    {candidate.votes}
                                  </span>
                                </div>
                                <AnimatedBar
                                  percent={(candidate.votes / maxVotes) * 100}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <p
              className="mt-6 text-center text-xs"
              style={{ color: "#9fb3c8" }}
            >
              Tallied at {new Date(result.tallied_at).toLocaleString()}
            </p>
          </>
        )}

        <div className="mt-8 text-center">
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
};

export default TallyingPage;