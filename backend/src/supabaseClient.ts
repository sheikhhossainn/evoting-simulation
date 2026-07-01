/**
 * supabaseClient.ts
 *
 * Initializes and exports the Supabase client for server-side use.
 * Uses the SERVICE_ROLE key to bypass Row-Level Security (RLS)
 * since all operations here are trusted backend calls.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env\n" +
    "   Copy .env.example → .env and fill in your Supabase credentials."
  );
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
