# Release review — storefront premium refinement

Reviewed, merged and deployed on 2026-09-14.

|                       |                                                             |
| --------------------- | ----------------------------------------------------------- |
| Reviewed branch       | `feat/storefront-premium-refinement`                        |
| Branch HEAD at review | `8c07f39`, then `430e689` arrived mid-review                |
| Starting `main`       | `0e98a14`                                                   |
| Released `main`       | `a0f5ae2`                                                   |
| Deployed release      | `releases/2026-09-14T17-35-00Z`                             |
| Rollback checkpoint   | tag `pre-release/storefront-premium-2026-09-14` → `0e98a14` |

The reference points in the brief were `9ed1989` (feature) and `0e98a14`
(main). `main` matched. `9ed1989` did **not** — it is the first of six commits
on that branch, not its tip. The branch had advanced to `8c07f39`, and then to
`430e689` while the review was running. The newer work was preserved and
rebased onto, never reset.

---

## 1. What was reviewed

Six commits, 44 files: brand assets (logo, favicon, apple-touch-icon), an
881-line storefront stylesheet, a reworked homepage and footer, cart and
product presentation, product-image filtering, route metadata, Italian and
English strings, plus the branch's own tests, acceptance notes and screenshots.

Checked specifically, and found correct:

| Concern                  | Finding                                                                                                                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront CSS isolation | `storefront.css` is loaded by `routes/storefront/layout.tsx` alone. It cannot reach the admin.                                                                                                                                                                                                            |
| Suppressed stock imagery | `saleableImageKey` quarantines by **object key**, not product id, so a merchant upload works immediately. A product whose image is suppressed stays in the catalogue and renders a labelled frame (`product.photo_pending`, translated in both locales) — not an invisible gap and not an invented photo. |
| Products are not hidden  | Only the featured **hero** slot requires a saleable image. Nothing is dropped from the shop.                                                                                                                                                                                                              |
| Admin touchpoint         | One line: a `service` page type, which the new homepage section reads. Coherent, not scope creep.                                                                                                                                                                                                         |
| Backend invariants       | Untouched by this branch. No change to compatibility levels, pricing, order snapshots, payment verification, reservations or permissions.                                                                                                                                                                 |

---

## 2. Defects found and fixed during review

### R-1 · A missing database variable was reported after the check, not before

`server/config.ts` collected problems and threw if any existed — but the four
`DB_*` variables were read with that same `required()` helper **inside the
returned object literal**, which is evaluated after the throw.

Proven before fixing: with all four removed, `loadConfig` returned
successfully carrying `{"host":"","port":3306,"user":"","password":"","name":""}`.

A deployment missing `DB_HOST` therefore started normally and failed on the
first query with a MySQL access-denied error for an empty user — which reads
like a wrong password on the database server, and sends you to hPanel to check
a credential that was never the problem.

Fixed by reading the four above the check. Nothing else uses `required()` after
it. Covered by `tests/unit/server-config.test.ts`, which generates a case per
required variable, missing and blank: 9 of its 20 cases failed before the fix.

Demonstrated end to end — starting `build/server-node/index.js` against an
isolated database with `DB_PASSWORD` unset now refuses to boot and prints
`DB_PASSWORD is not set`.

### R-2 · The deploy guard refused the deployment system's own files

`scripts/hostinger/deploy.mjs` refuses to deploy into a docroot containing
files it did not place, so a release cannot trample the merchant's other site.
Its allow-list held three names and omitted two that this same system creates:

- `.htaccess.bak` — written by `hostinger:configure`
- `tmp/` — holds Passenger's `restart.txt`

So every deploy after the first refused to run. This blocked the first attempt
at this release outright:

```
public_html contains files this deploy did not put there:
  .htaccess.bak, tmp
```

Fixed by naming both in the allow-list. Still exact names, not a relaxed
pattern — a genuine second website is refused exactly as before.

---

## 3. Verification

| Check                     | Result                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `npm ci`                  | clean, exit 0                                                                      |
| `npm run verify`          | **VERIFIED — 11 checks**                                                           |
| `npm run build:hostinger` | exit 0, emits `build/server-node/index.js`                                         |
| Production server startup | starts against an isolated MariaDB, `/api/health` ok                               |
| `npm run test:e2e`        | **189 passed, 9 skipped, 0 failed** (desktop, mobile, visual, storefront)          |
| `npm run test:e2e:cross`  | **20 passed, 3 skipped** (Firefox, WebKit)                                         |
| Responsive evidence       | 20 screenshots, 5 routes × 390 / 768 / 1366 / 1440 px, overflow assertions passing |
| Secret scan               | clean                                                                              |

Bundle budgets pass, but **storefront JavaScript is at 135.0 KB of 136.0 KB —
99%, about 1 KB of headroom.** The next customer-facing feature will breach it.
No budget was raised.

Nothing was skipped to make this pass, and no budget, gate or test was
weakened.

---

## 4. Deployment

Pipeline: **SSH release + Passenger, via `npm run hostinger:deploy`.** That is
what serves the site. Confirmed again during this release — pushing `main`
disturbed nothing, because Hostinger's Git deployment is a static flow that
cannot run an SSR process (see [build-fix.md](build-fix.md)).

Observed settings on the live account:

```
PassengerAppRoot     …/domains/<domain>/current
PassengerStartupFile build/server-node/index.js
PassengerAppType     node
PassengerNodejs      /opt/alt/alt-nodejs24/root/usr/bin/node
```

Node **24**, which satisfies `engines: >=22.22.0`. (An earlier note in
`live-deployment.md` recorded Node 20; the live directive says 24.)

No migration was run. This branch changes no schema, and the deploy script
never runs one.

Post-deploy: `/api/health` reports `commit: a0f5ae2…`, `dirty: false`,
`status: ok`, database ok, media and private buckets ok, `it` / `EUR` /
`Europe/Rome`. **The deployed SHA equals `origin/main`.**

---

## 5. Live smoke tests

All non-destructive. No order placed, no payment verified, no message sent, no
account altered.

|                                                                                                             |                                                       |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `/`, `/en`, `/shop`, `/en/shop`, `/trova-dispositivo`, `/prodotti/:slug`, `/negozio`, `/carrello`, `/cassa` | 200                                                   |
| `/admin/accedi`                                                                                             | 200                                                   |
| `/sitemap.xml`, `/robots.txt`                                                                               | 200                                                   |
| `/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png`, `/brand/logo.svg`                                  | 200                                                   |
| Title                                                                                                       | `Covers by Mobile Zam Zam                             | Accessori smartphone` |
| `og:site_name`                                                                                              | `Covers by Mobile Zam Zam`                            |
| `/en`                                                                                                       | `<html lang="en">`, English strings                   |
| Security headers                                                                                            | HSTS, `X-Frame-Options: DENY`, `nosniff`, CSP present |
| Admin cacheability                                                                                          | `private, no-store, max-age=0, must-revalidate`       |
| `/admin/pagamenti` unauthenticated                                                                          | 302 → `/admin/accedi?next=…`                          |
| Private media probe                                                                                         | 404                                                   |
| Unknown route                                                                                               | 404                                                   |

---

## 6. Remaining issues

**Storefront metadata is Italian on the English pages.** `/en` correctly serves
`lang="en"` and English content, but the `<title>` reads
`… | Accessori smartphone`, and `collection.tsx` builds `Ricerca: …` the same
way. This is systemic across storefront route `meta()` functions rather than a
single line, so it was recorded rather than patched after the release had been
verified and shipped. P2, SEO-facing.

**Storefront JS at 99% of budget.** 1 KB of headroom.

**No email provider.** `emailConfigured: false`. Password reset and any
transactional mail remain unavailable.

**Turnstile not configured.** `turnstileConfigured: false`.

**Hostinger Git auto-deployment is still connected** and still fails harmlessly
on every push to `main`. It cannot serve this application. Turning it off in
hPanel remains outstanding — it is noise, not a risk, because it never touches
`current`.

**The SSH password should be rotated.** The username, host and port were
committed to this public repository in an earlier revision.
