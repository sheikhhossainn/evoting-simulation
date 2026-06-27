/**
 * KeyHolderLogin.tsx
 *
 * Login page for Shamir's Secret Sharing key holders.
 * No logic yet — UI only. Form submission navigates to the share submission page.
 *
 * Day 1 build — UI shell only. Auth integration comes later.
 */

import { useNavigate } from "react-router-dom";

export default function KeyHolderLogin() {
  const navigate = useNavigate();

  // Placeholder handler — no validation, no API call yet
  const handleSubmit = (e:any) => {
    e.preventDefault();
    navigate("/keyholder/submit");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 mb-4">
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-medium text-slate-900">SecureVote BD</h1>
          <p className="text-sm text-slate-500 mt-1">Key Holder Portal</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-slate-900">Sign in</h2>
            <p className="text-sm text-slate-500 mt-1">
              Access your assigned Shamir share for the current election.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Keyholder ID
              </label>
              <input
                type="text"
                placeholder="e.g. KH-001"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Passphrase
              </label>
              <input
                type="password"
                placeholder="Enter your passphrase"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Election ID
              </label>
              <select className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                <option>Select election</option>
                <option>NATIONAL-2026-001</option>
                <option>NATIONAL-2026-002 (test)</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors mt-2"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-500 text-center">
              Authorized key holders only. All access attempts are logged.
            </p>
          </div>
        </div>

        {/* Status link */}
        <div className="text-center mt-6">
          <button
            onClick={() => navigate("/keyholder/status")}
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            View submission status →
          </button>
        </div>
      </div>
    </div>
  );
}
