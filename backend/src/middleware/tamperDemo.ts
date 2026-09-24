/**
 * tamperDemo.ts — production gate for the demo-only tamper routes (threat T4).
 *
 * POST /anchor/tamper/{root,ballot,delete-vote} and POST /anchor/restore/root
 * exist to demonstrate the tamper-detection story. One of them is not
 * hypothetical: /anchor/tamper/delete-vote genuinely deletes a vote row through
 * fn_admin_delete_vote (the single audited exception to trg_votes_no_delete).
 *
 * They therefore answer **404 unless ENABLE_TAMPER_DEMO=1** — deliberately a
 * 404 rather than a 403, so an unconfigured deployment does not advertise that
 * such routes exist at all. This is layered on top of requireAdminSecret, not
 * instead of it: both must pass in a demo environment.
 */
import { Request, Response, NextFunction } from "express";

export function isTamperDemoEnabled(): boolean {
  return process.env.ENABLE_TAMPER_DEMO === "1";
}

export function requireTamperDemo(_req: Request, res: Response, next: NextFunction): void {
  if (isTamperDemoEnabled()) {
    next();
    return;
  }

  res.status(404).json({
    error: "Not found",
    code: "NOT_FOUND",
    retryable: false,
  });
}
