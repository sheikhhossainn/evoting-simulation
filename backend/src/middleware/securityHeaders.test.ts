import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { strictTransportSecurity, HSTS_VALUE } from "./securityHeaders";

function runMiddleware(forwardedProto?: string) {
  let header: string | undefined;
  const req = { headers: forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}, protocol: "http" } as unknown as Request;
  const res = { setHeader: (_name: string, value: string) => { header = value; } } as unknown as Response;
  let called = false;
  const next = (() => { called = true; }) as NextFunction;
  strictTransportSecurity(req, res, next);
  return { header, called };
}

describe("strict transport security", () => {
  it("sets HSTS for an HTTPS request behind a TLS-terminating proxy", async () => {
    expect(runMiddleware("https")).toEqual({ header: HSTS_VALUE, called: true });
  });

  it("does not advertise HSTS on local HTTP", async () => {
    expect(runMiddleware()).toEqual({ header: undefined, called: true });
  });
});
