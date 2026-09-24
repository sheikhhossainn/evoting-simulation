export type ElectionStatus = "setup" | "voting" | "tallying" | "closed";
export type ElectionAvailability = "open" | "closed";

export interface Election {
  election_id: string;
  name: string;
  constituency_count: number;
  status: ElectionStatus;
  availability: ElectionAvailability;
  created_at: string;
}

export interface SessionResponse {
  token: string;
  token_type: "Bearer";
  expires_at: string;
  election_id: string;
  voter: {
    registered: boolean;
    is_eligible: boolean;
    has_voted: boolean;
    constituency_code: string | null;
  };
}

export interface SessionRefreshResponse {
  token: string;
  token_type: "Bearer";
  expires_at: string;
  election_id: string;
}

export interface VoterMe {
  election_id: string;
  registered: boolean;
  is_eligible: boolean;
  has_voted: boolean;
  constituency_code: string | null;
}

export interface PublicKey {
  p: string;
  g: string;
  y: string;
}

export interface Candidate {
  id: string;
  name: string;
  party: string;
  symbol: string;
  constituency_code: string;
}

export interface CandidatesResponse {
  election_id: string;
  constituency_code: string;
  candidates: Candidate[];
}

export interface EncryptedVote {
  c1: string;
  c2: string;
}

export interface ZkpProof {
  challenges: string[];
  responses: string[];
}

export interface VoteResponse {
  status: "queued" | "confirmed";
  vote_id: string;
}

export interface AnchorVerification {
  election_id: string;
  vote_id: string;
  batch_id: number;
  tx_hash: string | null;
  root: string;
  proof: unknown;
  included_locally: boolean;
  included_on_chain: boolean | null;
}

export interface SmtVerification {
  election_id: string;
  vote_id: string;
  nullifier_hash: string;
  type: "membership" | "non-membership";
  root: string;
  proof: unknown;
  included_locally: boolean;
  included_on_chain: boolean | null;
}

export interface LatestAnchor {
  election_id: string;
  batch_id: number;
  root: string;
  tx_hash: string | null;
  vote_count: number;
  created_at: string;
  sample_vote_id: string | null;
}

export interface PublicStats {
  election_id: string;
  status: string;
  total_registered_voters: number;
  total_votes_cast: number;
  turnout_pct: number;
  constituencies: Array<{
    constituency_code: string;
    registered_voters: number;
    votes_cast: number;
    turnout_pct: number;
  }>;
  key_ceremony: {
    submitted_count: number;
    threshold: number;
    total: number;
    threshold_met: boolean;
  };
  anchoring: {
    batches_anchored: number;
    latest_batch: LatestAnchor | null;
  };
}

export interface PublicResults {
  status: "not_tallied" | "tallied";
  tallied_at?: string;
  results?: unknown;
  batch_id?: number;
  total_votes?: number;
  valid_votes?: number;
  invalid_votes?: number;
}

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "VOTER_NOT_REGISTERED"
  | "VOTER_NOT_ELIGIBLE"
  | "VOTE_ALREADY_CAST"
  | "ELECTION_UNKNOWN"
  | "ELECTION_NOT_OPEN"
  | "KEY_NOT_READY"
  | "COMMITMENT_MISSING"
  | "INVALID_BALLOT"
  | "RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "UPSTREAM_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "DEVICE_MISMATCH"
  | "DEVICE_ID_REQUIRED"
  | "NOT_FOUND"
  | "INTERNAL"
  | "UNKNOWN";

export interface ApiErrorEnvelope {
  error?: string;
  code?: string;
  retryable?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: ApiErrorCode, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SessionStore {
  read(): Promise<{ token: string; expiresAt: string; electionId: string } | null>;
  write(session: { token: string; expiresAt: string; electionId: string }): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface ApiClientOptions {
  baseUrl: string;
  deviceId: string;
  sessionStore: SessionStore;
  fetchImpl?: ApiFetch;
  /** Development-only exception for local HTTP; release config must omit it. */
  allowInsecureLocalhost?: boolean;
}

const KNOWN_CODES = new Set<ApiErrorCode>([
  "VALIDATION_FAILED", "VOTER_NOT_REGISTERED", "VOTER_NOT_ELIGIBLE", "VOTE_ALREADY_CAST",
  "ELECTION_UNKNOWN", "ELECTION_NOT_OPEN", "KEY_NOT_READY", "COMMITMENT_MISSING",
  "INVALID_BALLOT", "RATE_LIMITED", "CAPTCHA_FAILED", "UPSTREAM_UNAVAILABLE",
  "UNAUTHORIZED", "SESSION_INVALID", "SESSION_EXPIRED", "SESSION_REVOKED",
  "DEVICE_MISMATCH", "DEVICE_ID_REQUIRED", "NOT_FOUND", "INTERNAL", "UNKNOWN",
]);

function assertApiBaseUrl(baseUrl: string, allowInsecureLocalhost: boolean): string {
  const parsed = new URL(baseUrl);
  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "10.0.2.2");
  if (parsed.protocol !== "https:" && !(allowInsecureLocalhost && localHttp)) {
    throw new Error("API base URL must use HTTPS outside explicitly allowed local development");
  }
  return parsed.toString().replace(/\/$/, "");
}

function errorFromResponse(status: number, body: unknown): ApiError {
  const envelope = body && typeof body === "object" ? body as ApiErrorEnvelope : {};
  const code = typeof envelope.code === "string" && KNOWN_CODES.has(envelope.code as ApiErrorCode)
    ? envelope.code as ApiErrorCode
    : "UNKNOWN";
  const message = typeof envelope.error === "string" ? envelope.error : "Request failed";
  return new ApiError(message, status, code, envelope.retryable === true);
}

function noSensitiveBody(body: unknown): unknown {
  return body && typeof body === "object" ? { error: (body as ApiErrorEnvelope).error, code: (body as ApiErrorEnvelope).code } : undefined;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = assertApiBaseUrl(options.baseUrl, options.allowInsecureLocalhost === true);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (authenticated) {
      const session = await options.sessionStore.read();
      if (!session) throw new ApiError("Sign in again to continue", 401, "UNAUTHORIZED", false);
      headers.set("Authorization", `Bearer ${session.token}`);
      headers.set("x-device-id", options.deviceId);
    }

    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    let body: unknown = undefined;
    if (response.status !== 204) {
      try { body = await response.json(); } catch { body = undefined; }
    }
    if (!response.ok) {
      // Deliberately do not retain or log the response body: it may contain a
      // server echo added by a future route. Only the stable envelope survives.
      void noSensitiveBody(body);
      throw errorFromResponse(response.status, body);
    }
    return body as T;
  }

  async function json<T>(path: string, body: Record<string, unknown>, authenticated = false): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) }, authenticated);
  }

  return {
    listElections: () => request<{ elections: Election[] }>("/elections"),
    authenticate: async (nid: string, electionId: string, captchaToken?: string): Promise<SessionResponse> => {
      const response = await json<SessionResponse>("/voter/session", {
        nid,
        election_id: electionId,
        device_id: options.deviceId,
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      await options.sessionStore.write({ token: response.token, expiresAt: response.expires_at, electionId: response.election_id });
      return response;
    },
    getMe: () => request<VoterMe>("/voter/me", {}, true),
    refreshSession: async (): Promise<SessionRefreshResponse> => {
      const response = await json<SessionRefreshResponse>("/voter/session/refresh", {}, true);
      await options.sessionStore.write({ token: response.token, expiresAt: response.expires_at, electionId: response.election_id });
      return response;
    },
    revokeSession: async () => {
      await json<void>("/voter/session/revoke", {}, true);
      await options.sessionStore.clear();
    },
    revokeAllSessions: async () => {
      await json<void>("/voter/session/revoke-all", {}, true);
      await options.sessionStore.clear();
    },
    getPublicKey: (electionId: string) => request<PublicKey>(`/election/public-key?election_id=${encodeURIComponent(electionId)}`),
    getCandidates: (electionId: string) => request<CandidatesResponse>(`/candidates?election_id=${encodeURIComponent(electionId)}`, {}, true),
    castVote: (electionId: string, encryptedVote: EncryptedVote, zkpProof: ZkpProof) => json<VoteResponse>("/vote", {
      election_id: electionId,
      encrypted_vote: encryptedVote,
      zkp_proof: zkpProof,
    }, true),
    verifyVote: (electionId: string, voteId: string) => request<AnchorVerification>(`/anchor/verify/${encodeURIComponent(voteId)}?election_id=${encodeURIComponent(electionId)}`),
    verifySmtVote: (electionId: string, voteId: string) => request<SmtVerification>(`/anchor/verify-smt/${encodeURIComponent(voteId)}?election_id=${encodeURIComponent(electionId)}`),
    latestAnchor: (electionId: string) => request<LatestAnchor>(`/anchor/latest?election_id=${encodeURIComponent(electionId)}`),
    publicStats: (electionId: string) => request<PublicStats>(`/public/stats?election_id=${encodeURIComponent(electionId)}`),
    publicResults: (electionId: string) => request<PublicResults>(`/public/results?election_id=${encodeURIComponent(electionId)}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
