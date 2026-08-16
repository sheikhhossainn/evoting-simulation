/**
 * keyshares.ts — Verifiable-tally key ceremony and tally routes
 * (docs/tally-verifiability-design.md)
 *
 * GET  /keyshares/commitments        — (public) group params + Feldman/keyholder commitments
 * GET  /keyshares/status             — (public) ceremony + per-keyholder submission progress
 * POST /keyshares/submit-partial     — (keyholder, passphrase-gated) submit (d_i, proof) per ballot —
 *                                       NEVER a raw share (docs §7)
 * POST /keyshares/tally              — (admin) verify + combine partial decryptions, tally
 * GET  /keyshares/verification-bundle — (public) the independent-recount bundle (docs §9)
 *
 * The OLD raw-Shamir-share flow (POST /keyshares/submit, GET /keyshares/reconstruct,
 * and the old POST /keyshares/tally that called reconstructKey()) is REMOVED from
 * this file entirely — not kept as a fallback. shamir.ts (GF(2^8)) and its
 * key_shares.share_value column are left in place, untouched, but nothing
 * here reads or writes them (docs §14: no silent bypass path).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { verifyKeyholderPassphrase, getKeyholderIndex } from "../config/keyholders";
import { decodeCandidateId } from "../crypto/elgamal";
import { verifyDleq, combinePartialDecryptions, type ValidPartial } from "../crypto/dleq";
import { requireAdminSecret } from "../middleware/adminAuth";
import { verifyBatchSmtCoverage, getSmtProof } from "../services/anchorSmtBatch";
import { resolveElectionId, getElection } from "../services/electionContext";

const router = Router();

// ── Explicit batch_id resolution — NO "latest batch" fallback ──
// docs/tally-verifiability-design.md §8 requires the tally be scoped to a
// specific anchored batch. "Latest merkle_batches row" silently picks up
// whatever was anchored most recently, including a contaminated batch —
// found the hard way when the live "latest" batch turned out to be ~80%
// test/fixture data (see the session's live-smoke-test audit). Every route
// below requires the caller to name the batch explicitly, WITHIN an
// explicitly named election (threat_model.md §10 — election_id has no
// silent default either, via resolveElectionId).
interface ResolvedBatch {
  batch_id: number;
  root: string;
  vote_ids: string[];
}

function parseBatchId(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw);
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

async function loadBatchById(electionId: string, batchId: number): Promise<ResolvedBatch | null> {
  const { data, error } = await supabase
    .from("merkle_batches")
    .select("batch_id, root, vote_ids")
    .eq("election_id", electionId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { batch_id: data.batch_id, root: data.root, vote_ids: data.vote_ids as string[] };
}

/**
 * Verify that every ballot in `batch` is actually covered by the current
 * anchored SMT commitment for `electionId` (docs §8 "internal consistency").
 * Does NOT assume a 1:1 dense-batch <-> smt-batch pairing — see
 * verifyBatchSmtCoverage's comment for why that assumption is wrong for this
 * project's own data.
 */
async function checkBatchSmtConsistency(
  electionId: string,
  batch: ResolvedBatch
): Promise<{ ok: true } | { ok: false; error: string; missing: string[] }> {
  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash")
    .eq("election_id", electionId)
    .in("id", batch.vote_ids);
  if (error) throw error;

  const foundIds = new Set((votes ?? []).map((v) => v.id));
  const missingVoteRows = batch.vote_ids.filter((id) => !foundIds.has(id));
  if (missingVoteRows.length > 0) {
    return {
      ok: false,
      error: `Batch ${batch.batch_id} references ${missingVoteRows.length} vote id(s) no longer present in votes`,
      missing: missingVoteRows,
    };
  }

  const nullifierHashes = (votes ?? []).map((v) => v.nullifier_hash as string);
  const coverage = await verifyBatchSmtCoverage(electionId, nullifierHashes);
  if (!coverage.allCovered) {
    return {
      ok: false,
      error: `Batch ${batch.batch_id}'s dense root and the anchored SMT are inconsistent: ${coverage.missing.length} ballot(s) not present in the SMT`,
      missing: coverage.missing,
    };
  }
  return { ok: true };
}

// ── GET /keyshares/commitments ──
// Public. Group params + Feldman coefficient commitments + each keyholder's
// public commitment y_i. All non-secret by construction (docs §2.1).
router.get("/commitments", async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;

  try {
    const [ceremonyRes, keyholdersRes] = await Promise.all([
      supabase
        .from("election_key_ceremony")
        .select("p_hex, g_hex, feldman_commitments")
        .eq("election_id", election_id)
        .maybeSingle(),
      supabase
        .from("key_shares")
        .select("share_index, keyholder_id, keyholder_role, public_commitment")
        .eq("election_id", election_id)
        .order("share_index", { ascending: true }),
    ]);

    if (ceremonyRes.error) throw ceremonyRes.error;
    if (keyholdersRes.error) throw keyholdersRes.error;

    if (!ceremonyRes.data) {
      res.status(404).json({ error: "No key ceremony has been run for this election yet" });
      return;
    }

    res.json({
      election_id,
      group_params: { p: ceremonyRes.data.p_hex, g: ceremonyRes.data.g_hex },
      feldman_commitments: ceremonyRes.data.feldman_commitments,
      keyholder_commitments: (keyholdersRes.data ?? []).map((k) => ({
        index: k.share_index,
        keyholder_id: k.keyholder_id,
        role: k.keyholder_role,
        y_i: k.public_commitment,
      })),
    });
  } catch (err) {
    console.error("Unexpected error in GET /keyshares/commitments:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /keyshares/status ──
router.get("/status", async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;
  const batchId = parseBatchId(req.query.batch_id);
  if (batchId === null) {
    res.status(400).json({
      error: "batch_id query parameter is required (explicit dense Merkle batch id — no latest-batch fallback, docs §8)",
    });
    return;
  }

  try {
    const batch = await loadBatchById(election_id, batchId);
    if (!batch) {
      res.status(404).json({ error: `No merkle_batches row for batch_id=${batchId} in election ${election_id}` });
      return;
    }
    const ballotIds = batch.vote_ids;

    // Scoped to THIS batch's ballots (methodology-audit follow-up, found
    // live: an unscoped query counts a keyholder's submissions from every
    // batch they've ever submitted for, so a fresh, untouched batch showed
    // stale nonzero counts left over from an earlier batch's real tally).
    const { data: partials, error } = await supabase
      .from("partial_decryptions")
      .select("keyholder_index, ballot_id")
      .eq("election_id", election_id)
      .in("ballot_id", ballotIds);
    if (error) throw error;

    const countByIndex = new Map<number, number>();
    for (const p of partials ?? []) {
      countByIndex.set(p.keyholder_index, (countByIndex.get(p.keyholder_index) ?? 0) + 1);
    }

    const { data: keyholders, error: khErr } = await supabase
      .from("key_shares")
      .select("share_index, keyholder_id, keyholder_role, public_commitment")
      .eq("election_id", election_id)
      .order("share_index", { ascending: true });
    if (khErr) throw khErr;

    res.json({
      election_id,
      batch_id: batch.batch_id,
      dense_root: batch.root,
      anchored_ballot_count: ballotIds.length,
      keyholders: (keyholders ?? []).map((k) => ({
        index: k.share_index,
        keyholder_id: k.keyholder_id,
        role: k.keyholder_role,
        ceremony_commitment_published: !!k.public_commitment,
        ballots_submitted: countByIndex.get(k.share_index) ?? 0,
      })),
    });
  } catch (err) {
    console.error("Unexpected error in GET /keyshares/status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /keyshares/submit-partial ──
const partialSchema = z.object({
  ballot_id: z.string().uuid(),
  d_i: z.string().regex(/^[0-9a-f]+$/),
  proof: z.object({
    t1: z.string().regex(/^[0-9a-f]+$/),
    t2: z.string().regex(/^[0-9a-f]+$/),
    z: z.string().regex(/^[0-9a-f]+$/),
  }),
});

const submitPartialSchema = z.object({
  election_id: z.string().min(1),
  keyholder_id: z.string().regex(/^KH-\d{3}$/),
  passphrase: z.string().min(1),
  partials: z.array(partialSchema).min(1),
});

router.post("/submit-partial", async (req: Request, res: Response) => {
  const parsed = submitPartialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, keyholder_id, passphrase, partials } = parsed.data;

  try {
    if (!(await getElection(election_id))) {
      res.status(404).json({ error: `Unknown election_id: ${election_id}` });
      return;
    }

    if (!(await verifyKeyholderPassphrase(election_id, keyholder_id, passphrase))) {
      res.status(401).json({ error: "Invalid keyholder id or passphrase" });
      return;
    }

    const index = await getKeyholderIndex(election_id, keyholder_id);
    if (index === null) {
      res.status(400).json({ error: "Unknown keyholder_id for this election" });
      return;
    }

    const [ceremonyRes, keyholderRes] = await Promise.all([
      supabase
        .from("election_key_ceremony")
        .select("p_hex, g_hex")
        .eq("election_id", election_id)
        .maybeSingle(),
      supabase
        .from("key_shares")
        .select("public_commitment")
        .eq("election_id", election_id)
        .eq("share_index", index)
        .maybeSingle(),
    ]);

    if (ceremonyRes.error) throw ceremonyRes.error;
    if (keyholderRes.error) throw keyholderRes.error;

    if (!ceremonyRes.data || !keyholderRes.data?.public_commitment) {
      res.status(503).json({ error: "Key ceremony has not been run for this election yet" });
      return;
    }

    const p = BigInt("0x" + ceremonyRes.data.p_hex);
    const g = BigInt("0x" + ceremonyRes.data.g_hex);
    const q = (p - 1n) / 2n;
    const y_iHex = keyholderRes.data.public_commitment;

    const ballotIds = partials.map((pt) => pt.ballot_id);
    const { data: votes, error: votesErr } = await supabase
      .from("votes")
      .select("id, encrypted_vote")
      .eq("election_id", election_id)
      .in("id", ballotIds);
    if (votesErr) throw votesErr;
    const voteById = new Map((votes ?? []).map((v) => [v.id, v.encrypted_vote as { c1: string; c2: string }]));

    const results: { ballot_id: string; verified: boolean; reason?: string }[] = [];

    for (const partial of partials) {
      const vote = voteById.get(partial.ballot_id);
      if (!vote) {
        results.push({ ballot_id: partial.ballot_id, verified: false, reason: "ballot_not_found" });
        continue;
      }

      const verified = verifyDleq(
        election_id,
        partial.ballot_id,
        vote.c1,
        partial.d_i,
        y_iHex,
        partial.proof,
        g,
        p,
        q
      );

      // INSERT, not upsert — a keyholder's submission for a given ballot is
      // write-once. Upserting would let a keyholder quietly overwrite a
      // flagged-invalid submission (erasing the accountability trail, docs
      // §10) or a valid one after tally already ran, with no audit trail and
      // no DB-level guard (trg_partial_decryptions_no_update backs this up).
      const { error: insertErr } = await supabase.from("partial_decryptions").insert({
        election_id,
        ballot_id: partial.ballot_id,
        keyholder_index: index,
        d_i: partial.d_i,
        proof_t1: partial.proof.t1,
        proof_t2: partial.proof.t2,
        proof_z: partial.proof.z,
        verified,
      });
      if (insertErr) {
        if (insertErr.code === "23505") {
          results.push({ ballot_id: partial.ballot_id, verified: false, reason: "already_submitted" });
        } else {
          console.error("Supabase error inserting partial_decryptions row:", insertErr);
          results.push({ ballot_id: partial.ballot_id, verified: false, reason: "storage_error" });
        }
        continue;
      }

      // Publish invalid submissions rather than silently dropping them
      // (docs §10 — accountability is the mechanism that catches a
      // malicious keyholder, not just a side effect).
      results.push({
        ballot_id: partial.ballot_id,
        verified,
        ...(verified ? {} : { reason: "dleq_verification_failed" }),
      });
    }

    res.status(201).json({ election_id, keyholder_id, results });
  } catch (err) {
    console.error("Unexpected error in POST /keyshares/submit-partial:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /keyshares/tally ──
// Admin-only. Verifies and combines partial decryptions — NEVER
// reconstructs the private key (docs §0/§7). Scoped to an EXPLICITLY named
// anchored dense batch (docs §8) rather than an unscoped `SELECT * FROM
// votes` OR an implicit "latest batch" (which can silently select a
// contaminated batch — this project's own latest batch turned out to be
// ~80% test/fixture data; see the session's live audit).
router.post("/tally", requireAdminSecret, async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.body as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;
  const batchId = parseBatchId(req.body?.batch_id);
  if (batchId === null) {
    res.status(400).json({
      error: "batch_id is required in the request body (explicit dense Merkle batch id — no latest-batch fallback, docs §8)",
    });
    return;
  }

  try {
    const { data: setupCommitment, error: setupErr } = await supabase
      .from("election_setup_commitments")
      .select("election_id")
      .eq("election_id", election_id)
      .maybeSingle();
    if (setupErr) throw setupErr;
    if (!setupCommitment) {
      res.status(400).json({
        error:
          "No election setup commitment anchored for this election — candidates/constituencies are not yet locked (docs §8.2). Run the setup-commitment deployment first.",
      });
      return;
    }

    const batch = await loadBatchById(election_id, batchId);
    if (!batch) {
      res.status(404).json({ error: `No merkle_batches row for batch_id=${batchId} in election ${election_id}` });
      return;
    }

    const consistency = await checkBatchSmtConsistency(election_id, batch);
    if (!consistency.ok) {
      res.status(409).json({ error: consistency.error, missing: consistency.missing });
      return;
    }

    const ballotIds: string[] = batch.vote_ids;

    const { data: ceremony, error: ceremonyErr } = await supabase
      .from("election_key_ceremony")
      .select("p_hex, g_hex")
      .eq("election_id", election_id)
      .maybeSingle();
    if (ceremonyErr) throw ceremonyErr;
    if (!ceremony) {
      res.status(503).json({ error: "Key ceremony has not been run for this election yet" });
      return;
    }
    const p = BigInt("0x" + ceremony.p_hex);
    const g = BigInt("0x" + ceremony.g_hex);
    const q = (p - 1n) / 2n;

    const { data: keyholders, error: khErr } = await supabase
      .from("key_shares")
      .select("share_index, public_commitment")
      .eq("election_id", election_id);
    if (khErr) throw khErr;
    const yByIndex = new Map((keyholders ?? []).map((k) => [k.share_index, k.public_commitment as string]));

    const [votesRes, candidatesRes, partialsRes] = await Promise.all([
      supabase.from("votes").select("id, encrypted_vote, constituency_code").eq("election_id", election_id).in("id", ballotIds),
      supabase.from("candidates").select("id, name, party, constituency_code").eq("election_id", election_id),
      supabase.from("partial_decryptions").select("*").eq("election_id", election_id).in("ballot_id", ballotIds),
    ]);
    if (votesRes.error) throw votesRes.error;
    if (candidatesRes.error) throw candidatesRes.error;
    if (partialsRes.error) throw partialsRes.error;

    const candidateById = new Map((candidatesRes.data ?? []).map((c) => [c.id, c]));
    const partialsByBallot = new Map<string, typeof partialsRes.data>();
    for (const row of partialsRes.data ?? []) {
      const list = partialsByBallot.get(row.ballot_id) ?? [];
      list.push(row);
      partialsByBallot.set(row.ballot_id, list);
    }

    interface RejectedVote {
      vote_id: string;
      reason:
        | "decryption_failed"
        | "candidate_not_found"
        | "constituency_mismatch"
        | "duplicate_nullifier"
        | "invalid_signature"
        | "insufficient_valid_shares";
    }
    interface TallyEntry {
      candidate_id: string;
      name: string;
      party: string;
      votes: number;
    }

    const resultsByConstituency = new Map<string, Map<string, TallyEntry>>();
    let validVotes = 0;
    const rejectedVotes: RejectedVote[] = [];
    const flaggedSubmissions: { ballot_id: string; keyholder_index: number }[] = [];

    for (const vote of votesRes.data ?? []) {
      const rows = partialsByBallot.get(vote.id) ?? [];
      const validPartials: ValidPartial[] = [];

      for (const row of rows) {
        const y_iHex = yByIndex.get(row.keyholder_index);
        if (!y_iHex) continue;

        // Re-verify at combination time — the stored `verified` flag is a
        // cache/audit trail, not the sole gate (schema.sql's comment on
        // partial_decryptions.verified).
        const ok = verifyDleq(
          election_id,
          vote.id,
          (vote.encrypted_vote as { c1: string; c2: string }).c1,
          row.d_i,
          y_iHex,
          { t1: row.proof_t1, t2: row.proof_t2, z: row.proof_z },
          g,
          p,
          q
        );

        if (ok) {
          validPartials.push({ index: BigInt(row.keyholder_index), d_iHex: row.d_i });
        } else {
          flaggedSubmissions.push({ ballot_id: vote.id, keyholder_index: row.keyholder_index });
        }
      }

      if (validPartials.length < 3) {
        rejectedVotes.push({ vote_id: vote.id, reason: "insufficient_valid_shares" });
        continue;
      }

      // Deterministic subset: lowest indices first (docs §6).
      validPartials.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
      const chosen = validPartials.slice(0, 3);

      let candidateId: string;
      try {
        const mHex = combinePartialDecryptions(
          chosen,
          (vote.encrypted_vote as { c1: string; c2: string }).c2,
          p,
          q
        );
        candidateId = decodeCandidateId(BigInt("0x" + mHex));
      } catch {
        rejectedVotes.push({ vote_id: vote.id, reason: "decryption_failed" });
        continue;
      }

      const candidate = candidateById.get(candidateId);
      if (!candidate) {
        rejectedVotes.push({ vote_id: vote.id, reason: "candidate_not_found" });
        continue;
      }
      if (!vote.constituency_code || candidate.constituency_code !== vote.constituency_code) {
        rejectedVotes.push({ vote_id: vote.id, reason: "constituency_mismatch" });
        continue;
      }

      validVotes++;
      if (!resultsByConstituency.has(vote.constituency_code)) {
        resultsByConstituency.set(vote.constituency_code, new Map());
      }
      const constituencyResults = resultsByConstituency.get(vote.constituency_code)!;
      const entry = constituencyResults.get(candidateId) ?? {
        candidate_id: candidateId,
        name: candidate.name,
        party: candidate.party,
        votes: 0,
      };
      entry.votes += 1;
      constituencyResults.set(candidateId, entry);
    }

    const results = [...resultsByConstituency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([constituency_code, candidateMap]) => ({
        constituency_code,
        candidates: [...candidateMap.values()].sort((a, b) => b.votes - a.votes),
      }));

    const tallyRecord = {
      election_id,
      tallied_at: new Date().toISOString(),
      shares_used: yByIndex.size,
      total_votes: (votesRes.data ?? []).length,
      valid_votes: validVotes,
      invalid_votes: rejectedVotes.length,
      rejected_votes: rejectedVotes,
      flagged_submissions: flaggedSubmissions,
      anchored_dense_batch_id: batch.batch_id,
      anchored_dense_root: batch.root,
      verifiable: true,
      results,
    };

    const { error: persistError } = await supabase
      .from("tally_results")
      .upsert(
        {
          election_id: tallyRecord.election_id,
          tallied_at: tallyRecord.tallied_at,
          shares_used: tallyRecord.shares_used,
          total_votes: tallyRecord.total_votes,
          valid_votes: tallyRecord.valid_votes,
          invalid_votes: tallyRecord.invalid_votes,
          results: tallyRecord.results,
        },
        { onConflict: "election_id" }
      );

    if (persistError) {
      console.error("Supabase error persisting tally results:", persistError);
      res.json({ ...tallyRecord, persisted: false });
      return;
    }

    res.json({ ...tallyRecord, persisted: true });
  } catch (err) {
    console.error("Unexpected error in POST /keyshares/tally:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /keyshares/verification-bundle ──
// Public. Everything an independent verifier needs (docs §9) — no secrets,
// no admin access required to fetch this.
router.get("/verification-bundle", async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;
  const batchId = parseBatchId(req.query.batch_id);
  if (batchId === null) {
    res.status(400).json({
      error: "batch_id query parameter is required (explicit dense Merkle batch id — no latest-batch fallback, docs §8)",
    });
    return;
  }

  try {
    const batch = await loadBatchById(election_id, batchId);
    if (!batch) {
      res.status(404).json({ error: `No merkle_batches row for batch_id=${batchId} in election ${election_id}` });
      return;
    }
    const consistency = await checkBatchSmtConsistency(election_id, batch);

    const [
      ceremonyRes,
      keyholdersRes,
      smtBatchRes,
      setupRes,
      tallyRes,
      votersRes,
    ] = await Promise.all([
      supabase
        .from("election_key_ceremony")
        .select("p_hex, g_hex")
        .eq("election_id", election_id)
        .maybeSingle(),
      supabase
        .from("key_shares")
        .select("share_index, public_commitment")
        .eq("election_id", election_id)
        .order("share_index", { ascending: true }),
      supabase
        .from("smt_batches")
        .select("smt_batch_id, smt_root, total_keys_anchored")
        .eq("election_id", election_id)
        .order("smt_batch_id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("election_setup_commitments")
        .select("commitment, candidates_root, constituencies_root")
        .eq("election_id", election_id)
        .maybeSingle(),
      supabase.from("tally_results").select("*").eq("election_id", election_id).maybeSingle(),
      supabase.from("voters").select("has_voted").eq("election_id", election_id),
    ]);

    if (ceremonyRes.error) throw ceremonyRes.error;
    if (keyholdersRes.error) throw keyholdersRes.error;
    if (setupRes.error) throw setupRes.error;
    if (tallyRes.error) throw tallyRes.error;
    if (votersRes.error) throw votersRes.error;

    const ballotIds: string[] = batch.vote_ids;
    const [votesRes, partialsRes, candidatesRes, constituenciesRes] = await Promise.all([
      supabase.from("votes").select("id, encrypted_vote, constituency_code, created_at, nullifier_hash").eq("election_id", election_id).in("id", ballotIds),
      supabase.from("partial_decryptions").select("*").eq("election_id", election_id).in("ballot_id", ballotIds),
      supabase.from("candidates").select("id, name, party, symbol, constituency_code").eq("election_id", election_id),
      supabase.from("constituencies").select("code, name").eq("election_id", election_id),
    ]);
    if (votesRes.error) throw votesRes.error;
    if (partialsRes.error) throw partialsRes.error;
    if (candidatesRes.error) throw candidatesRes.error;
    if (constituenciesRes.error) throw constituenciesRes.error;

    // .in() does not preserve order — the dense tree was built in
    // vote_ids' exact order (runAnchorBatch's created_at-ascending fetch),
    // so an independent verifier rebuilding the tree from ballots[] needs
    // that SAME order (mirrors anchor.ts's GET /anchor/verify fix for the
    // identical issue).
    const voteById = new Map((votesRes.data ?? []).map((v) => [v.id, v]));
    const orderedVotes = ballotIds.map((id) => voteById.get(id)).filter((v): v is NonNullable<typeof v> => !!v);

    const independentlyObservedVoteCount = (votersRes.data ?? []).filter((v) => v.has_voted).length;

    // Per-ballot SMT membership proofs (methodology-audit finding M1
    // follow-up): step 1b already confirms the referenced smt_batch_id's
    // root/total are genuinely on-chain, but that alone still asks the
    // verifier to trust the server's aggregate "this batch is covered"
    // claim. Handing over one real membership proof per ballot lets the
    // verifier check EACH ballot's presence in the anchored SMT itself,
    // off-chain, using the same canonical algorithm the contract runs
    // (sparseMerkleTree.ts's verifySmtMembershipProof / MerkleRootStorage's
    // _verifySmt — one implementation, docs/smt-design.md §11) — no
    // additional RPC calls needed beyond the root check step 1b already
    // makes. A ballot whose key is (unexpectedly) NOT currently a member
    // gets its non-membership proof instead, surfaced as `type` — the
    // verifier treats that as a hard failure, not a soft skip.
    const smtProofs = await Promise.all(
      orderedVotes.map(async (v) => {
        try {
          const result = await getSmtProof(election_id, v.nullifier_hash as string);
          return { ballot_id: v.id, nullifier_hash: v.nullifier_hash, type: result.type, proof: result.proof };
        } catch (err) {
          return { ballot_id: v.id, nullifier_hash: v.nullifier_hash, type: "error" as const, proof: null, error: `${err}` };
        }
      })
    );

    res.json({
      election_id,
      anchored_batch_ref: {
        dense_batch_id: batch.batch_id,
        dense_root: batch.root,
        smt_batch_id: smtBatchRes.data?.smt_batch_id ?? null,
        smt_root: smtBatchRes.data?.smt_root ?? null,
        total_keys_anchored: smtBatchRes.data?.total_keys_anchored ?? null,
        // Per-batch check, distinct from the global total_keys_anchored
        // figure above (docs §8's "internal consistency" requirement) — does
        // every ballot in THIS batch actually appear in the anchored SMT.
        smt_coverage_verified: consistency.ok,
        smt_coverage_error: consistency.ok ? null : consistency.error,
      },
      group_params: ceremonyRes.data
        ? { p: ceremonyRes.data.p_hex, g: ceremonyRes.data.g_hex }
        : null,
      keyholder_commitments: (keyholdersRes.data ?? []).map((k) => ({
        index: k.share_index,
        y_i: k.public_commitment,
      })),
      ballots: orderedVotes.map((v) => ({
        ballot_id: v.id,
        c1: (v.encrypted_vote as { c1: string; c2: string }).c1,
        c2: (v.encrypted_vote as { c1: string; c2: string }).c2,
        constituency_code: v.constituency_code,
        created_at: v.created_at,
      })),
      partial_decryptions: (partialsRes.data ?? []).map((row) => ({
        ballot_id: row.ballot_id,
        keyholder_index: row.keyholder_index,
        d_i: row.d_i,
        proof: { t1: row.proof_t1, t2: row.proof_t2, z: row.proof_z },
      })),
      smt_membership_proofs: smtProofs,
      candidates: candidatesRes.data ?? [],
      constituencies: constituenciesRes.data ?? [],
      election_setup_commitment: setupRes.data?.commitment ?? null,
      candidates_root: setupRes.data?.candidates_root ?? null,
      constituencies_root: setupRes.data?.constituencies_root ?? null,
      independently_observed_vote_count: independentlyObservedVoteCount,
      published_results: tallyRes.data ?? null,
    });
  } catch (err) {
    console.error("Unexpected error in GET /keyshares/verification-bundle:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
