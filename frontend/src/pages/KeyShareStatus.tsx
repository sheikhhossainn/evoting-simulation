/**
 * KeyShareStatus.tsx
 *
 * Live status page — fetches real data from GET /keyshares/status.
 * Shows submitted count, threshold progress, and keyholder list.
 *
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../utils/api";

const ELECTION_ID = "NATIONAL-2026-001";
const THRESHOLD = 3;
const TOTAL = 4;

// Role labels for each share index (display only)
const ROLE_LABELS: Record<number, { name: string; role: string; theme: string; accent: string; bg: string }> = {
  1: { name: "Election Commission",     role: "Primary Authority",    theme: "from-emerald-500 to-teal-600",  accent: "text-emerald-600", bg: "bg-emerald-50" },
  2: { name: "Judiciary Observer",      role: "Legal Oversight",      theme: "from-blue-500 to-cyan-600",     accent: "text-blue-600",    bg: "bg-blue-50"    },
  3: { name: "Academic Auditor",        role: "Technical Oversight",  theme: "from-violet-500 to-purple-600", accent: "text-violet-600",  bg: "bg-violet-50"  },
  4: { name: "Civil Society Observer",  role: "Public Trust",         theme: "from-rose-500 to-pink-600",     accent: "text-rose-600",    bg: "bg-rose-50"    },
};

type KeyholderStatus = {
  id: string;
  share_index: number;
  keyholder_id: string;
  keyholder_role: string | null;
  submitted: boolean;
  submitted_at: string | null;
};

type StatusData = {
  election_id: string;
  threshold: { required: number; total: number };
  submitted_count: number;
  threshold_met: boolean;
  keyholders: KeyholderStatus[];
};

const KeyShareStatus = () => {
  const navigate = useNavigate();
  const [data, setData]       = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
  `http://localhost:3000/keyshares/status?election_id=${encodeURIComponent(ELECTION_ID)}`
);
if (!res.ok) {
  const err = await res.json();
  throw new ApiError(err.error ?? "Failed to load status", res.status);
}
const result = await res.json();
setData(result);

    } catch (err: any) {
      setError(err?.message ?? "Failed to load status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Derive display list — always show all 4 slots
  const displayKeyholders = [1, 2, 3, 4].map((idx) => {
    const live = data?.keyholders.find((k) => k.share_index === idx);
    const meta = ROLE_LABELS[idx];
    return {
      share_index: idx,
      name: live?.keyholder_role ?? meta.name,
      role: meta.role,
      submitted: live?.submitted ?? false,
      submitted_at: live?.submitted_at ?? null,
      theme: meta.theme,
      accent: meta.accent,
      bg: meta.bg,
    };
  });

  const submittedCount = data?.submitted_count ?? 0;
  const thresholdMet   = data?.threshold_met ?? false;
  const remaining      = Math.max(0, THRESHOLD - submittedCount);
  const progressPct    = (submittedCount / TOTAL) * 100;

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "#F2F5FA" }}>
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">

        {/* ── Header bar ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <span className="text-sm font-semibold text-white">
              Threshold Decryption · {ELECTION_ID}
            </span>
          </div>
          <div className="px-6 py-2 flex items-center gap-3 sm:mr-4">
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-amber-50 border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: "#0A2540" }}>Live</span>
            </div>
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="text-xs font-medium transition-colors text-amber-600 hover:text-amber-700 flex items-center gap-1"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: "#0A2540" }}>
            Reconstruction Progress
          </h1>
          <p style={{ color: "#627d98" }}>
            Real-time status of Shamir share submissions toward the 3-of-4 threshold.
          </p>
        </div>

        {/* ── Error state ── */}
        {error && (
          <div className="mb-5 glass-card p-5 text-center">
            <p className="text-sm" style={{ color: "#F42A41" }}>⚠ {error}</p>
            <button onClick={fetchStatus} className="mt-3 text-sm text-amber-600">
              Try again
            </button>
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !data && (
          <div className="glass-card p-8 mb-8 text-center">
            <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto" />
            <p className="mt-3 text-sm" style={{ color: "#9fb3c8" }}>Loading live status…</p>
          </div>
        )}

        {/* ── Progress card ── */}
        {!loading || data ? (
          <div
            className="glass-card overflow-hidden mb-8 opacity-0-init"
            style={{ animation: "fade-in-up 0.5s ease-out 0.2s forwards" }}
          >
            <div className="p-6 md:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-5">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0 text-white bg-gradient-to-br ${
                      thresholdMet ? "from-emerald-500 to-teal-600" : "from-amber-500 to-orange-600"
                    }`}
                  >
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      {thresholdMet ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      )}
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold font-mono" style={{ color: "#0A2540" }}>
                        {submittedCount}
                      </span>
                      <span className="text-lg" style={{ color: "#627d98" }}>
                        of {THRESHOLD} required
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium" style={{ color: thresholdMet ? "#0F6E56" : "#627d98" }}>
                      {thresholdMet
                        ? "Threshold met — private key can be reconstructed"
                        : `${remaining} more share${remaining === 1 ? "" : "s"} needed`}
                    </p>
                  </div>
                </div>

                <span
                  className={`inline-block px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                    thresholdMet ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {thresholdMet ? "Ready" : "Pending"}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(10,37,64,0.08)" }}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r ${
                    thresholdMet ? "from-emerald-500 to-teal-600" : "from-amber-500 to-orange-600"
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs" style={{ color: "#9fb3c8" }}>
                <span>0 shares</span>
                <span>{TOTAL} keyholders total</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Keyholder grid ── */}
        <div className="mb-2 opacity-0-init animate-fade-in-up-delayed">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#0A2540" }}>
            Authorized Key Holders
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
          {displayKeyholders.map((kh, i) => (
            <div
              key={kh.share_index}
              className={`relative glass-card p-6 opacity-0-init transition-all duration-300 ${!kh.submitted ? "opacity-70" : ""}`}
              style={{ animation: `fade-in-up 0.5s ease-out ${0.1 + i * 0.1}s forwards` }}
            >
              {/* Check indicator */}
              <div className="absolute top-4 right-4">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  kh.submitted ? "border-emerald-500 bg-emerald-500" : "border-slate-300"
                }`}>
                  {kh.submitted && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${kh.theme} flex items-center justify-center text-lg font-bold shadow-sm flex-shrink-0 text-white`}>
                  #{kh.share_index}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold truncate" style={{ color: "#0A2540" }}>
                    {kh.name}
                  </h3>
                  <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${kh.bg} ${kh.accent}`}>
                    {kh.role}
                  </span>
                  <p className="mt-2 text-xs font-mono" style={{ color: "#9fb3c8" }}>
                    {kh.submitted && kh.submitted_at
                      ? `Submitted ${new Date(kh.submitted_at).toLocaleString()}`
                      : "Awaiting submission"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between text-xs mb-6">
          <span style={{ color: "#9fb3c8" }}>
            This page refreshes automatically every 30 seconds.
          </span>
        </div>

        {thresholdMet && (
          <div className="text-center mb-4">
            <button onClick={() => navigate("/tally")} className="btn-navy text-sm px-6">
              Proceed to Tallying →
            </button>
          </div>
        )}

        <div className="text-center">
          <button onClick={() => navigate("/")} className="text-sm transition-colors" style={{ color: "#627d98" }}
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

export default KeyShareStatus;
