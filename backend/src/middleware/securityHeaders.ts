import type { NextFunction, Request, Response } from "express";

const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Emit HSTS only for requests that arrived over HTTPS. The proxy-aware check
 * keeps local HTTP development usable while ensuring production responses
 * cannot silently omit the browser transport policy behind TLS termination.
 */
export function strictTransportSecurity(req: Request, res: Response, next: NextFunction): void {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string"
    ? forwardedProto.split(",", 1)[0]?.trim().toLowerCase()
    : req.protocol;

  if (protocol === "https") {
    res.setHeader("Strict-Transport-Security", HSTS_VALUE);
  }

  next();
}

export { HSTS_VALUE };
