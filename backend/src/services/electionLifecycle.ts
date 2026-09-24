/**
 * Pure election-window rules shared by the vote gate and the public election
 * registry. Keeping these rules free of Supabase makes it impossible for the
 * hub and the cast path to quietly drift apart.
 */

export const ELECTION_STATUSES = ["setup", "voting", "tallying", "closed"] as const;
export type ElectionStatus = (typeof ELECTION_STATUSES)[number];
export type ElectionAvailability = "open" | "closed";

const NEXT_STATUS: Record<ElectionStatus, ElectionStatus | null> = {
  setup: "voting",
  voting: "tallying",
  tallying: "closed",
  closed: null,
};

export function isElectionStatus(value: string): value is ElectionStatus {
  return (ELECTION_STATUSES as readonly string[]).includes(value);
}

export function isAcceptingVotes(status: string): boolean {
  return status === "voting";
}

export function computeAvailability(status: string): ElectionAvailability {
  return isAcceptingVotes(status) ? "open" : "closed";
}

export type TransitionValidation =
  | { ok: true; idempotent: boolean }
  | { ok: false; reason: "UNKNOWN_STATUS" | "NOT_FORWARD_SINGLE_STEP" };

/**
 * Valid transitions are one step forward. A closed election may be submitted
 * as closed again as a harmless idempotent admin operation; no event row is
 * emitted for that case by the route.
 */
export function validateStatusTransition(from: string, to: string): TransitionValidation {
  if (!isElectionStatus(from) || !isElectionStatus(to)) {
    return { ok: false, reason: "UNKNOWN_STATUS" };
  }
  if (from === "closed" && to === "closed") {
    return { ok: true, idempotent: true };
  }
  if (NEXT_STATUS[from] === to) {
    return { ok: true, idempotent: false };
  }
  return { ok: false, reason: "NOT_FORWARD_SINGLE_STEP" };
}
