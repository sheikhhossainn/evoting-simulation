import "dotenv/config";
import { supabase } from "../supabaseClient";

async function main() {
  const { error } = await supabase.rpc("exec_sql", { sql_text: "SELECT 1;" });
  if (error) {
    if (error.message.includes("does not exist") || error.code === "PGRST202") {
      console.log("RESULT: exec_sql RPC does NOT exist");
    } else {
      console.log("RESULT: exec_sql error", error.code, "|", error.message);
    }
    process.exit(0);
  }
  console.log("RESULT: exec_sql RPC EXISTS and ran SELECT 1");
  process.exit(0);
}

main();
