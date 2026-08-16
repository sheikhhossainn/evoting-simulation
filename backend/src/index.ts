/**
 * index.ts — Express server entry point
 *
 * Mounts:
 *   /voter/*     → voter registration & nullifier checks
 *   /vote        → vote submission (ElGamal-encrypted)
 *   /candidates  → candidate lookup by constituency
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import voterRouter from "./routes/voter";
import voteRouter from "./routes/vote";
import candidatesRouter from "./routes/candidates";
import keySharesRouter from "./routes/keyshares";
import anchorRouter from "./routes/anchor";
import publicRouter from "./routes/public";
import electionsRouter from "./routes/elections";
import dkgRouter from "./routes/dkg";
import { maybeAutoAnchor } from "./services/anchorBatch";
import { resolveElectionId, getElectionPublicKey } from "./services/electionContext";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

// ── Routes ──
app.use("/voter", voterRouter);
app.use(voteRouter);          // POST /vote lives at root
app.use(candidatesRouter);    // GET /candidates lives at root
app.use("/keyshares", keySharesRouter);
app.use(anchorRouter);         // POST /anchor/batch, GET /anchor/verify/:voteId
app.use(publicRouter);         // GET /public/stats (Public Watchdog page)
app.use(electionsRouter);      // POST /elections, GET /elections, GET /elections/:id
app.use("/dkg", dkgRouter);    // Distributed key generation ceremony


// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── ElGamal public key endpoint ──
// Frontend fetches this to encrypt votes client-side. Sourced entirely from
// the election's DKG ceremony (election_key_ceremony), never from env — see
// electionContext.ts's getElectionPublicKey doc comment.
app.get("/election/public-key", async (req, res) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  try {
    const pubKey = await getElectionPublicKey(resolved.electionId);
    if (!pubKey) {
      res.status(503).json({
        error: `DKG ceremony not yet qualified for ${resolved.electionId} — run the key ceremony first.`,
      });
      return;
    }
    res.json(pubKey);
  } catch (err) {
    console.error("Unexpected error in GET /election/public-key:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Verify NID salt
  if (process.env.NID_HASH_SALT) {
    console.log("🧂 NID hash salt loaded");
  } else {
    console.warn("⚠️  NID_HASH_SALT not set — NID hashes will be unsalted!");
  }

  // Periodic auto-anchor check, independent of vote traffic (methodology-audit
  // finding M3). maybeAutoAnchor() was previously only ever invoked
  // fire-and-forget after a vote was cast — if voting stopped entirely before
  // AUTO_ANCHOR_THRESHOLD was reached, nothing would ever re-check the
  // age-based trigger. This closes that: the pre-anchor window is now bounded
  // by AUTO_ANCHOR_MAX_AGE_MS even with zero further votes.
  setInterval(() => {
    maybeAutoAnchor().catch((err) => console.error("Periodic auto-anchor check failed:", err));
  }, 5 * 60 * 1000);
});
