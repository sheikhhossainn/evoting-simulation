import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  computeAvailability,
  isAcceptingVotes,
  validateStatusTransition,
} from "./electionLifecycle";
import { recordAdminAction, type AdminActionRecord, type AdminAuditWriter } from "./adminAudit";

describe("election lifecycle contracts", () => {
  it("accepts only the forward single-step chain", () => {
    expect(validateStatusTransition("setup", "voting")).toEqual({ ok: true, idempotent: false });
    expect(validateStatusTransition("voting", "tallying")).toEqual({ ok: true, idempotent: false });
    expect(validateStatusTransition("tallying", "closed")).toEqual({ ok: true, idempotent: false });
  });

  it("rejects jumps, backwards moves, and non-closed repeated statuses", () => {
    expect(validateStatusTransition("setup", "tallying")).toEqual({
      ok: false,
      reason: "NOT_FORWARD_SINGLE_STEP",
    });
    expect(validateStatusTransition("voting", "setup")).toEqual({
      ok: false,
      reason: "NOT_FORWARD_SINGLE_STEP",
    });
    expect(validateStatusTransition("voting", "voting")).toEqual({
      ok: false,
      reason: "NOT_FORWARD_SINGLE_STEP",
    });
  });

  it("allows closed-to-closed idempotence and rejects unknown statuses", () => {
    expect(validateStatusTransition("closed", "closed")).toEqual({ ok: true, idempotent: true });
    expect(validateStatusTransition("draft", "voting")).toEqual({ ok: false, reason: "UNKNOWN_STATUS" });
    expect(validateStatusTransition("setup", "paused")).toEqual({ ok: false, reason: "UNKNOWN_STATUS" });
  });

  it("uses one accepting-votes predicate for the gate and hub availability", () => {
    for (const status of ["setup", "voting", "tallying", "closed"]) {
      expect(computeAvailability(status) === "open").toBe(isAcceptingVotes(status));
    }
    expect(computeAvailability("voting")).toBe("open");
    expect(computeAvailability("setup")).toBe("closed");
  });
});

describe("admin audit write point", () => {
  it("writes the static actor and the exact audit shape", async () => {
    const rows: AdminActionRecord[] = [];
    const writer: AdminAuditWriter = {
      async insert(record) {
        rows.push(record);
        return { error: null };
      },
    };

    await recordAdminAction(
      {
        election_id: "E-1",
        action: "election.status",
        request_summary: { from_status: "setup", to_status: "voting" },
        http_status: 200,
      },
      writer
    );

    expect(rows).toEqual([
      {
        actor_admin_id: "shared-admin",
        election_id: "E-1",
        action: "election.status",
        request_summary: { from_status: "setup", to_status: "voting" },
        http_status: 200,
      },
    ]);
  });

  it("fails the operation when the audit write fails", async () => {
    const writer: AdminAuditWriter = {
      async insert() {
        return { error: new Error("database unavailable") };
      },
    };

    await expect(
      recordAdminAction(
        {
          election_id: "E-1",
          action: "election.status",
          request_summary: {},
          http_status: 200,
        },
        writer
      )
    ).rejects.toThrow("Admin audit write failed");
  });
});

describe("admin route audit registry", () => {
  it("requires every requireAdminSecret route block to call recordAdminAction", () => {
    const routeDir = path.resolve(__dirname, "../routes");
    const routeFiles = fs.readdirSync(routeDir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    const guardedBlocks: string[] = [];

    for (const file of routeFiles) {
      const source = fs.readFileSync(path.join(routeDir, file), "utf8");
      const blocks = source.split(/(?=router\.(?:post|patch|put|delete)\s*\()/).slice(1);
      guardedBlocks.push(...blocks.filter((block) => block.includes("requireAdminSecret")));
    }

    expect(guardedBlocks.length).toBeGreaterThan(0);
    for (const block of guardedBlocks) {
      expect(block).toContain("recordAdminAction");
    }
  });
});
