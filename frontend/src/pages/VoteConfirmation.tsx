import { useNavigate, useLocation } from "react-router-dom";

const VoteConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    nid?: string;
    candidateName?: string;
    candidateParty?: string;
  } | null;

  // Mock receipt data
  const txHash =
    "0x7a3f…e91b4c08d2f6a0b7e1c3d5f8a2b4c6d8e0f1a3b5c7d9e";
  const voteId = "EVT-2026-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const timestamp = new Date().toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "medium",
  });

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 w-full max-w-lg">
        {/* ── Success animation ── */}
        <div className="flex justify-center mb-8 animate-scale-in">
          <div className="relative">
            {/* Glow rings */}
            <div className="absolute inset-0 w-24 h-24 rounded-full bg-emerald-500/10 animate-ping" />
            <div className="relative w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg
                className="w-12 h-12 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                style={{
                  strokeDasharray: 100,
                  strokeDashoffset: 100,
                  animation: "check-draw 0.8s ease-out 0.5s forwards",
                }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 12.75 6 6 9-13.5"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* ── Heading ── */}
        <div className="text-center mb-8 animate-fade-in-up">
          <h1 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: "#0A2540" }}>
            Vote Recorded!
          </h1>
          <p className="text-lg" style={{ color: "#627d98" }}>
            Your vote has been encrypted and securely submitted.
          </p>
        </div>

        {/* ── Receipt card ── */}
        <div className="glass-card p-6 md:p-8 mb-6 opacity-0-init animate-fade-in-up-delayed">
          {/* Candidate info */}
          {state?.candidateName && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
              <p className="text-xs uppercase tracking-wider mb-1 font-medium" style={{ color: "#627d98" }}>
                Your Selection
              </p>
              <p className="text-lg font-semibold" style={{ color: "#0A2540" }}>
                {state.candidateName}
              </p>
              {state.candidateParty && (
                <p className="text-sm font-medium" style={{ color: "#006A4E" }}>
                  {state.candidateParty}
                </p>
              )}
            </div>
          )}

          {/* Receipt rows */}
          <div className="space-y-4">
            <ReceiptRow label="Encrypted Vote ID" value={voteId} mono />
            <ReceiptRow label="Timestamp" value={timestamp} />
            <ReceiptRow label="Transaction Hash" value={txHash} mono truncate />
            <ReceiptRow label="Status" value="Confirmed on Blockchain" status />
          </div>

          {/* Blockchain badge */}
          <div className="mt-6 pt-5 border-t border-slate-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-violet-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                />
              </svg>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#627d98" }}>
              This vote is anchored on the{" "}
              <span className="text-violet-600 font-medium">
                Polygon Network
              </span>{" "}
              and can be independently verified using the transaction hash above.
            </p>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8 opacity-0-init animate-fade-in-up-delayed">
          <button
            onClick={() => navigate("/")}
            className="btn-primary flex-1 text-base shadow-sm"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
              />
            </svg>
            Return to Home
          </button>
        </div>

        {/* ── Privacy footer ── */}
        <div className="glass-card px-5 py-4 opacity-0-init animate-fade-in-up-delayed">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5 border border-emerald-100">
              <svg
                className="w-4 h-4 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: "#0A2540" }}>
                Zero-Knowledge Privacy Guarantee
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "#627d98" }}>
                Your vote was encrypted using ElGamal encryption before leaving
                your device. The ZKP proof ensures your vote is valid without
                revealing your choice. No one — including system administrators —
                can link your identity to your vote.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Receipt row helper ── */
function ReceiptRow({
  label,
  value,
  mono,
  truncate,
  status,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  status?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider mb-1 font-medium" style={{ color: "#627d98" }}>
        {label}
      </p>
      {status ? (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-600">{value}</span>
        </div>
      ) : (
        <p
          className={`text-sm ${
            mono ? "font-mono" : ""
          } ${truncate ? "truncate" : ""}`}
          style={{ color: "#0A2540" }}
        >
          {value}
        </p>
      )}
    </div>
  );
}

export default VoteConfirmation;
