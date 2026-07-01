import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const DB_FILE = path.join(__dirname, "../../db.json");

interface Voter {
  id: string;
  nid_hash: string;
  name: string;
  constituency_code: string;
  is_eligible: boolean;
  has_voted: boolean;
}

interface Nullifier {
  id: string;
  election_id: string;
  nullifier_hash: string;
}

interface Vote {
  id: string;
  voter_nid_hash: string;
  encrypted_vote: any;
  status: string;
}

interface Database {
  voters: Voter[];
  nullifiers: Nullifier[];
  votes: Vote[];
}

function readDb(): Database {
  if (!fs.existsSync(DB_FILE)) {
    return { voters: [], nullifiers: [], votes: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function writeDb(db: Database) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

export const localDb = {
  getVoterByNidHash: (nid_hash: string) => {
    return readDb().voters.find((v) => v.nid_hash === nid_hash);
  },
  insertVoter: (voterData: Omit<Voter, "id">) => {
    const db = readDb();
    const newVoter = { ...voterData, id: uuidv4() };
    db.voters.push(newVoter);
    writeDb(db);
    return newVoter;
  },
  checkNullifier: (election_id: string, nullifier_hash: string) => {
    return readDb().nullifiers.some(
      (n) => n.election_id === election_id && n.nullifier_hash === nullifier_hash
    );
  },
  castVote: (nid_hash: string, encrypted_vote: any, nullifier_hash: string, election_id: string) => {
    const db = readDb();
    
    // Check if voter exists
    const voter = db.voters.find((v) => v.nid_hash === nid_hash);
    if (!voter) throw new Error("Voter not registered");
    if (!voter.is_eligible) throw new Error("Voter is not eligible to vote");
    if (voter.has_voted) throw new Error("You have already voted");

    // Double check nullifier
    const hasNullifier = db.nullifiers.some(
      (n) => n.election_id === election_id && n.nullifier_hash === nullifier_hash
    );
    if (hasNullifier) throw new Error("You have already voted");

    // Flip has_voted
    voter.has_voted = true;

    // Insert vote
    const voteId = uuidv4();
    db.votes.push({
      id: voteId,
      voter_nid_hash: nid_hash,
      encrypted_vote,
      status: "queued"
    });

    // Insert nullifier
    db.nullifiers.push({
      id: uuidv4(),
      election_id,
      nullifier_hash
    });

    writeDb(db);
    return voteId;
  }
};
