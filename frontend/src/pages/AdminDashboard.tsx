import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createElection, initDkgCeremony, ApiError } from "../utils/api";

// ── Sample data ──
const CONSTITUENCIES = [
  "Dhaka-1",
  "Dhaka-2",
  "Chittagong-1",
  "Chittagong-2",
  "Sylhet-1",
  "Sylhet-2",
  "Rajshahi-1",
  "Khulna-1",
];

const PARTIES = [
  { code: "NPP", name: "Progressive Alliance", theme: "from-emerald-500 to-teal-600", accent: "text-emerald-600", bg: "bg-emerald-50" },
  { code: "DA", name: "Unity Front", theme: "from-blue-500 to-cyan-600", accent: "text-blue-600", bg: "bg-blue-50" },
  { code: "PV", name: "People's Voice", theme: "from-amber-500 to-orange-600", accent: "text-amber-600", bg: "bg-amber-50" },
  { code: "UF", name: "National Reform", theme: "from-violet-500 to-purple-600", accent: "text-violet-600", bg: "bg-violet-50" },
];

type Candidate = {
  id: string;
  name: string;
  partyCode: string;
  symbol: string;
  constituency: string;
};

const SAMPLE_CANDIDATES: Candidate[] = [
  { id: "C-001", name: "Abdullah Al-Mamun", partyCode: "NPP", symbol: "🌿", constituency: "Dhaka-1" },
  { id: "C-002", name: "Fatima Begum", partyCode: "DA", symbol: "🤝", constituency: "Dhaka-1" },
  { id: "C-003", name: "Rafiqul Islam", partyCode: "PV", symbol: "📣", constituency: "Dhaka-1" },
  { id: "C-004", name: "Nusrat Jahan", partyCode: "NPP", symbol: "🌿", constituency: "Chittagong-1" },
  { id: "C-005", name: "Shafiqul Haque", partyCode: "DA", symbol: "🤝", constituency: "Chittagong-1" },
  { id: "C-006", name: "Razia Sultana", partyCode: "UF", symbol: "⚖️", constituency: "Chittagong-1" },
  { id: "C-007", name: "Mahmud Hassan", partyCode: "NPP", symbol: "🌿", constituency: "Sylhet-1" },
  { id: "C-008", name: "Anika Rahman", partyCode: "DA", symbol: "🤝", constituency: "Sylhet-1" },
];

type Tab = "add" | "list" | "elections";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("add");
  const [filterConstituency, setFilterConstituency] = useState<string>("all");

  // ── Add Candidate form state (drives the disabled button) ──
  const [candName, setCandName] = useState("");
  const [candParty, setCandParty] = useState("");
  const [candSymbol, setCandSymbol] = useState("");
  const [candConstituency, setCandConstituency] = useState("");

  const isCandValid =
    candName.trim().length > 0 &&
    candParty !== "" &&
    candSymbol.trim().length > 0 &&
    candConstituency !== "";

  // ── New Election form state (threat_model.md §10 — the real entry point
  // for setting this system up for a different election; wired to the
  // actual POST /elections route, unlike the candidate form above which is
  // still a UI mock over sample data) ──
  const [electionAdminSecret, setElectionAdminSecret] = useState("");
  const [newElectionId, setNewElectionId] = useState("");
  const [newElectionName, setNewElectionName] = useState("");
  const [newConstituencyCount, setNewConstituencyCount] = useState(8);
  const [electionSubmitting, setElectionSubmitting] = useState(false);
  const [electionError, setElectionError] = useState<string | null>(null);
  const [electionSuccess, setElectionSuccess] = useState<string | null>(null);

  const isElectionFormValid =
    electionAdminSecret.trim().length > 0 &&
    /^[A-Za-z0-9_-]+$/.test(newElectionId.trim()) &&
    newElectionName.trim().length > 0 &&
    newConstituencyCount > 0;

  // ── DKG ceremony initialization — establishes the election's public
  // group params (p, g). Not secret, so this is a normal admin action, not
  // a trusted-dealer step — the private key itself is never generated here
  // (see frontend/src/pages/KeyCeremony.tsx for the actual 4-party ceremony). ──
  const [dkgElectionId, setDkgElectionId] = useState("");
  const [dkgSubmitting, setDkgSubmitting] = useState(false);
  const [dkgError, setDkgError] = useState<string | null>(null);
  const [dkgSuccess, setDkgSuccess] = useState<string | null>(null);

  const handleInitDkg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!electionAdminSecret.trim() || !dkgElectionId.trim()) return;
    setDkgSubmitting(true);
    setDkgError(null);
    setDkgSuccess(null);
    try {
      const result = await initDkgCeremony(electionAdminSecret.trim(), dkgElectionId.trim());
      setDkgSuccess(
        `Ceremony initialized for "${result.election_id}". Keyholders can now use "Join Key Generation Ceremony" on the Key Holder Portal login page.`
      );
    } catch (err) {
      setDkgError(err instanceof ApiError ? err.message : "Failed to initialize ceremony.");
    } finally {
      setDkgSubmitting(false);
    }
  };

  const handleCreateElection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isElectionFormValid) return;
    setElectionSubmitting(true);
    setElectionError(null);
    setElectionSuccess(null);
    try {
      const created = await createElection(
        electionAdminSecret.trim(),
        newElectionId.trim(),
        newElectionName.trim(),
        newConstituencyCount
      );
      setElectionSuccess(
        `Election "${created.election_id}" created (status: ${created.status}). Next: deploy contracts and seed candidates/constituencies/keyholders for it.`
      );
      setNewElectionId("");
      setNewElectionName("");
      setNewConstituencyCount(8);
    } catch (err) {
      setElectionError(err instanceof ApiError ? err.message : "Failed to create election.");
    } finally {
      setElectionSubmitting(false);
    }
  };

  const filteredCandidates =
    filterConstituency === "all"
      ? SAMPLE_CANDIDATES
      : SAMPLE_CANDIDATES.filter((c) => c.constituency === filterConstituency);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#F2F5FA" }}
    >
      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* ── Header bar ── */}
        <div className="glass-card overflow-hidden mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in-up">
          <div
            className="flex w-full sm:w-auto items-center gap-2 px-6 py-3.5"
            style={{ background: "#0A2540" }}
          >
            <svg
              className="w-4 h-4 text-amber-400"
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
              EC Admin Dashboard
            </span>
          </div>
          <div className="px-6 py-2 w-full sm:w-auto flex items-center justify-between sm:justify-end gap-4">
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-amber-50 border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: "#0A2540" }}>
                EC Admin Session
              </span>
            </div>
            <button
              onClick={() => navigate("/admin/login")}
              className="text-xs font-medium transition-colors"
              style={{ color: "#627d98" }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="text-center mb-8 opacity-0-init animate-fade-in-up-delayed">
          <h1
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{ color: "#0A2540" }}
          >
            Candidate Management
          </h1>
          <p style={{ color: "#627d98" }}>
            Register new candidates and review the current ballot roster by constituency.
          </p>
        </div>

        {/* ── Tab navigation (pill toggle) ── */}
        <div
          className="mb-8 mx-auto max-w-md flex gap-1 p-1 rounded-2xl opacity-0-init"
          style={{
            background: "rgba(10, 37, 64, 0.05)",
            animation: "fade-in-up 0.5s ease-out 0.2s forwards",
          }}
        >
          <button
            onClick={() => setActiveTab("add")}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300"
            style={{
              background: activeTab === "add" ? "#ffffff" : "transparent",
              color: activeTab === "add" ? "#0A2540" : "#627d98",
              boxShadow: activeTab === "add" ? "var(--shadow-card)" : "none",
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Candidate
            </span>
          </button>
          <button
            onClick={() => setActiveTab("list")}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300"
            style={{
              background: activeTab === "list" ? "#ffffff" : "transparent",
              color: activeTab === "list" ? "#0A2540" : "#627d98",
              boxShadow: activeTab === "list" ? "var(--shadow-card)" : "none",
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
              Candidates List
              <span
                className="ml-1 text-[11px] font-mono px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600"
              >
                {SAMPLE_CANDIDATES.length}
              </span>
            </span>
          </button>
          <button
            onClick={() => setActiveTab("elections")}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300"
            style={{
              background: activeTab === "elections" ? "#ffffff" : "transparent",
              color: activeTab === "elections" ? "#0A2540" : "#627d98",
              boxShadow: activeTab === "elections" ? "var(--shadow-card)" : "none",
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A8.959 8.959 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
              </svg>
              New Election
            </span>
          </button>
        </div>

        {/* ═══════════════════════════════════════════
            TAB: Add Candidate
            ═══════════════════════════════════════════ */}
        {activeTab === "add" && (
          <div
            className="glass-card overflow-hidden opacity-0-init animate-scale-in"
          >
            <div
              className="flex items-center gap-2 px-6 py-3.5"
              style={{ background: "#0A2540" }}
            >
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
              </svg>
              <span className="text-sm font-semibold text-white">
                Register New Candidate
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              className="space-y-5 p-6 md:p-8"
            >
              {/* Candidate Name */}
              <div>
                <label
                  htmlFor="cand-name"
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
                  Candidate Name
                </label>
                <input
                  id="cand-name"
                  type="text"
                  value={candName}
                  onChange={(e) => setCandName(e.target.value)}
                  placeholder="Full name as it should appear on the ballot"
                  className="input-field"
                />
              </div>

              {/* Party + Symbol row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="cand-party"
                    className="mb-1.5 block text-sm font-medium"
                    style={{ color: "#0A2540" }}
                  >
                    Political Party
                  </label>
                  <select
                    id="cand-party"
                    value={candParty}
                    onChange={(e) => setCandParty(e.target.value)}
                    className="input-field bg-white cursor-pointer"
                  >
                    <option value="">Select party</option>
                    {PARTIES.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="cand-symbol"
                    className="mb-1.5 block text-sm font-medium"
                    style={{ color: "#0A2540" }}
                  >
                    Ballot Symbol
                  </label>
                  <input
                    id="cand-symbol"
                    type="text"
                    value={candSymbol}
                    onChange={(e) => setCandSymbol(e.target.value)}
                    placeholder="e.g. 🌿 or Rising Sun"
                    className="input-field"
                  />
                </div>
              </div>

              {/* Constituency */}
              <div>
                <label
                  htmlFor="cand-constituency"
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
                  Constituency
                </label>
                <select
                  id="cand-constituency"
                  value={candConstituency}
                  onChange={(e) => setCandConstituency(e.target.value)}
                  className="input-field bg-white cursor-pointer"
                >
                  <option value="">Select constituency</option>
                  {CONSTITUENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p
                  className="mt-1.5 text-xs"
                  style={{ color: "#9fb3c8" }}
                >
                  Voters from this constituency will see this candidate on their ballot
                </p>
              </div>

              {/* Candidate ID */}
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "#0A2540" }}
                >
                  Candidate ID (auto-generated)
                </label>
                <input
                  type="text"
                  value="C-009"
                  readOnly
                  className="input-field font-mono cursor-not-allowed"
                  style={{ background: "rgba(10, 37, 64, 0.03)" }}
                />
              </div>

              {/* Actions */}
              <div
                className="flex gap-3 pt-3 border-t"
                style={{ borderColor: "rgba(10, 37, 64, 0.08)" }}
              >
                <button type="reset" className="btn-ghost text-sm">
                  Clear
                </button>
                <button type="submit" disabled={!isCandValid} className="btn-navy flex-1 text-sm shadow-sm">
                  <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Register Candidate
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            TAB: Candidates List
            ═══════════════════════════════════════════ */}
        {activeTab === "list" && (
          <div className="opacity-0-init animate-scale-in">
            {/* Filter bar */}
            <div className="glass-card mb-5 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <label
                  htmlFor="filter-constituency"
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "#9fb3c8" }}
                >
                  Filter
                </label>
                <select
                  id="filter-constituency"
                  value={filterConstituency}
                  onChange={(e) => setFilterConstituency(e.target.value)}
                  className="input-field bg-white py-1.5 text-sm w-auto cursor-pointer"
                  style={{ minWidth: "180px" }}
                >
                  <option value="all">All constituencies</option>
                  {CONSTITUENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <span
                className="text-xs font-mono px-2.5 py-1 rounded-full bg-amber-50 text-amber-600"
              >
                Showing {filteredCandidates.length} of {SAMPLE_CANDIDATES.length}
              </span>
            </div>

            {/* Candidate grid (matches VotingPage candidate card pattern) */}
            {filteredCandidates.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <p className="text-sm" style={{ color: "#9fb3c8" }}>
                  No candidates found in this constituency
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {filteredCandidates.map((c, i) => {
                  const party = PARTIES.find((p) => p.code === c.partyCode) || PARTIES[0];
                  return (
                    <div
                      key={c.id}
                      className="relative glass-card p-6 opacity-0-init transition-all duration-300 hover:scale-[1.01]"
                      style={{
                        animation: `fade-in-up 0.4s ease-out ${0.05 + i * 0.06}s forwards`,
                      }}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span
                          className="text-xs font-mono font-semibold"
                          style={{ color: "#9fb3c8" }}
                        >
                          {c.id}
                        </span>
                        <span
                          className="text-xs font-mono px-2 py-0.5 rounded"
                          style={{ background: "rgba(10, 37, 64, 0.05)", color: "#0A2540" }}
                        >
                          {c.constituency}
                        </span>
                      </div>

                      <div className="flex items-start gap-4 mt-2">
                        <div
                          className={`w-14 h-14 rounded-xl bg-gradient-to-br ${party.theme} flex items-center justify-center text-2xl shadow-sm flex-shrink-0 text-white`}
                        >
                          {c.symbol}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3
                            className="text-lg font-semibold truncate"
                            style={{ color: "#0A2540" }}
                          >
                            {c.name}
                          </h3>
                          <span
                            className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${party.bg} ${party.accent}`}
                          >
                            {party.name}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div
                        className="mt-5 pt-4 flex items-center gap-4 border-t"
                        style={{ borderColor: "rgba(10, 37, 64, 0.06)" }}
                      >
                        <button
                          className="text-xs font-semibold transition-colors text-amber-600 hover:text-amber-700"
                        >
                          Edit
                        </button>
                        <button
                          className="text-xs font-semibold transition-colors"
                          style={{ color: "#F42A41" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════
            TAB: New Election (threat_model.md §10 — real entry point for
            replicating this system for a different election; the only tab
            on this page wired to an actual write route, POST /elections)
            ═══════════════════════════════════════════ */}
        {activeTab === "elections" && (
          <div className="glass-card overflow-hidden opacity-0-init animate-scale-in">
            <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="text-sm font-semibold text-white">Register a New Election</span>
            </div>

            <form onSubmit={handleCreateElection} className="space-y-5 p-6 md:p-8">
              <p className="text-sm" style={{ color: "#627d98" }}>
                Creates the registry row every other table (voters, candidates, constituencies,
                anchored batches, keyholders) requires before it can reference this election.
                Deploying contracts and seeding candidates/constituencies/keyholders for it are
                separate steps (see backend/src/scripts/).
              </p>

              {electionError && (
                <div className="rounded-xl p-4" style={{ background: "rgba(244,42,65,0.05)", border: "1px solid rgba(244,42,65,0.2)" }}>
                  <p className="text-sm font-medium" style={{ color: "#F42A41" }}>⚠ {electionError}</p>
                </div>
              )}
              {electionSuccess && (
                <div className="rounded-xl p-4" style={{ background: "rgba(0,106,78,0.06)", border: "1px solid rgba(0,106,78,0.2)" }}>
                  <p className="text-sm font-medium" style={{ color: "#0F6E56" }}>✓ {electionSuccess}</p>
                </div>
              )}

              <div>
                <label htmlFor="election-id" className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                  Election ID
                </label>
                <input
                  id="election-id"
                  type="text"
                  value={newElectionId}
                  onChange={(e) => setNewElectionId(e.target.value)}
                  placeholder="e.g. NATIONAL-2027-001"
                  className="input-field font-mono"
                />
                <p className="mt-1.5 text-xs" style={{ color: "#9fb3c8" }}>
                  Alphanumeric, - and _ only. This is the value every page's ?election_id= must match.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="election-name" className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                    Election Name
                  </label>
                  <input
                    id="election-name"
                    type="text"
                    value={newElectionName}
                    onChange={(e) => setNewElectionName(e.target.value)}
                    placeholder="e.g. National Election 2027"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="election-constituencies" className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                    Constituency Count
                  </label>
                  <input
                    id="election-constituencies"
                    type="number"
                    min={1}
                    value={newConstituencyCount}
                    onChange={(e) => setNewConstituencyCount(Number(e.target.value) || 0)}
                    className="input-field font-mono"
                  />
                  <p className="mt-1.5 text-xs" style={{ color: "#9fb3c8" }}>
                    Replaces the old hardcoded 8-constituency assumption — each election declares its own.
                  </p>
                </div>
              </div>

              <div>
                <label htmlFor="election-admin-secret" className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                  Admin Secret
                </label>
                <input
                  id="election-admin-secret"
                  type="password"
                  value={electionAdminSecret}
                  onChange={(e) => setElectionAdminSecret(e.target.value)}
                  placeholder="x-admin-secret"
                  className="input-field"
                  autoComplete="off"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t" style={{ borderColor: "rgba(10, 37, 64, 0.08)" }}>
                <button type="submit" disabled={!isElectionFormValid || electionSubmitting} className="btn-navy flex-1 text-sm shadow-sm">
                  {electionSubmitting ? "Creating…" : "Create Election"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            TAB: Initialize Key Ceremony — establishes public group params
            (p, g) so keyholders can then run the 4-party DKG ceremony
            (KeyCeremony.tsx). Uses the same admin secret entered above.
            ═══════════════════════════════════════════ */}
        {activeTab === "elections" && (
          <div className="glass-card overflow-hidden opacity-0-init animate-scale-in mt-6">
            <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span className="text-sm font-semibold text-white">Initialize Key Ceremony</span>
            </div>

            <form onSubmit={handleInitDkg} className="space-y-4 p-6 md:p-8">
              <p className="text-sm" style={{ color: "#627d98" }}>
                Publishes fresh public domain parameters (p, g) for an election so its 4 keyholders
                can run the distributed key generation ceremony themselves — no single party ever
                generates the private key. Uses the admin secret entered above.
              </p>

              {dkgError && (
                <div className="rounded-xl p-4" style={{ background: "rgba(244,42,65,0.05)", border: "1px solid rgba(244,42,65,0.2)" }}>
                  <p className="text-sm font-medium" style={{ color: "#F42A41" }}>⚠ {dkgError}</p>
                </div>
              )}
              {dkgSuccess && (
                <div className="rounded-xl p-4" style={{ background: "rgba(0,106,78,0.06)", border: "1px solid rgba(0,106,78,0.2)" }}>
                  <p className="text-sm font-medium" style={{ color: "#0F6E56" }}>✓ {dkgSuccess}</p>
                </div>
              )}

              <div>
                <label htmlFor="dkg-election-id" className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                  Election ID
                </label>
                <input
                  id="dkg-election-id"
                  type="text"
                  value={dkgElectionId}
                  onChange={(e) => setDkgElectionId(e.target.value)}
                  placeholder="e.g. NATIONAL-2027-001"
                  className="input-field font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={!electionAdminSecret.trim() || !dkgElectionId.trim() || dkgSubmitting}
                className="btn-navy w-full text-sm shadow-sm"
              >
                {dkgSubmitting ? "Initializing…" : "Initialize Ceremony"}
              </button>
            </form>
          </div>
        )}

        {/* ── Back to home ── */}
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate("/")}
            className="text-sm transition-colors"
            style={{ color: "#627d98" }}
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

export default AdminDashboard;
