import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminActionRecord {
  actor_admin_id: "shared-admin";
  election_id: string;
  action: string;
  request_summary: Record<string, unknown>;
  http_status: number;
}

export interface AdminAuditWriter {
  insert(record: AdminActionRecord): Promise<{ error: unknown | null }>;
}

/**
 * The one write point for administrative audit rows. Audit failures reject the
 * request: an admin operation must not be reported as successful when its
 * audit record could not be persisted. The database mutation is not rolled
 * back here because the existing routes do not share a transaction boundary.
 */
export async function recordAdminAction(
  record: Omit<AdminActionRecord, "actor_admin_id">,
  writer: AdminAuditWriter
): Promise<void> {
  const row: AdminActionRecord = {
    actor_admin_id: "shared-admin",
    ...record,
  };
  const { error } = await writer.insert(row);
  if (error) {
    throw new Error("Admin audit write failed");
  }
}

export function createSupabaseAdminAuditWriter(client: SupabaseClient): AdminAuditWriter {
  return {
    async insert(record) {
      const { error } = await client.from("admin_actions").insert(record);
      return { error };
    },
  };
}
