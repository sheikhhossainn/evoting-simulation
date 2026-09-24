/**
 * KeyCeremony.tsx — Distributed Key Generation (DKG) ceremony portal
 *
 * Replaces the trusted-dealer setup-shamir-zq.ts script. Each keyholder
 * runs this page once: generates their own polynomial + Feldman
 * commitments locally (frontend/src/utils/dkgCrypto.ts), publishes only
 * PUBLIC commitments and end-to-end-encrypted sub-shares, and combines
 * incoming sub-shares into their final key share entirely in this
 * browser tab. The server (backend/src/routes/dkg.ts) only ever relays
 * public data and ciphertext it cannot read — the private key never
 * exists anywhere in full, not even momentarily.
 *
 * The ceremony spans 3 rounds, each gated on all 4 keyholders' browsers
 * completing the previous one — this tab polls and auto-advances. Own
 * polynomial + ceremony ECDH keypair are kept in sessionStorage between
 * rounds (survives this tab's polling wait, not a closed browser — the
 * ceremony is a scheduled one-time event, not recoverable mid-flight
 * from a lost session; retry the whole ceremony if a keyholder drops).
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getElectionId } from "../utils/nullifier";
import {
  ApiError,
  getDkgStatus,
  submitDkgRound1,
  getDkgRound1,
  submitDkgRound2,
  getDkgRound2Inbox,
  submitDkgRound3,
  type DkgStatusResponse,
} from "../utils/api";
import {
  generatePolynomial,
  computeShare,
  computeCommitments,
  verifyFeldmanShare,
  bigIntToHex,
  hexToBigInt,
  generateEcdhKeyPair,
  exportEcdhPublicKeyHex,
  importEcdhPublicKeyFromHex,
  exportEcdhPrivateKeyJwk,
  importEcdhPrivateKeyJwk,
  deriveTransportKey,
  encryptSubShare,
  decryptSubShare,
} from "../utils/dkgCrypto";

type Phase =
  | "no_keyholder"
  | "auth"
  | "loading"
  | "round1_ready"
  | "round1_waiting"
  | "round2_ready"
  | "round2_waiting"
  | "round3_ready"
  | "round3_waiting"
  | "qualified";

interface SessionMaterial {
  polynomialHex: string[];
  ecdhPrivateJwk: JsonWebKey;
}

const POLL_MS = 5_000;

const PHASE_LABEL: Record<Phase, string> = {
  no_keyholder: "",
  auth: "Enter your passphrase to begin",
  loading: "Loading ceremony status…",
  round1_ready: "Round 1 — publish your commitments",
  round1_waiting: "Round 1 — waiting for other key holders",
  round2_ready: "Round 2 — send your encrypted sub-shares",
  round2_waiting: "Round 2 — waiting for incoming sub-shares",
  round3_ready: "Round 3 — combine and confirm",
  round3_waiting: "Round 3 — waiting for ceremony to qualify",
  qualified: "Ceremony complete",
};

const KeyCeremony = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const ELECTION_ID = getElectionId(location.search);
  const keyholderId = (location.state as { keyholderId?: string } | null)?.keyholderId ?? "";

  const [passphrase, setPassphrase] = useState("");
  const [phase, setPhase] = useState<Phase>(keyholderId ? "auth" : "no_keyholder");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DkgStatusResponse | null>(null);
  const [myIndex, setMyIndex] = useState<number | null>(null);
  const [finalShareHex, setFinalShareHex] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storageKey = `dkg-ceremony-${ELECTION_ID}-${keyholderId}`;
  const loadSession = (): SessionMaterial | null => {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionMaterial;
    } catch {
      return null;
    }
  };
  const saveSession = (m: SessionMaterial) => sessionStorage.setItem(storageKey, JSON.stringify(m));
  const clearSession = () => sessionStorage.removeItem(storageKey);

  const refreshStatus = useCallback(async () => {
    const s = await getDkgStatus(ELECTION_ID);
    setStatus(s);
    const mine = s.keyholders.find((k) => k.keyholder_id === keyholderId);
    if (mine) setMyIndex(mine.index);
    return s;
  }, [ELECTION_ID, keyholderId]);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback);

  // ── Auth: resume wherever this keyholder actually is ──
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await refreshStatus();
      const mine = s.keyholders.find((k) => k.keyholder_id === keyholderId);
      if (!mine) {
        setError("Unknown keyholder id for this election.");
        return;
      }
      if (s.status === "qualified" || mine.round3_confirmed) {
        setPhase("qualified");
      } else if (mine.round2_submitted) {
        setPhase("round3_ready");
      } else if (mine.round1_submitted) {
        setPhase(s.keyholders.every((k) => k.round1_submitted) ? "round2_ready" : "round1_waiting");
      } else {
        setPhase("round1_ready");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("Ceremony has not been initialized for this election yet — ask an administrator to run it.");
      } else {
        fail(err, "Failed to load ceremony status.");
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Round 1: generate own polynomial, publish commitments ──
  const runRound1 = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!status) throw new Error("Ceremony status not loaded.");
      const p = hexToBigInt(status.group_params.p);
      const q = (p - 1n) / 2n;
      const g = hexToBigInt(status.group_params.g);

      const polynomial = generatePolynomial(q, 3);
      const commitments = computeCommitments(polynomial, g, p);
      const ecdhKeyPair = await generateEcdhKeyPair();
      const ecdhPublicHex = await exportEcdhPublicKeyHex(ecdhKeyPair.publicKey);
      const ecdhPrivateJwk = await exportEcdhPrivateKeyJwk(ecdhKeyPair.privateKey);

      saveSession({ polynomialHex: polynomial.map(bigIntToHex), ecdhPrivateJwk });

      const result = await submitDkgRound1({
        election_id: ELECTION_ID,
        keyholder_id: keyholderId,
        passphrase,
        commitments: commitments.map(bigIntToHex),
        ecdh_pubkey: ecdhPublicHex,
      });
      setMyIndex(result.index);
      setPhase("round1_waiting");
    } catch (err) {
      fail(err, "Round 1 submission failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "round1_waiting") return;
    const check = async () => {
      try {
        const r1 = await getDkgRound1(ELECTION_ID);
        if (r1.complete) setPhase("round2_ready");
      } catch (err) {
        fail(err, "Failed to poll round 1 status.");
      }
    };
    check();
    const interval = setInterval(check, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ELECTION_ID]);

  // ── Round 2: compute + encrypt one sub-share per recipient ──
  const runRound2 = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = loadSession();
      if (!session || !status) throw new Error("Ceremony session data missing in this tab — cannot continue.");

      const p = hexToBigInt(status.group_params.p);
      const q = (p - 1n) / 2n;
      const polynomial = session.polynomialHex.map(hexToBigInt);
      const privateKey = await importEcdhPrivateKeyJwk(session.ecdhPrivateJwk);

      const r1 = await getDkgRound1(ELECTION_ID);
      if (!r1.complete) throw new Error("Round 1 is not complete yet.");

      const shares = await Promise.all(
        r1.participants.map(async (participant) => {
          const shareValue = computeShare(polynomial, BigInt(participant.index), q);
          const peerPublicKey = await importEcdhPublicKeyFromHex(participant.ecdh_pubkey);
          const transportKey = await deriveTransportKey(privateKey, peerPublicKey);
          const { ciphertext, iv } = await encryptSubShare(transportKey, bigIntToHex(shareValue));
          return { to_index: participant.index, ciphertext, iv };
        })
      );

      await submitDkgRound2({ election_id: ELECTION_ID, keyholder_id: keyholderId, passphrase, shares });
      setPhase("round2_waiting");
    } catch (err) {
      fail(err, "Round 2 submission failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "round2_waiting") return;
    const check = async () => {
      try {
        const inbox = await getDkgRound2Inbox({ election_id: ELECTION_ID, keyholder_id: keyholderId, passphrase });
        if (inbox.complete) setPhase("round3_ready");
      } catch (err) {
        fail(err, "Failed to poll round 2 inbox.");
      }
    };
    check();
    const interval = setInterval(check, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ELECTION_ID, keyholderId]);

  // ── Round 3: decrypt + Feldman-verify each sub-share, sum, confirm ──
  const runRound3 = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = loadSession();
      if (!session || !status || myIndex === null) {
        throw new Error("Ceremony session data missing in this tab — cannot continue.");
      }

      const p = hexToBigInt(status.group_params.p);
      const q = (p - 1n) / 2n;
      const g = hexToBigInt(status.group_params.g);
      const privateKey = await importEcdhPrivateKeyJwk(session.ecdhPrivateJwk);

      const [r1, inbox] = await Promise.all([
        getDkgRound1(ELECTION_ID),
        getDkgRound2Inbox({ election_id: ELECTION_ID, keyholder_id: keyholderId, passphrase }),
      ]);
      const commitmentsByIndex = new Map(r1.participants.map((pt) => [pt.index, pt.commitments.map(hexToBigInt)]));
      const pubkeyByIndex = new Map(r1.participants.map((pt) => [pt.index, pt.ecdh_pubkey]));

      let sum = 0n;
      for (const entry of inbox.inbox) {
        const peerPubHex = pubkeyByIndex.get(entry.from_index);
        const senderCommitments = commitmentsByIndex.get(entry.from_index);
        if (!peerPubHex || !senderCommitments) {
          throw new Error(`Missing round-1 material for keyholder #${entry.from_index}.`);
        }
        const peerPublicKey = await importEcdhPublicKeyFromHex(peerPubHex);
        const transportKey = await deriveTransportKey(privateKey, peerPublicKey);
        const shareHex = await decryptSubShare(transportKey, entry.ciphertext, entry.iv);
        const shareValue = hexToBigInt(shareHex);

        if (!verifyFeldmanShare(BigInt(myIndex), shareValue, senderCommitments, g, p)) {
          throw new Error(
            `Sub-share from keyholder #${entry.from_index} failed Feldman verification — possible cheating dealer. Ceremony aborted; do not confirm, contact the other keyholders.`
          );
        }
        sum = (sum + shareValue) % q;
      }

      setFinalShareHex(bigIntToHex(sum));
      await submitDkgRound3({ election_id: ELECTION_ID, keyholder_id: keyholderId, passphrase });
      clearSession();
      setPhase("round3_waiting");
    } catch (err) {
      fail(err, "Round 3 failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "round3_waiting") return;
    const check = async () => {
      try {
        const s = await refreshStatus();
        if (s.status === "qualified") setPhase("qualified");
      } catch (err) {
        fail(err, "Failed to poll ceremony status.");
      }
    };
    check();
    const interval = setInterval(check, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const progressCount = status?.keyholders.filter((k) => k.round1_submitted).length ?? 0;

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "#F2F5FA" }}>
      <div className="relative z-10 max-w-2xl mx-auto px-4 py-10">
        <div className="glass-card overflow-hidden mb-6">
          <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
            <span className="text-sm font-semibold text-white">
              Key Generation Ceremony · {ELECTION_ID}
            </span>
          </div>
          <div className="p-6 md:p-8 space-y-5">
            {phase === "no_keyholder" && (
              <div className="text-center">
                <p className="text-sm" style={{ color: "#627d98" }}>
                  No key holder id found. Please log in first.
                </p>
                <button onClick={() => navigate("/keyholder/login")} className="btn-navy mt-4 text-sm">
                  Go to Key Holder Login
                </button>
              </div>
            )}

            {phase !== "no_keyholder" && (
              <>
                <div>
                  <h1 className="text-xl font-bold" style={{ color: "#0A2540" }}>
                    {keyholderId}
                  </h1>
                  <p className="text-sm mt-1" style={{ color: "#627d98" }}>
                    {PHASE_LABEL[phase]}
                  </p>
                </div>

                {error && (
                  <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(244,42,65,0.08)", color: "#F42A41" }}>
                    ⚠ {error}
                  </div>
                )}

                {phase === "auth" && (
                  <form onSubmit={handleAuthSubmit} className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium" style={{ color: "#0A2540" }}>
                        Passphrase
                      </label>
                      <input
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="input-field"
                      />
                    </div>
                    <button type="submit" disabled={busy || passphrase.length === 0} className="btn-navy w-full text-sm">
                      {busy ? "Loading…" : "Continue"}
                    </button>
                  </form>
                )}

                {phase === "round1_ready" && (
                  <div>
                    <p className="text-sm mb-4" style={{ color: "#627d98" }}>
                      Generates your own random polynomial and Feldman commitments locally in this
                      browser, then publishes only the public commitments. Your private polynomial
                      never leaves this tab.
                    </p>
                    <button onClick={runRound1} disabled={busy} className="btn-navy w-full text-sm">
                      {busy ? "Generating…" : "Generate & Publish My Commitments"}
                    </button>
                  </div>
                )}

                {phase === "round1_waiting" && (
                  <div className="text-center py-4">
                    <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm" style={{ color: "#627d98" }}>
                      {progressCount}/4 key holders have published their round-1 commitments…
                    </p>
                  </div>
                )}

                {phase === "round2_ready" && (
                  <div>
                    <p className="text-sm mb-4" style={{ color: "#627d98" }}>
                      All 4 commitments are in. Computes your 4 sub-shares locally, encrypts each to
                      its recipient (ECDH + AES-GCM), and sends only the encrypted blobs — the server
                      cannot read them.
                    </p>
                    <button onClick={runRound2} disabled={busy} className="btn-navy w-full text-sm">
                      {busy ? "Encrypting…" : "Compute & Send My Sub-Shares"}
                    </button>
                  </div>
                )}

                {phase === "round2_waiting" && (
                  <div className="text-center py-4">
                    <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm" style={{ color: "#627d98" }}>
                      Waiting for the other key holders' encrypted sub-shares to arrive…
                    </p>
                  </div>
                )}

                {phase === "round3_ready" && (
                  <div>
                    <p className="text-sm mb-4" style={{ color: "#627d98" }}>
                      Decrypts each incoming sub-share, verifies it against its sender's published
                      commitments, and sums them into your final key share — entirely in this
                      browser. Confirms to the server afterward (confirmation only, no secret sent).
                    </p>
                    <button onClick={runRound3} disabled={busy} className="btn-navy w-full text-sm">
                      {busy ? "Combining…" : "Combine & Confirm My Share"}
                    </button>
                  </div>
                )}

                {(phase === "round3_waiting" || phase === "qualified") && finalShareHex && (
                  <div className="rounded-lg border p-4" style={{ borderColor: "rgba(200,146,10,0.25)", background: "rgba(200,146,10,0.04)" }}>
                    <p className="text-xs font-semibold text-amber-700 mb-1">
                      Your final key share (record this securely — never sent to the server):
                    </p>
                    <code className="block text-xs font-mono break-all text-amber-700/90">{finalShareHex}</code>
                  </div>
                )}

                {phase === "round3_waiting" && (
                  <div className="text-center py-4">
                    <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm" style={{ color: "#627d98" }}>
                      Waiting for the other key holders to confirm…
                    </p>
                  </div>
                )}

                {phase === "qualified" && (
                  <div className="text-center py-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </div>
                    <p className="text-sm mb-4" style={{ color: "#0F6E56" }}>
                      Ceremony qualified — the election public key is published and ready.
                    </p>
                    <button
                      onClick={() => navigate(`/keyholder/submit?election_id=${encodeURIComponent(ELECTION_ID)}`, { state: { keyholderId } })}
                      className="btn-navy text-sm"
                    >
                      Continue to Partial Decryption →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="text-center">
          <button onClick={() => navigate("/")} className="text-sm" style={{ color: "#627d98" }}>
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyCeremony;
