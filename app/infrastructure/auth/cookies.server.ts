/**
 * Relaying Better Auth's cookies.
 *
 * `Response.headers.get("Set-Cookie")` returns ONE value. Set-Cookie is the one
 * header that legitimately appears many times in a response, and the Headers
 * API deliberately does not join them — joining would be ambiguous, because a
 * cookie's `Expires` attribute contains a comma.
 *
 * Every auth route in this project read it with `.get()`, so whenever Better
 * Auth issued more than one cookie, all but the first were silently dropped.
 *
 * That was not theoretical. Signing in to an account with two-factor enabled
 * sets both a session cookie and a two-factor challenge cookie. Only the
 * session survived, so the challenge page had nothing identifying which
 * challenge it was answering, and every correct code was rejected as "Codice
 * non valido o scaduto". The account was permanently unable to log in, and the
 * message pointed the merchant at their phone's clock.
 *
 * `getSetCookie()` returns all of them. It is the only correct way to read this
 * header, and this module exists so the question is settled in one place rather
 * than re-decided at five call sites.
 */

/** Every Set-Cookie value from a response, in order. */
export function allSetCookies(response: Response): string[] {
  // getSetCookie is the standard accessor; the fallback covers a runtime that
  // predates it, where a single value is still better than none.
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();

  const single = response.headers.get("Set-Cookie");
  return single === null ? [] : [single];
}

/**
 * Headers carrying every cookie from `response`, for a redirect or a render.
 *
 * Returns undefined when there are none, so callers can pass it straight
 * through to `redirect()` without constructing an empty Headers object.
 */
export function relayCookies(response: Response): { headers: Headers } | undefined {
  const cookies = allSetCookies(response);
  if (cookies.length === 0) return undefined;

  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return { headers };
}

/**
 * A `Cookie` request-header value built from a response's Set-Cookie list.
 *
 * Used when the server has to make a follow-up call as the user it just
 * authenticated — reading the new session back, for instance. Only the
 * name=value pair of each cookie is kept, because attributes like `Path` and
 * `HttpOnly` are response-side and meaningless on a request.
 */
export function cookieHeaderFrom(response: Response): string {
  return allSetCookies(response)
    .map((cookie) => cookie.split(";", 1)[0]!.trim())
    .filter((pair) => pair !== "")
    .join("; ");
}

/**
 * Is this request carrying a two-factor challenge?
 *
 * Better Auth issues a short-lived `two_factor` cookie — and NOT a session —
 * once a password has been accepted for an account with a verified factor. Its
 * presence is what makes the challenge page meaningful: without it there is no
 * challenge to answer, and any code submitted is rejected whatever it is.
 *
 * Matched on the cookie NAME, tolerantly. Better Auth prefixes the name with
 * `__Secure-` once cookies are secure, which they are over HTTPS and are not on
 * localhost — so a hardcoded name would work in development and fail on the
 * deployed site, which is the failure mode this codebase has already been
 * bitten by twice.
 *
 * Only names are examined. A cookie whose VALUE happened to contain the word
 * would otherwise let anyone conjure a challenge by setting a cookie.
 */
export function hasTwoFactorChallenge(request: Request): boolean {
  const header = request.headers.get("Cookie");
  if (!header) return false;

  return header
    .split(";")
    .map((pair) => pair.trim().split("=")[0] ?? "")
    .some((name) => /two[._-]?factor/i.test(name));
}
