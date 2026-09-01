import { describe, it, expect } from "vitest";

/**
 * Set-Cookie survives the Worker's response-header rewrite.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 *
 * `applyResponseHeaders` wraps every response to attach CSP and friends, and it
 * started with `new Headers(response.headers)`. Set-Cookie is the one header
 * that legitimately appears many times, and the Headers constructor is not
 * obliged to keep them apart — `cookies.server.ts` already documents the
 * `.get()` version of this trap at length, and this is the same trap one layer
 * out.
 *
 * It only bites a response that sets MORE THAN ONE cookie. Signing in with a
 * second factor is exactly that: answering the challenge sets the session
 * cookie and clears the two-factor cookie in the same response. The symptom is
 * that a correct code is accepted — the server logs the challenge as passed and
 * creates a real session — and the browser is still not signed in, because the
 * two cookies arrived folded into one malformed value and neither was stored.
 *
 * Run in the workers pool, so this is workerd's Headers and not Node's.
 */
describe("response header rewriting", () => {
  it("keeps two Set-Cookie headers separate through a Headers copy", () => {
    const original = new Response("ok");
    original.headers.append("Set-Cookie", "session=abc; Path=/; HttpOnly; Secure");
    original.headers.append("Set-Cookie", "challenge=; Path=/; Max-Age=0");

    const copied = new Headers(original.headers);

    // The assertion that matters: two cookies in, two cookies out.
    expect(copied.getSetCookie()).toHaveLength(2);
    expect(copied.getSetCookie()[0]).toContain("session=abc");
    expect(copied.getSetCookie()[1]).toContain("challenge=");
  });

  it("keeps them separate through a full Response reconstruction", () => {
    const original = new Response("ok", { status: 302 });
    original.headers.append("Set-Cookie", "session=abc; Path=/");
    original.headers.append("Set-Cookie", "challenge=; Max-Age=0");

    const headers = new Headers(original.headers);
    headers.set("content-security-policy", "default-src 'self'");

    const rebuilt = new Response(original.body, {
      status: original.status,
      statusText: original.statusText,
      headers,
    });

    expect(rebuilt.headers.getSetCookie()).toHaveLength(2);
  });
});
