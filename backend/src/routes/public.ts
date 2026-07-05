/**
 * public.ts — Public election transparency stats (no auth, no login)
 *
 * Backs the Public Watchdog page. Everything here is either a plain count
 * (never requires decrypting a ballot) or already-public metadata:
 *   - turnout per constituency (registered vs. voted — from `voters`)
 *   - total votes cast (row count on `votes`, not their content)
 *   - key-share ceremony progress (from `key_shares`, no share values)
 *   - Merkle anchoring progress (from `merkle_batches`)
 *
 * Per-candidate results are NOT here — those only exist once the 3-of-4
 * key ceremony completes and POST /keyshares/tally decrypts the batch
 * (see routes/keyshares.ts).
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";

const router = Router();

const DEFAULT_ELECTION_ID = "NATIONAL-2026-001";

router.get("/public/stats", async (req: Request, res: Response) => {
  const election_id = (req.query.election_id as string) || DEFAULT_ELECTION_ID;

  try {
    const [votersRes, votesCountRes, keySharesRes, batchCountRes, latestBatchRes] =
      await Promise.all([
        supabase.from("voters").select("constituency_code, has_voted"),
        supabase.from("votes").select("id", { count: "exact", head: true }),
        supabase
          .from("key_shares")
          .select("share_index, keyholder_role, submitted, submitted_at")
          .eq("election_id", election_id)
          .order("share_index", { ascending: true }),
        supabase
          .from("merkle_batches")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("merkle_batches")
          .select("batch_id, tx_hash, vote_count, created_at")
          .order("batch_id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (votersRes.error) throw votersRes.error;
    if (votesCountRes.error) throw votesCountRes.error;
    if (keySharesRes.error) throw keySharesRes.error;
    if (batchCountRes.error) throw batchCountRes.error;
    if (latestBatchRes.error) throw latestBatchRes.error;

    const voters = votersRes.data ?? [];
    const totalRegistered = voters.length;
    const totalVoted = voters.filter((v) => v.has_voted).length;

    const byConstituency = new Map<
      string,
      { registered: number; voted: number }
    >();
    for (const v of voters) {
      const entry =
        byConstituency.get(v.constituency_code) ?? { registered: 0, voted: 0 };
      entry.registered += 1;
      if (v.has_voted) entry.voted += 1;
      byConstituency.set(v.constituency_code, entry);
    }

    const pct = (num: number, denom: number) =>
      denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

    const constituencies = [...byConstituency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, { registered, voted }]) => ({
        constituency_code: code,
        registered_voters: registered,
        votes_cast: voted,
        turnout_pct: pct(voted, registered),
      }));

    const keyShares = keySharesRes.data ?? [];
    const submittedCount = keyShares.filter((s) => s.submitted).length;

    res.json({
      election_id,
      status: totalVoted > 0 ? "active" : "not_started",
      total_registered_voters: totalRegistered,
      total_votes_cast: votesCountRes.count ?? 0,
      turnout_pct: pct(totalVoted, totalRegistered),
      constituencies,
      key_ceremony: {
        submitted_count: submittedCount,
        threshold: 3,
        total: 4,
        threshold_met: submittedCount >= 3,
      },
      anchoring: {
        batches_anchored: batchCountRes.count ?? 0,
        latest_batch: latestBatchRes.data ?? null,
      },
    });
  } catch (err) {
    console.error("Unexpected error in GET /public/stats:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
