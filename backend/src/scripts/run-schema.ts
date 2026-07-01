/**
 * init-db.ts — Initialize Supabase database with schema.sql
 *
 * Run: npx ts-node src/scripts/init-db.ts
 *
 * Uses the Supabase Management API to execute schema.sql.
 * Requires the Supabase project ref and service role key.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

// Extract project ref from URL: https://<ref>.supabase.co
const projectRef = supabaseUrl.replace("https://", "").split(".")[0];

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function executeSqlStatements(sql: string) {
  // Split SQL into individual statements (split on semicolons, respecting $$ blocks)
  // We'll use the Supabase client rpc to execute a custom function,
  // but since the tables don't exist yet, we need raw SQL.
  
  // Use the Supabase SQL API (available at the project's database endpoint)
  const dbUrl = `https://${projectRef}.supabase.co/pg`;
  
  // Actually, Supabase exposes a raw SQL endpoint via the query endpoint
  // Let's try using the postgrest-js workaround: create a temporary function
  
  console.log("📋 Attempting to execute schema via Supabase...\n");
  
  // The simplest approach: split and execute each DDL statement
  // Parse out individual statements, skipping comments and empty lines
  const statements = splitSqlStatements(sql);
  
  let succeeded = 0;
  let failed = 0;
  
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    
    try {
      const { error } = await supabase.rpc("exec_sql", { sql_text: trimmed });
      
      if (error) {
        // If exec_sql doesn't exist, we can't use this approach
        if (error.message.includes("function") && error.message.includes("does not exist")) {
          console.log("❌ The exec_sql function is not available.");
          console.log("   You need to execute the schema manually.\n");
          printManualInstructions();
          return;
        }
        console.log(`  ⚠️  ${error.message}`);
        failed++;
      } else {
        succeeded++;
      }
    } catch (err: any) {
      console.log(`  ❌ ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n✅ ${succeeded} statements succeeded, ${failed} failed\n`);
}

function splitSqlStatements(sql: string): string[] {
  // Simple split that respects $$ blocks (for PL/pgSQL functions)
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  
  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Track $$ blocks
    const dollarMatches = trimmedLine.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }
    
    current += line + "\n";
    
    // If we see a semicolon at the end and we're not in a $$ block, split here
    if (trimmedLine.endsWith(";") && !inDollarQuote) {
      statements.push(current.trim());
      current = "";
    }
  }
  
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements;
}

function printManualInstructions() {
  const schemaPath = path.join(__dirname, "../schema.sql");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  Execute schema.sql manually in Supabase:          │");
  console.log("  │                                                     │");
  console.log("  │  1. Go to: https://supabase.com/dashboard          │");
  console.log("  │  2. Open your project → SQL Editor                 │");
  console.log("  │  3. Paste the contents of:                         │");
  console.log(`  │     ${schemaPath}`);
  console.log("  │  4. Click \"Run\"                                    │");
  console.log("  │                                                     │");
  console.log("  │  Then re-run:                                      │");
  console.log("  │     npx ts-node src/scripts/seed-voters.ts         │");
  console.log("  └─────────────────────────────────────────────────────┘");
}

async function main() {
  console.log("\n🗄️  Supabase Database Initialization\n");
  
  const schemaPath = path.join(__dirname, "../schema.sql");
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ schema.sql not found at: ${schemaPath}`);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(schemaPath, "utf-8");
  
  // Try to detect if tables already exist
  const { data, error } = await supabase.from("voters").select("id").limit(1);
  
  if (!error) {
    console.log("✅ Tables already exist in Supabase. Schema appears initialized.");
    console.log("   Run seed-voters.ts to populate test data.\n");
    return;
  }
  
  if (error.code === "PGRST205") {
    // Table doesn't exist — need to create it
    console.log("Tables not found. Attempting to initialize...\n");
    await executeSqlStatements(sql);
  } else {
    console.error("Unexpected error:", error);
    printManualInstructions();
  }
}

main().catch(console.error);
