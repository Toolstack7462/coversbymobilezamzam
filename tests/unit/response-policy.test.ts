import { describe, expect, it } from "vitest";

import { CSP_PRODUCTION, CSP_DEVELOPMENT, cacheControlFor } from "../../workers/response-policy";

/**
 * The response policy.
 *
 * These are one-line decisions with consequences that do not show up in any
 * feature test: a missing `private` hands one customer's basket to the next
 * person through a shared cache, and a missing `frame-ancestors` leaves the
 * page that changes the shop's bank details frameable. Pinned here so a later
 * edit has to be deliberate.
 */

describe("cacheControlFor", () => {
  it("never stores staff pages", () => {
    // Order details, customer names, payment state.
    for (const path of [
      "/admin",
      "/admin/ordini",
      "/admin/ordini/ord_123",
      "/admin/pagamenti",
      "/admin/clienti",
      "/admin/impostazioni",
    ]) {
      expect(cacheControlFor(path), path).toContain("no-store");
      expect(cacheControlFor(path), path).toContain("private");
    }
  });

  it("never stores API responses", () => {
    expect(cacheControlFor("/api/auth/sign-in/email")).toContain("no-store");
  });

  it("does not mistake a storefront path that merely begins with the letters", () => {
    /*
     * `/admin` must match, `/administrative-something` must not — a prefix test
     * written as `startsWith("/admin")` alone would silently apply no-store to
     * storefront URLs, and nobody would notice because the failure is only ever
     * a slower page.
     */
    expect(cacheControlFor("/amministrazione")).not.toContain("no-store");
    expect(cacheControlFor("/prodotti/admin-cover")).not.toContain("no-store");
  });

  it("lets the browser keep storefront pages but always revalidate them", () => {
    const policy = cacheControlFor("/prodotti/cover-iphone-16-pro");
    expect(policy).toContain("no-cache");
    expect(policy).toContain("must-revalidate");
    expect(policy).not.toContain("no-store");
  });

  it("marks every response private", () => {
    /*
     * The load-bearing word. These pages vary by cookie — the cart is a session
     * — so `public` would let a shared cache serve one customer's basket to
     * whoever asks for the same URL next.
     */
    for (const path of ["/", "/shop", "/carrello", "/admin", "/api/health"]) {
      expect(cacheControlFor(path), path).toContain("private");
      expect(cacheControlFor(path), path).not.toContain("public");
    }
  });
});

describe("content security policy", () => {
  const required = [
    // The admin can verify a payment and change the IBAN customers pay into.
    "frame-ancestors 'none'",
    // A form retargeted at another origin is how credentials leave.
    "form-action 'self'",
    // An injected <base> rewrites every relative URL, forms included.
    "base-uri 'self'",
    "object-src 'none'",
    "default-src 'self'",
  ];

  it.each(required)("production policy contains %s", (directive) => {
    expect(CSP_PRODUCTION).toContain(directive);
  });

  it.each(required)("development policy contains %s", (directive) => {
    // Development is relaxed only for the hot-reload websocket. Everything that
    // protects the shop applies there too, or the relaxation would drift.
    expect(CSP_DEVELOPMENT).toContain(directive);
  });

  it("allows no cross-origin script source", () => {
    // 'unsafe-inline' is present and documented; an external origin is not.
    expect(CSP_PRODUCTION).toContain("script-src 'self' 'unsafe-inline'");
    expect(CSP_PRODUCTION).not.toMatch(/script-src[^;]*https?:/);
  });

  it("never leaks the local tooling origin into production", () => {
    /*
     * Development allows http://localhost:8400 so injected design tooling can
     * load. If that ever reaches the deployed policy it is an external origin
     * permitted to serve script to a customer — the exact thing the policy
     * exists to refuse.
     */
    expect(CSP_DEVELOPMENT).toContain("localhost:8400");
    expect(CSP_PRODUCTION).not.toContain("localhost");
  });

  it("opens the websocket exception in development only", () => {
    expect(CSP_DEVELOPMENT).toContain("connect-src 'self' ws: wss:");
    expect(CSP_PRODUCTION).toContain("connect-src 'self'");
    expect(CSP_PRODUCTION).not.toContain("ws:");
  });
});
