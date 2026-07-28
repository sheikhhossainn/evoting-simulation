/**
 * TamperVisualizer.tsx
 *
 * A single, self-contained page that shows how the system's tamper-evidence
 * works — and lets you watch a live tamper attempt get caught. No login for
 * the read-only zones; the tamper console prompts once for the admin secret.
 *
 * Four zones:
 *   1. Flow diagram      — the vote → nullifier → Merkle batch → on-chain root
 *                          → verify pipeline (docs/meeting-cheatsheet.md §3).
 *   2. Anchor status     — latest batch, root, and a deep link to the real
 *                          Sepolia transaction (the trust anchor we don't own).
 *   3. Verify a vote     — live GET /anchor/verify/:id; local + on-chain agree.
 *   4. Tamper console    — vector 1 (edit root → 409 → restore) and vector 2
 *                          (edit ballot → DB trigger blocks it), plus the
 *                          honestly-reported boundaries (§6).
 *
 * All state is fetched live from the backend + chain. A 409 from verify is
 * rendered as the triumphant "tamper caught" state, not an error.
 */

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getLatestBatch,
  verifyVoteOutcome,
  tamperRoot,
  restoreRoot,
  tamperBallot,
  ApiError,
  type LatestBatchResponse,
  type VerifyOutcome,
  type TamperBallotResponse,
} from "../utils/api";

const SEPOLIA_TX = "https://sepolia.etherscan.io/tx/";
const CONTRACT = "0x7f228912a2a709010F9419582d021485B5F4d928";
const SEPOLIA_CONTRACT = `https://sepolia.etherscan.io/address/${CONTRACT}`;

const shorten = (s: string, head = 10, tail = 8) =>
  s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

export default function TamperVisualizer() {
  const [batch, setBatch] = useState<LatestBatchResponse | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const loadBatch = useCallback(async () => {
    try {
      setBatch(await getLatestBatch());
      setBatchError(null);
    } catch (err) {
      setBatch(null);
      setBatchError(
        err instanceof ApiError && err.status === 404
          ? "No batch has been anchored yet. Cast some seeded votes and run an anchor batch first."
          : "Unable to reach the backend on :3000."
      );
    }
  }, []);

  useEffect(() => {
    loadBatch();
  }, [loadBatch]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ════════ HERO ════════ */}
      <section className="watchdog-grid-bg px-4 pb-6 pt-12 text-center sm:pt-16">
        <div className="mb-4 flex justify-center anim-fade-in-up">
          <div className="live-badge">
            <span className="live-dot" />
            Tamper-Evidence Visualizer
          </div>
        </div>
        <h1
          className="text-3xl font-bold tracking-tight sm:text-4xl anim-fade-in-up anim-delay-1"
          style={{ color: "#0A2540" }}
        >
          How the System Proves It Wasn't Tampered With
        </h1>
        <p
          className="mx-auto mt-3 max-w-2xl text-base leading-relaxed anim-fade-in-up anim-delay-2"
          style={{ color: "#627d98" }}
        >
          Every vote batch is fingerprinted into a Merkle root committed on a
          public blockchain we don't control. Edit the data and an honest
          verifier catches it. Watch it happen below — live.
        </p>
      </section>

      <div className="mx-auto max-w-5xl px-4 pb-16 pt-2">
        <FlowDiagram />
        <AnchorStatus batch={batch} error={batchError} />
        <VerifyZone sampleVoteId={batch?.sample_vote_id ?? null} />
        <TamperConsole batch={batch} onChanged={loadBatch} />

        <p className="mt-8 text-center text-xs" style={{ color: "#9fb3c8" }}>
          Operates on seeded / mock data only ·{" "}
          <Link to="/watchdog" className="font-semibold" style={{ color: "#C8920A" }}>
            Public Watchdog →
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ════════════════════ Zone 1 — Flow diagram ════════════════════ */

const FLOW_STEPS = [
  { n: 1, title: "Encrypted ballot", body: "Voter submits an ElGamal-encrypted vote over HTTPS." },
  { n: 2, title: "Nullifier + atomic cast", body: "Server derives a nullifier from a secret; stores the vote with no voter identity." },
  { n: 3, title: "Merkle batch", body: "Unanchored votes are hashed into a Merkle tree (keccak256)." },
  { n: 4, title: "Root on-chain", body: "Only the root is written to the Sepolia contract — public and immutable." },
  { n: 5, title: "Anyone verifies", body: "Re-checks the proof locally AND against the chain. Both must agree." },
];

function FlowDiagram() {
  return (
    <div className="glass-card p-6 mb-8 anim-fade-in-up anim-delay-3">
      <h2 className="text-base font-bold mb-1" style={{ color: "#0A2540" }}>
        The pipeline
      </h2>
      <p className="text-xs mb-5" style={{ color: "#627d98" }}>
        The chain is the trust anchor. The last step is the one that catches tampering.
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0">
        {FLOW_STEPS.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-stretch">
            <div
              className="flex-1 rounded-xl p-4"
              style={{
                background: i === 4 ? "rgba(0,106,78,0.06)" : "rgba(10,37,64,0.03)",
                border: `1px solid ${i === 4 ? "rgba(0,106,78,0.18)" : "rgba(10,37,64,0.07)"}`,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: i === 4 ? "#006A4E" : "#0A2540" }}
                >
                  {s.n}
                </span>
                <span className="text-xs font-bold" style={{ color: "#0A2540" }}>
                  {s.title}
                </span>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "#627d98" }}>
                {s.body}
              </p>
            </div>
            {i < FLOW_STEPS.length - 1 && (
              <div className="hidden md:flex items-center px-1" style={{ color: "#9fb3c8" }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════ Zone 2 — Anchor status ════════════════════ */

function AnchorStatus({ batch, error }: { batch: LatestBatchResponse | null; error: string | null }) {
  return (
    <div className="glass-card overflow-hidden mb-8 anim-fade-in-up anim-delay-4">
      <div className="flex items-center justify-between px-6 py-3.5" style={{ background: "#0A2540" }}>
        <span className="text-sm font-semibold text-white">Latest On-Chain Anchor</span>
        <a
          href={SEPOLIA_CONTRACT}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-teal-300 hover:text-teal-200"
        >
          Contract on Etherscan ↗
        </a>
      </div>
      <div className="p-6">
        {error && (
          <p className="text-sm font-medium" style={{ color: "#C8920A" }}>
            ⚠ {error}
          </p>
        )}
        {batch && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Batch ID" value={`#${batch.batch_id}`} mono />
            <Field label="Votes in batch" value={String(batch.vote_count)} />
            <div className="sm:col-span-2">
              <FieldLabel>Merkle root</FieldLabel>
              <span className="font-mono text-xs font-semibold break-all" style={{ color: "#0A2540" }}>
                {batch.root}
              </span>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Sepolia transaction</FieldLabel>
              <a
                href={`${SEPOLIA_TX}${batch.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs font-semibold break-all hover:underline"
                style={{ color: "#006A4E" }}
              >
                {shorten(batch.tx_hash, 18, 12)} ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════ Zone 3 — Verify a vote ════════════════════ */

function VerifyZone({ sampleVoteId }: { sampleVoteId: string | null }) {
  const [voteId, setVoteId] = useState("");
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill with the sample vote id from the latest batch, once available.
  useEffect(() => {
    if (sampleVoteId && !voteId) setVoteId(sampleVoteId);
  }, [sampleVoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voteId.trim()) return;
    setBusy(true);
    setOutcome(await verifyVoteOutcome(voteId.trim()));
    setBusy(false);
  };

  return (
    <div className="glass-card overflow-hidden mb-8 anim-fade-in-up anim-delay-5">
      <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
        <span className="text-sm font-semibold text-white">Verify a Vote</span>
      </div>
      <div className="p-6">
        <p className="text-sm mb-4" style={{ color: "#627d98" }}>
          Regenerates the Merkle proof and checks it <strong>locally and against the
          on-chain contract</strong>. Both must agree.
        </p>
        <form onSubmit={run} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={voteId}
            onChange={(e) => setVoteId(e.target.value)}
            placeholder="vote id…"
            className="input-field font-mono text-xs flex-1"
          />
          <button type="submit" disabled={busy || !voteId.trim()} className="btn-navy text-sm px-6 shrink-0">
            {busy ? "Checking…" : "Verify"}
          </button>
        </form>

        {outcome && <VerifyResult outcome={outcome} />}
      </div>
    </div>
  );
}

function VerifyResult({ outcome }: { outcome: VerifyOutcome }) {
  if (outcome.kind === "verified") {
    const d = outcome.data;
    return (
      <ResultCard tone="green" title="Vote Verified — local & on-chain agree">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <MiniField label="Included locally" value={d.included_locally ? "✓ true" : "✗ false"} good={d.included_locally} />
          <MiniField
            label="Included on-chain"
            value={d.included_on_chain === null ? "not configured" : d.included_on_chain ? "✓ true" : "✗ false"}
            good={d.included_on_chain === true}
          />
          <MiniField label="Batch" value={`#${d.batch_id}`} good />
        </div>
      </ResultCard>
    );
  }
  if (outcome.kind === "tampered") {
    return (
      <ResultCard tone="red" title="Tamper Caught — verification refused (HTTP 409)">
        <p className="text-xs" style={{ color: "#8a1020" }}>
          {outcome.message}
        </p>
        <p className="text-xs mt-2" style={{ color: "#627d98" }}>
          The recomputed root no longer matches the root anchored on Sepolia, so the
          endpoint refuses to return a proof. This is the system working as designed.
        </p>
      </ResultCard>
    );
  }
  return (
    <ResultCard tone="amber" title={outcome.kind === "not_anchored" ? "Not Anchored Yet" : "Error"}>
      <p className="text-xs" style={{ color: "#8a6d1a" }}>{outcome.message}</p>
    </ResultCard>
  );
}

/* ════════════════════ Zone 4 — Tamper console ════════════════════ */

type TamperState =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "root_tampered"; message: string }
  | { kind: "restored"; message: string }
  | { kind: "ballot"; result: TamperBallotResponse }
  | { kind: "error"; message: string };

function TamperConsole({ batch, onChanged }: { batch: LatestBatchResponse | null; onChanged: () => void }) {
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<TamperState>({ kind: "idle" });

  const guard = (): boolean => {
    if (!secret.trim()) {
      setState({ kind: "error", message: "Enter the admin secret first." });
      return false;
    }
    return true;
  };

  const asMessage = (err: unknown) =>
    err instanceof ApiError ? err.message : "Request failed — is the backend running?";

  const doTamperRoot = async () => {
    if (!guard()) return;
    setState({ kind: "busy", label: "Editing the anchored root in the DB…" });
    try {
      const r = await tamperRoot(secret.trim());
      setState({ kind: "root_tampered", message: r.note });
      onChanged();
    } catch (err) {
      setState({ kind: "error", message: asMessage(err) });
    }
  };

  const doRestore = async () => {
    if (!guard()) return;
    setState({ kind: "busy", label: "Recomputing the true root and writing it back…" });
    try {
      const r = await restoreRoot(secret.trim());
      setState({ kind: "restored", message: r.note });
      onChanged();
    } catch (err) {
      setState({ kind: "error", message: asMessage(err) });
    }
  };

  const doTamperBallot = async () => {
    if (!guard()) return;
    setState({ kind: "busy", label: "Attempting to edit an encrypted ballot…" });
    try {
      const r = await tamperBallot(secret.trim());
      setState({ kind: "ballot", result: r });
    } catch (err) {
      setState({ kind: "error", message: asMessage(err) });
    }
  };

  const busy = state.kind === "busy";

  return (
    <div className="glass-card overflow-hidden mb-8 anim-fade-in-up anim-delay-6">
      <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#7a1020" }}>
        <span className="text-sm font-semibold text-white">Tamper Console (live)</span>
        <span className="text-[11px] text-red-200">
          {batch ? `targets batch #${batch.batch_id}` : "no batch"}
        </span>
      </div>
      <div className="p-6">
        <p className="text-sm mb-4" style={{ color: "#627d98" }}>
          These buttons really mutate the database, then let you re-verify above and
          watch the result flip. Restore recomputes the correct root, so it's safe to
          repeat.
        </p>

        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="admin secret (x-admin-secret)…"
          className="input-field text-xs mb-4"
          autoComplete="off"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={doTamperRoot} disabled={busy || !batch} className="btn-navy text-sm" style={{ background: "#c0392b" }}>
            1 · Edit on-chain root
          </button>
          <button onClick={doRestore} disabled={busy || !batch} className="btn-navy text-sm" style={{ background: "#006A4E" }}>
            Restore root
          </button>
          <button onClick={doTamperBallot} disabled={busy || !batch} className="btn-navy text-sm" style={{ background: "#b7791f" }}>
            2 · Edit a ballot
          </button>
        </div>

        {state.kind === "busy" && (
          <ResultCard tone="amber" title="Working…">
            <p className="text-xs" style={{ color: "#8a6d1a" }}>{state.label}</p>
          </ResultCard>
        )}
        {state.kind === "root_tampered" && (
          <ResultCard tone="red" title="Root edited — now re-verify above">
            <p className="text-xs" style={{ color: "#8a1020" }}>{state.message}</p>
          </ResultCard>
        )}
        {state.kind === "restored" && (
          <ResultCard tone="green" title="Root restored — verify returns to green">
            <p className="text-xs" style={{ color: "#0a5a44" }}>{state.message}</p>
          </ResultCard>
        )}
        {state.kind === "ballot" && (
          <ResultCard
            tone={state.result.blocked ? "green" : "red"}
            title={state.result.blocked ? "Ballot edit BLOCKED by DB trigger" : "Ballot edit was NOT blocked"}
          >
            <p className="text-xs" style={{ color: state.result.blocked ? "#0a5a44" : "#8a1020" }}>
              {state.result.note}
            </p>
            {state.result.db_message && (
              <p className="text-[11px] mt-2 font-mono break-all" style={{ color: "#627d98" }}>
                {state.result.db_message}
              </p>
            )}
          </ResultCard>
        )}
        {state.kind === "error" && (
          <ResultCard tone="amber" title="Couldn't run that">
            <p className="text-xs" style={{ color: "#8a6d1a" }}>{state.message}</p>
          </ResultCard>
        )}

        {/* Honest boundaries — the paper's methodological point (§6). */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BoundaryCard
            title="Pre-anchor window"
            body="A vote is only tamper-evident after its batch is anchored. Edits before anchoring leave no on-chain trace — the guarantee is bounded by anchoring cadence."
          />
          <BoundaryCard
            title="Deletion vs. edit"
            body="A Merkle root proves inclusion, not completeness. Editing a leaf is caught; deleting a whole vote can leave a self-consistent smaller tree unless a leaf-count is also committed on-chain."
          />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════ Small shared bits ════════════════════ */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "#9fb3c8" }}>
      {children}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <span className={`text-sm font-semibold ${mono ? "font-mono" : ""}`} style={{ color: "#0A2540" }}>
        {value}
      </span>
    </div>
  );
}

function MiniField({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.6)" }}>
      <FieldLabel>{label}</FieldLabel>
      <span className="text-xs font-semibold" style={{ color: good ? "#006A4E" : "#c0392b" }}>
        {value}
      </span>
    </div>
  );
}

const TONES = {
  green: { bg: "rgba(0,106,78,0.05)", border: "rgba(0,106,78,0.2)", title: "#006A4E" },
  red: { bg: "rgba(192,57,43,0.05)", border: "rgba(192,57,43,0.22)", title: "#c0392b" },
  amber: { bg: "rgba(200,146,10,0.06)", border: "rgba(200,146,10,0.22)", title: "#b7791f" },
} as const;

function ResultCard({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
      <p className="text-sm font-bold mb-1.5" style={{ color: t.title }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function BoundaryCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(200,146,10,0.05)", border: "1px dashed rgba(200,146,10,0.3)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: "#b7791f" }}>⚠</span>
        <span className="text-xs font-bold" style={{ color: "#0A2540" }}>{title}</span>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: "#627d98" }}>{body}</p>
    </div>
  );
}
