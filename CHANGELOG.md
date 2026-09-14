# Changelog

Notable changes. Newest first.

Versions are not published to a registry, so entries are grouped by milestone
rather than semver tag.

## 2026-09-14 — storefront premium refinement (deployed)

Released `a0f5ae2` to https://coversbymobile.com as
`releases/2026-09-14T17-35-00Z`. Rollback checkpoint:
`pre-release/storefront-premium-2026-09-14` (`0e98a14`).

### Added

- Storefront premium refinement: brand logo, favicon and apple-touch-icon,
  reworked homepage and footer, cart and product presentation, an 881-line
  scoped storefront stylesheet, and a `service` page type in the admin that the
  new homepage section reads.
- Product-image quarantine by object key, so suppressed stock photography
  leaves a labelled, translated empty frame rather than an invented photo — and
  a merchant upload takes effect immediately.
- A `storefront` Playwright project: 5 routes at 390 / 768 / 1366 / 1440 px
  with horizontal-overflow assertions and captured screenshots.
- `tests/unit/server-config.test.ts` — one case per required environment
  variable, missing and blank.

### Fixed

- **A missing database variable was reported after the check, not before.**
  `server/config.ts` read the four `DB_*` values inside the returned object
  literal, which is evaluated after `if (problems.length > 0) throw`. A
  deployment missing `DB_HOST` started normally carrying empty credentials and
  failed on the first query with a MySQL access-denied error for an empty user —
  which reads like a wrong password on the database server, and sends you to
  hPanel to check a credential that was never the problem. It now fails at
  startup, naming the variable.
- **The deploy guard refused the deployment system's own files.** Its
  allow-list omitted `.htaccess.bak` and `tmp/`, both created by
  `hostinger:configure` and Passenger, so every deploy after the first refused
  to run. This blocked the first attempt at this release.

### Known issues

- Storefront route metadata is Italian on the English pages: `/en` serves
  `lang="en"` and English content, but the `<title>` reads
  `… | Accessori smartphone`. Systemic across storefront `meta()` functions.
- Storefront JavaScript is at 135.0 KB of a 136.0 KB budget — 99%.
- No email provider configured, so there is still no password reset.
- Hostinger Git auto-deployment remains connected and fails harmlessly on every
  push; it cannot serve an SSR application.

## Unreleased

### Added

- **Phase 0** — environment audit, dependency compatibility verification,
  repository created with its own `.git`.
- **Phase 1** — `CLAUDE.md`, fourteen invariants, three status machines, ten
  ADRs, twelve project-local skills, eight read-only review subagents, CI.
- **Phase 2/3** — full D1 schema (60 tables), forward-only migration, and the
  pure domain layer: money, compatibility resolution, order/payment/fulfilment
  status machines, price and discount rules, availability, order numbers,
  WhatsApp message composition, configuration gates, permissions.
- **Phase 5/6 (partial)** — storefront: home, listing, product, device finder,
  cart, checkout, order confirmation, order tracking, shop page. Italian and
  English. Order creation with an atomic stock reservation, and the cron
  reservation sweeper.
- Verification: `npm run verify` runs ten gates. 173 unit tests and 31
  integration/security tests pass.
- Operational scripts: backup, restore verification, inventory reconciliation,
  media inventory, seed, locale parity, migration drift, bundle budgets, secret
  scan.

### Fixed during development

- SQLite treats NULLs as distinct in a unique index, so the original composite
  index would have allowed two contradictory product-level compatibility rows
  for one device. Replaced with partial unique indexes split on nullability.
- The reservation guard was a conditional `WHERE`, which is a **silent no-op**
  inside a D1 batch. Replaced with a CHECK constraint that throws. Found while
  writing the concurrency test.
- `normaliseOrderNumberInput` mapped `I` to `1` across the whole string, turning
  every pasted `ITA-…` into `1TA-…`.
- `delivered` and `collected` were listed as terminal order statuses, which
  would have made a lawful 14-day withdrawal impossible to record.
- A literal U+00A0 inside a regex character class in the money parser.

### Not built in this pass

Authentication, the admin panel, the payment verification screen, RBAC
enforcement, import/export, proof upload, FTS5 search, browser tests and the
outbox worker. See `docs/known-limitations.md` §2b.

### Notes

- No production deployment. No Cloudflare resources created.
- No GitHub remote: `gh` is installed but not authenticated.
- Status: **DO NOT LAUNCH** — see `docs/launch-checklist.md`.
