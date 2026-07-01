import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { generateNullifier, hashNid, ELECTION_ID } from "../utils/nullifier";
import { checkNullifier, submitVote, ApiError } from "../utils/api";

interface Candidate {
  id: string;
  constituencyId: number;
  name: string;
  party: string;
  symbol: string;
}

const PARTY_THEMES: Record<string, { color: string, ring: string, bg: string, accent: string }> = {
  "Progressive Alliance": {
    color: "from-emerald-500 to-teal-600",
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500/10",
    accent: "text-emerald-600",
  },
  "Unity Front": {
    color: "from-blue-500 to-cyan-600",
    ring: "ring-blue-500/40",
    bg: "bg-blue-500/10",
    accent: "text-blue-600",
  },
  "People's Voice": {
    color: "from-amber-500 to-orange-600",
    ring: "ring-amber-500/40",
    bg: "bg-amber-500/10",
    accent: "text-amber-600",
  },
  "National Reform": {
    color: "from-violet-500 to-purple-600",
    ring: "ring-violet-500/40",
    bg: "bg-violet-500/10",
    accent: "text-violet-600",
  },
  "Democratic League": {
    color: "from-rose-500 to-pink-600",
    ring: "ring-rose-500/40",
    bg: "bg-rose-500/10",
    accent: "text-rose-600",
  },
  "Civic Coalition": {
    color: "from-sky-500 to-indigo-600",
    ring: "ring-sky-500/40",
    bg: "bg-sky-500/10",
    accent: "text-sky-600",
  },
};

interface LocationState {
  nid?: string;
  nidHash?: string;
  constituencyCode?: string;
  voterId?: string;
}

const VotingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const voterNid = state?.nid ?? "00000000000";
  const voterNidHash = state?.nidHash ?? "";

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Deterministic constituency mapping: taking the first 4 digits of NID % 8 + 1
  const firstFour = parseInt(voterNid.slice(0, 4)) || 0;
  const constituencyId = (firstFour % 8) + 1;

  useEffect(() => {
    fetch("/candidates.json")
      .then((res) => res.json())
      .then((data: Candidate[]) => {
        // Filter candidates by the assigned constituency
        const filtered = data.filter((c) => c.constituencyId === constituencyId);
        setCandidates(filtered);
      })
      .catch((err) => console.error("Failed to load candidates", err));
  }, [constituencyId]);

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  const handleCastVote = () => {
    if (!selectedCandidate) return;
    setVoteError(null);
    setShowModal(true);
  };

  const handleConfirm = async () => {
    if (!selectedCandidate || isSubmitting) return;

    setIsSubmitting(true);
    setVoteError(null);

    try {
      // 1. Compute NID hash (if not passed from login)
      const nidHash = voterNidHash || (await hashNid(voterNid));

      // 2. Generate nullifier: SHA-256(NID + election_id)
      const nullifierHash = await generateNullifier(voterNid, ELECTION_ID);

      // 3. Check if nullifier already exists (double-vote prevention)
      const { exists } = await checkNullifier(nullifierHash, ELECTION_ID);
      if (exists) {
        setVoteError("You have already voted in this election.");
        setIsSubmitting(false);
        return;
      }

      // 4. Create mock encrypted vote (placeholder until ElGamal is implemented)
      const encryptedVote = {
        c1: btoa(`candidate:${selectedCandidate.id}:${Date.now()}`),
        c2: btoa(`voter:${nidHash.slice(0, 16)}:${Date.now()}`),
      };

      // 5. Submit vote to backend
      const result = await submitVote(
        nidHash,
        encryptedVote,
        nullifierHash,
        ELECTION_ID
      );

      // 6. Success — navigate to confirmation
      navigate("/voter/confirmation", {
        state: {
          nid: voterNid,
          candidateName: selectedCandidate.name,
          candidateParty: selectedCandidate.party,
          voteId: result.vote_id,
          status: result.status,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setVoteError(err.message);
      } else if (err instanceof TypeError && err.message.includes("fetch")) {
        setVoteError(
          "Unable to connect to server. Please ensure the backend is running."
        );
      } else {
        setVoteError("An unexpected error occurred. Please try again.");
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      {/* ── Content ── */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Header bar */}
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
                d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
              />
            </svg>
            <span className="text-sm font-semibold text-white">
              National Election 2026
            </span>
          </div>
          <div className="px-6 py-2 w-full sm:w-auto flex items-center justify-between sm:justify-end gap-4">
             <span className="text-xs font-semibold" style={{ color: "#627d98" }}>
              Constituency {constituencyId}
            </span>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-slate-100 border border-slate-200">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: "#0A2540" }}>
                Voter: {voterNid.slice(0, 4)}••••
              </span>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-10 opacity-0-init animate-fade-in-up-delayed">
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: "#0A2540" }}>
            Select Your Candidate
          </h1>
          <p style={{ color: "#627d98" }}>
            Choose one candidate below. Your vote will be encrypted before
            submission.
          </p>
        </div>

        {/* Candidate grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
          {candidates.map((candidate, i) => {
            const isSelected = selectedId === candidate.id;
            const theme = PARTY_THEMES[candidate.party] || PARTY_THEMES["Progressive Alliance"];
            return (
              <button
                key={candidate.id}
                onClick={() => setSelectedId(candidate.id)}
                className={`group relative glass-card p-6 text-left transition-all duration-300 cursor-pointer
                  opacity-0-init
                  ${isSelected ? `ring-2 ${theme.ring} scale-[1.02]` : "hover:scale-[1.01]"}
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
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-slate-300 group-hover:border-slate-400"
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
                    className={`w-14 h-14 rounded-xl bg-gradient-to-br ${theme.color} flex items-center justify-center text-2xl shadow-sm flex-shrink-0 text-white`}
                  >
                    {candidate.symbol}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold truncate" style={{ color: "#0A2540" }}>
                      {candidate.name}
                    </h3>
                    <span
                      className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${theme.bg} ${theme.accent}`}
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
            className="btn-primary text-lg px-12 py-4 shadow-lg shadow-emerald-500/20"
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
          <p className="text-xs flex items-center justify-center gap-1.5" style={{ color: "#627d98" }}>
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
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => {
              if (!isSubmitting) setShowModal(false);
            }}
          />

          {/* Modal card */}
          <div className="relative glass-card overflow-hidden max-w-sm w-full animate-scale-in">
             <div
                className="flex items-center justify-center py-4"
                style={{ background: "#0A2540" }}
              >
                <h3 className="text-base font-semibold text-white">
                  Confirm Your Vote
                </h3>
              </div>
            <div className="p-8">
              {/* Warning icon */}
              <div className="flex justify-center mb-5">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-amber-500"
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

              <p className="text-sm text-center mb-6" style={{ color: "#627d98" }}>
                This action is irreversible. Please verify your selection:
              </p>

              {/* Selected candidate card */}
              {(() => {
                const theme = PARTY_THEMES[selectedCandidate.party] || PARTY_THEMES["Progressive Alliance"];
                return (
                  <div
                    className={`rounded-xl p-4 mb-6 ${theme.bg} border border-slate-200`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{selectedCandidate.symbol}</span>
                      <div>
                        <p className="font-semibold" style={{ color: "#0A2540" }}>
                          {selectedCandidate.name}
                        </p>
                        <p className={`text-xs ${theme.accent}`}>
                          {selectedCandidate.party}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Error message in modal */}
              {voteError && (
                <div
                  className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm mb-4"
                  style={{
                    borderColor: "rgba(244, 42, 65, 0.25)",
                    background: "rgba(244, 42, 65, 0.04)",
                    color: "#F42A41",
                  }}
                >
                  <svg
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                    />
                  </svg>
                  <span>{voteError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  disabled={isSubmitting}
                  className="btn-ghost flex-1 text-sm py-2.5"
                >
                  Go Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isSubmitting}
                  className="btn-primary flex-1 text-sm py-2.5"
                >
                  {isSubmitting ? (
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
                      Submitting…
                    </span>
                  ) : (
                    "Confirm Vote"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VotingPage;
