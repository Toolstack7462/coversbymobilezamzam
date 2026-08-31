# Deployed preview audit — 31 August 2026

**Status: PREVIEW DEPLOYED — FIXES REQUIRED**

Audited against
`https://italian-tech-atelier-commerce-preview.genzdigitaltools7462.workers.dev`
over real HTTPS, in a real browser, with no code changed during the audit.

Two things need fixing before this goes in front of the merchant, and one
question needs answering. Everything else passed.

| #   | Finding                                                | Severity | Status                         |
| --- | ------------------------------------------------------ | -------- | ------------------------------ |
| 1   | The deployed cron has never been observed to run       | High     | **Open**                       |
| 2   | No security response headers at all                    | High     | **Fixed** — version `3a7d05ef` |
| 3   | No `Cache-Control` on any page, including admin        | Medium   | **Fixed** — version `3a7d05ef` |
| 4   | `Content-Type: text/html` with no charset              | Low      | Open                           |
| 5   | No product images exist, so image delivery is unproven | Low      | Open                           |

A sixth was found while fixing 2 and 3: **no static asset had ever carried the
`noindex` header**, despite a comment in `workers/app.ts` claiming the Worker
covered them. Cloudflare serves `build/client` without invoking the Worker at
all. Fixed in the same change, via `public/_headers`.

---

## 1. The cron took 82 minutes to start firing

**It works.** First observed run at **20:30:10 UTC** — `expire_reservations`,
`completed`, 582ms, nothing to release. But the Worker was first deployed with
its schedule at 19:08, and five windows passed with nothing at all:

| Window    | Result           |
| --------- | ---------------- |
| 19:15     | did not fire     |
| 19:30     | did not fire     |
| 19:45     | did not fire     |
| 20:00     | did not fire     |
| 20:15     | did not fire     |
| **20:30** | **fired, 582ms** |

For most of that period this looked like a broken cron, and it was investigated
as one. `scheduled_job_runs` was empty 54 minutes in, and a continuously running
`wrangler tail` captured 84 HTTP invocations and **zero** scheduled ones.

This is not an inference from silence. `expireReservations` writes a `running`
row to `scheduled_job_runs` as its very first statement, before it reads
anything — so a run that started and then failed would still leave a trace.
There is no trace.

The handler itself is fine. Invoked locally against a migrated D1:

    curl "http://127.0.0.1:8791/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"
    → ok

leaving `expire_reservations / completed / 16ms` in the table. And Cloudflare
confirms the schedule on every deploy:

    Deployed italian-tech-atelier-commerce-preview triggers
      schedule: */15 * * * *

So: handler correct, schedule accepted, execution never observed.

So the conclusion is not "the cron is broken" but something more useful, and
easy to mistake for a fault: **a newly created Worker's Cron Trigger is not
reliably active for over an hour**, even though Cloudflare accepts and echoes the
schedule on every deploy. Nothing needed re-applying and nothing was changed to
make it start.

Worth writing down because the natural reaction — redeploy, then redeploy again,
then start editing the handler — makes it worse rather than better, and because
the same silence would look identical to a genuinely broken sweeper. The way to
tell them apart is `scheduled_job_runs`: the sweeper writes its `running` row
before it reads anything, so a run that started and failed still leaves a trace.
No trace at all means it never started.

**Before launch**, confirm the schedule is firing on the production Worker after
its first deploy rather than assuming it inherited a working one. The sweeper is
what releases stock held by orders that were never paid; silently not running
means stock stays reserved and the shop shows items as out of stock while they
are not.

---

## 2. No security headers

None of these are present on any response:

    Content-Security-Policy      X-Frame-Options
    X-Content-Type-Options       Referrer-Policy
    Strict-Transport-Security    Permissions-Policy

The complete header set on `/` is `x-robots-tag` plus Cloudflare's own
`Report-To`, `Nel`, `Server`, `CF-RAY` and `alt-svc`. Nothing else.

`X-Frame-Options` (or a CSP `frame-ancestors`) is the one that matters most
here: the admin can verify a payment and change the bank details customers are
told to pay into, and without it those pages can be framed. `nosniff` and a
`Referrer-Policy` are cheap and should not be left out.

### Fixed

Deployed in version `3a7d05ef`. Every Worker response now carries a CSP,
`X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, a
`Permissions-Policy` denying eleven features the shop does not use,
`same-origin` COOP, and HSTS (one year, `includeSubDomains`, deliberately **not**
`preload` — preloading is submitted to a browser-maintained list and is slow to
undo).

`script-src` keeps `'unsafe-inline'`, and the code says why: streaming SSR has
React emitting inline scripts to deliver each chunk of loader data — five on the
homepage — and without it the page renders and never hydrates. Removing it needs
a nonce, and the streaming chunks take theirs from `renderToReadableStream`,
which means owning `app/entry.server.tsx`, a file this project does not have.
That is a deliberate change, not a side effect of adding headers. The policy
still refuses any cross-origin script source, which is the more common half of
the same attack.

Verified on the deployed site: 76/76 smoke checks, and a real browser reports no
console errors and no CSP violations on any page.

---

## 3. No cache directives

No `Cache-Control` on `/`, `/shop` or `/admin/accedi`. Admin pages in particular
should be `no-store`: they render order details, customer names and payment
state, and without a directive the browser's back/forward cache and any
intermediary decide the policy instead.

`/api/health` was the only exception and was already correct: `no-store`.

### Fixed

Also in `3a7d05ef`. Everything the Worker returns is now `private` — the
load-bearing word, since these pages vary by the session cookie and `public`
would let a shared cache hand one customer's basket to whoever asked for the
same URL next. Admin and API responses are `no-store`; storefront HTML is
`private, no-cache, must-revalidate`.

Fingerprinted assets went the other way, to `public, max-age=31536000,
immutable`. Cloudflare's default of `max-age=0, must-revalidate` had the browser
re-checking all fourteen bundles on every page load, for files whose names
contain a hash of their own contents and which cannot go stale.

## 4. Charset

`Content-Type: text/html` with no `; charset=utf-8`. The site is Italian and
full of accented characters. Most clients sniff UTF-8 correctly; the ones that
do not will show mojibake in product names.

## 5. No images

Every page has **zero** `<img>` elements. The demo catalogue was seeded without
media, so "images load" could not be tested at all — neither R2 delivery, nor
`/media/*`, nor layout with real images in place. CLS is currently 0 partly
because there is nothing to shift.

---

## What passed

**Identity.** Deployed `96938d8`, built from a clean tree, an ancestor of local
HEAD `8273297`. The only differences are six documentation files and one offline
Node script that never enters the Worker bundle — the deployed _application_
code is identical to HEAD. The branch was not on GitHub when the audit started;
it is now.

**Authentication over HTTPS.** The origin check is active and discriminating: a
forged `Origin` is refused `403 INVALID_ORIGIN`, while the real origin reaches
the credential check and is refused `401 INVALID_EMAIL_OR_PASSWORD`. That
distinction is the whole point — with `APP_BASE_URL` unset, as on the first
deploy, _both_ were refused, which looks like security working and is actually a
shop nobody can sign in to.

All 26 protected admin routes redirect an anonymous visitor to `/admin/accedi`.
No cookie is issued to an anonymous visitor, on the homepage or on a failed
sign-in. No `localhost` origin survives anywhere in the client bundles.

**Leakage.** 14 JS bundles totalling 373KB scanned: no secrets, no key-shaped
literals, no Cloudflare account id, no internal hostnames. Nothing in the HTML.
Malformed JSON returns a clean `400`; the 404 page leaks no stack, file path or
line number. `robots.txt` disallows everything, `x-robots-tag: noindex` is on
every route sampled, and `/sitemap.xml` is 404.

**Private storage.** Public `r2.dev` access is **disabled** on both EU buckets,
including the payment-proof bucket. `/media/` refuses proof-shaped paths and
path traversal.

**Storefront.** Four demo products, prices in correct Italian format
(`19,90 €`), stock wording present. Full-text search works over HTTPS — `cover`
returns one product, a nonsense term returns none. Add-to-cart works and the
item appears in the cart. The compatibility invariant holds: the one universal
product does not claim an exact fit.

**Performance**, measured rather than assumed:

| Page          | LCP (desktop) | LCP (390px) | CLS | TTFB      |
| ------------- | ------------- | ----------- | --- | --------- |
| Homepage      | 638ms         | 481ms       | 0   | 286–382ms |
| Catalogue     | 446ms         | 424ms       | 0   | 228–243ms |
| Product       | 580ms         | 553ms       | 0   | 387–409ms |
| Device finder | 533ms         | 575ms       | 0   | 365–435ms |
| Cart          | 470ms         | 463ms       | 0   | 251–304ms |
| Admin login   | 166ms         | 258ms       | 0   | 42–116ms  |

LCP is comfortably inside the 2.5s "good" threshold everywhere and CLS is zero
on every page at both widths. First load transfers 119KB of JS and 3.6KB of CSS
across 16 requests; subsequent pages transfer 3–5KB, the shared chunks already
being cached.

**INP and TBT were not measured.** They need interaction tracing, and claiming
them from a navigation-only run would be inventing numbers.

**Mobile at 390px.** No horizontal overflow on any page, no console errors, no
failed requests.

**Worker CPU.** Median 4–7ms against the free plan's 10ms, with peaks of 10–11ms
on the homepage and device finder. No `exceededCpu` outcome and no exceptions in
84 tailed invocations. Detail in
[free-plan-cpu-results.md](./free-plan-cpu-results.md).

**Resources.**

| Kind   | Name                                    | State                                                     |
| ------ | --------------------------------------- | --------------------------------------------------------- |
| Worker | `italian-tech-atelier-commerce-preview` | version `c49a18a9`, 100% of traffic                       |
| D1     | `ita-commerce-preview-db`               | EU (`EEUR`), 106 tables, 1.59 MB, 6 migrations, no errors |
| R2     | `ita-commerce-preview-media`            | EU, public access disabled                                |
| R2     | `ita-commerce-preview-proofs`           | EU, public access disabled                                |
| D1     | `ita-commerce-preview-restore-test`     | EU, disposable, holds a verified restore                  |

---

## What could not be tested, and why

**Everything behind the login.** There is no administrator account, and creating
one is not something this audit can do: the setup token lives only in the
merchant's password manager, and the password must be one only they know.

So the following remain **untested on the deployed environment**: the dashboard,
Setup Centre, products, orders, payments, settings, inventory and compatibility
screens; admin tables, filters, forms and validation; admin mobile layout;
session persistence and logout; TOTP enrolment and challenge.

They are covered by the browser suite against a local Workers runtime — 87
passing, including a real TOTP enrolment and challenge — but that is not the
same as HTTPS, and two of the three historical incidents can only be re-proven
with a real session:

| Incident                       | Deployed status                                                           |
| ------------------------------ | ------------------------------------------------------------------------- |
| `account.issuer` missing       | **Verified** — column present in the deployed database                    |
| `two_factor.verified` mismatch | Column present; the write path needs a real enrolment to re-prove         |
| Multiple `Set-Cookie` lost     | **Cannot be tested** — only a successful 2FA sign-in issues more than one |

Cookie `Secure`, `HttpOnly` and `SameSite` attributes are likewise unobservable:
no cookie is issued to a visitor who never signs in.

**Order creation, stock reservation, confirmation and tracking.** Checkout is
gated — _"Al momento non è possibile completare un ordine online"_ — because no
payment method is configured. That is correct for this state, and it means the
order pipeline cannot be exercised end to end here.

The next step is the merchant following
[first-admin-setup.md](./first-admin-setup.md).
