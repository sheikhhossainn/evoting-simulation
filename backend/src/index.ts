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
});
