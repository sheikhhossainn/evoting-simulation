/**
 * AdminDashboard.tsx
 *
 * Placeholder stub for the EC Admin dashboard.
 * Will be built out when admin features are implemented.
 */

import { useNavigate } from "react-router-dom";

export default function AdminDashboard() {
  const navigate = useNavigate();

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "#F2F5FA" }}
    >
      <div className="w-full max-w-lg text-center">
        <div className="glass-card p-8">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "rgba(0, 106, 78, 0.08)" }}
          >
            <svg
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="#006A4E"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
              />
            </svg>
          </div>

          <h1
            className="text-xl font-bold"
            style={{ color: "#0A2540" }}
          >
            EC Admin Dashboard
          </h1>
          <p className="mt-2 text-sm" style={{ color: "#627d98" }}>
            This dashboard is under construction. Candidate management,
            constituency setup, and election lifecycle controls will be
            available here.
          </p>

          <button
            onClick={() => navigate("/")}
            className="btn-ghost mt-6 text-sm"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
