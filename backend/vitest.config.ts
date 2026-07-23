import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Pre-existing manual adversarial-test script, not a vitest suite —
    // self-executes against a live server + Supabase, calls process.exit().
    exclude: ["src/routes/vote.test.ts"],
    environment: "node",
  },
});
