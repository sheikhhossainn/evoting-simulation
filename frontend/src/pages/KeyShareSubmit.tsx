/**
 * KeyShareSubmit.tsx
 *
 * Where a key holder submits their Shamir share at tallying time.
 * No logic yet — UI only. The submit button navigates to the status page.
 *
 * Day 1 build — UI shell only. Real submission logic and Supabase
 * integration come in later tasks.
 */

import { useNavigate } from "react-router-dom";

export default function KeyShareSubmit() {
  const navigate = useNavigate();
// Placeholder handler — no validation, no API call yet
  const handleSubmit = (e: any) => {
    e.preventDefault();
    navigate("/keyholder/status");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium text-slate-900">SecureVote BD</h1>
            <p className="text-xs text-slate-500">Key Holder Portal</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Signed in
            </span>
            <button className="text-sm text-slate-600 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">

        {/* Election context */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                Active election
              </p>
              <p className="text-base font-medium text-slate-900">
                NATIONAL-2026-001
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Tallying phase — share submission window open
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                Threshold
              </p>
              <p className="text-base font-medium text-slate-900">3 of 4</p>
            </div>
          </div>
        </div>

        {/* Important notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-900">
                Verify your share before submitting
              </p>
              <p className="text-sm text-amber-800 mt-1">
                Once submitted, your share will be combined with others to reconstruct the private key.
                Make sure the share value matches the one you received during the key ceremony.
              </p>
            </div>
          </div>
        </div>

        {/* Submission form */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-1">
            Submit your Shamir share
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Paste your assigned share below. Your share index identifies which point
            on the polynomial you hold.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Share index (x value)
              </label>
              <input
                type="number"
                placeholder="e.g. 3"
                min={1}
                max={4}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Your assigned position in the (3, 4) threshold scheme
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Share value (y value)
              </label>
              <textarea
                rows={4}
                placeholder="Paste your share value here (hex or decimal format)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                The cryptographic share value from your secure backup
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Confirmation passphrase
              </label>
              <input
                type="password"
                placeholder="Re-enter passphrase to confirm submission"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex items-start gap-2 pt-2">
              <input
                type="checkbox"
                id="confirm"
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="confirm" className="text-sm text-slate-700">
                I confirm this share is from my authorized custody and I am submitting
                it for the purpose of tallying election NATIONAL-2026-001.
              </label>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => navigate("/keyholder")}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Submit share
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
