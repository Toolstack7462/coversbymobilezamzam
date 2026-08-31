import { describe, expect, it } from "vitest";

import { hasTwoFactorChallenge } from "../../app/infrastructure/auth/cookies.server";

/**
 * Whether a two-factor challenge is in flight.
 *
 * The challenge page is reachable without a session by design — the password
 * has been accepted but no session exists yet — so this cookie is the only
 * thing separating "answering a challenge" from "a stranger typing the URL".
 * Getting it wrong in the strict direction locks every member of staff out of
 * the shop, which has happened twice in this codebase already.
 */

const request = (cookie?: string) =>
  new Request("https://example.test/admin/sicurezza/2fa/verifica", {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });

describe("hasTwoFactorChallenge", () => {
  it("is false when there are no cookies at all", () => {
    expect(hasTwoFactorChallenge(request())).toBe(false);
  });

  it("is false for an empty cookie header", () => {
    expect(hasTwoFactorChallenge(request(""))).toBe(false);
  });

  it("finds the challenge cookie", () => {
    expect(hasTwoFactorChallenge(request("better-auth.two_factor=abc123"))).toBe(true);
  });

  it("finds it behind the __Secure- prefix", () => {
    /*
     * The reason this is matched loosely. Better Auth adds `__Secure-` once
     * cookies are secure — true over HTTPS, false on localhost — so a
     * hardcoded name passes every local test and redirects real staff away
     * from the challenge the moment it is deployed.
     */
    expect(hasTwoFactorChallenge(request("__Secure-better-auth.two_factor=abc123"))).toBe(true);
  });

  it("finds it among other cookies, in any position", () => {
    expect(hasTwoFactorChallenge(request("theme=dark; better-auth.two_factor=abc; other=1"))).toBe(
      true,
    );
    expect(hasTwoFactorChallenge(request("better-auth.two_factor=abc; theme=dark"))).toBe(true);
  });

  it("tolerates the spacing browsers actually send", () => {
    expect(hasTwoFactorChallenge(request("a=1;better-auth.two_factor=abc"))).toBe(true);
    expect(hasTwoFactorChallenge(request("a=1;   better-auth.two_factor=abc"))).toBe(true);
  });

  it("is false for a session cookie alone", () => {
    // A full session is handled earlier, by redirecting to the dashboard.
    expect(hasTwoFactorChallenge(request("better-auth.session_token=abc123"))).toBe(false);
  });

  it("ignores the word appearing in a cookie VALUE", () => {
    /*
     * Otherwise anyone could conjure a challenge by setting a cookie of their
     * own, since cookie values are entirely attacker-controlled.
     */
    expect(hasTwoFactorChallenge(request("theme=two_factor"))).toBe(false);
    expect(hasTwoFactorChallenge(request("returnTo=/x?two_factor=1"))).toBe(false);
  });
});
