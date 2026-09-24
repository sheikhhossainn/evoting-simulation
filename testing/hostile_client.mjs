/**
 * P6 HTTP-layer hostile-client harness.
 *
 * Required environment:
 *   HOSTILE_CLIENT_BASE_URL       e.g. https://staging.example
 *   HOSTILE_CLIENT_ELECTION_ID
 *   HOSTILE_CLIENT_TOKEN          a session token for the replay case
 *   HOSTILE_CLIENT_CIPHERTEXT     JSON: {"c1":"...","c2":"..."}
 *   HOSTILE_CLIENT_PROOF           JSON: {"challenges":[],"responses":[]}
 *   HOSTILE_CLIENT_REPLAY_BODY     JSON body captured from an already-cast vote
 *
 * The harness never prints the token, NID, ciphertext, or proof. It records
 * only statuses and the public vote count before/after the rejected attempts.
 */

import { writeFile } from "node:fs/promises";

const required = [
  "HOSTILE_CLIENT_BASE_URL",
  "HOSTILE_CLIENT_ELECTION_ID",
  "HOSTILE_CLIENT_TOKEN",
  "HOSTILE_CLIENT_CIPHERTEXT",
  "HOSTILE_CLIENT_PROOF",
  "HOSTILE_CLIENT_REPLAY_BODY",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const baseUrl = process.env.HOSTILE_CLIENT_BASE_URL.replace(/\/$/, "");
const electionId = process.env.HOSTILE_CLIENT_ELECTION_ID;
const token = process.env.HOSTILE_CLIENT_TOKEN;
const ciphertext = JSON.parse(process.env.HOSTILE_CLIENT_CIPHERTEXT);
const proof = JSON.parse(process.env.HOSTILE_CLIENT_PROOF);
const replayBody = JSON.parse(process.env.HOSTILE_CLIENT_REPLAY_BODY);

async function request(path, body, authenticated) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${token}`, "x-device-id": "hostile-client-harness" } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* status is the evidence */ }
  return { status: response.status, code: payload && typeof payload.code === "string" ? payload.code : null };
}

async function publicCount() {
  const response = await fetch(`${baseUrl}/public/stats?election_id=${encodeURIComponent(electionId)}`);
  if (!response.ok) throw new Error(`public stats failed with ${response.status}`);
  const payload = await response.json();
  return payload.total_votes_cast;
}

const before = await publicCount();
const attempts = [
  {
    name: "omitted-proof",
    result: await request("/vote", { election_id: electionId, encrypted_vote: ciphertext }, true),
  },
  {
    name: "forged-proof",
    result: await request("/vote", { election_id: electionId, encrypted_vote: ciphertext, zkp_proof: { ...proof, responses: ["forged"] } }, true),
  },
  {
    name: "omitted-session",
    result: await request("/vote", { election_id: electionId, encrypted_vote: ciphertext, zkp_proof: proof }, false),
  },
  {
    name: "replayed-cast",
    result: await request("/vote", replayBody, true),
  },
];
const after = await publicCount();
const allowedStatuses = new Set([400, 401, 409]);
const unexpected = attempts.filter(({ result }) => !allowedStatuses.has(result.status));
if (unexpected.length > 0) throw new Error(`unexpected hostile-client status: ${unexpected.map(({ name, result }) => `${name}=${result.status}`).join(", ")}`);
if (after !== before) throw new Error(`vote count changed from ${before} to ${after}`);

const output = {
  generated_at: new Date().toISOString(),
  base_url: new URL(baseUrl).origin,
  election_id: electionId,
  attempts,
  public_vote_count_before: before,
  public_vote_count_after: after,
  zero_vote_count_delta: true,
};
await writeFile("testing/hostile_client_output.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ attempts, zero_vote_count_delta: true }));
