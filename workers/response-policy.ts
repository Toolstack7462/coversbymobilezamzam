/**
 * What every response says about caching, framing and indexing.
 *
 * ── Why this is a separate file ──────────────────────────────────────────────
 *
 * It lived in `workers/app.ts` and was exported from there so the tests could
 * reach it. That broke the Worker:
 *
 *     Incorrect type for map entry 'CSP_DEVELOPMENT':
 *     the provided value is not of type 'function or ExportedHandler'
 *
 * Every named export of a Worker entrypoint is treated by the runtime as an
 * entrypoint of its own — a handler, a Durable Object, a WorkerEntrypoint. A
 * string is none of those. The entry module may export its default handler and
 * nothing else.
 *
 * It is worth knowing how far that got: `npm run verify` passed, `wrangler
 * deploy` accepted it, the deployed site served 76/76 smoke checks, and only
 * `wrangler dev` refused to start — so the break was invisible everywhere
 * except on the machine of whoever next tried to work on the project.
 *
 * So the policy lives here, as ordinary module exports that tests can import
 * and the runtime never sees.
 */

/**
 * Environments whose responses must never be indexed.
 *
 * A preview is a working copy of a real shop on a public HTTPS address. If a
 * crawler finds it, the merchant ends up with two versions of their catalogue
 * competing in search results — and an indexed preview leaks order-confirmation
 * and tracking URLs, which carry order numbers and tracking tokens.
 */
export const NON_INDEXABLE_ENVIRONMENTS = new Set(["preview", "staging", "development", "test"]);

export const LOCAL_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Content Security Policy.
 *
 * ── About `script-src 'unsafe-inline'` ───────────────────────────────────────
 *
 * It is there because this application server-renders with streaming, and React
 * emits inline scripts to deliver each chunk of loader data as it resolves —
 * five of them on the homepage. Without `'unsafe-inline'` the page renders and
 * then never hydrates, and nothing on the site is interactive.
 *
 * The proper fix is a nonce, and it is not a small one. `<Scripts nonce>` covers
 * the two scripts React Router emits, but the streaming chunks come from React
 * itself and take their nonce from `renderToReadableStream({ nonce })` — which
 * means owning `app/entry.server.tsx`, a file this project deliberately does not
 * have. That is a change to make on purpose with the browser suite watching, not
 * a side effect of adding headers.
 *
 * So this policy does not stop injected inline script. It does stop the more
 * common half of the same attack — `<script src="https://evil.example/x.js">` —
 * which `'self'` refuses.
 *
 * The directives that cost nothing and are worth the most here:
 *
 *   frame-ancestors  the admin can verify a payment and change the IBAN that
 *                    customers are told to pay into. Those pages must not be
 *                    frameable by anyone, ever.
 *   form-action      a form silently retargeted at another origin is how
 *                    credentials and payment details leave.
 *   base-uri         an injected <base> rewrites every relative URL on the page,
 *                    including the ones the forms post to.
 *   object-src       no plugin content is used, so none should be permitted.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // Inline styles: the layout uses a handful of `style=` attributes, which no
  // nonce can ever cover — a nonce applies to <style> elements, not attributes.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "manifest-src 'self'",
];

/**
 * Development additionally needs a websocket to itself, for hot reload.
 *
 * Browsers disagree about whether `'self'` covers `ws:` on the same host, and a
 * policy that breaks `npm run dev` would be deleted by the next person who hit
 * it rather than fixed.
 */
export const CSP_PRODUCTION = [...CSP_DIRECTIVES, "connect-src 'self'"].join("; ");
export const CSP_DEVELOPMENT = [...CSP_DIRECTIVES, "connect-src 'self' ws: wss:"].join("; ");

/** Hardware and browser features this shop has no use for. */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * How long a response may be kept, and by whom.
 *
 * Everything here is `private`, and that word is load-bearing rather than a
 * default. These pages vary by cookie — the cart is a session — so a response
 * marked `public` may be stored by a shared cache and handed to the next person
 * who asks for the same URL. That is one customer's basket shown to another.
 *
 * Nothing carried any `Cache-Control` at all before this, which left the
 * decision to each browser's heuristics.
 */
export function cacheControlFor(pathname: string): string {
  // Staff pages and API responses carry order details, customer names, payment
  // state and sessions. Not merely revalidated — never written down.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/")) {
    return "private, no-store, max-age=0, must-revalidate";
  }

  // Storefront HTML may be kept by the browser that fetched it, but must be
  // revalidated before reuse: prices and stock change, and there is no
  // invalidation path that could reach a copy already handed out.
  return "private, no-cache, must-revalidate";
}
