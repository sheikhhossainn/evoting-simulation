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
import { loadPublicKeyFromEnv } from "./crypto/elgamal";
import keySharesRouter from "./routes/keyshares";
import anchorRouter from "./routes/anchor";
import publicRouter from "./routes/public";
import electionsRouter from "./routes/elections";
import dkgRouter from "./routes/dkg";
import { maybeAutoAnchor } from "./services/anchorBatch";


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
// Frontend fetches this to encrypt votes client-side
app.get("/election/public-key", (_req, res) => {
  const pubKey = loadPublicKeyFromEnv();
  if (!pubKey) {
    res.status(503).json({
      error: "ElGamal keys not configured. Run: npx ts-node src/scripts/setup-keys.ts",
    });
    return;
  }
  res.json(pubKey);
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Verify ElGamal keys are loaded
  const pubKey = loadPublicKeyFromEnv();
  if (pubKey) {
    console.log(`🔐 ElGamal public key loaded (p=${pubKey.p.slice(0, 12)}...)`);
  } else {
    console.warn(
      "⚠️  ElGamal keys not found in .env — run: npx ts-node src/scripts/setup-keys.ts"
    );
  }

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
