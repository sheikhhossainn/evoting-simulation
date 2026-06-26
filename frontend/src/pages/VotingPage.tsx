import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/* ── Static candidate data (no API) ── */
const candidates = [
  {
    id: "c1",
    name: "Ayesha Rahman",
    party: "Progressive Alliance",
    symbol: "🌿",
    color: "from-emerald-500 to-teal-600",
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500/10",
    accent: "text-emerald-400",
  },
  {
    id: "c2",
    name: "Karim Hossain",
    party: "Unity Front",
    symbol: "🤝",
    color: "from-blue-500 to-cyan-600",
    ring: "ring-blue-500/40",
    bg: "bg-blue-500/10",
    accent: "text-blue-400",
  },
  {
    id: "c3",
    name: "Fatima Begum",
    party: "People's Voice",
    symbol: "📢",
    color: "from-amber-500 to-orange-600",
    ring: "ring-amber-500/40",
    bg: "bg-amber-500/10",
    accent: "text-amber-400",
  },
  {
    id: "c4",
    name: "Rafiq Uddin",
    party: "National Reform",
    symbol: "⚖️",
    color: "from-violet-500 to-purple-600",
    ring: "ring-violet-500/40",
    bg: "bg-violet-500/10",
    accent: "text-violet-400",
  },
];

const VotingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const voterNid = (location.state as { nid?: string })?.nid ?? "••••••••";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  const handleCastVote = () => {
    if (!selectedCandidate) return;
    setShowModal(true);
  };

  const handleConfirm = () => {
    // Navigate to confirmation — no API call
    navigate("/voter/confirmation", {
      state: {
        nid: voterNid,
        candidateName: selectedCandidate?.name,
        candidateParty: selectedCandidate?.party,
      },
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ── Background ── */}
      <div className="absolute inset-0 bg-gradient-to-b from-surface-950 via-surface-900 to-brand-950" />
      <div className="orb w-80 h-80 bg-brand-600 top-[-10%] right-[-5%] animate-float" />
      <div className="orb w-64 h-64 bg-purple-600 bottom-[10%] left-[-5%] animate-float-delayed" />

      {/* ── Content ── */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Header bar */}
        <div className="glass-card px-6 py-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                National Election 2026
              </h2>
              <p className="text-xs text-slate-400">
                Parliamentary Constituency — Ward 42
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800/60 border border-slate-700/50">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono text-slate-400">
              Voter: {voterNid.slice(0, 4)}••••
            </span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-10 opacity-0-init animate-fade-in-up-delayed">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Select Your Candidate
          </h1>
          <p className="text-slate-400">
            Choose one candidate below. Your vote will be encrypted before
            submission.
          </p>
        </div>

        {/* Candidate grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
          {candidates.map((candidate, i) => {
            const isSelected = selectedId === candidate.id;
            return (
              <button
                key={candidate.id}
                onClick={() => setSelectedId(candidate.id)}
                className={`group relative glass-card p-6 text-left transition-all duration-300 cursor-pointer
                  opacity-0-init
                  ${isSelected ? `ring-2 ${candidate.ring} scale-[1.02]` : "hover:scale-[1.01]"}
                `}
                style={{
                  animation: `fade-in-up 0.5s ease-out ${0.1 + i * 0.1}s forwards`,
                }}
              >
                {/* Selection indicator */}
                <div className="absolute top-4 right-4">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300
                    ${
                      isSelected
                        ? "border-brand-400 bg-brand-500"
                        : "border-slate-600 group-hover:border-slate-400"
                    }`}
                  >
                    {isSelected && (
                      <svg
                        className="w-3.5 h-3.5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m4.5 12.75 6 6 9-13.5"
                        />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Candidate info */}
                <div className="flex items-start gap-4">
                  <div
                    className={`w-14 h-14 rounded-xl bg-gradient-to-br ${candidate.color} flex items-center justify-center text-2xl shadow-lg flex-shrink-0`}
                  >
                    {candidate.symbol}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white truncate">
                      {candidate.name}
                    </h3>
                    <span
                      className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${candidate.bg} ${candidate.accent}`}
                    >
                      {candidate.party}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Cast vote button */}
        <div className="flex justify-center">
          <button
            onClick={handleCastVote}
            disabled={!selectedId}
            className="btn-primary text-lg px-12 py-4"
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
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            Cast Your Vote
          </button>
        </div>

        {/* Security footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500 flex items-center justify-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            End-to-end encrypted with ElGamal • Anchored on Polygon
          </p>
        </div>
      </div>

      {/* ── Confirmation Modal ── */}
      {showModal && selectedCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />

          {/* Modal card */}
          <div className="relative glass-card p-8 max-w-sm w-full animate-scale-in">
            {/* Warning icon */}
            <div className="flex justify-center mb-5">
              <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-xl font-bold text-white text-center mb-2">
              Confirm Your Vote
            </h3>
            <p className="text-sm text-slate-400 text-center mb-6">
              This action is irreversible. Please verify your selection:
            </p>

            {/* Selected candidate card */}
            <div
              className={`rounded-xl p-4 mb-6 ${selectedCandidate.bg} border border-slate-700/30`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedCandidate.symbol}</span>
                <div>
                  <p className="font-semibold text-white">
                    {selectedCandidate.name}
                  </p>
                  <p className={`text-xs ${selectedCandidate.accent}`}>
                    {selectedCandidate.party}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="btn-ghost flex-1"
              >
                Go Back
              </button>
              <button onClick={handleConfirm} className="btn-primary flex-1">
                Confirm Vote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VotingPage;
