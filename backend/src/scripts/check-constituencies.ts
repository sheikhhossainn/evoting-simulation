import "dotenv/config";
import { supabase } from "../supabaseClient";

async function main() {
  const { data, error, count } = await supabase
    .from("constituencies")
    .select("*", { count: "exact" });

  if (error) {
    if (error.code === "PGRST205") {
      console.log("RESULT: table 'constituencies' does NOT exist in live DB");
    } else {
      console.log("RESULT: query error", error.code, error.message);
    }
    process.exit(0);
  }

  console.log(`RESULT: table 'constituencies' EXISTS. row count = ${count}`);
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

main();
