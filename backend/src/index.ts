/**
 * index.ts — Express server entry point
 *
 * Mounts:
 *   /voter/*  → voter registration & nullifier checks
 *   /vote     → vote submission
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import voterRouter from "./routes/voter";
import voteRouter from "./routes/vote";

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
app.use(voteRouter); // POST /vote lives at root

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
