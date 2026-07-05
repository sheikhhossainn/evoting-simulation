/**
 * adminAuth.ts — Shared-secret guard for sensitive admin operations
 *
 * There is no session-based admin auth yet (the EC Admin login page is
 * still a UI mock — see context.md). Endpoints that can mutate chain state
 * or reveal decrypted tally results (batch anchoring, key reconstruction)
 * are too sensitive to leave open, so they require this header in the
 * interim:
 *
 *   x-admin-secret: <ADMIN_SECRET from .env>
 */

import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

export function requireAdminSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const configured = process.env.ADMIN_SECRET;

  if (!configured) {
    res.status(503).json({
      error: "ADMIN_SECRET not configured on the server — refusing admin action",
    });
    return;
  }

  const provided = req.header("x-admin-secret") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid or missing x-admin-secret header" });
    return;
  }

  next();
}
