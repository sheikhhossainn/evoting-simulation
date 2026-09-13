/* Generates docs/evoting-system-flow.svg — an accurate end-to-end diagram of
 * the actual e-voting implementation in this repo. Layout is computed here so
 * coordinates stay consistent. Run: node docs/gen-flow-svg.cjs */

const fs = require("fs");
const path = require("path");

// ── Palette ──────────────────────────────────────────────────────────────
const LAYERS = {
  user:    { title: "1 · Voter / User Layer",              accent: "#0A2540", band: "#EEF2F8" },
  auth:    { title: "2 · Authentication & Eligibility",    accent: "#1D4ED8", band: "#EDF3FE" },
  voting:  { title: "3 · Voting Layer",                    accent: "#0F766E", band: "#E8F6F3" },
  crypto:  { title: "4 · Security / Cryptography Layer",   accent: "#7C3AED", band: "#F4EEFE" },
  submit:  { title: "5 · Vote Submission & Validation",    accent: "#0E7490", band: "#E7F5F9" },
  chain:   { title: "6 · Blockchain / Immutable Storage",  accent: "#B45309", band: "#FBF2E5" },
  verify:  { title: "7 · Verification & Tamper Detection", accent: "#0891B2", band: "#E6F6FB" },
  result:  { title: "8 · Counting & Result Layer",         accent: "#047857", band: "#E8F7EF" },
};

const C = {
  arrow:      "#475569",
  arrowFail:  "#DC2626",
  yes:        "#047857",
  procFill:   "#FFFFFF",
  procText:   "#0F172A",
  procMuted:  "#5B6B7F",
  diaFill:    "#FEF3C7",
  diaStroke:  "#D97706",
  diaText:    "#7C2D12",
  failFill:   "#FDECEC",
  failStroke: "#DC2626",
  failText:   "#991B1B",
  bg:         "#FBFCFE",
};

// ── Flow model (main spine, top → bottom) ─────────────────────────────────
// type: process | decision | terminal
// fail (decisions only): red branch on the "No"/reject path
const STEPS = [
  { layer: "user", type: "process", title: "Voter enters 11-digit National ID (NID)",
    detail: ["Frontend  VoterLogin →  POST /voter/register", "Server: nid_hash = SHA-256(NID + NID_HASH_SALT)"] },
  { layer: "user", type: "process", title: "Constituency derived from NID (server-side)",
    detail: ["constituency = CON-((first4 mod 8) + 1)", "Raw NID never stored — only its salted hash"] },

  { layer: "auth", type: "process", title: "Register / look up voter in  voters  table",
    detail: ["Upsert by nid_hash · is_eligible, has_voted flags"] },
  { layer: "auth", type: "decision", title: "Registered & eligible?",
    detail: ["is_eligible = true"],
    fail: { title: "REJECT · 403", detail: ["Not registered / not eligible", "→ voting blocked"] } },
  { layer: "auth", type: "process", title: "Load ballot:  GET /candidates",
    detail: ["Constituency re-derived from x-voter-nid header", "Returns only this constituency's candidates (real UUIDs)"] },
  { layer: "auth", type: "decision", title: "Already voted?",
    detail: ["POST /voter/check-nullifier", "nullifier = SHA-256(NID+election_id+SECRET)"],
    fail: { title: "REJECT · 409", detail: ["Nullifier exists → \"You have already voted\""] } },

  { layer: "voting", type: "process", title: "Voter selects ONE candidate",
    detail: ["Confirmation modal · irreversible action"] },
  { layer: "voting", type: "process", title: "Optional: Benaloh cast-or-audit",
    detail: ["Reveal randomness r → recompute & verify ciphertext", "Audited ballot discarded; cast always re-encrypts fresh"] },

  { layer: "crypto", type: "process", title: "ElGamal encrypt candidate UUID (client-side)",
    detail: ["m = 128-bit UUID · k random · 256-bit safe prime p", "c1 = g^k mod p , c2 = m · y^k mod p  → {c1, c2}"] },
  { layer: "crypto", type: "process", title: "Generate ZKP of ballot validity",
    detail: ["Disjunctive Chaum-Pedersen OR-proof (CDS94)", "Fiat-Shamir / SHA-256 → { challenges[], responses[] }"] },

  { layer: "submit", type: "process", title: "POST /vote  → backend",
    detail: ["Payload: nid · candidate_id · {c1,c2}", "election_id · zkp_proof · candidate_ids[]"] },
  { layer: "submit", type: "decision", title: "Schema valid?",
    detail: ["Zod: NID 11 digits, UUID, ciphertext present"],
    fail: { title: "REJECT · 400", detail: ["Malformed request body"] } },
  { layer: "submit", type: "decision", title: "Candidate in voter's constituency?",
    detail: ["Server looks up candidate row"],
    fail: { title: "REJECT · 403 / 404", detail: ["Unknown candidate or cross-constituency vote"] } },
  { layer: "submit", type: "decision", title: "ZKP validity proof verifies?",
    detail: ["Σ challenges ≡ Fiat-Shamir e"],
    fail: { title: "REJECT · 400", detail: ["Ballot not a valid choice → discarded"] } },
  { layer: "submit", type: "process", title: "fn_cast_vote()  — atomic transaction",
    detail: ["Lock voter row · insert vote by nullifier_hash + constituency", "flip has_voted — all-or-nothing"] },
  { layer: "submit", type: "decision", title: "Atomic cast succeeded?",
    detail: ["Eligible · not double-voting · no unique clash"],
    fail: { title: "REJECT · 409 / 403", detail: ["Double vote (nullifier UNIQUE) or ineligible"] } },
  { layer: "submit", type: "process", title: "Vote recorded  ( status = 'queued' )",
    detail: ["encrypted_vote JSONB + zkp_proof · tx_hash = NULL", "Nullifier persisted → one-person-one-vote"] },

  { layer: "chain", type: "process", title: "EC admin triggers batch anchor",
    detail: ["POST /anchor/batch  → select votes where tx_hash IS NULL"] },
  { layer: "chain", type: "process", title: "Build Merkle tree over the batch",
    detail: ["leaf = keccak256²( voteId, c1, c2, createdAt )", "node = keccak256( sort(L, R) )  (OpenZeppelin-compatible)"] },
  { layer: "chain", type: "process", title: "anchorRoot(root, voteCount) → Ethereum Sepolia",
    detail: ["MerkleRootStorage.sol  (Ownable — only EC anchor key)", "Contract 0x7f22…d928 · emits BatchAnchored"] },
  { layer: "chain", type: "decision", title: "On-chain tx confirmed?",
    detail: ["root ≠ 0 · voteCount > 0 · receipt mined"],
    fail: { title: "RETRY", detail: ["Batch stays unanchored; re-run anchoring"] } },
  { layer: "chain", type: "process", title: "Persist batch + confirm votes",
    detail: ["merkle_batches { batch_id, root, tx_hash, vote_ids[] }", "votes → status = 'confirmed', tx_hash set"] },
  { layer: "chain", type: "process", title: "DB immutability guards (defense-in-depth)",
    detail: ["Triggers reject UPDATE of ciphertext/nullifier/created_at", "and reject DELETE of any cast vote row"] },

  { layer: "verify", type: "process", title: "Public auditor:  GET /anchor/verify/:voteId",
    detail: ["Recompute leaves & Merkle root from stored batch votes"] },
  { layer: "verify", type: "decision", title: "Recomputed root == stored root?",
    detail: ["Compare regenerated root to DB / on-chain value"],
    fail: { title: "⚠ TAMPER DETECTED · 409", detail: ["Vote or batch edited after anchoring", "recomputed root ≠ anchored root"] } },
  { layer: "verify", type: "decision", title: "Inclusion proof valid — local & on-chain?",
    detail: ["contract.verify(batchId, leaf, proof)  on Sepolia"],
    fail: { title: "NOT VERIFIED", detail: ["Proof fails → integrity not confirmed"] } },
  { layer: "verify", type: "process", title: "✓ Vote integrity confirmed",
    detail: ["Leaf proven under the immutable on-chain root"] },

  { layer: "result", type: "process", title: "Key ceremony: keyholders submit Shamir shares",
    detail: ["POST /keyshares/submit (passphrase-verified) · 4 holders"] },
  { layer: "result", type: "decision", title: "Threshold met (3 of 4 shares)?",
    detail: ["GET /keyshares/status · reconstruct diagnostic"],
    fail: { title: "WAIT", detail: ["Fewer than 3 shares → tally blocked", "zero key material exposed"] } },
  { layer: "result", type: "process", title: "POST /keyshares/tally  (admin)",
    detail: ["Reconstruct ElGamal private key in-memory (Shamir combine)", "Key never persisted, logged, or returned"] },
  { layer: "result", type: "process", title: "Decrypt every ballot",
    detail: ["decryptCandidateId: subgroup check c1^q ≡ 1", "m = c2 · (c1^x)^(-1) mod p → candidate UUID"] },
  { layer: "result", type: "decision", title: "Decodes to a valid candidate in its constituency?",
    detail: ["Guards malformed / tampered ciphertext at tally time"],
    fail: { title: "INVALID BALLOT", detail: ["decryption_failed / candidate_not_found /", "constituency_mismatch → counted as invalid"] } },
  { layer: "result", type: "process", title: "Tally valid votes by constituency & candidate",
    detail: ["Persist tally_results (aggregate counts only)"] },
  { layer: "result", type: "terminal", title: "FINAL ELECTION RESULT published",
    detail: ["GET /public/results · Public Watchdog & Tally pages"] },
];

// ── Geometry ───────────────────────────────────────────────────────────────
const W = 1500;
const MARGIN_TOP = 232;         // header space
const BAND_X = 40, BAND_W = 1420;
const SPINE_CX = 470, BOX_W = 344;
const DIA_W = 320, DIA_H = 140;
const PROC_H = 84, TERM_H = 92;
const GAP = 52;                 // vertical arrow gap
const BAND_PAD = 26;            // extra gap when a new layer starts
const FAIL_CX = 1092, FAIL_W = 348, FAIL_H = 92;

// assign y positions
let y = MARGIN_TOP;
let prevLayer = null;
for (const s of STEPS) {
  if (prevLayer !== null && s.layer !== prevLayer) y += BAND_PAD;
  const h = s.type === "decision" ? DIA_H : s.type === "terminal" ? TERM_H : PROC_H;
  s.h = h;
  s.yTop = y;
  s.yMid = y + h / 2;
  s.yBot = y + h;
  y += h + GAP;
  prevLayer = s.layer;
}
const H = y + 150; // footer space

// ── SVG helpers ──────────────────────────────────────────────────────────
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const out = [];
const p = (s) => out.push(s);

function textBlock(cx, yTop, title, detail, opts) {
  const { titleColor, titleSize = 16.5, detailColor, detailSize = 12.2, boxH } = opts;
  const lines = [];
  // vertically center the title + details group within the box
  const nDetail = detail ? detail.length : 0;
  const groupH = titleSize + (nDetail ? 8 + nDetail * (detailSize + 4) : 0);
  let ty = yTop + (boxH - groupH) / 2 + titleSize - 2;
  lines.push(`<text x="${cx}" y="${ty}" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="${titleColor}">${esc(title)}</text>`);
  if (detail) {
    ty += 8;
    for (const d of detail) {
      ty += detailSize + 4;
      lines.push(`<text x="${cx}" y="${ty}" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${detailSize}" fill="${detailColor}">${esc(d)}</text>`);
    }
  }
  return lines.join("\n");
}

function vArrow(x, y1, y2, color, label) {
  let s = `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 9}" stroke="${color}" stroke-width="2.4" marker-end="url(#arrow)"/>`;
  if (label) {
    s += `\n<rect x="${x + 7}" y="${(y1 + y2) / 2 - 11}" width="34" height="18" rx="4" fill="#ECFDF5" stroke="${C.yes}" stroke-width="1"/>`;
    s += `\n<text x="${x + 24}" y="${(y1 + y2) / 2 + 2}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" fill="${C.yes}">${label}</text>`;
  }
  return s;
}

// ── Build document ─────────────────────────────────────────────────────────
p(`<?xml version="1.0" encoding="UTF-8"?>`);
p(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif">`);

// defs
p(`<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${C.arrow}"/>
  </marker>
  <marker id="arrowFail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${C.arrowFail}"/>
  </marker>
  <linearGradient id="finalGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#059669"/><stop offset="1" stop-color="#047140"/>
  </linearGradient>
  <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#0A2540"/><stop offset="1" stop-color="#123a63"/>
  </linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0A2540" flood-opacity="0.10"/>
  </filter>
</defs>`);

// background
p(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`);

// ── Layer bands (draw behind nodes) ──
const groups = [];
{
  let cur = null;
  for (const s of STEPS) {
    if (!cur || cur.layer !== s.layer) { cur = { layer: s.layer, top: s.yTop, bot: s.yBot }; groups.push(cur); }
    else cur.bot = s.yBot;
  }
}
for (const g of groups) {
  const L = LAYERS[g.layer];
  const top = g.top - 16, h = (g.bot + 16) - top;
  p(`<rect x="${BAND_X}" y="${top}" width="${BAND_W}" height="${h}" rx="16" fill="${L.band}"/>`);
  // left accent spine + rotated title
  p(`<rect x="${BAND_X}" y="${top}" width="7" height="${h}" rx="3.5" fill="${L.accent}"/>`);
  const lx = BAND_X + 34, ly = top + h / 2;
  p(`<text x="${lx}" y="${ly}" transform="rotate(-90 ${lx} ${ly})" text-anchor="middle" font-size="15.5" font-weight="800" letter-spacing="0.5" fill="${L.accent}" opacity="0.92">${esc(L.title)}</text>`);
}

// ── Connain arrows between consecutive spine nodes ──
for (let i = 0; i < STEPS.length - 1; i++) {
  const a = STEPS[i], b = STEPS[i + 1];
  const label = a.type === "decision" ? "Yes" : null;
  p(vArrow(SPINE_CX, a.yBot, b.yTop, C.arrow, label));
}

// ── Fail branches ──
for (const s of STEPS) {
  if (s.type !== "decision" || !s.fail) continue;
  const startX = SPINE_CX + DIA_W / 2;
  const failLeft = FAIL_CX - FAIL_W / 2;
  // horizontal line from diamond right vertex to fail box
  p(`<line x1="${startX}" y1="${s.yMid}" x2="${failLeft - 9}" y2="${s.yMid}" stroke="${C.arrowFail}" stroke-width="2.4" marker-end="url(#arrowFail)"/>`);
  p(`<rect x="${startX + 8}" y="${s.yMid - 22}" width="30" height="18" rx="4" fill="#FEF2F2" stroke="${C.failStroke}" stroke-width="1"/>`);
  p(`<text x="${startX + 23}" y="${s.yMid - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.failText}">No</text>`);
  // fail box
  const fy = s.yMid - FAIL_H / 2;
  p(`<rect x="${failLeft}" y="${fy}" width="${FAIL_W}" height="${FAIL_H}" rx="12" fill="${C.failFill}" stroke="${C.failStroke}" stroke-width="1.8" filter="url(#soft)"/>`);
  p(`<rect x="${failLeft}" y="${fy}" width="6" height="${FAIL_H}" rx="3" fill="${C.failStroke}"/>`);
  p(textBlock(FAIL_CX + 3, fy, s.fail.title, s.fail.detail, { titleColor: C.failText, titleSize: 14.5, detailColor: "#B04A4A", detailSize: 11.5, boxH: FAIL_H }));
}

// ── Spine nodes ──
for (const s of STEPS) {
  const L = LAYERS[s.layer];
  if (s.type === "decision") {
    const cx = SPINE_CX, cy = s.yMid;
    const hw = DIA_W / 2, hh = DIA_H / 2;
    p(`<polygon points="${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}" fill="${C.diaFill}" stroke="${C.diaStroke}" stroke-width="2" filter="url(#soft)"/>`);
    p(textBlock(cx, cy - hh, s.title, s.detail, { titleColor: C.diaText, titleSize: 14.5, detailColor: "#8A5A24", detailSize: 11.3, boxH: DIA_H }));
  } else if (s.type === "terminal") {
    const x = SPINE_CX - BOX_W / 2;
    p(`<rect x="${x}" y="${s.yTop}" width="${BOX_W}" height="${s.h}" rx="16" fill="url(#finalGrad)" stroke="#035c34" stroke-width="1.5" filter="url(#soft)"/>`);
    p(textBlock(SPINE_CX, s.yTop, s.title, s.detail, { titleColor: "#FFFFFF", titleSize: 17, detailColor: "#DCFCE7", detailSize: 12.3, boxH: s.h }));
  } else {
    const x = SPINE_CX - BOX_W / 2;
    p(`<rect x="${x}" y="${s.yTop}" width="${BOX_W}" height="${s.h}" rx="13" fill="${C.procFill}" stroke="${L.accent}" stroke-width="1.6" filter="url(#soft)"/>`);
    p(`<rect x="${x}" y="${s.yTop}" width="6" height="${s.h}" rx="3" fill="${L.accent}"/>`);
    p(textBlock(SPINE_CX + 3, s.yTop, s.title, s.detail, { titleColor: L.accent, titleSize: 15.5, detailColor: C.procMuted, detailSize: 12, boxH: s.h }));
  }
}

// ── Header ──
p(`<rect x="0" y="0" width="${W}" height="150" fill="url(#headerGrad)"/>`);
p(`<text x="52" y="60" font-size="30" font-weight="800" fill="#FFFFFF">Blockchain E-Voting System — End-to-End Flow</text>`);
p(`<text x="53" y="92" font-size="15.5" fill="#AFC6E0">Actual implementation: React + Express + Supabase (PostgreSQL) + Ethereum Sepolia · ElGamal · disjunctive Chaum-Pedersen ZKP · Shamir 3-of-4 · Merkle (keccak256) anchoring</text>`);
p(`<text x="53" y="116" font-size="13" fill="#8FB0D0">CSE Cybersecurity Capstone · Election NATIONAL-2026-001 · Contract MerkleRootStorage.sol @ 0x7f228912a2a709010F9419582d021485B5F4d928</text>`);

// legend (top-right)
const lgX = W - 470, lgY = 30;
p(`<rect x="${lgX}" y="${lgY}" width="420" height="104" rx="12" fill="#0d2f52" stroke="#2b5482" stroke-width="1"/>`);
p(`<text x="${lgX + 18}" y="${lgY + 26}" font-size="13.5" font-weight="800" fill="#DCE9F7" letter-spacing="0.4">LEGEND</text>`);
const li = (i, sw, label) => {
  const col = i % 2, row = Math.floor(i / 2);
  const ex = lgX + 18 + col * 205, ey = lgY + 46 + row * 26;
  p(sw(ex, ey));
  p(`<text x="${ex + 34}" y="${ey + 5}" font-size="12" fill="#CBDCEE">${esc(label)}</text>`);
};
li(0, (x, y) => `<rect x="${x}" y="${y - 9}" width="24" height="17" rx="4" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="1.6"/>`, "Process step");
li(1, (x, y) => `<polygon points="${x + 12},${y - 10} ${x + 26},${y} ${x + 12},${y + 10} ${x - 2},${y}" fill="${C.diaFill}" stroke="${C.diaStroke}" stroke-width="1.6"/>`, "Decision / condition");
li(2, (x, y) => `<rect x="${x}" y="${y - 9}" width="24" height="17" rx="4" fill="${C.failFill}" stroke="${C.failStroke}" stroke-width="1.6"/>`, "Reject / fail path");
li(3, (x, y) => `<rect x="${x}" y="${y - 9}" width="24" height="17" rx="4" fill="url(#finalGrad)"/>`, "Final result");

// ── Footer note ──
const fY = H - 96;
p(`<rect x="40" y="${fY}" width="${W - 80}" height="70" rx="12" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="1"/>`);
p(`<text x="60" y="${fY + 26}" font-size="13.5" font-weight="800" fill="#334155">TRUST ANCHOR &amp; HONEST SCOPE</text>`);
p(`<text x="60" y="${fY + 47}" font-size="12.3" fill="#475569">The public Sepolia Merkle root + an honest verifier are the core tamper-evidence guarantee; DB triggers are defense-in-depth (a DB admin can drop them).</text>`);
p(`<text x="60" y="${fY + 64}" font-size="12.3" fill="#475569">Pre-anchor window: a vote is tamper-evident only after its batch root is committed on-chain. Nullifier secret &amp; ElGamal private key stay server-side / in-memory only.</text>`);

p(`</svg>`);

const target = path.join(__dirname, "evoting-system-flow.svg");
fs.writeFileSync(target, out.join("\n"), "utf-8");
console.log("Wrote", target, "(", H, "px tall )");
