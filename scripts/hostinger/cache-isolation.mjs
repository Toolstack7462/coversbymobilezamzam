/**
 * Proves the response cache cannot leak one visitor's page to another —
 * against a real server, over real HTTP, on the target runtime.
 *
 *   npm run test:cache-isolation
 *
 * ── WHY THIS EXISTS BESIDE THE UNIT TESTS ───────────────────────────────────
 *
 * tests/unit/response-cache.test.ts pins the RULES. This proves the rules are
 * actually the ones a request meets. Every real failure of a cache like this
 * one has been a wiring failure rather than a logic failure: the middleware
 * mounted in the wrong place, a header set after the body was sent, a hit path
 * that skipped the security headers because it never called `next()`. None of
 * those are visible to a unit test of the decision functions, and all of them
 * are visible here.
 *
 * ── WHAT IT DOES NOT PROVE ──────────────────────────────────────────────────
 *
 * It sends a session-shaped cookie rather than signing in as a real member of
 * staff, because the isolation rule keys on the PRESENCE of a cookie and not
 * on its validity — that is the whole point of the strict rule, and a real
 * session would test a weaker property than the one being claimed. The
 * authenticated admin screens are covered by the browser suite.
 *
 * It is a lab proof on one machine. It says the rules hold; it says nothing
 * about Hostinger, which needs the hosting account.
 */

import { setTimeout } from "node:timers";
import fs from "node:fs";

import { startLocalServer, VERSION_FILE, DEV_JOB_SECRET } from "./local-server.mjs";

const checks = [];
let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failed += 1;
  checks.push({ name, ok, detail });
  const mark = ok ? "  ok  " : " FAIL ";
  console.log(`${mark} ${name}${detail && !ok ? `\n         ${detail}` : ""}`);
}

async function get(base, path, headers = {}) {
  const response = await fetch(`${base}${path}`, { headers, redirect: "manual" });
  const body = await response.text();
  return {
    status: response.status,
    cache: response.headers.get("x-cache"),
    setCookie: response.headers.getSetCookie(),
    csp: response.headers.get("content-security-policy"),
    frame: response.headers.get("x-frame-options"),
    control: response.headers.get("cache-control"),
    type: response.headers.get("content-type"),
    body,
  };
}

console.log("Cache isolation — starting the Node server against local MariaDB\n");

const server = await startLocalServer();
console.log(`  server pid ${server.pid} on ${server.base}`);
console.log(`  database   ${server.health?.checks?.database?.ok ? "ok" : "DEGRADED"}\n`);

try {
  const base = server.base;

  // ── 1. The cache works at all ─────────────────────────────────────────────
  //
  // Proved first, because every isolation assertion below is worthless if the
  // cache is silently off: "no cached page leaked" is trivially true of a cache
  // that never stores anything.
  const first = await get(base, "/");
  const second = await get(base, "/");
  check("a cold anonymous homepage is a MISS", first.cache === "MISS", `got ${first.cache}`);
  check("the second identical request is a HIT", second.cache === "HIT", `got ${second.cache}`);
  check("the cached body is byte-identical", first.body === second.body);
  check(
    "the cached body is a real page, not an error",
    second.status === 200 && second.body.includes("<html"),
    `status ${second.status}, ${second.body.length} bytes`,
  );

  // ── 2. A replayed page still carries its security headers ─────────────────
  //
  // A hit ends the response without calling `next()`. If the cache were
  // mounted before the response-policy middleware, a cached page would arrive
  // with no CSP and no X-Frame-Options — a hole that opens under load, when
  // the cache is warm, and closes whenever anybody looks with a cold one.
  check(
    "a HIT still carries the CSP",
    typeof second.csp === "string" && second.csp.includes("frame-ancestors 'none'"),
    `csp: ${second.csp}`,
  );
  check("a HIT still carries X-Frame-Options", second.frame === "DENY", `got ${second.frame}`);
  check(
    "a HIT still carries the storefront cache-control",
    typeof second.control === "string" && second.control.includes("private"),
    `got ${second.control}`,
  );
  check(
    "a HIT still declares its charset",
    typeof second.type === "string" && /charset=utf-8/i.test(second.type),
    `got ${second.type}`,
  );

  // ── 3. A request with a cookie is never served from the cache ─────────────
  //
  // The one that matters. The homepage is warm at this point, so a cookied
  // request that hit the cache would be receiving a page rendered for somebody
  // else.
  const withSession = await get(base, "/", { cookie: "better-auth.session_token=pretend" });
  check(
    "a cookied request is bypassed, not served from the warm cache",
    withSession.cache === "BYPASS-cookie",
    `got ${withSession.cache}`,
  );
  check("the bypassed request still rendered a page", withSession.status === 200);

  const withCart = await get(base, "/", { cookie: "__Host-cart=abc" });
  check("a cart cookie also bypasses", withCart.cache === "BYPASS-cookie", `got ${withCart.cache}`);

  const withUnknownCookie = await get(base, "/", { cookie: "consent=1" });
  check(
    "ANY cookie bypasses, not only the ones we know about",
    withUnknownCookie.cache === "BYPASS-cookie",
    `got ${withUnknownCookie.cache}`,
  );

  // ── 4. A cookied response never enters the cache ──────────────────────────
  //
  // The mirror image of 3, and the more dangerous direction: storing a
  // Set-Cookie means handing one person's session to everybody who asks next.
  const cartPage = await get(base, "/carrello");
  check("the cart is bypassed by path", cartPage.cache === "BYPASS-path", `got ${cartPage.cache}`);
  if (cartPage.setCookie.length > 0) {
    const cartAgain = await get(base, "/carrello");
    check(
      "a page that sets a cookie is never replayed",
      cartAgain.cache === "BYPASS-path" && cartAgain.setCookie.length > 0,
      `got ${cartAgain.cache}, ${cartAgain.setCookie.length} Set-Cookie headers`,
    );
  }

  // ── 5. Staff pages and APIs are never cached ──────────────────────────────
  for (const path of [
    "/admin",
    "/admin/prodotti",
    "/admin/accedi",
    "/api/health",
    "/cassa",
    "/en/carrello",
    "/en/cassa",
  ]) {
    const response = await get(base, path);
    check(`${path} is never cached`, response.cache === "BYPASS-path", `got ${response.cache}`);
  }

  // Twice, because a path that was refused on the way in but stored on the way
  // out would only show up on the second request.
  const adminAgain = await get(base, "/admin/prodotti");
  check(
    "a second /admin/prodotti is still a bypass, not a hit",
    adminAgain.cache === "BYPASS-path",
    `got ${adminAgain.cache}`,
  );

  // ── 6. A redirect is not stored ───────────────────────────────────────────
  const login = await get(base, "/admin");
  check(
    "the anonymous admin redirect is still a redirect",
    login.status === 302 || login.status === 301,
    `got ${login.status}`,
  );

  // ── 7. Different URLs are different entries ───────────────────────────────
  const shop = await get(base, "/shop");
  const search = await get(base, "/shop?q=cover");
  check("a fresh path is a MISS", shop.cache === "MISS", `got ${shop.cache}`);
  check("a fresh query string is a MISS", search.cache === "MISS", `got ${search.cache}`);
  check(
    "the query string is not ignored",
    shop.body !== search.body,
    "a collection and a search returned the same bytes",
  );

  const shopAgain = await get(base, "/shop");
  const searchAgain = await get(base, "/shop?q=cover");
  check(
    "each is then served from its own entry",
    shopAgain.cache === "HIT" && searchAgain.cache === "HIT",
  );
  check(
    "and the bodies did not swap",
    shopAgain.body === shop.body && searchAgain.body === search.body,
  );

  // ── 8. The English mirror is a separate page ──────────────────────────────
  const english = await get(base, "/en");
  check("/en is its own entry", english.cache === "MISS", `got ${english.cache}`);
  check("/en is not the Italian homepage", english.body !== first.body);

  // ── 9. Invalidation reaches this worker ───────────────────────────────────
  //
  // Writing the shared version file is exactly what another Passenger worker's
  // bump does, so this exercises the real cross-worker path rather than a
  // simulation of it. The refresh is deliberately off the request path and
  // bounded by CacheVersion's interval, so the poll below allows for it.
  const warm = await get(base, "/");
  check("the homepage is warm before invalidating", warm.cache === "HIT", `got ${warm.cache}`);

  fs.writeFileSync(VERSION_FILE, String(Date.now() + 1000), "utf8");

  let invalidated = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const probe = await get(base, "/");
    if (probe.cache === "MISS") {
      invalidated = probe;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check(
    "a bump written by another worker invalidates this one",
    invalidated !== null,
    "still serving HITs 5s after the shared version file changed",
  );

  const rewarmed = await get(base, "/");
  check("and the cache refills afterwards", rewarmed.cache === "HIT", `got ${rewarmed.cache}`);

  // ── 10. The statistics endpoint is not public ─────────────────────────────
  const statsAnonymous = await fetch(`${base}/api/cache-stats`);
  check(
    "cache statistics are not readable without the job secret",
    statsAnonymous.status === 404,
    `got ${statsAnonymous.status}`,
  );

  const statsResponse = await fetch(`${base}/api/cache-stats`, {
    headers: { "x-job-secret": DEV_JOB_SECRET },
  });
  if (!statsResponse.ok) {
    throw new Error(
      `cache statistics unavailable: HTTP ${statsResponse.status}. ` +
        `Either the endpoint is not mounted or the job secret does not match.`,
    );
  }
  const stats = await statsResponse.json();
  console.log("\n  ── Cache statistics after the run ────────────────────────");
  console.log(`  entries      ${stats.entries}`);
  console.log(`  bytes held   ${(stats.bytes / 1024).toFixed(1)} KiB`);
  console.log(`  hits         ${stats.hits}`);
  console.log(`  misses       ${stats.misses}`);
  console.log(`  hit rate     ${stats.hitRate}`);
  console.log(`  refusals     ${JSON.stringify(stats.refusals)}`);

  check(
    "nothing under /admin ever entered the store",
    (stats.refusals.path ?? 0) >= 8,
    `only ${stats.refusals.path ?? 0} path refusals recorded`,
  );
  check(
    "the cookie rule fired",
    (stats.refusals.cookie ?? 0) >= 3,
    `only ${stats.refusals.cookie ?? 0} cookie refusals recorded`,
  );
  check(
    "the cache stayed inside its byte budget",
    stats.bytes <= 24 * 1024 * 1024,
    `${stats.bytes} bytes held`,
  );
} finally {
  await server.stop();
}

console.log("");
if (failed > 0) {
  console.error(`  ${failed} of ${checks.length} isolation checks FAILED`);
  process.exit(1);
}
console.log(`  ${checks.length} isolation checks passed against a real Node + MariaDB server.`);
console.log("  Lab evidence on one machine. Not a Hostinger measurement.");
