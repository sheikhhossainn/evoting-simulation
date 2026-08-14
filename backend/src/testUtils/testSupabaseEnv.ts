/**
 * testSupabaseEnv.ts — fail-closed environment loader for tests that write
 * to Supabase (vote.test.ts, anchorSmt.integration.test.ts).
 *
 * Both files used to fall back to backend/.env (production) whenever
 * backend/.env.test didn't exist, with no cleanup for anything they
 * inserted. That's exactly how NATIONAL-2026-001's live votes table ended
 * up with permanent fixture rows (`{c1:'c1',c2:'c2'}`, `fake_c1`, `0x01`) —
 * self-documented in vote.test.ts's now-skipped concurrency test and the
 * committed testing/concurrency_stress_output.json evidence — and, because
 * of the `trg_votes_no_delete` trigger, those rows cannot be cleaned up
 * through ordinary means.
 *
 * This loader refuses to run instead: no backend/.env.test, or a
 * backend/.env.test that points at the same Supabase project as
 * production, is now a hard failure at import time, not a silent fallback.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

export function loadTestSupabaseEnv(): void {
  const testEnvPath = path.resolve(__dirname, "../../.env.test");
  const prodEnvPath = path.resolve(__dirname, "../../.env");

  if (!fs.existsSync(testEnvPath)) {
    throw new Error(
      "FATAL: backend/.env.test is required for tests that write to Supabase, and it does not exist.\n" +
        "Create backend/.env.test pointing at a SEPARATE Supabase project — see backend/.env.test.example.\n" +
        "Refusing to fall back to backend/.env (production)."
    );
  }

  const testEnv = dotenv.parse(fs.readFileSync(testEnvPath));
  if (!testEnv.SUPABASE_URL) {
    throw new Error("FATAL: backend/.env.test exists but is missing SUPABASE_URL.");
  }

  if (fs.existsSync(prodEnvPath)) {
    const prodEnv = dotenv.parse(fs.readFileSync(prodEnvPath));
    if (prodEnv.SUPABASE_URL && prodEnv.SUPABASE_URL === testEnv.SUPABASE_URL) {
      throw new Error(
        "FATAL: backend/.env.test's SUPABASE_URL is identical to backend/.env's (production).\n" +
          "Refusing to run — point .env.test at a genuinely separate Supabase project."
      );
    }
  }

  dotenv.config({ path: testEnvPath, override: true });
}
