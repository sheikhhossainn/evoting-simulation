import express from "express";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Zod schema for vote request
const voteSchema = z.object({
  nid: z.string(),
});

// POST /vote — validates { nid: string } and returns { status: "queued" }
app.post("/vote", (req, res) => {
  const result = voteSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({ error: result.error.issues });
    return;
  }

  res.json({ status: "queued" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
