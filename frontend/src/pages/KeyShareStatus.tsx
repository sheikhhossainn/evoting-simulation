/**
 * KeyShareStatus.tsx
 *
 * Public status page showing which keyholders have submitted their shares
 * and whether the threshold has been met for decryption.
 *
 * Day 1 build — UI only with hard-coded sample state.
 * Real data binding to Supabase comes in later tasks.
 */

import { useNavigate } from "react-router-dom";

// Type for a key holder entry
type KeyHolder = {
  id: number;
  name: string;
  submitted: boolean;
  submittedAt: string | null;
};

// Hard-coded sample state for UI demonstration
// In later tasks this will come from Supabase
const SAMPLE_KEYHOLDERS: KeyHolder[] = [
  { id: 1, name: "Election Commission", submitted: true, submittedAt: "2026-08-30 14:22" },
  { id: 2, name: "Judiciary Observer", submitted: true, submittedAt: "2026-08-30 14:35" },
  { id: 3, name: "Academic Auditor", submitted: false, submittedAt: null },
  { id: 4, name: "Civil Society Observer", submitted: false, submittedAt: null },
];

const THRESHOLD = 3;

export default function KeyShareStatus() {
  const navigate = useNavigate();

  const submittedCount = SAMPLE_KEYHOLDERS.filter((k) => k.submitted).length;
  const thresholdMet = submittedCount >= THRESHOLD;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium text-slate-900">SecureVote BD</h1>
            <p className="text-xs text-slate-500">Key Holder Portal — Status</p>
          </div>
          <button
            onClick={() => navigate("/keyholder/login")}
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            ← Back to portal
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">

        {/* Threshold summary card */}
        <div className={`rounded-xl border p-6 mb-6 ${thresholdMet ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                Threshold status
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-medium text-slate-900">
                  {submittedCount}
                </span>
                <span className="text-lg text-slate-500">
                  / {THRESHOLD} required
                </span>
              </div>
              <p className={`text-sm mt-2 ${thresholdMet ? "text-emerald-700" : "text-slate-600"}`}>
                {thresholdMet
                  ? "Threshold met — private key can be reconstructed for tallying"
                  : `${THRESHOLD - submittedCount} more share${THRESHOLD - submittedCount === 1 ? "" : "s"} needed before decryption can begin`
                }
              </p>
            </div>
            <div className={`p-3 rounded-full ${thresholdMet ? "bg-emerald-100" : "bg-slate-100"}`}>
              {thresholdMet ? (
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-5">
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${thresholdMet ? "bg-emerald-500" : "bg-indigo-500"}`}
                style={{ width: `${(submittedCount / SAMPLE_KEYHOLDERS.length) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-slate-500">0</span>
              <span className="text-xs text-slate-500">{SAMPLE_KEYHOLDERS.length} keyholders</span>
            </div>
          </div>
        </div>

        {/* Keyholder list */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-base font-medium text-slate-900">Keyholders</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Submission status for election NATIONAL-2026-001
            </p>
          </div>

          <ul className="divide-y divide-slate-100">
            {SAMPLE_KEYHOLDERS.map((kh) => (
              <li key={kh.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${kh.submitted ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {kh.id}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{kh.name}</p>
                    <p className="text-xs text-slate-500">
                      Share index {kh.id}
                      {kh.submittedAt && ` · submitted ${kh.submittedAt}`}
                    </p>
                  </div>
                </div>

                {kh.submitted ? (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Submitted
                  </span>
                ) : (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                    Pending
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Action footer */}
        <div className="mt-6 flex items-center justify-between text-sm">
          <p className="text-slate-500">
            This page is publicly visible for election transparency.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </main>
    </div>
  );
}
