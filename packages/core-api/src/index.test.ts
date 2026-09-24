import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type SessionStore } from "./index";

function store(): SessionStore & { value: { token: string; expiresAt: string; electionId: string } | null } {
  const value: { token: string; expiresAt: string; electionId: string } | null = null;
  return {
    value,
    async read() { return this.value; },
    async write(next) { this.value = next; },
    async clear() { this.value = null; },
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("core-api", () => {
  it("rejects insecure non-local API bases", () => {
    expect(() => createApiClient({
      baseUrl: "http://api.example.test",
      deviceId: "device-1",
      sessionStore: store(),
    })).toThrow("must use HTTPS");
  });

  it("allows explicitly opted-in local development only", () => {
    expect(() => createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      allowInsecureLocalhost: true,
      deviceId: "device-1",
      sessionStore: store(),
    })).not.toThrow();
  });

  it("serializes session auth and stores only the returned session token", async () => {
    const saved = store();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.test/voter/session");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        nid: "12345678901",
        election_id: "E-1",
        device_id: "device-1",
      });
      return response(201, {
        token: "opaque-token",
        token_type: "Bearer",
        expires_at: "2030-01-01T00:00:00.000Z",
        election_id: "E-1",
        voter: { registered: true, is_eligible: true, has_voted: false, constituency_code: "DHK-01" },
      });
    });
    const client = createApiClient({ baseUrl: "https://api.example.test", deviceId: "device-1", sessionStore: saved, fetchImpl });

    await client.authenticate("12345678901", "E-1");
    expect(saved.value).toEqual({ token: "opaque-token", expiresAt: "2030-01-01T00:00:00.000Z", electionId: "E-1" });
  });

  it("casts without putting the NID in the request body", async () => {
    const saved = store();
    saved.value = { token: "opaque-token", expiresAt: "2030-01-01T00:00:00.000Z", electionId: "E-1" };
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer opaque-token");
      expect(headers.get("x-device-id")).toBe("device-1");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ election_id: "E-1", encrypted_vote: { c1: "a", c2: "b" }, zkp_proof: { challenges: ["1"], responses: ["2"] } });
      expect(body).not.toHaveProperty("nid");
      return response(201, { status: "queued", vote_id: "vote-1" });
    });
    const client = createApiClient({ baseUrl: "https://api.example.test", deviceId: "device-1", sessionStore: saved, fetchImpl });

    await expect(client.castVote("E-1", { c1: "a", c2: "b" }, { challenges: ["1"], responses: ["2"] })).resolves.toEqual({ status: "queued", vote_id: "vote-1" });
  });

  it("maps the stable envelope and safely defaults unknown codes", async () => {
    const saved = store();
    const fetchImpl = vi.fn(async () => response(403, { error: "closed", code: "ELECTION_NOT_OPEN", retryable: false }));
    const client = createApiClient({ baseUrl: "https://api.example.test", deviceId: "device-1", sessionStore: saved, fetchImpl });
    await expect(client.listElections()).rejects.toMatchObject({ code: "ELECTION_NOT_OPEN", retryable: false, status: 403 });

    const unknownClient = createApiClient({
      baseUrl: "https://api.example.test",
      deviceId: "device-1",
      sessionStore: saved,
      fetchImpl: vi.fn(async () => response(500, { error: "opaque server detail", code: "NEW_CODE", retryable: false, token: "must-not-leak" })),
    });
    try { await unknownClient.listElections(); } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: "UNKNOWN", retryable: false });
      expect(String(error)).not.toContain("must-not-leak");
    }
  });

  it("clears secure session state after revoke", async () => {
    const saved = store();
    saved.value = { token: "opaque-token", expiresAt: "2030-01-01T00:00:00.000Z", electionId: "E-1" };
    const client = createApiClient({ baseUrl: "https://api.example.test", deviceId: "device-1", sessionStore: saved, fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) });
    await client.revokeSession();
    expect(saved.value).toBeNull();
  });

  it("does not log raw error payloads", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      deviceId: "device-1",
      sessionStore: store(),
      fetchImpl: vi.fn(async () => response(500, { error: "private detail", token: "opaque-token" })),
    });

    await expect(client.listElections()).rejects.toBeInstanceOf(ApiError);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
