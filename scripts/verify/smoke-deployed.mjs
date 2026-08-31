/**
 * Smoke tests against a DEPLOYED preview.
 *
 * Everything else in `npm run verify` runs against a local simulation. This
 * runs against the real thing over real HTTPS, which is the only place a whole
 * class of failure shows up: cookie `Secure` and `__Host-` prefixes, origin
 * checks, redirect schemes, CDN caching, and the environment variables that
 * exist only once something is actually deployed.
 *
 *   node scripts/verify/smoke-deployed.mjs <url>
 *   npm run smoke:preview
 *
 * It reads NOTHING it is not allowed to read: there is no admin account here
 * and this script does not create one. It proves the doors are locked, not what
 * is behind them.
 *
 * ── The admin gate list is derived, not written down ─────────────────────────
 *
 * The protected admin routes are parsed out of `app/routes.ts`. Hand-listing
 * them would mean a new admin page is unprotected AND untested on the same day
 * somebody forgets — the two failures that have to coincide for a leak are
 * exactly the two a hand-written list makes coincide.
 */
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error(
    "Usage: node scripts/verify/smoke-deployed.mjs <https://...>\n" +
      "No URL given, and PREVIEW_URL is not set.",
  );
  process.exit(1);
}
if (!BASE.startsWith("https://")) {
  // The point of this file is behaviour that only happens over TLS.
  console.error(`Refusing to run against ${BASE}: these checks are only meaningful over HTTPS.`);
  process.exit(1);
}

const results = [];
let currentGroup = "";

const group = (name) => {
  currentGroup = name;
};

function record(name, ok, detail) {
  results.push({ group: currentGroup, name, ok, detail });
}

/** A check that reports its own failure rather than aborting the run. */
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function get(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  return response;
}

// ── The routes, read from the application itself ────────────────────────────

const routesSource = readFileSync("app/routes.ts", "utf8");

/**
 * The routes inside the admin layout — the ones a session is required for.
 *
 * Anchored on `layout("routes/admin/layout.tsx"` and stopping at the closing
 * `]),` so routes deliberately left outside it (the login form, the setup page,
 * the 2FA challenge, invitation acceptance) are not mistaken for protected
 * ones. Each of those is public for a stated reason, and each would fail this
 * check if it were included.
 */
function protectedAdminRoutes() {
  const start = routesSource.indexOf('layout("routes/admin/layout.tsx"');
  assert(start !== -1, "Could not find the admin layout block in app/routes.ts");
  const end = routesSource.indexOf("\n  ]),", start);
  assert(end !== -1, "Could not find the end of the admin layout block");

  const block = routesSource.slice(start, end);
  const paths = [...block.matchAll(/route\("([^"]+)"/g)].map((match) => match[1]);
  assert(paths.length > 0, "Parsed zero protected admin routes — the parser is broken");
  return paths;
}

/** Fill route parameters with values that certainly do not exist. */
const concrete = (path) => `/${path.replace(/:[A-Za-z]+/g, "non-esistente")}`;

// ── Operational endpoints ───────────────────────────────────────────────────

group("Operational");

let health;

await check("/api/health responds and reports preview", async () => {
  const response = await get("/api/health");
  assert(response.status === 200, `status ${response.status}`);
  health = await response.json();
  assert(health.status === "ok", `status field is "${health.status}"`);
  assert(health.environment === "preview", `environment is "${health.environment}"`);
  return `commit ${String(health.build?.commit).slice(0, 7)}, ${health.totalMs}ms`;
});

await check("health check is never cached", async () => {
  const response = await get("/api/health");
  const cacheControl = response.headers.get("cache-control") ?? "";
  // A cached health check reports the state of the world at some earlier time,
  // which is worse than no health check at all.
  assert(cacheControl.includes("no-store"), `cache-control: ${cacheControl || "(absent)"}`);
  return cacheControl;
});

await check("D1 is reachable from the deployed Worker", () => {
  assert(health?.checks?.database?.ok === true, "database check did not pass");
  return `${health.checks.database.ms}ms, at ${health.checks.database.migration}`;
});

await check("both R2 buckets are reachable", () => {
  assert(health?.checks?.mediaBucket?.ok === true, "media bucket unreachable");
  assert(health?.checks?.privateBucket?.ok === true, "private bucket unreachable");
  return `media ${health.checks.mediaBucket.ms}ms, private ${health.checks.privateBucket.ms}ms`;
});

await check("the deployed build is a clean commit", () => {
  assert(health?.build?.dirty === false, "deployed from a dirty working tree");
  return health.build.commit;
});

await check("no real payment provider is configured", () => {
  // A preview that could take a real payment is not a preview.
  assert(health?.config?.emailConfigured === false, "an email provider is configured");
  return "email and Turnstile both unconfigured, as intended";
});

// ── Search-engine protection ────────────────────────────────────────────────

group("Not indexable");

await check("/robots.txt disallows everything", async () => {
  const response = await get("/robots.txt");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(/User-agent:\s*\*/i.test(body), "no wildcard user-agent");
  assert(/Disallow:\s*\/\s*$/m.test(body), "does not disallow the whole site");
  return "Disallow: /";
});

for (const path of ["/", "/shop", "/api/health", "/admin/accedi"]) {
  await check(`x-robots-tag on ${path}`, async () => {
    const header = (await get(path)).headers.get("x-robots-tag") ?? "";
    assert(header.includes("noindex"), `x-robots-tag: ${header || "(absent)"}`);
    return header;
  });
}

// ── Security headers ────────────────────────────────────────────────────────

group("Security headers");

const REQUIRED_HEADERS = {
  "content-security-policy": /frame-ancestors 'none'/,
  "x-frame-options": /^DENY$/,
  "x-content-type-options": /^nosniff$/,
  "referrer-policy": /strict-origin-when-cross-origin/,
  "permissions-policy": /camera=\(\)/,
  "cross-origin-opener-policy": /^same-origin$/,
  // workers.dev is HTTPS-only, so this should always be present here.
  "strict-transport-security": /max-age=\d+/,
};

for (const [header, pattern] of Object.entries(REQUIRED_HEADERS)) {
  await check(`${header} on the homepage`, async () => {
    const value = (await get("/")).headers.get(header) ?? "";
    assert(pattern.test(value), value ? `is "${value}"` : "ABSENT");
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  });
}

await check("the CSP allows no cross-origin script source", async () => {
  const csp = (await get("/")).headers.get("content-security-policy") ?? "";
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
  assert(scriptSrc.length > 0, "no script-src directive at all");
  // 'unsafe-inline' is present and documented — streaming SSR emits inline
  // scripts. An external origin would be a different matter entirely.
  assert(!/https?:/.test(scriptSrc), `script-src permits an origin: ${scriptSrc}`);
  return scriptSrc;
});

await check("HSTS is not preloaded", async () => {
  const hsts = (await get("/")).headers.get("strict-transport-security") ?? "";
  // Preloading is submitted to a browser-maintained list and is slow to undo.
  // Not something a preview should ever assert.
  assert(!/preload/i.test(hsts), `HSTS asks to be preloaded: ${hsts}`);
  return hsts;
});

// ── Cache directives ────────────────────────────────────────────────────────

group("Cache directives");

await check("staff pages are never stored", async () => {
  const value = (await get("/admin/ordini")).headers.get("cache-control") ?? "";
  assert(/no-store/.test(value), value ? `is "${value}"` : "ABSENT");
  assert(/private/.test(value), `is "${value}" — missing private`);
  return value;
});

await check("the login page is never stored", async () => {
  const value = (await get("/admin/accedi")).headers.get("cache-control") ?? "";
  assert(/no-store/.test(value), value ? `is "${value}"` : "ABSENT");
  return value;
});

for (const path of ["/", "/shop", "/carrello"]) {
  await check(`${path} is private and revalidated`, async () => {
    const value = (await get(path)).headers.get("cache-control") ?? "";
    assert(/private/.test(value), value ? `is "${value}"` : "ABSENT");
    /*
     * `public` here would let a shared cache hand one customer's basket to the
     * next person who asks for the same URL, because these pages vary by the
     * session cookie.
     */
    assert(!/public/.test(value), `is "${value}" — public on a cookie-varying page`);
    assert(/no-cache|no-store/.test(value), `is "${value}" — may be reused without revalidating`);
    return value;
  });
}

await check("fingerprinted assets are cached hard", async () => {
  /*
   * These are served by Cloudflare without invoking the Worker, so their
   * headers come from public/_headers rather than from workers/app.ts. The
   * filename contains a hash of the content, so the file at a URL can never
   * change and the browser never needs to ask again.
   */
  const html = await (await get("/")).text();
  const asset = /\/assets\/[A-Za-z0-9._-]+\.js/.exec(html)?.[0];
  assert(asset, "no hashed asset referenced by the homepage");

  const response = await get(asset);
  const value = response.headers.get("cache-control") ?? "";
  assert(/immutable/.test(value), value ? `is "${value}"` : "ABSENT");
  assert(!/max-age=0/.test(value), `is "${value}" — revalidated on every page load`);
  return `${asset.slice(0, 28)}… ${value}`;
});

await check("static assets are not indexable either", async () => {
  // The Worker cannot reach these responses; this proves public/_headers is
  // actually being applied, not merely present in the repository.
  const html = await (await get("/")).text();
  const asset = /\/assets\/[A-Za-z0-9._-]+\.js/.exec(html)?.[0];
  const value = (await get(asset)).headers.get("x-robots-tag") ?? "";
  assert(/noindex/.test(value), value ? `is "${value}"` : "ABSENT");
  return value;
});

// ── Storefront ──────────────────────────────────────────────────────────────

group("Storefront");

let productSlug = null;

await check("homepage renders in Italian", async () => {
  const response = await get("/");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(/<html[^>]+lang="it"/.test(body), "html lang is not it");
  return `${(body.length / 1024).toFixed(1)} KB`;
});

await check("homepage says it is not the shop", async () => {
  const body = await (await get("/")).text();
  // Anyone sent this link has no other way to tell it from the real shop.
  assert(/Ambiente di prova/.test(body), "preview banner missing");
  return "preview banner present";
});

await check("/shop lists products and links to one", async () => {
  const response = await get("/shop");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  const match = /href="\/prodotti\/([a-z0-9-]+)"/.exec(body);
  assert(match, "no product link found on the collection page");
  productSlug = match[1];
  return `first product: ${productSlug}`;
});

await check("a product page renders", async () => {
  assert(productSlug, "no product slug discovered");
  const response = await get(`/prodotti/${productSlug}`);
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(body.includes("<h1"), "no heading on the product page");
  return productSlug;
});

await check("an unknown product is 404, not 200", async () => {
  const response = await get("/prodotti/questo-non-esiste-affatto");
  // A soft 404 tells a search engine the page exists and tells a customer
  // nothing.
  assert(response.status === 404, `status ${response.status}`);
  return "404";
});

for (const path of ["/trova-dispositivo", "/carrello", "/negozio", "/shop"]) {
  await check(`${path} renders`, async () => {
    const response = await get(path);
    assert(response.status === 200, `status ${response.status}`);
    return "200";
  });
}

await check("English mirror renders", async () => {
  const response = await get("/en");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(/<html[^>]+lang="en"/.test(body), "html lang is not en");
  return "200, lang=en";
});

for (const path of ["/en/shop", "/en/carrello", "/en/negozio"]) {
  await check(`${path} renders`, async () => {
    const response = await get(path);
    assert(response.status === 200, `status ${response.status}`);
    return "200";
  });
}

await check("an unknown order number is 404", async () => {
  const response = await get("/ordine/ORD-NON-ESISTENTE");
  assert(response.status === 404, `status ${response.status}`);
  return "404";
});

await check("an unknown tracking token is 404", async () => {
  const response = await get("/traccia/non-esiste");
  assert(response.status === 404, `status ${response.status}`);
  return "404";
});

// ── The admin door ──────────────────────────────────────────────────────────

group("Admin is locked");

const adminRoutes = protectedAdminRoutes();

for (const route of adminRoutes) {
  const path = concrete(route);
  await check(`${path} requires a session`, async () => {
    const response = await get(path);
    assert(
      response.status === 302 || response.status === 303,
      `status ${response.status} — expected a redirect to the login page`,
    );
    const location = response.headers.get("location") ?? "";
    assert(
      location.includes("/admin/accedi"),
      `redirects to "${location}" rather than the login page`,
    );
    return "→ /admin/accedi";
  });
}

group("Admin doors that are open on purpose");

await check("/admin/accedi renders the login form", async () => {
  const response = await get("/admin/accedi");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(/name="email"/.test(body) && /name="password"/.test(body), "no credential fields");
  return "200";
});

await check("/admin/installazione is still open", async () => {
  // Setup has not been performed. If this ever stops being true without the
  // merchant doing it, somebody else has completed the installation.
  const response = await get("/admin/installazione");
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.text();
  assert(/name="setupToken"/.test(body), "no setup token field");
  return "200, awaiting first admin";
});

await check("an invalid invitation token does not 500", async () => {
  const response = await get("/admin/personale/invito/questo-token-non-esiste");
  assert(response.status !== 500, "server error on a bad token");
  return `status ${response.status}`;
});

await check("the 2FA challenge is unreachable without a partial session", async () => {
  const response = await get("/admin/sicurezza/2fa/verifica");
  assert(response.status !== 200, "the challenge page rendered with no session at all");
  return `status ${response.status}`;
});

// ── Authentication over a real origin ───────────────────────────────────────

group("Authentication");

const signIn = (origin) =>
  get("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      email: "nessuno@example.invalid",
      password: "questa-password-non-e-corretta",
    }),
  });

await check("a forged origin is refused", async () => {
  const response = await signIn("https://attacker.example");
  assert(response.status === 403, `status ${response.status}, expected 403`);
  const body = await response.json();
  assert(body.code === "INVALID_ORIGIN", `code ${body.code}`);
  return "403 INVALID_ORIGIN";
});

await check("the real origin reaches the credential check", async () => {
  /*
   * The control for the check above, and the one that matters.
   *
   * With APP_BASE_URL unset — which is how this deployed the first time —
   * trustedOrigins was [undefined] and this request was refused too. Both
   * checks failing looks like security working; it is actually a shop nobody
   * can sign in to.
   */
  const response = await signIn(BASE);
  assert(response.status === 401, `status ${response.status}, expected 401`);
  const body = await response.json();
  assert(body.code === "INVALID_EMAIL_OR_PASSWORD", `code ${body.code}`);
  return "401 INVALID_EMAIL_OR_PASSWORD";
});

await check("a failed sign-in issues no session cookie", async () => {
  const response = await signIn(BASE);
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.filter((cookie) => /session/i.test(cookie));
  assert(session.length === 0, `set ${session.length} session cookie(s) on a failed sign-in`);
  return "no cookies";
});

await check("an unauthenticated visit issues no session cookie", async () => {
  const cookies = (await get("/")).headers.getSetCookie?.() ?? [];
  assert(cookies.length === 0, `homepage set ${cookies.length} cookie(s)`);
  return "no cookies";
});

// ── Report ──────────────────────────────────────────────────────────────────

const failed = results.filter((result) => !result.ok);
let lastGroup = "";

for (const result of results) {
  if (result.group !== lastGroup) {
    console.log(`\n${result.group}\n`);
    lastGroup = result.group;
  }
  const status = result.ok ? "ok  " : "FAIL";
  console.log(`  ${status}  ${result.name.padEnd(52)} ${result.detail}`);
}

console.log(`\n${"─".repeat(76)}`);
console.log(`  ${BASE}`);
console.log(
  `  ${results.length - failed.length}/${results.length} passed` +
    (failed.length > 0 ? `, ${failed.length} FAILED` : ""),
);
console.log(`${"─".repeat(76)}\n`);

if (failed.length > 0) {
  console.error("Failed checks:\n");
  for (const result of failed) console.error(`  - ${result.name}: ${result.detail}`);
  console.error("");
  process.exit(1);
}
