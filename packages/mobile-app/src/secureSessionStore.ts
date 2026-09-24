import * as SecureStore from "expo-secure-store";
import type { SessionStore } from "@evoting/core-api";

const SESSION_KEY = "secure-vote.session";
const DEVICE_KEY = "secure-vote.device-id";
const AUDIT_KEY = "secure-vote.audit-record";

interface StoredSession {
  token: string;
  expiresAt: string;
  electionId: string;
}

export function createSecureSessionStore(): SessionStore {
  return {
    async read() {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as StoredSession;
        if (!parsed.token || !parsed.expiresAt || !parsed.electionId) return null;
        return parsed;
      } catch {
        await SecureStore.deleteItemAsync(SESSION_KEY);
        return null;
      }
    },
    async write(session) {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    },
    async clear() {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    },
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateDeviceId(randomBytes: (length: number) => Promise<Uint8Array>): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const created = `device-${hex(await randomBytes(16))}`;
  await SecureStore.setItemAsync(DEVICE_KEY, created);
  return created;
}

export interface SavedAuditRecord {
  electionId: string;
  candidateId: string;
  ciphertext: { c1: string; c2: string };
  randomness: string;
  savedAt: string;
}

export async function saveAuditRecord(record: SavedAuditRecord): Promise<void> {
  await SecureStore.setItemAsync(AUDIT_KEY, JSON.stringify(record));
}

export async function readAuditRecord(): Promise<SavedAuditRecord | null> {
  const raw = await SecureStore.getItemAsync(AUDIT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SavedAuditRecord; } catch { return null; }
}

export async function deleteAuditRecord(): Promise<void> {
  await SecureStore.deleteItemAsync(AUDIT_KEY);
}
